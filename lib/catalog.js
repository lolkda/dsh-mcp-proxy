/**
 * Read-only views over the MCP tools currently visible to one agent.
 *
 * Nothing here mutates the registry or stores per-session state. Every call
 * derives its answer from `tools.schemas(agent)`, so a reconnect, a renamed
 * tool, or a newly added server is reflected on the next call.
 *
 * @module @lolkda/dsh-mcp-proxy/catalog
 */

/**
 * Whether a tool name belongs to the configured MCP namespace.
 * @param {unknown} name - tool name.
 * @param {string} prefix - configured prefix, normally `mcp__`.
 * @returns {boolean} whether this is an MCP tool name.
 */
export function isMcpName(name, prefix) {
  return typeof name === 'string' && name.startsWith(prefix) && name.length > prefix.length
}

/**
 * Extract the MCP server segment from `mcp__<server>__<tool>`.
 * @param {string} name - MCP tool name.
 * @param {string} prefix - configured prefix.
 * @returns {string} server name, or `unknown` for a non-standard shape.
 */
export function serverOf(name, prefix) {
  if (!isMcpName(name, prefix)) return 'unknown'
  const rest = name.slice(prefix.length)
  const separator = rest.indexOf('__')
  return separator <= 0 ? 'unknown' : rest.slice(0, separator)
}

/**
 * Truncate one description without splitting a surrogate pair.
 * @param {unknown} value - raw description.
 * @param {number} maxChars - maximum output code points.
 * @returns {string} truncated description.
 */
export function truncateDescription(value, maxChars) {
  if (typeof value !== 'string') return ''
  const limit = Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : 200
  const chars = [...value]
  if (chars.length <= limit) return value
  return `${chars.slice(0, Math.max(0, limit - 1)).join('')}…`
}

/**
 * Read the agent's current MCP schemas. Registry failures degrade to an empty
 * list: the proxy must never break an assembly because a provider is absent.
 * @param {object} tools - tool registry service.
 * @param {object} agent - calling agent.
 * @param {string} prefix - configured MCP prefix.
 * @returns {Array<object>} MCP schemas.
 */
export function readMcpSchemas(tools, agent, prefix) {
  try {
    const schemas = tools?.schemas?.(agent)
    if (!Array.isArray(schemas)) return []
    return schemas.filter((schema) => isMcpName(schema?.name, prefix))
  } catch {
    return []
  }
}

/**
 * Whether the agent currently has at least one MCP tool.
 * @param {object} tools - tool registry service.
 * @param {object} agent - calling agent.
 * @param {string} prefix - configured MCP prefix.
 * @returns {boolean} whether any MCP tool is visible.
 */
export function hasMcpTools(tools, agent, prefix) {
  return readMcpSchemas(tools, agent, prefix).length > 0
}

/**
 * Project one MCP schema onto a compact listing row.
 * @param {object} schema - MCP schema.
 * @param {string} prefix - configured MCP prefix.
 * @param {number} maxDescriptionChars - description budget.
 * @returns {{name: string, server: string, description: string}} listing row.
 */
function listingRow(schema, prefix, maxDescriptionChars) {
  return {
    name: schema.name,
    server: serverOf(schema.name, prefix),
    description: truncateDescription(schema.description, maxDescriptionChars),
  }
}

/**
 * List every MCP tool visible to the agent.
 * @param {object} tools - tool registry service.
 * @param {object} agent - calling agent.
 * @param {{prefix: string, descriptionMaxChars: number}} options - proxy options.
 * @param {string} [server] - optional server filter.
 * @returns {Array<{name: string, server: string, description: string}>} rows.
 */
export function listMcpTools(tools, agent, options, server) {
  const wanted = typeof server === 'string' ? server.trim() : ''
  return readMcpSchemas(tools, agent, options.prefix)
    .map((schema) => listingRow(schema, options.prefix, options.descriptionMaxChars))
    .filter((row) => wanted === '' || row.server === wanted)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/**
 * Score one tool against a natural-language query. The ranking is deliberately
 * simple and deterministic: exact name, name substring, description substring,
 * then individual query tokens.
 * @param {object} schema - MCP schema.
 * @param {string} query - normalized query.
 * @param {readonly string[]} tokens - normalized query tokens.
 * @returns {number} relevance score.
 */
function scoreSchema(schema, query, tokens) {
  const name = String(schema?.name ?? '').toLowerCase()
  const description = String(schema?.description ?? '').toLowerCase()
  let score = 0
  if (name === query) score += 1000
  if (name.includes(query)) score += 100
  if (description.includes(query)) score += 20
  for (const token of tokens) {
    if (name.includes(token)) score += 10
    if (description.includes(token)) score += 2
  }
  return score
}

/**
 * Search the visible MCP tools.
 * @param {object} tools - tool registry service.
 * @param {object} agent - calling agent.
 * @param {{prefix: string, descriptionMaxChars: number, searchLimit: number}} options - proxy options.
 * @param {{query?: unknown, server?: unknown, limit?: unknown}} input - search input.
 * @returns {{total: number, tools: Array<{name: string, server: string, description: string}>}} results.
 */
export function searchMcpTools(tools, agent, options, input = {}) {
  const query = typeof input.query === 'string' ? input.query.trim().toLowerCase() : ''
  if (query === '') return { total: 0, tools: [] }
  const tokens = query.split(/\s+/).filter((token) => token.length > 0)
  const server = typeof input.server === 'string' ? input.server.trim() : ''
  const requestedLimit = Number.isFinite(input.limit) ? Math.floor(input.limit) : options.searchLimit
  const limit = Math.min(Math.max(requestedLimit > 0 ? requestedLimit : options.searchLimit, 1), 50)
  const matches = readMcpSchemas(tools, agent, options.prefix)
    .filter((schema) => server === '' || serverOf(schema.name, options.prefix) === server)
    .map((schema) => ({ schema, score: scoreSchema(schema, query, tokens) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || (a.schema.name < b.schema.name ? -1 : a.schema.name > b.schema.name ? 1 : 0))
  return {
    total: matches.length,
    tools: matches
      .slice(0, limit)
      .map(({ schema }) => listingRow(schema, options.prefix, options.descriptionMaxChars)),
  }
}

/**
 * Read one MCP tool's complete parameter schema.
 * @param {object} tools - tool registry service.
 * @param {object} agent - calling agent.
 * @param {{prefix: string}} options - proxy options.
 * @param {unknown} name - exact tool name.
 * @returns {{found: boolean, name: string, server?: string, description?: string, parameters?: object}} result.
 */
export function describeMcpTool(tools, agent, options, name) {
  const requested = typeof name === 'string' ? name.trim() : ''
  if (!isMcpName(requested, options.prefix)) {
    return {
      found: false,
      name: requested,
      hint: `Tool names must start with "${options.prefix}".`,
    }
  }
  const schema = readMcpSchemas(tools, agent, options.prefix).find((entry) => entry.name === requested)
  if (schema === undefined) {
    return {
      found: false,
      name: requested,
      hint: 'No MCP tool with that exact name is visible. Use mcp_list or mcp_search first.',
    }
  }
  return {
    found: true,
    name: schema.name,
    server: serverOf(schema.name, options.prefix),
    description: schema.description ?? '',
    parameters: schema.parameters ?? { type: 'object', additionalProperties: true },
  }
}
