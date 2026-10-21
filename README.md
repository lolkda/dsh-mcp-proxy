# @lolkda/dsh-mcp-proxy

DSH 原生模式的 MCP 代理插件：把 `mcp__*` 工具从模型的 tool list 中隐藏，改用四个轻量工具发现和调用 MCP，同时保留标准工具的原生直接调用。

## 它解决什么

设计记录见 [docs/specs/dsh-mcp-proxy.md](docs/specs/dsh-mcp-proxy.md)。

MCP server 的工具通常以 `mcp__<server>__<tool>` 直接出现在模型 tool list。工具多时，这部分 schema 会持续占用上下文，而且模型不总能从名字判断该用哪个。

本插件不实现 Code Mode，也不改 MCP server。它只做三件事：

1. 从请求投影中移除 `mcp__*` 工具和 `mcp:<server>` 提示段；
2. 加入 `mcp_list`、`mcp_search`、`mcp_describe`、`mcp_call` 四个发现工具；
3. 用 agent-scoped guard 阻止模型直接调用被隐藏的 `mcp__*`，只允许 `mcp_call` 的嵌套调用通过。

标准工具（`read`、`bash`、`todo_write` 等）仍然是原生工具，不受影响。

## 适用范围

- 对所有 **native** Agent 生效，包括 preset 里的 native 会话。
- 跳过可见 `run_code` 的 PTC Agent。
- 跳过可见 `code_run` 的 codemode preset。
- 跳过可见 `tool_load` 的 tool-discovery preset。
- MCP resources 不在代理范围内：`list_mcp_resources`、`list_mcp_resource_templates`、`read_mcp_resource` 和 `mcp-resource-servers` 提示段保持可见。
- 没有任何 MCP 工具时，四个代理工具也会从请求中隐藏，直到 MCP 重新出现。

选择“跳过”而不是叠加，是为了避免同一个会话被两套发现协议同时约束。

## 模型看到的接口

| 工具 | 参数 | 作用 |
|---|---|---|
| `mcp_list` | `server?` | 返回当前 Agent 可见的全部 MCP 工具、server 和截断后的描述 |
| `mcp_search` | `query`, `server?`, `limit?` | 按名称/描述排序；默认返回 10 条，最多 50 条 |
| `mcp_describe` | `name` | 返回一个 MCP 工具的完整 parameters JSON Schema |
| `mcp_call` | `name`, `arguments` | 通过 registry 执行隐藏的 MCP 工具 |

`mcp_list` 按用户要求返回全部工具，没有分页或硬上限，只截断单行描述。

`mcp_call` 的返回是结构化的：

```json
{ "ok": true, "name": "mcp__fake__echo", "result": { "echo": "hi" } }
```

失败时：

```json
{ "ok": false, "name": "mcp__fake__echo", "error": { "message": "..." } }
```

## 安装

包内自带 `dsh.bundle.patch`，`cordis.patch.yml` 会在 profile 顶层插入一行：

```yaml
- insert:
    - id: mcp-proxy
      name: '@lolkda/dsh-mcp-proxy'
      config:
        prefix: 'mcp__'
        searchLimit: 10
        descriptionMaxChars: 200
```

安装到指定 profile：

```bash
dsh plugin --profile <name> add /app/project/dsh-run-code
```

验证 profile 组合：

```bash
dsh --profile <name> --dump-config | grep -A6 'mcp-proxy'
```

本包通过 GitHub Actions 与 npm OIDC trusted publishing 发布；首次发布、npm 端 trusted publisher 配置和发版流程见 [docs/releasing.md](docs/releasing.md)。

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 关闭后不注册、不拦截 |
| `prefix` | `mcp__` | MCP 工具名前缀，同时用于识别和隐藏 |
| `searchLimit` | `10` | `mcp_search` 默认条数，最大 50 |
| `descriptionMaxChars` | `200` | 列表中的描述截断长度，最大 2000 |

## Web 可视化配置

安装后打开：

