import assert from 'node:assert/strict'
import test from 'node:test'

import { apply } from '../../lib/index.js'

/**
 * Create one fake agent-scoped registry.
 * @param {object[]} [initial] - initial definitions.
 * @returns {object} registry fixture.
 */
function createTools(initial = []) {
  const definitions = new Map(initial.map((definition) => [definition.name, definition]))
  const registered = new Map()
  const guards = []
  const executed = []
  const tools = {
    registered,
    guards,
    executed,
    executeResult: { isError: false, value: { echoed: true } },
    register(definition) {
      if (definitions.has(definition.name)) throw new Error(`duplicate tool: ${definition.name}`)
      definitions.set(definition.name, definition)
      registered.set(definition.name, definition)
      return () => {
        definitions.delete(definition.name)
        registered.delete(definition.name)
      }
    },
    guard(guard) {
      guards.push(guard)
      return () => {
        const at = guards.indexOf(guard)
        if (at >= 0) guards.splice(at, 1)
      }
    },
    schemas() {
      return [...definitions.values()].map(({ name, description, parameters }) => ({
        name,
        description,
        parameters,
      }))
    },
    get(name) {
      return definitions.get(name)
    },
    async execute(input) {
      executed.push(input)
      return tools.executeResult
    },
  }
  return tools
}

/**
 * Create one fake agent and host context.
 * @param {object[]} [initialTools] - registry definitions.
 * @returns {object} harness.
 */
function createHarness(initialTools = []) {
  const tools = createTools(initialTools)
  const sections = []
  const listeners = new Map()
  const agent = {
    id: 'agent-1',
    ctx: {
      tools,
      systemPrompt: {
        section(options) {
          sections.push(options)
          return () => {
            const at = sections.indexOf(options)
            if (at >= 0) sections.splice(at, 1)
          }
        },
      },
      on(event, listener) {
        const list = listeners.get(event) ?? []
        list.push(listener)
        listeners.set(event, list)
        return () => {
          const at = list.indexOf(listener)
          if (at >= 0) list.splice(at, 1)
        }
      },
    },
  }
  const hostListeners = new Map()
  const top = {
    logger: { info() {}, warn() {} },
    on(event, listener) {
      const list = hostListeners.get(event) ?? []
      list.push(listener)
      hostListeners.set(event, list)
      return () => {}
    },
    effect(callback) {
      return callback()
    },
    get() {
      return undefined
    },
  }
  return {
    agent,
    tools,
    sections,
    top,
    emit(event, payload) {
      for (const listener of hostListeners.get(event) ?? []) listener(payload)
    },
    async assemble(initial) {
      const assembly = {
        tools: initial.tools ?? [],
        sections: initial.sections ?? [],
        contexts: initial.contexts ?? [],
      }
      const hooks = listeners.get('system-prompt/assemble') ?? []
      let index = 0
      const next = async () => {
        const hook = hooks[index++]
        return hook === undefined ? assembly : hook(assembly, { scope: agent }, next)
      }
      return next()
    },
  }
}

/** @returns {object} one MCP definition. */
function mcpEcho() {
  return {
    name: 'mcp__alpha__echo',
    description: 'Echo text back to the caller.',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
  }
}

/** @returns {object} another MCP definition. */
function mcpAdd() {
  return {
    name: 'mcp__beta__add',
    description: 'Add two numbers.',
    parameters: {
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
      required: ['a', 'b'],
    },
  }
}

