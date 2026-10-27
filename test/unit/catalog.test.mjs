import assert from 'node:assert/strict'
import test from 'node:test'

import {
  describeMcpTool,
  isMcpName,
  listMcpServers,
  searchMcpTools,
  serverOf,
} from '../../lib/catalog.js'
import { normalizeConfig, Config } from '../../lib/index.js'

const options = {
  prefix: 'mcp__',
  searchLimit: 2,
}

const tools = {
  schemas: () => [
    { name: 'mcp__alpha__echo', description: 'Echo text back to the caller.', parameters: { type: 'object' } },
    { name: 'mcp__beta__add', description: 'Add two numbers.', parameters: { type: 'object', required: ['a'] } },
    { name: 'mcp__beta__multiply', description: 'Multiply two numbers.', parameters: { type: 'object' } },
    { name: 'read', description: 'A native tool.', parameters: { type: 'object' } },
  ],
}

test('name helpers recognize only the configured prefix', () => {
  assert.equal(isMcpName('mcp__alpha__echo', 'mcp__'), true)
  assert.equal(isMcpName('mcp__', 'mcp__'), false)
  assert.equal(isMcpName('read', 'mcp__'), false)
  assert.equal(serverOf('mcp__alpha__echo', 'mcp__'), 'alpha')
  assert.equal(serverOf('mcp__bad', 'mcp__'), 'unknown')
})

test('server listing returns only distinct server names', () => {
  const servers = listMcpServers(tools, {}, options)
  assert.deepEqual(servers, ['alpha', 'beta'])
})

test('search ranks by name and honors limit and server filter', () => {
  const byName = searchMcpTools(tools, {}, options, { query: 'add' })
  assert.equal(byName.total, 1)
  assert.equal(byName.tools[0].name, 'mcp__beta__add')

  const byDescription = searchMcpTools(tools, {}, options, { query: 'numbers', server: 'beta' })
  assert.equal(byDescription.total, 2)
  assert.equal(byDescription.tools.length, 2)
  assert.equal(byDescription.tools[0].description, 'Add two numbers.')

  const limited = searchMcpTools(tools, {}, options, { query: 'numbers', limit: 1 })
  assert.equal(limited.total, 2)
  assert.equal(limited.tools.length, 1)
})

test('search returns descriptions without a character limit', () => {
  const description = `long-${'x'.repeat(2500)}`
  const longTools = {
    schemas: () => [
      { name: 'mcp__alpha__long', description, parameters: { type: 'object' } },
    ],
  }

  const result = searchMcpTools(longTools, {}, options, { query: 'long' })
  assert.equal(result.total, 1)
  assert.equal(result.tools[0].description, description)
})

test('describe returns the full parameter schema and a hint when missing', () => {
  const found = describeMcpTool(tools, {}, options, 'mcp__beta__add')
  assert.equal(found.found, true)
  assert.deepEqual(found.parameters.required, ['a'])

  const missing = describeMcpTool(tools, {}, options, 'mcp__nope__x')
  assert.equal(missing.found, false)
  assert.match(missing.hint, /mcp_search/)
})

test('config normalization clamps values and preserves a custom prefix', () => {
  const config = normalizeConfig({
    prefix: 'tool__',
    searchLimit: 999,
  })
  assert.equal(config.prefix, 'tool__')
  assert.equal(config.searchLimit, 50)
  assert.equal('enabled' in config, false)
})

test('the loader Config schema exposes and validates the two settings', () => {
  const loaded = Config({})
  assert.equal(loaded.prefix.get(), 'mcp__')
  assert.equal(loaded.searchLimit.get(), 10)
  assert.deepEqual(normalizeConfig(loaded), {
    prefix: 'mcp__',
    searchLimit: 10,
  })
  assert.throws(() => Config({ searchLimit: 51 }))
  assert.throws(() => Config({ prefix: '' }))
})
