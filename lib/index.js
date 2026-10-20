/**
 * dsh-mcp-proxy — native-mode MCP discovery proxy.
 *
 * The plugin is a top-level profile entry, but every capability is installed on
 * one agent's scoped context. It therefore applies to all native presets
 * without registering global tools or changing PTC/codemode/tool-discovery
 * sessions, which already own their own disclosure model.
 *
 * Model-facing shape:
 *   - every `mcp__*` tool is removed from the request;
 *   - four small tools (`mcp_list`, `mcp_search`, `mcp_describe`, `mcp_call`)
 *     are added when the agent actually has MCP tools;
 *   - a direct model call to `mcp__*` is denied by a monotonic guard;
 *   - `mcp_call` executes the hidden tool through the public registry with a
 *     `parent` token, so the guard can distinguish it from a direct call.
 *
 * There is no session state: no loaded set, no journal, no compaction hook.
 * `mcp_list`/`mcp_search` always read the registry's current view.
 *
 * @module @lolkda/dsh-mcp-proxy
 */

import {
  describeMcpTool,
  hasMcpTools,
  isMcpName,
  listMcpTools,
  searchMcpTools,
} from './catalog.js'
import { callMcpTool } from './call.js'

/** Loader diagnostic name. */
export const name = 'mcp-proxy'

/** Host services used by this plugin. Agent-scoped tools are resolved per agent. */
export const inject = ['tools', 'systemPrompt']

/** Model-facing proxy tools. */
const PROXY_TOOL_NAMES = Object.freeze(['mcp_list', 'mcp_search', 'mcp_describe', 'mcp_call'])

/** A visible marker from another disclosure system means: do not add a second layer. */
const SKIP_MARKERS = Object.freeze(['run_code', 'code_run', 'tool_load'])

/** Prompt section name; intentionally distinct from MCP's own `mcp:*` sections. */
const SECTION_NAME = 'preset:mcp-proxy'

/** Late prompt position, after the standard tool sections. */
const SECTION_ORDER = 900

/** Guard reason shown to a model that guesses a hidden MCP name. */
const DIRECT_CALL_REASON =
  'MCP tools are hidden from the tool list. Use mcp_list or mcp_search, then mcp_describe for the schema, then mcp_call to execute.'

/** Compact usage section; emitted only when the agent actually has MCP tools. */
const PROMPT = `## MCP tools

MCP tools are hidden from your tool list. Use:
- \`mcp_list\` to browse every MCP tool (optionally with \`server\`);
- \`mcp_search({ query, server?, limit? })\` to find a tool by name or description;
- \`mcp_describe({ name })\` to read its complete parameter schema;
- \`mcp_call({ name, arguments })\` to execute it.

Do not call a tool whose name starts with \`mcp__\` directly; that call is rejected. MCP resource tools remain available separately.`

/** Output schema shared by the proxy tools. */
const OUTPUT_SCHEMA = Object.freeze({ type: 'object', additionalProperties: true })

/**
 * Read a plain value or a schemastery-style volatile ref.
 * @param {unknown} value - config value.
 * @param {unknown} fallback - fallback when unset.
 * @returns {unknown} current value.
 */
function readValue(value, fallback) {
  if (value !== null && typeof value === 'object' && typeof value.get === 'function') return value.get()
  return value ?? fallback
}

/**
 * Normalize one positive integer.
 * @param {unknown} value - raw config value.
 * @param {number} fallback - default.
 * @param {number} maximum - clamp.
 * @returns {number} normalized value.
 */
function positiveInt(value, fallback, maximum) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return fallback
  return Math.min(Math.floor(number), maximum)
}

/**
 * Normalize plugin config.
 * @param {object} [config] - loader config.
 * @returns {{enabled: boolean, prefix: string, searchLimit: number, descriptionMaxChars: number}} options.
 */
export function normalizeConfig(config = {}) {
  const prefix = readValue(config.prefix, 'mcp__')
  return {
    enabled: readValue(config.enabled, true) !== false,
    prefix: typeof prefix === 'string' && prefix.length > 0 ? prefix : 'mcp__',
    searchLimit: positiveInt(readValue(config.searchLimit, 10), 10, 50),
    descriptionMaxChars: positiveInt(readValue(config.descriptionMaxChars, 200), 200, 2000),
  }
}

/**
 * Render a JSON value as one text block.
 * @param {unknown} _args - tool arguments (unused).
 * @param {unknown} value - tool result.
 * @returns {Array<{type: 'text', text: string}>} rendered content.
 */
function renderJson(_args, value) {
  return [{ type: 'text', text: JSON.stringify(value ?? null, null, 2) }]
}

/**
 * Build one registry-ready tool definition.
 * @param {string} toolName - model-facing name.
 * @param {string} description - model-facing description.
 * @param {object} parameters - JSON Schema object.
 * @param {boolean} concurrent - whether sibling calls may overlap.
 * @param {(args: object, exec: object) => Promise<unknown> | unknown} execute - body.
 * @returns {object} tool definition.
 */
