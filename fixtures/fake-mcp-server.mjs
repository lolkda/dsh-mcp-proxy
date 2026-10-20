#!/usr/bin/env node
/**
 * Minimal MCP stdio server for composition tests. It exposes two deterministic
 * tools in the `fake` namespace and never touches the network.
 */

const TOOLS = [
  {
    name: 'echo',
    description: 'Echo text back to the caller.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Text to echo.' } },
      required: ['text'],
    },
  },
  {
    name: 'add',
    description: 'Add two numbers.',
    inputSchema: {
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
      required: ['a', 'b'],
    },
  },
]

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)

/**
 * Handle one JSON-RPC frame.
 * @param {object} request - parsed request.
 * @returns {void}
 */
function handle(request) {
  const { id, method, params } = request
  const reply = (result) => send({ jsonrpc: '2.0', id, result })
  const fail = (code, message) => send({ jsonrpc: '2.0', id, error: { code, message } })

  switch (method) {
    case 'initialize':
      return reply({
        protocolVersion: params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'fake-mcp-proxy', version: '1.0.0' },
      })
    case 'ping':
      return reply({})
    case 'tools/list':
      return reply({ tools: TOOLS })
    case 'resources/list':
      return reply({ resources: [] })
    case 'prompts/list':
      return reply({ prompts: [] })
    case 'tools/call': {
      const name = params?.name
      const tool = TOOLS.find((entry) => entry.name === name)
      if (tool === undefined) return fail(-32602, `unknown tool: ${String(name)}`)
      const args = params?.arguments ?? {}
      const structuredContent = name === 'add'
        ? { ok: true, tool: name, sum: Number(args.a) + Number(args.b) }
        : { ok: true, tool: name, echo: args.text }
      return reply({
        content: [{ type: 'text', text: `fake:${name} ${JSON.stringify(args)}` }],
        structuredContent,
      })
    }
    default:
      return id === undefined ? undefined : fail(-32601, `method not found: ${String(method)}`)
  }
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let index = buffer.indexOf('\n')
  while (index >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (line.length > 0) {
      try {
        handle(JSON.parse(line))
      } catch {
        /* the client owns malformed frames */
      }
    }
    index = buffer.indexOf('\n')
  }
})
process.stdin.on('end', () => process.exit(0))
