import assert from 'node:assert/strict'
import test from 'node:test'

import { apply } from '../../lib/index.js'
import { loadDsh } from './dsh-resolver.mjs'

const { Context } = await loadDsh('@deepseek-ai/cordis')
const { createScope } = await loadDsh('@deepseek-ai/dsh-scope')
const { default: SystemPrompt } = await loadDsh('@deepseek-ai/dsh-system-prompt')
const { default: ToolRuntime } = await loadDsh('@deepseek-ai/dsh-tools')

/**
 * Build a plain registry definition with a JSON Schema.
 * @param {string} name - tool name.
 * @param {string} description - description.
 * @param {object} parameters - JSON Schema.
 * @param {(args: object) => unknown} execute - body.
 * @returns {object} tool definition.
 */
function tool(name, description, parameters, execute) {
  return {
    name,
    description,
    parameters,
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    isConcurrencySafe: () => true,
    execute: async (args) => execute(args),
  }
}

/**
 * Register tools inside one context so the registration lands in that scope.
 * @param {object} ctx - context with a tools service.
 * @param {object[]} definitions - definitions.
 * @returns {Promise<void>} completion.
 */
function registerIn(ctx, definitions) {
  return new Promise((resolve, reject) => {
    try {
      ctx.inject(['tools'], (injected) => {
        try {
          for (const definition of definitions) injected.tools.register(definition)
          resolve()
        } catch (error) {
          reject(error)
        }
      })
    } catch (error) {
      reject(error)
    }
  })
}

/**
 * Compose the real services and one native agent scope.
 * @returns {Promise<{root: object, tools: object, systemPrompt: object, agentKey: object, agent: object}>} harness.
 */
async function createHarness() {
  const root = new Context()
  await root.plugin(SystemPrompt, {})
  await root.plugin(ToolRuntime, { mode: 'native' })
  const tools = root.get('tools')
  const systemPrompt = root.get('systemPrompt')

  await registerIn(root, [
    tool(
      'mcp__fake__echo',
      'Echo text back to the caller.',
      {
        type: 'object',
        additionalProperties: false,
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
      (args) => ({ echo: args.text }),
    ),
    tool('read', 'Read a file.', { type: 'object', additionalProperties: true }, () => ({ ok: true })),
  ])

  systemPrompt.section({ name: 'mcp:fake', order: 10, text: 'fake MCP server' })
  systemPrompt.section({ name: 'mcp-resource-servers', order: 11, text: 'MCP resources' })
  systemPrompt.section({ name: 'tool:read', order: 12, text: 'read tool' })

  const agent = { id: 'verify-agent' }
  const agentScope = createScope(root, agent)
  agent.ctx = agentScope.ctx
  apply(root, { prefix: 'mcp__' })
  root.emit('agent/created', { agent })
  await new Promise((resolve) => setImmediate(resolve))
  return { root, tools, systemPrompt, agent }
}

test('real loader hides MCP, keeps proxy tools, and executes through mcp_call', async () => {
  const { tools, systemPrompt, agent } = await createHarness()
  const assembly = await systemPrompt.assemble({ scope: agent, agent })

  assert.deepEqual(assembly.tools.map((entry) => entry.name).sort(), [
    'mcp_call',
    'mcp_describe',
    'mcp_list',
    'mcp_search',
    'read',
  ])
  const sectionNames = assembly.sections.map((entry) => entry.name)
  assert.ok(sectionNames.includes('mcp-resource-servers'))
  assert.ok(sectionNames.includes('preset:mcp-proxy'))
  assert.ok(sectionNames.includes('tool:read'))
  assert.equal(sectionNames.includes('mcp:fake'), false)

  const signal = new AbortController().signal
  const direct = await tools.execute({
    name: 'mcp__fake__echo',
    callId: 'direct-call',
    arguments: { text: 'blocked' },
    agent,
    signal,
  })
  assert.equal(direct.isError, true)
  assert.match(String(direct.error?.message ?? ''), /hidden/)

  const listed = await tools.execute({
    name: 'mcp_list',
    callId: 'list-call',
    arguments: {},
    agent,
    signal,
  })
  assert.equal(listed.isError, false)
  assert.equal(listed.value.total, 1)
  assert.deepEqual(listed.value.servers, ['fake'])
  assert.equal('tools' in listed.value, false)

  const searched = await tools.execute({
    name: 'mcp_search',
    callId: 'search-call',
    arguments: { query: 'echo' },
    agent,
    signal,
  })
  assert.equal(searched.isError, false)
  assert.equal(searched.value.total, 1)
  assert.equal(searched.value.tools[0].name, 'mcp__fake__echo')
  assert.equal(searched.value.tools[0].description, 'Echo text back to the caller.')

  const described = await tools.execute({
    name: 'mcp_describe',
    callId: 'describe-call',
    arguments: { name: 'mcp__fake__echo' },
    agent,
    signal,
  })
  assert.equal(described.isError, false)
  assert.equal(described.value.found, true)
  assert.equal(described.value.parameters.required[0], 'text')

  const called = await tools.execute({
    name: 'mcp_call',
    callId: 'proxy-call',
    arguments: { name: 'mcp__fake__echo', arguments: { text: 'hello' } },
    agent,
    signal,
  })
  assert.equal(called.isError, false)
  assert.deepEqual(called.value, {
    ok: true,
    name: 'mcp__fake__echo',
    result: { echo: 'hello' },
  })
})

test('real loader skips a codemode-shaped agent', async () => {
  const { root, tools } = await createHarness()
  const codeAgent = { id: 'codemode-agent' }
  const codeAgentScope = createScope(root, codeAgent)
  codeAgent.ctx = codeAgentScope.ctx
  await registerIn(codeAgentScope.ctx, [
    tool('code_run', 'Fixture code transport.', { type: 'object', additionalProperties: false, properties: {} }, () => ({ ok: true })),
  ])
  root.emit('agent/created', { agent: codeAgent })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(tools.get('mcp_list', codeAgent), undefined)
  assert.equal(tools.get('mcp_call', codeAgent), undefined)
})
