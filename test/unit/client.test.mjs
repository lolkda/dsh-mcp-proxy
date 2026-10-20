import assert from 'node:assert/strict'
import test from 'node:test'

/**
 * Load the browser wrapper through its expected ModuleLoader seam.
 * @returns {Promise<{exports: object, model: object, slot: object, effects: object[], dictionaries: object}>} captured client wiring.
 */
async function loadClient() {
  let registration
  globalThis.window = {
    __ModuleLoader__: {
      load(spec) {
        registration = spec
      },
    },
  }

  try {
    const url = new URL(`../../lib/client.js?test=${Date.now()}`, import.meta.url)
    await import(url.href)
  } finally {
    delete globalThis.window
  }

  assert.ok(registration, 'client registers with ModuleLoader')
  assert.equal(registration.id, '@lolkda/dsh-mcp-proxy')

  let capturedModel
  class FakeSettingsFormModel {
    constructor(scope, specs) {
      this.scope = scope
      this.specs = specs
      this.disposed = false
      capturedModel = this
    }

    bind(project) {
      this.project = project
      return { kind: 'snapshot-store' }
    }

    shell() {
      return {
        available: true,
        writable: true,
        dirty: false,
        invalid: false,
        saving: false,
        failed: false,
      }
    }

    field(name) {
      return {
        text: name === 'enabled' ? 'true'
          : name === 'prefix' ? 'mcp__'
            : name === 'searchLimit' ? '10' : '200',
        overridden: false,
        invalid: false,
      }
    }

    actions() {
      return {
        edit() {},
        resetField() {},
        save() {},
        discard() {},
      }
    }

    dispose() {
      this.disposed = true
    }
  }

  const primitives = {
    Button: 'Button',
    SettingsForm: 'SettingsForm',
    SettingsValueField: 'SettingsValueField',
    Switch: 'Switch',
    SettingsFormModel: FakeSettingsFormModel,
  }
  const React = {
    createElement(type, props, ...children) {
      return { type, props: { ...(props ?? {}), children } }
    },
  }

  const exportsObject = registration.factory((specifier) => {
    if (specifier === 'react') return React
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error(`unexpected require: ${specifier}`)
  })

  const effects = []
  let slot
  let dictionaries
  const ctx = {
    slots: {
      inject(name, callback) {
        assert.equal(name, 'plugins.item')
        return callback()
      },
      register(options, component) {
        slot = { options, component }
        return () => {}
      },
    },
    configForms: {
      get(entryId) {
        assert.equal(entryId, 'mcp-proxy')
        return { entryId }
      },
      whileServed(namespaces, register) {
        assert.deepEqual(namespaces, ['mcp-proxy'])
        return register(new Set(['mcp-proxy']))
      },
    },
    locale: {
      register(namespace, value) {
        dictionaries = { namespace, value }
        return () => {}
      },
      bind() {
        return key => key === 'nav' ? 'MCP 代理'
          : key === 'description' ? 'summary text'
            : key
      },
    },
    effect(callback, label) {
      effects.push({ label, dispose: callback() })
    },
  }

  exportsObject.apply(ctx)
  return { exports: exportsObject, model: capturedModel, slot, effects, dictionaries }
}

test('client registers one MCP proxy card over the four settings', async () => {
  const { exports, model, slot, effects, dictionaries } = await loadClient()

  assert.deepEqual(exports.inject, ['slots', 'locale', 'configForms'])
  assert.deepEqual(model.specs.map(spec => spec.field), [
    'enabled',
    'prefix',
    'searchLimit',
    'descriptionMaxChars',
  ])
  assert.equal(dictionaries.namespace, 'settings.mcp-proxy')
  assert.ok(dictionaries.value.zh)
  assert.ok(dictionaries.value.en)
  assert.equal(slot.options.name, 'plugins.item')
  assert.equal(slot.options.id, 'mcp-proxy')
  assert.equal(slot.options.order, 45)
  assert.equal(slot.options.label(), 'MCP 代理')
  assert.equal(slot.options.locale, 'settings.mcp-proxy')

  const injected = slot.options.inject()
  assert.equal(injected.hooks.mcpProxy.kind, 'snapshot-store')
  assert.equal(typeof injected.edit, 'function')
  assert.equal(typeof injected.resetField, 'function')
  assert.equal(typeof injected.save, 'function')
  assert.equal(typeof injected.discard, 'function')

  assert.equal(slot.component({ view: 'summary', t: key => key === 'description' ? 'summary text' : key }), 'summary text')

  const actions = {
    edit() {},
    resetField() {},
    save() {},
    discard() {},
  }
  const tree = slot.component({
    view: 'form',
    t: key => key,
    useMcpProxy: selector => selector({
      ...model.shell(),
      enabled: model.field('enabled'),
      prefix: model.field('prefix'),
      searchLimit: model.field('searchLimit'),
      descriptionMaxChars: model.field('descriptionMaxChars'),
    }),
    ...actions,
  })

  assert.equal(tree.type, 'SettingsForm')
  assert.equal(tree.props.children.length, 4)
  assert.equal(tree.props.children[0].type, 'div')
  assert.deepEqual(tree.props.children.slice(1).map(child => child.type), [
    'SettingsValueField',
    'SettingsValueField',
    'SettingsValueField',
  ])
  assert.ok(effects.some(entry => entry.label === 'mcp-proxy: settings card'))
})
