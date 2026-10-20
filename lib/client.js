window.__ModuleLoader__.load({
  id: '@lolkda/dsh-mcp-proxy',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const {
      Button,
      SettingsForm,
      SettingsFormModel,
      SettingsValueField,
      Switch,
    } = require('@deepseek-ai/dsh-client-ui-primitives')

    /** Settings namespace: the Loader entry id that owns this plugin. */
    const ENTRY_ID = 'mcp-proxy'
    /** Locale namespace for this settings card. */
    const NS = 'settings.mcp-proxy'

    const en = {
      nav: 'MCP proxy',
      description: 'Hide MCP tools from the model tool list, then expose discovery, schema, and guarded call tools.',
      enabled: 'Enable MCP proxy',
      enabledHint: 'When off, the plugin leaves MCP tools untouched.',
      prefix: 'MCP tool prefix',
      prefixHint: 'Tool names beginning with this prefix are hidden and guarded. DSH uses mcp__.',
      searchLimit: 'Default search results',
      searchLimitHint: 'Default number of mcp_search rows, from 1 to 50. A call can override it with limit.',
      descriptionMaxChars: 'Description limit',
      descriptionMaxCharsHint: 'Maximum characters in mcp_list and mcp_search descriptions, from 1 to 2000. mcp_describe returns the full text.',
      overridden: 'Overridden',
      reset: 'Reset',
      invalidPrefix: 'Enter a non-empty prefix.',
      invalidNumber: 'Enter a whole number in range, or leave blank to use the default.',
      readOnly: 'This deployment stores settings read-only.',
      unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
      save: 'Save',
      saving: 'Saving…',
      saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
    }

    const zh = {
      nav: 'MCP 代理',
      description: '从模型工具列表中隐藏 MCP 工具，并提供发现、schema 查看和受保护的调用入口。',
      enabled: '启用 MCP 代理',
      enabledHint: '关闭后插件不再隐藏或拦截 MCP 工具。',
      prefix: 'MCP 工具前缀',
      prefixHint: '以此前缀开头的工具会被隐藏和拦截。DSH 默认使用 mcp__。',
      searchLimit: '搜索默认条数',
      searchLimitHint: 'mcp_search 默认返回条数，范围 1–50；单次调用可用 limit 覆盖。',
      descriptionMaxChars: '描述截断长度',
      descriptionMaxCharsHint: 'mcp_list 和 mcp_search 描述的最大字符数，范围 1–2000；mcp_describe 返回完整内容。',
      overridden: '已覆盖',
      reset: '恢复默认',
      invalidPrefix: '请填写非空前缀。',
      invalidNumber: '请填写范围内的整数；留空表示使用默认值。',
      readOnly: '本部署的设置为只读。',
      unavailable: '该插件当前未加载，暂时无法配置。',
      save: '保存',
      saving: '保存中…',
      saveFailed: '本部署没有接受这些值，已保留供你修改。',
    }

    const h = React.createElement

    /** Stage a boolean through the shared string-based form model. */
    const enabledField = {
      field: 'enabled',
      format: value => (value === false ? 'false' : 'true'),
      parse: text => (
        text === 'true' || text === 'false'
          ? { kind: 'set', value: text === 'true' }
          : undefined
      ),
    }

    /** Prefix is a required string; the empty draft is invalid rather than a clear. */
    const prefixField = {
      field: 'prefix',
      format: value => (typeof value === 'string' ? value : ''),
      parse: text => {
        const value = text.trim()
        return value === '' ? undefined : { kind: 'set', value }
      },
    }

    /** A bounded integer field, with field-level validation before the Host write. */
    function boundedNumberField(field, minimum, maximum) {
      return {
        field,
        format: value => (value === undefined || value === null ? '' : String(value)),
        parse: text => {
          const trimmed = text.trim()
          if (trimmed === '') return { kind: 'clear' }
          const value = Number(trimmed)
          if (!Number.isInteger(value) || value < minimum || value > maximum) return undefined
          return { kind: 'set', value }
        },
      }
    }

    /** Copy the shared form frame renders. */
    function formLabels(t) {
      return {
        unavailable: t('unavailable'),
        readOnly: t('readOnly'),
        saveFailed: t('saveFailed'),
        save: t('save'),
        saving: t('saving'),
      }
    }

    /**
     * Render one plugin card on Settings → Built-in plugins.
     * @param props - slot props: locale, form snapshot hook, and form actions.
     * @returns summary text, or the staged settings form.
     */
    function McpProxyCard(props) {
      const { t } = props
      if (props.view === 'summary') return t('description')

      const state = props.useMcpProxy(snapshot => snapshot)
      const disabled = !state.writable || state.saving
      const enabled = state.enabled.text === 'true'

      const toggleRow = {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
        padding: '4px 0 14px',
      }
      const toggleText = {
        fontSize: '14px',
        lineHeight: '20px',
        color: 'var(--dsw-alias-label-primary)',
      }
      const toggleHint = {
        margin: '4px 0 0',
        fontSize: '12px',
        lineHeight: '18px',
        color: 'var(--dsw-alias-label-secondary)',
      }
      const toggleActions = {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flex: 'none',
      }

      return h(
        SettingsForm,
        {
          labels: formLabels(t),
          state,
          onSave: props.save,
          onDiscard: props.discard,
        },
        h(
          'div',
          { key: 'enabled', style: toggleRow },
          h(
            'div',
            null,
            h('div', { style: toggleText }, t('enabled')),
            h('p', { style: toggleHint }, t('enabledHint')),
          ),
          h(
            'div',
            { style: toggleActions },
            state.enabled.overridden
              ? h(
                  Button,
                  {
                    size: 'sm',
                    variant: 'ghost',
                    disabled,
                    onClick: () => props.resetField('enabled'),
                  },
                  t('reset'),
                )
              : null,
            h(Switch, {
              checked: enabled,
              disabled,
              label: t('enabled'),
              onChange: next => props.edit('enabled', next ? 'true' : 'false'),
            }),
          ),
        ),
        h(SettingsValueField, {
          key: 'prefix',
          id: 'mcp-proxy-prefix',
          label: t('prefix'),
          hint: t('prefixHint'),
          overriddenLabel: t('overridden'),
          resetLabel: t('reset'),
          invalidLabel: t('invalidPrefix'),
          disabled,
          ...state.prefix,
          onEdit: text => props.edit('prefix', text),
          onReset: () => props.resetField('prefix'),
        }),
        h(SettingsValueField, {
          key: 'searchLimit',
          id: 'mcp-proxy-search-limit',
          label: t('searchLimit'),
          hint: t('searchLimitHint'),
          overriddenLabel: t('overridden'),
          resetLabel: t('reset'),
          invalidLabel: t('invalidNumber'),
          numeric: true,
          disabled,
          ...state.searchLimit,
          onEdit: text => props.edit('searchLimit', text),
          onReset: () => props.resetField('searchLimit'),
        }),
        h(SettingsValueField, {
          key: 'descriptionMaxChars',
          id: 'mcp-proxy-description-max',
          label: t('descriptionMaxChars'),
          hint: t('descriptionMaxCharsHint'),
          overriddenLabel: t('overridden'),
          resetLabel: t('reset'),
          invalidLabel: t('invalidNumber'),
          numeric: true,
          disabled,
          ...state.descriptionMaxChars,
          onEdit: text => props.edit('descriptionMaxChars', text),
          onReset: () => props.resetField('descriptionMaxChars'),
        }),
      )
    }

    /**
     * Mount the plugin's settings card.
     * @param ctx - browser plugin context with slots, locale, and config forms.
     * @returns nothing; every registration is owned by a context effect.
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'mcp-proxy: settings dictionaries')

      const form = ctx.configForms.get(ENTRY_ID)
      const model = new SettingsFormModel(form, [
        enabledField,
        prefixField,
        boundedNumberField('searchLimit', 1, 50),
        boundedNumberField('descriptionMaxChars', 1, 2000),
      ])
      const store = model.bind(() => ({
        ...model.shell(),
        enabled: model.field('enabled'),
        prefix: model.field('prefix'),
        searchLimit: model.field('searchLimit'),
        descriptionMaxChars: model.field('descriptionMaxChars'),
      }))

      ctx.effect(() => () => model.dispose(), 'mcp-proxy: settings form')

      ctx.effect(
        () => ctx.configForms.whileServed([ENTRY_ID], () =>
          ctx.slots.inject('plugins.item', () =>
            ctx.slots.register(
              {
                name: 'plugins.item',
                id: ENTRY_ID,
                order: 45,
                label: () => t('nav'),
                locale: NS,
                inject: () => ({ hooks: { mcpProxy: store }, ...model.actions() }),
              },
              McpProxyCard,
            ),
          ),
        ),
        'mcp-proxy: settings card',
      )
    }

    exports.apply = apply
    exports.inject = ['slots', 'locale', 'configForms']
    return module.exports
  },
})
