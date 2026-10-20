import assert from 'node:assert/strict'
import test from 'node:test'

import {
  describeMcpTool,
  isMcpName,
  listMcpTools,
  searchMcpTools,
  serverOf,
  truncateDescription,
} from '../../lib/catalog.js'
import { normalizeConfig } from '../../lib/index.js'

const options = {
  prefix: 'mcp__',
  descriptionMaxChars: 12,
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
  assert.equal(truncateDescription('abcdefghijklmnop', 5), 'abcd…')
  assert.equal(truncateDescription('abc', 5), 'abc')
})

test('listing filters by server and truncates descriptions', () => {
  const rows = listMcpTools(tools, {}, options, 'beta')
  assert.deepEqual(rows.map((row) => row.name), ['mcp__beta__add', 'mcp__beta__multiply'])
  assert.equal(rows[0].server, 'beta')
  assert.equal(rows[0].description.length, 12)
  assert.ok(rows[0].description.endsWith('…'))
})

test('search ranks by name and honors limit and server filter', () => {
  const byName = searchMcpTools(tools, {}, options, { query: 'add' })
  assert.equal(byName.total, 1)
  assert.equal(byName.tools[0].name, 'mcp__beta__add')

  const byDescription = searchMcpTools(tools, {}, options, { query: 'numbers', server: 'beta' })
  assert.equal(byDescription.total, 2)
  assert.equal(byDescription.tools.length, 2)

  const limited = searchMcpTools(tools, {}, options, { query: 'numbers', limit: 1 })
  assert.equal(limited.total, 2)
  assert.equal(limited.tools.length, 1)
})

test('describe returns the full parameter schema and a hint when missing', () => {
  const found = describeMcpTool(tools, {}, options, 'mcp__beta__add')
  assert.equal(found.found, true)
  assert.deepEqual(found.parameters.required, ['a'])

  const missing = describeMcpTool(tools, {}, options, 'mcp__nope__x')
  assert.equal(missing.found, false)
  assert.match(missing.hint, /mcp_list/)
})

test('config normalization clamps values and preserves a custom prefix', () => {
  const config = normalizeConfig({
    prefix: 'tool__',
    searchLimit: 999,
    descriptionMaxChars: 0,
    enabled: false,
  })
  assert.equal(config.prefix, 'tool__')
  assert.equal(config.searchLimit, 50)
  assert.equal(config.descriptionMaxChars, 200)
  assert.equal(config.enabled, false)
})