test('native agent gets four proxy tools, hides MCP and mcp: sections', async () => {
  const harness = createHarness([
    mcpEcho(),
    mcpAdd(),
    { name: 'read', description: 'Read a file.', parameters: { type: 'object' } },
  ])
  apply(harness.top, { prefix: 'mcp__' })
  harness.emit('agent/created', { agent: harness.agent })

  assert.deepEqual([...harness.tools.registered.keys()].sort(), [
    'mcp_call',
    'mcp_describe',
    'mcp_list',
    'mcp_search',
  ])
  assert.equal(harness.tools.guards.length, 1)
  assert.equal(harness.sections.length, 1)

  const assembly = await harness.assemble({
    tools: [
      { name: 'mcp__alpha__echo' },
      { name: 'mcp__beta__add' },
      { name: 'read' },
      { name: 'mcp_list' },
      { name: 'mcp_search' },
      { name: 'mcp_describe' },
      { name: 'mcp_call' },
    ],
    sections: [
      { name: 'mcp:alpha', text: 'alpha' },
      { name: 'mcp-resource-servers', text: 'resources' },
      { name: 'tool:read', text: 'read' },
      { name: 'preset:mcp-proxy', text: 'proxy' },
    ],
  })
  assert.deepEqual(assembly.tools.map((tool) => tool.name).sort(), [
    'mcp_call',
    'mcp_describe',
    'mcp_list',
    'mcp_search',
    'read',
  ])
  assert.deepEqual(assembly.sections.map((section) => section.name), [
    'mcp-resource-servers',
    'tool:read',
    'preset:mcp-proxy',
  ])
  assert.notEqual(harness.sections[0].text(), '')
})

test('no MCP tools hides the proxy tools and prompt section', async () => {
  const harness = createHarness([
    { name: 'read', description: 'Read a file.', parameters: { type: 'object' } },
  ])
  apply(harness.top, {})
  harness.emit('agent/created', { agent: harness.agent })

  assert.equal(harness.tools.registered.size, 4)
  assert.equal(harness.sections[0].text(), '')

  const assembly = await harness.assemble({
    tools: [
      { name: 'read' },
      { name: 'mcp_list' },
      { name: 'mcp_search' },
      { name: 'mcp_describe' },
      { name: 'mcp_call' },
    ],
    sections: [{ name: 'preset:mcp-proxy', text: 'proxy' }],
  })
  assert.deepEqual(assembly.tools.map((tool) => tool.name), ['read'])
  assert.deepEqual(assembly.sections, [])
})

test('PTC, codemode and tool-discovery agents are skipped', () => {
  for (const marker of ['run_code', 'code_run', 'tool_load']) {
    const harness = createHarness([{ name: marker, description: marker, parameters: { type: 'object' } }])
    apply(harness.top, {})
    harness.emit('agent/created', { agent: harness.agent })
    assert.equal(harness.tools.registered.size, 0, marker)
    assert.equal(harness.tools.guards.length, 0, marker)
    assert.equal(harness.sections.length, 0, marker)
  }
})

test('guard denies direct MCP calls and allows nested calls', () => {
  const harness = createHarness([mcpEcho()])
  apply(harness.top, {})
  harness.emit('agent/created', { agent: harness.agent })
  const guard = harness.tools.guards[0]

  assert.match(String(guard({ name: 'mcp__alpha__echo', agent: harness.agent })), /hidden/)
  assert.equal(guard({ name: 'mcp__alpha__echo', parent: Symbol('parent'), agent: harness.agent }), undefined)
  assert.equal(guard({ name: 'read', agent: harness.agent }), undefined)
})

test('mcp_list, mcp_search and mcp_describe read the registry without state', async () => {
  const harness = createHarness([mcpEcho(), mcpAdd()])
  apply(harness.top, {})
  harness.emit('agent/created', { agent: harness.agent })
  const exec = { agent: harness.agent, callId: 'call-1' }

  const list = await harness.tools.registered.get('mcp_list').execute({}, exec)
  assert.equal(list.total, 2)
  assert.deepEqual(list.tools.map((row) => row.name), ['mcp__alpha__echo', 'mcp__beta__add'])
  assert.equal(list.tools[0].server, 'alpha')

  const search = await harness.tools.registered.get('mcp_search').execute({ query: 'add' }, exec)
  assert.equal(search.total, 1)
  assert.equal(search.tools[0].name, 'mcp__beta__add')

  const described = await harness.tools.registered.get('mcp_describe').execute({ name: 'mcp__beta__add' }, exec)
  assert.equal(described.found, true)
  assert.equal(described.parameters.required[0], 'a')

  const missing = await harness.tools.registered.get('mcp_describe').execute({ name: 'mcp__nope__x' }, exec)
  assert.equal(missing.found, false)
})