function definition(toolName, description, parameters, concurrent, execute) {
  return {
    name: toolName,
    description,
    parameters,
    output: { schema: OUTPUT_SCHEMA, render: renderJson },
    isConcurrencySafe: () => concurrent,
    execute,
  }
}

/**
 * Build the four proxy tools for one agent.
 * @param {object} options - normalized plugin config.
 * @param {object} tools - agent-scoped tool registry.
 * @param {object} agent - owning agent.
 * @returns {object[]} tool definitions.
 */
function createProxyTools(options, tools, agent) {
  return [
    definition(
      'mcp_list',
      'List every MCP tool currently available to this agent. Returns name, server and a short description; use mcp_describe for the full parameter schema.',
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          server: { type: 'string', description: 'Optional MCP server name to filter by.' },
        },
      },
      true,
      (args, exec) => {
        const rows = listMcpTools(tools, exec?.agent ?? agent, options, args?.server)
        return { total: rows.length, tools: rows }
      },
    ),
    definition(
      'mcp_search',
      'Rank MCP tools against a natural-language query. Returns the best matching names, servers and short descriptions; use mcp_describe for the exact parameter schema.',
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string', description: 'What you need the MCP tool to do, in natural language or by name fragment.' },
          server: { type: 'string', description: 'Optional MCP server name to filter by.' },
          limit: { type: 'integer', description: `Maximum rows to return. Default ${options.searchLimit}; maximum 50.` },
        },
        required: ['query'],
      },
      true,
      (args, exec) => searchMcpTools(tools, exec?.agent ?? agent, options, args ?? {}),
    ),
    definition(
      'mcp_describe',
      'Return one MCP tool\'s description and complete JSON parameter schema by exact name. Use it before mcp_call when the arguments are not obvious.',
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', description: 'Exact MCP tool name, for example "mcp__notion__search".' },
        },
        required: ['name'],
      },
      true,
      (args, exec) => describeMcpTool(tools, exec?.agent ?? agent, options, args?.name),
    ),
    definition(
      'mcp_call',
      'Execute one MCP tool by exact name. The MCP tool is hidden from the tool list but remains callable through this guarded proxy.',
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', description: 'Exact MCP tool name, for example "mcp__notion__search".' },
          arguments: {
            type: 'object',
            additionalProperties: true,
            description: 'Arguments object accepted by the MCP tool. Read mcp_describe first when unsure.',
          },
        },
        required: ['name'],
      },
      false,
      (args, exec) =>
        callMcpTool({
          tools,
          agent: exec?.agent ?? agent,
          exec,
          name: args?.name,
          argumentsValue: args?.arguments,
          prefix: options.prefix,
        }),
    ),
  ]
}

/**
 * Detect another disclosure system already active on this agent.
 * @param {object} tools - agent-scoped tool registry.
 * @param {object} agent - agent.
 * @returns {string | undefined} marker name, or a synthetic failure reason.
 */
function detectSkip(tools, agent) {
  if (typeof tools?.get !== 'function') return 'no-registry-read'
  for (const marker of SKIP_MARKERS) {
    try {
      if (tools.get(marker, agent) !== undefined) return marker
    } catch {
      return 'probe-failed'
    }
  }
  return undefined
}

/**
 * Apply the final request projection for one agent.
 * @param {object} assembly - prompt assembly.
 * @param {object} tools - agent-scoped tool registry.
 * @param {object} agent - owning agent.
 * @param {{prefix: string}} options - normalized config.
 * @returns {object} same assembly.
 */
export function filterAssembly(assembly, tools, agent, options) {
  if (assembly === null || typeof assembly !== 'object') return assembly
  const hasMcp = hasMcpTools(tools, agent, options.prefix)
  if (Array.isArray(assembly.tools)) {
    assembly.tools = assembly.tools.filter((tool) => {
      if (isMcpName(tool?.name, options.prefix)) return false
      if (!hasMcp && PROXY_TOOL_NAMES.includes(tool?.name)) return false
      return true
    })
  }
  if (Array.isArray(assembly.sections)) {
    assembly.sections = assembly.sections.filter((section) => {
      const sectionName = section?.name
      if (typeof sectionName !== 'string') return true
      if (sectionName === SECTION_NAME && !hasMcp) return false
      if (sectionName.startsWith('mcp:')) return false
      return true
    })
  }
  return assembly
}

/**
 * Read an agent's scoped services. A real Agent context requires `inject`
 * before its service accessors are usable; test/standalone contexts may expose
 * them directly. The fallback keeps both shapes working.
 * @param {object} agentCtx - agent scoped context.
 * @param {(ctx: object, tools: object, prompt: object) => boolean} callback - install callback.
 * @returns {boolean} whether the callback got a usable service pair.
 */
