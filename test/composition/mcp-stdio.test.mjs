import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { apply } from '../../lib/index.js'
import { loadDsh } from './dsh-resolver.mjs'

const { Context } = await loadDsh('@deepseek-ai/cordis')
const { createScope } = await loadDsh('@deepseek-ai/dsh-scope')
const { default: SystemPrompt } = await loadDsh('@deepseek-ai/dsh-system-prompt')
const { default: ToolRuntime } = await loadDsh('@deepseek-ai/dsh-tools')
const mcpClient = await loadDsh('@deepseek-ai/dsh-mcp-client')

const FIXTURE = fileURLToPath(new URL('../../fixtures/fake-mcp-server.mjs', import.meta.url))

test('a real stdio MCP server is hidden and callable through mcp_call', async (t) => {
  const root = new Context()
  await root.plugin(SystemPrompt, {})
  await root.plugin(ToolRuntime, { mode: 'native' })
  const tools = root.get('tools')
  const systemPrompt = root.get('systemPrompt')

  await new Promise((resolve, reject) => {
    root.inject(['tools'], (injected) => {
      try {
        injected.tools.register({
          name: 'read',
          description: 'Read a file.',
          parameters: { type: 'object', additionalProperties: true },
          output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
          execute: async () => ({ ok: true }),
        })
        resolve()
      } catch (error) {
        reject(error)
      }
    })
  })

  const mcpFiber = await root.plugin(
    { name: mcpClient.name, apply: mcpClient.apply, inject: mcpClient.inject },
    {
      serverName: 'fake',
      transport: 'stdio',
      command: process.execPath,
      args: [FIXTURE],
      toolCallTimeoutMs: 5000,
      failOnStartupError: true,
    },
  )
  t.after(async () => {
    await mcpFiber.dispose()
  })

  systemPrompt.section({ name: 'mcp-resource-servers', order: 11, text: 'MCP resources' })

  const agent = { id: 'stdio-agent' }
  const agentScope = createScope(root, agent)
  agent.ctx = agentScope.ctx
  apply(root, { prefix: 'mcp__' })
  root.emit('agent/created', { agent })
  await new Promise((resolve) => setImmediate(resolve))

  const assembly = await systemPrompt.assemble({ scope: agent, agent })
  assert.equal(assembly.tools.some((entry) => entry.name.startsWith('mcp__')), false)
  assert.ok(assembly.tools.some((entry) => entry.name === 'mcp_list'))
  assert.equal(assembly.sections.some((entry) => entry.name === 'mcp:fake'), false)

  const signal = new AbortController().signal
  const direct = await tools.execute({
    name: 'mcp__fake__echo',
    callId: 'stdio-direct',
    arguments: { text: 'blocked' },
    agent,
    signal,
  })
  assert.equal(direct.isError, true)

  const listed = await tools.execute({
    name: 'mcp_list',
    callId: 'stdio-list',
    arguments: {},
    agent,
    signal,
  })
  assert.equal(listed.isError, false)
  assert.deepEqual(listed.value.servers, ['fake'])
  assert.equal('tools' in listed.value, false)

  const searched = await tools.execute({
    name: 'mcp_search',
    callId: 'stdio-search',
    arguments: { query: 'echo' },
    agent,
    signal,
  })
  assert.equal(searched.isError, false)
  assert.deepEqual(searched.value.tools.map((entry) => entry.name), ['mcp__fake__echo'])
  assert.equal(searched.value.tools[0].description, 'Echo text back to the caller.')

  const called = await tools.execute({
    name: 'mcp_call',
    callId: 'stdio-call',
    arguments: { name: 'mcp__fake__echo', arguments: { text: 'hello' } },
    agent,
    signal,
  })
  assert.equal(called.isError, false)
  assert.equal(called.value.ok, true)
  assert.match(JSON.stringify(called.value.result), /hello/)
})