test('mcp_call nests through tools.execute and returns a structured result', async () => {
  const harness = createHarness([mcpEcho()])
  apply(harness.top, {})
  harness.emit('agent/created', { agent: harness.agent })
  const parent = Symbol('parent-token')
  const exec = { agent: harness.agent, callId: 'call-1', rootCallId: 'root-1', token: parent, signal: new AbortController().signal }

  const result = await harness.tools.registered.get('mcp_call').execute(
    { name: 'mcp__alpha__echo', arguments: { text: 'hi' } },
    exec,
  )
  assert.equal(result.ok, true)
  assert.deepEqual(result.result, { echoed: true })
  assert.equal(harness.tools.executed.length, 1)
  assert.equal(harness.tools.executed[0].parent, parent)
  assert.equal(harness.tools.executed[0].name, 'mcp__alpha__echo')
  assert.deepEqual(harness.tools.executed[0].arguments, { text: 'hi' })
})

test('mcp_call refuses non-MCP tools and surfaces nested errors', async () => {
  const harness = createHarness([mcpEcho(), { name: 'bash', description: 'Run a command.', parameters: { type: 'object' } }])
  apply(harness.top, {})
  harness.emit('agent/created', { agent: harness.agent })
  const exec = { agent: harness.agent, callId: 'call-1', token: Symbol('parent') }

  const refused = await harness.tools.registered.get('mcp_call').execute(
    { name: 'bash', arguments: { command: 'pwd' } },
    exec,
  )
  assert.equal(refused.ok, false)
  assert.match(refused.error.message, /mcp__/)

  harness.tools.executeResult = { isError: true, error: { message: 'MCP exploded' } }
  const failed = await harness.tools.registered.get('mcp_call').execute(
    { name: 'mcp__alpha__echo', arguments: { text: 'hi' } },
    exec,
  )
  assert.equal(failed.ok, false)
  assert.equal(failed.error.message, 'MCP exploded')
})

test('agent disposal removes tools, guards and sections', () => {
  const harness = createHarness([mcpEcho()])
  apply(harness.top, {})
  harness.emit('agent/created', { agent: harness.agent })
  assert.equal(harness.tools.registered.size, 4)
  harness.emit('agent/disposed', { agent: harness.agent })
  assert.equal(harness.tools.registered.size, 0)
  assert.equal(harness.tools.guards.length, 0)
  assert.equal(harness.sections.length, 0)
})

test('a legacy enabled field no longer disables the proxy', () => {
  const harness = createHarness([mcpEcho()])
  apply(harness.top, { enabled: false })
  harness.emit('agent/created', { agent: harness.agent })
  assert.equal(harness.tools.registered.size, 4)
})

test('volatile settings update existing agents in place', () => {
  const config = {
    prefix: 'mcp__',
    searchLimit: 10,
    descriptionMaxChars: 200,
  }
  const harness = createHarness([mcpEcho()])
  apply(harness.top, config)
  harness.emit('agent/created', { agent: harness.agent })
  const guard = harness.tools.guards[0]

  assert.match(String(guard({ name: 'mcp__alpha__echo', agent: harness.agent })), /hidden/)

  config.prefix = 'tool__'
  harness.emit('loader/volatile-update', [])

  assert.equal(harness.tools.registered.size, 4)
  assert.equal(guard({ name: 'mcp__alpha__echo', agent: harness.agent }), undefined)
  assert.match(String(guard({ name: 'tool__x', agent: harness.agent })), /hidden/)
})

test('a first-turn clearing hook wins and the proxy does not re-add its section', async () => {
  const harness = createHarness([mcpEcho()])
  apply(harness.top, {})
  harness.emit('agent/created', { agent: harness.agent })
  harness.agent.ctx.on('system-prompt/assemble', async (assembly, _context, next) => {
    const transformed = await next()
    transformed.tools = []
    transformed.sections = [{ name: 'bare-first-turn', text: 'zero tools' }]
    return transformed
  })

  const assembly = await harness.assemble({
    tools: [{ name: 'mcp__alpha__echo' }],
    sections: [{ name: 'preset:mcp-proxy', text: 'proxy' }],
  })
  assert.deepEqual(assembly.tools, [])
  assert.deepEqual(assembly.sections.map((section) => section.name), ['bare-first-turn'])
})