function withAgentServices(agentCtx, callback) {
  const attempt = (ctx) => {
    let tools
    let prompt
    try {
      tools = ctx.tools
    } catch {
      tools = undefined
    }
    try {
      prompt = ctx.systemPrompt
    } catch {
      prompt = undefined
    }
    if (tools === undefined) {
      try {
        tools = ctx.get?.('tools')
      } catch {
        tools = undefined
      }
    }
    if (prompt === undefined) {
      try {
        prompt = ctx.get?.('systemPrompt')
      } catch {
        prompt = undefined
      }
    }
    if (tools === undefined || prompt === undefined) return false
    return callback(ctx, tools, prompt)
  }

  if (attempt(agentCtx)) return true
  if (typeof agentCtx.inject === 'function') {
    try {
      let used = false
      agentCtx.inject(['tools', 'systemPrompt'], (injected) => {
        used = attempt(injected) || used
      })
      return used
    } catch {
      return false
    }
  }
  return false
}

/**
 * Install the proxy on one agent. Any failure is contained and logged; a proxy
 * problem must never prevent the host from creating an agent.
 * @param {object} agent - created agent.
 * @param {object} options - normalized config.
 * @param {Map<string, {dispose: () => void}>} states - live agents.
 * @param {(level: string, message: string) => void} log - logger.
 * @returns {void}
 */
function attachAgent(agent, options, states, log) {
  const agentCtx = agent?.ctx
  if (agentCtx === undefined || agent?.id === undefined) return
  if (states.has(agent.id)) return

  withAgentServices(agentCtx, (readyCtx, tools, prompt) => {
    if (typeof tools?.register !== 'function' || typeof tools?.guard !== 'function') return false
    if (states.has(agent.id)) return true

    let skip
    try {
      skip = detectSkip(tools, agent)
    } catch (error) {
      skip = `probe-failed: ${String(error?.message ?? error)}`
    }
    if (skip !== undefined) {
      log('info', `mcp-proxy: skipped agent ${agent.id} (${skip})`)
      return true
    }

    const disposers = []
    const disposeAll = () => {
      for (const dispose of disposers.splice(0)) {
        try {
          dispose?.()
        } catch {
          /* teardown must not fail a disposal path */
        }
      }
    }

    try {
      for (const tool of createProxyTools(options, tools, agent)) {
        const dispose = tools.register(tool)
        if (typeof dispose === 'function') disposers.push(dispose)
      }

      const guardDispose = tools.guard((exec) => {
        if (exec === undefined || exec === null) return undefined
        if (isMcpName(exec.name, options.prefix) && exec.parent === undefined) return DIRECT_CALL_REASON
        return undefined
      })
      if (typeof guardDispose === 'function') disposers.push(guardDispose)

      if (typeof readyCtx.on === 'function') {
        const assemblyDispose = readyCtx.on(
          'system-prompt/assemble',
          async (assembly, _context, next) => {
            const transformed = typeof next === 'function' ? await next() : assembly
            return filterAssembly(transformed ?? assembly, tools, agent, options)
          },
          { prepend: true },
        )
        if (typeof assemblyDispose === 'function') disposers.push(assemblyDispose)
      }

      if (typeof prompt?.section === 'function') {
        const sectionDispose = prompt.section({
          name: SECTION_NAME,
          order: SECTION_ORDER,
          interpolate: false,
          text: () => (hasMcpTools(tools, agent, options.prefix) ? PROMPT : ''),
        })
        if (typeof sectionDispose === 'function') disposers.push(sectionDispose)
      }

      states.set(agent.id, { dispose: disposeAll })
    } catch (error) {
      disposeAll()
      log('warn', `mcp-proxy: failed to install on agent ${agent.id}: ${String(error?.message ?? error)}`)
    }
    return true
  })
}

/**
 * Mount the proxy.
 * @param {object} ctx - top-level plugin context.
 * @param {object} [config] - loader config.
 * @returns {void}
 */
export function apply(ctx, config = {}) {
  const options = normalizeConfig(config)
  if (!options.enabled) return
  const states = new Map()
  const logger = ctx.logger ?? ctx.get?.('logger')
  const log = (level, message) => {
    try {
      logger?.[level]?.(message)
    } catch {
      /* logging must never fail a turn */
    }
  }
  const disposeAll = () => {
    for (const state of states.values()) state.dispose()
    states.clear()
  }

  ctx.on('agent/created', ({ agent } = {}) => {
    try {
      attachAgent(agent, options, states, log)
    } catch (error) {
      log('warn', `mcp-proxy: agent/created handler failed: ${String(error?.message ?? error)}`)
    }
  })

  ctx.on('agent/disposed', ({ agent } = {}) => {
    const state = states.get(agent?.id)
    if (state === undefined) return
    states.delete(agent.id)
    state.dispose()
  })

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => disposeAll(), 'mcp-proxy: agent states')
  }
}