```text
设置 → MCP 代理
```

首次安装或更新 client bundle 后，需要重启一次 DSH Web；仅刷新页面不会重新扫描 `dsh.client` 声明。

页面出现在左侧设置导航中，使用 DSH 原生的 `SettingsForm`、`SettingsValueField` 和 `Switch`，提供：

- `enabled` 开关；
- `prefix` 文本；
- `searchLimit` 数字输入，1–50；
- `descriptionMaxChars` 数字输入，1–2000。

首次加载后，后续保存配置不需要重启 DSH；四个字段都是 volatile，Loader 会原地更新运行中的配置。`enabled` 切换时会立即移除或恢复已存在 Agent 上的代理工具、guard 和提示段。

## 关键实现

- `agent/created` 时在 `agent.ctx` 上安装四项能力：四个工具、一个 guard、一个 `system-prompt/assemble` 监听、一个动态提示段。
- `agent.ctx.inject(['tools', 'systemPrompt'], ...)` 取得 agent 作用域的服务；注册落在该 Agent 的层，不会变成全局工具。
- guard 规则是 `name.startsWith(options.prefix) && exec.parent === undefined`。`mcp_call` 通过 `tools.execute({ parent: exec.token })` 发起嵌套调用，所以能通过同一个 guard。
- 装配监听使用 `prepend: true` 并在 `await next()` 之后过滤，保证最终投影由它收口。
- 提示段是动态的：有 MCP 时非空，没有 MCP 时为空，并且会被装配过滤移除。
- 配置字段是 volatile；插件监听 `loader/volatile-update`，原地更新 `enabled`、`prefix`、`searchLimit` 和 `descriptionMaxChars`。
- 没有持久化、加载集合、journal 或 compaction hook。压缩后模型重新 `mcp_list` / `mcp_search` 即可。

## 安全边界

隐藏 `mcp__*` 不是权限控制。MCP 工具仍然存在于 registry，guard 只约束模型通过工具入口发起的直接调用。任何拥有代码执行能力或直接访问 registry 的插件都可以绕过这一层；如果需要真正的权限隔离，应使用 `tools.restrict` 或 host 层策略。

## 开发与验证

```bash
npm test
npm run test:composition
npm run test:all
npm run check
```

- `test/unit`：假 context，覆盖激活/跳过、装配过滤、无 MCP、guard、发现接口、代理调用和销毁。
- `test/composition/real-loader.test.mjs`：真实 `cordis` + `dsh-system-prompt` + `dsh-tools` 组合，验证真实 registry 和 scope。
- `test/composition/mcp-stdio.test.mjs`：真实 `dsh-mcp-client` + `fixtures/fake-mcp-server.mjs` stdio server，验证端到端隐藏与调用。

组合测试默认从安装目录解析 DSH 包，可用 `DSH_INSTALL_ROOT` 指向另一份 DSH 构建：

```bash
DSH_INSTALL_ROOT=/path/to/dsh npm run test:composition
```

## 发布

发布由 [.github/workflows/ci.yml](.github/workflows/ci.yml) 的 `publish` job 完成，使用 GitHub Actions OIDC，不需要 `NPM_TOKEN`。

发版前需要先在 npm 包设置中配置 trusted publisher：

- GitHub 用户/组织：`lolkda`
- 仓库：`dsh-mcp-proxy`
- 工作流文件名：`ci.yml`
- Allowed actions：`npm publish`

首次发布、bootstrap 步骤和 tag 流程见 [docs/releasing.md](docs/releasing.md)。

## 已知限制

- 只处理 MCP tools；resources 仍直接暴露。
- 图片结果 v1 不做专门投影。
- `mcp_list` 在超大 MCP 目录下可能产生很大的结果；需要分页时应改成分页接口。
- 跳过判断在 Agent 创建时做一次；如果之后才动态加入 codemode/tool-discovery，可能同时存在两层。
- 不修改 `tools:sdk`；PTC 会话完全跳过。
