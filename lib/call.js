/**
 * One guarded MCP invocation through the public tool registry.
 *
 * The MCP tool is still registered; this module never mutates or bypasses the
 * registry pipeline. It marks the call as a nested dispatch with the caller's
 * opaque `parent` token, which lets the proxy's guard distinguish an agent's
 * direct `mcp__*` call from a call made by `mcp_call`.
 *
 * @module @lolkda/dsh-mcp-proxy/call
 */

import { isMcpName } from './catalog.js'

/** Monotonic local suffix; it only has to be unique within this process. */
let sequence = 0

/**
 * Convert one registry content array into model-readable text.
 * v1 deliberately does not forward image blocks; it reports that they were
 * omitted instead of silently dropping them.
 * @param {unknown} content - registry content blocks.
 * @returns {string} text projection.
 */
function contentToText(content) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
    } else if (block?.type === 'image') {
      parts.push('[image content omitted]')
    }
  }
  return parts.join('\n')
}

/**
 * Build a structured failure without throwing through the tool boundary.
 * @param {string} name - requested tool name.
 * @param {string} message - human-readable reason.
 * @returns {{ok: false, name: string, error: {message: string}}} failure envelope.
 */
function failure(name, message) {
  return {
    ok: false,
    name,
    error: { message },
  }
}

/**
 * Execute one MCP tool as a nested registry call.
 * @param {object} options - call options.
 * @param {object} options.tools - tool registry service.
 * @param {object} options.agent - calling agent.
 * @param {object} options.exec - outer `mcp_call` execution.
 * @param {string} options.name - exact MCP tool name.
 * @param {unknown} options.argumentsValue - raw MCP arguments.
 * @param {string} options.prefix - configured MCP prefix.
 * @returns {Promise<{ok: true, name: string, result: unknown} | {ok: false, name: string, error: {message: string}}>} result envelope.
 */
export async function callMcpTool({ tools, agent, exec, name, argumentsValue, prefix }) {
  const requested = typeof name === 'string' ? name.trim() : ''
  if (!isMcpName(requested, prefix)) {
    return failure(requested, `Tool names must start with "${prefix}".`)
  }
  if (argumentsValue !== undefined && (argumentsValue === null || typeof argumentsValue !== 'object' || Array.isArray(argumentsValue))) {
    return failure(requested, '`arguments` must be a JSON object.')
  }
  let definition
  try {
    definition = tools?.get?.(requested, agent)
  } catch (error) {
    return failure(requested, `Could not resolve the MCP tool: ${String(error?.message ?? error)}`)
  }
  if (definition === undefined) {
    return failure(requested, 'No MCP tool with that exact name is visible. Use mcp_search first.')
  }

  let schema
  try {
    schema = tools?.schemas?.(agent)?.find((entry) => entry?.name === requested)
  } catch {
    schema = undefined
  }
  if (schema === undefined) {
    schema = {
      name: definition.name,
      description: definition.description ?? '',
      parameters: definition.parameters ?? { type: 'object', additionalProperties: true },
    }
  }

  const signal = exec?.signal ?? new AbortController().signal
  const callId = `${String(exec?.callId ?? 'mcp')}:mcp:${++sequence}`
  const input = {
    callId,
    ...(exec?.rootCallId === undefined ? {} : { rootCallId: exec.rootCallId }),
    name: requested,
    schema,
    arguments: argumentsValue ?? {},
    ...(agent === undefined ? {} : { agent }),
    ...(exec?.token === undefined ? {} : { parent: exec.token }),
    signal,
  }

  try {
    const outcome = await tools.execute(input)
    if (outcome?.isError === true) {
      return failure(requested, outcome.error?.message ?? 'MCP tool execution failed.')
    }
    const result = outcome?.value === undefined
      ? contentToText(outcome?.content)
      : outcome.value
    return { ok: true, name: requested, result }
  } catch (error) {
    return failure(requested, `MCP tool execution failed: ${String(error?.message ?? error)}`)
  }
}
