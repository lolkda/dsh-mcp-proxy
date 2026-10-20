# DSH MCP Proxy

## 1. 文档信息

- 文档标识：`dsh-mcp-proxy`
- 规格状态：已确认
- 最后更新：2026-10-20
- 实现状态：已实现
- 验证状态：通过
- 关联文档：[README](../../README.md)

## 2. 目标与范围

### 背景

MCP 工具在 DSH 原生模式中以 `mcp__<server>__<tool>` 直接进入模型 tool list。工具较多时，schema 持续占用上下文，模型也难以仅凭名称选择工具。项目需要一个不引入代码执行、不维护会话状态的 MCP 发现代理。

### 目标

- 对所有 native Agent 隐藏 `mcp__*` 工具和 `mcp:<server>` 提示段。
- 提供 `mcp_list`、`mcp_search`、`mcp_describe`、`mcp_call` 四个发现和调用工具。
- 保留标准工具的原生直接调用。
- 阻止模型直接调用 `mcp__*`，只允许代理的嵌套调用。
- 不持久化、不依赖压缩恢复、不维护已加载集合。

### 非目标

- 不实现 Code Mode，不注册自定义 `code_run`。
- 不接管 PTC、codemode、tool-discovery 会话。
- 不代理 MCP resources，不改变 MCP resource 工具。
- 不提供设置页、客户端 bundle 或压缩恢复逻辑。

## 3. 参与深度与委托

- 参与深度：架构与设计。
- 局部例外：无。
- 需要用户确认：产品定位、全局 native 范围、包名、四个工具、跳过策略、验证与安装边界；均已确认。
- 模型自主决定：模块拆分、工具参数细节、搜索排序、错误结构、测试实现、README 内容。
- 当前执行授权：已批准创建包、初始化 Git、安装到隔离 profile；未安装到 `web` profile。

## 4. 行为要求与约束

### R-001：按 Agent 激活

- 参与者或触发方：`agent/created`。
- 前置条件与输入：Agent 有 `agent.ctx`，并可见 `tools`、`systemPrompt` 服务。
- 必须满足的行为：仅对 native Agent 生效；存在可见 `run_code`、`code_run`、`tool_load` 时跳过。
- 输出或状态变化：在 Agent 作用域注册四个工具、一个 guard、一个装配监听和一个动态提示段。
- 边界与失败行为：服务获取、探测或注册失败时记录日志并跳过，不影响 Agent 创建。

### R-002：隐藏 MCP 工具与提示段

- 参与者或触发方：`system-prompt/assemble`。
- 前置条件与输入：装配结果包含 `tools` 或 `sections`。
- 必须满足的行为：在 `next()` 之后移除 `mcp__*` 工具；移除 `mcp:<server>` 提示段；保留 `mcp-resource-servers` 和 resource 工具。
- 输出或状态变化：返回过滤后的同一装配对象。
- 边界与失败行为：装配缺失或字段不是数组时原样返回；不抛出。

### R-003：无 MCP 时隐藏代理工具

- 参与者或触发方：装配过滤和提示段求值。
- 前置条件与输入：当前 Agent 没有可见的 `mcp__*` 工具。
- 必须满足的行为：从装配结果删除四个代理工具；提示段文本为空并从 sections 删除。
- 输出或状态变化：无 MCP 的请求不出现代理工具。
- 边界与失败行为：MCP 后续出现时，下一轮装配自动恢复四个工具。

### R-004：发现接口

- 参与者或触发方：模型调用 `mcp_list`、`mcp_search`、`mcp_describe`。
- 前置条件与输入：Agent 有至少一个 MCP 工具。
- 必须满足的行为：`mcp_list` 返回全部 MCP 工具；`mcp_search` 按名称和描述排序并支持 `server`、`limit`；`mcp_describe` 返回精确名称的完整 parameters。
- 输出或状态变化：只读返回；不改变 registry 或会话状态。
- 边界与失败行为：无匹配时返回空列表或 `found:false`；不抛出。

### R-005：代理调用

- 参与者或触发方：模型调用 `mcp_call({ name, arguments })`。
- 前置条件与输入：名称以配置的 `mcp__` 前缀开头，且当前 Agent 可见。
- 必须满足的行为：通过 `tools.execute()` 发起嵌套调用，带 `parent: exec.token`；成功返回 `{ok:true,name,result}`，失败返回 `{ok:false,name,error}`。
- 输出或状态变化：执行 MCP 工具；代理自身不持久化状态。
- 边界与失败行为：非 MCP 名称、不可见名称、非对象 arguments、registry 错误和异常都转为结构化失败。

### R-006：直接调用阻断

- 参与者或触发方：工具 guard。
- 前置条件与输入：调用名称以 `mcp__` 开头，且 `exec.parent` 为空。
- 必须满足的行为：返回拒绝原因，要求模型使用 `mcp_list` / `mcp_search` / `mcp_describe` / `mcp_call`。
- 输出或状态变化：直接调用不执行。
- 边界与失败行为：带 `parent` 的嵌套调用放行；非 MCP 名称放行。

### R-007：生命周期

- 参与者或触发方：`agent/disposed` 或插件卸载。
- 前置条件与输入：该 Agent 已安装代理。
- 必须满足的行为：释放工具、guard、装配监听和提示段。
- 输出或状态变化：状态表清空。
- 边界与失败行为：单个释放异常被吞掉，不影响其余释放。

### R-008：包形态

- 参与者或触发方：DSH profile loader 与 Web client loader。
- 前置条件与输入：profile 通过 `dsh plugin add` 引入本包。
- 必须满足的行为：`dsh.bundle.patch` 指向 `cordis.patch.yml`，顶层插入 `mcp-proxy` 行；`dsh.client` 指向 `./client`，在 Web 设置的 `plugins.item` 槽注册配置卡片。
- 输出或状态变化：`--dump-config` 中出现唯一 `mcp-proxy` 行；Web 设置页出现“MCP 代理”入口。
- 边界与失败行为：client 不可用时 host 行为不变，只是没有可视化配置页。

### R-009：Web 可视化配置

- 参与者或触发方：Web 设置 → 内置插件 → MCP 代理。
- 前置条件与输入：Host 暴露 `mcp-proxy` 的 `Config` schema，client 注入 `configForms`、`locale`、`slots`。
- 必须满足的行为：配置卡片使用 DSH 原生 `SettingsForm`、`SettingsValueField` 和 `Switch`；编辑 `enabled`、`prefix`、`searchLimit`、`descriptionMaxChars`；保存后才写入。
- 输出或状态变化：四个字段均为 volatile；保存后原地更新运行配置。`enabled` 关闭时移除已有 Agent 的代理能力，重新开启时恢复已存在 Agent。
- 边界与失败行为：设置不可写时表单只读；Host 不服务 namespace 时不显示入口；保存失败保留草稿。

### 相关约束

- 不修改 `bare-first-turn`；代理不依赖其装配顺序。
- MCP resource 工具保持可见。
- v1 不处理图片专用投影。
- 隐藏是请求投影，不是权限控制。
- Web 配置页只编辑本插件的四个配置字段，不代理 MCP resources。

## 5. 关键决定

### D-001：MCP 代理而非 Code Mode

- 状态：已确认
- 结论：只做隐藏、发现、代理调用，不做代码执行。
- 理由：实现轻、无状态，不需要 PTC runtime 和自定义 transport。
- 考虑过的备选：Code Mode、PTC、渐进披露。
- 未采用原因：复杂度高，或与标准工具原生的目标冲突。
- 影响范围：R-001、R-005、R-008。

### D-002：全局 native 生效并跳过已有披露系统

- 状态：已确认
- 结论：所有 native Agent 生效；PTC、codemode、tool-discovery 跳过。
- 理由：用户要求全局；跳过已有披露机制的 preset 避免双层隐藏。
- 考虑过的备选：按 preset 配置开关、只对指定 preset 生效。
- 未采用原因：不符合全局 native 目标，或需要额外配置。
- 影响范围：R-001。

### D-003：独立包

- 状态：已确认
- 结论：`@lolkda/dsh-mcp-proxy`，目录 `/app/project/dsh-run-code`。
- 理由：与 `bare-first-turn` 职责分离，可独立测试和卸载。
- 考虑过的备选：并入 `bare-first-turn`。
- 未采用原因：耦合首轮逻辑，难以独立验证。
- 影响范围：R-008。

### D-004：四个工具

- 状态：已确认
- 结论：`mcp_list`、`mcp_search`、`mcp_describe`、`mcp_call`。
- 理由：列表、检索、schema、执行职责分离。
- 考虑过的备选：只提供 `mcp_list` + `mcp_call`。
- 未采用原因：检索和 schema 读取会退化为模型自己读大列表。
- 影响范围：R-004、R-005。

### D-005：MCP resource 保持可见

- 状态：已确认
- 结论：不代理 MCP resources；保留 `mcp-resource-servers` 与 resource 工具。
- 理由：v1 只解决 MCP tools 的上下文问题。
- 考虑过的备选：同时代理 resources。
- 未采用原因：超出 v1 范围，增加状态面。
- 影响范围：R-002。

### D-006：无 MCP 时隐藏代理工具

- 状态：已确认
- 结论：没有 `mcp__*` 时不显示四个代理工具。
- 理由：避免污染没有 MCP 的 preset 会话。
- 考虑过的备选：始终显示代理工具。
- 未采用原因：无 MCP 时只有空列表提示，浪费上下文。
- 影响范围：R-003。

### D-007：无持久化

- 状态：已确认
- 结论：不记录加载集合、不写 journal、不监听 compaction。
- 理由：压缩后重新发现即可；减少状态和恢复逻辑。
- 考虑过的备选：持久化已发现工具。
- 未采用原因：与“无状态”目标冲突。
- 影响范围：R-004、R-007。

## 6. 验收标准

### AC-001：native Agent 隐藏 MCP

- 对应规则：R-001、R-002
- 前置条件：native Agent，存在 `mcp__fake__echo`。
- 操作或输入：触发真实 `systemPrompt.assemble()`。
- 预期结果：tool list 无 `mcp__fake__echo`；四个代理工具存在；`mcp:fake` 被删除；resource 段保留。
- 验证状态：通过
- 验证证据：`test/composition/real-loader.test.mjs`、`test/unit/proxy.test.mjs`。

### AC-002：直接调用被拒绝

- 对应规则：R-006
- 前置条件：存在隐藏 MCP 工具。
- 操作或输入：以无 `parent` 的 `tools.execute()` 调用 `mcp__fake__echo`。
- 预期结果：返回错误，不执行 MCP 工具。
- 验证状态：通过
- 验证证据：`test/composition/real-loader.test.mjs`、`test/composition/mcp-stdio.test.mjs`、`test/unit/proxy.test.mjs`。

### AC-003：代理调用成功

- 对应规则：R-005
- 前置条件：存在隐藏 MCP 工具。
- 操作或输入：调用 `mcp_call({name:'mcp__fake__echo',arguments:{text:'hello'}})`。
- 预期结果：嵌套 `tools.execute()` 收到 `parent`，返回 `{ok:true,...}`，真实 MCP server 返回结果。
- 验证状态：通过
- 验证证据：`test/composition/real-loader.test.mjs`、`test/composition/mcp-stdio.test.mjs`。

### AC-004：PTC / codemode / tool-discovery 不受影响

- 对应规则：R-001
- 前置条件：Agent 可见 `run_code` 或 `code_run` 或 `tool_load`。
- 操作或输入：触发 `agent/created` 和装配。
- 预期结果：不注册四个代理工具，不安装 guard，不改装配。
- 验证状态：通过
- 验证证据：`test/unit/proxy.test.mjs` 覆盖三种标记；`test/composition/real-loader.test.mjs` 覆盖真实 codemode 形状。

### AC-005：无 MCP 时隐藏代理工具

- 对应规则：R-003
- 前置条件：native Agent，无 `mcp__*`。
- 操作或输入：触发装配。
- 预期结果：四个代理工具从装配删除；提示段为空。
- 验证状态：通过
- 验证证据：`test/unit/proxy.test.mjs`。

### AC-006：发现接口

- 对应规则：R-004
- 前置条件：存在多个 MCP 工具。
- 操作或输入：调用 `mcp_list`、`mcp_search`、`mcp_describe`。
- 预期结果：列表完整排序；搜索按相关度返回并支持 limit/server；describe 返回完整 parameters。
- 验证状态：通过
- 验证证据：`test/unit/catalog.test.mjs`、`test/composition/real-loader.test.mjs`。

### AC-007：隔离 profile 可加载

- 对应规则：R-008
- 前置条件：临时 `DSH_HOME`。
- 操作或输入：`dsh plugin --profile verify add /app/project/dsh-run-code`，再执行 `--dump-config`。
- 预期结果：出现唯一 `mcp-proxy` 行；临时 profile 可独立启动。
- 验证状态：通过
- 验证证据：`/tmp/dsh-mcp-proxy-home/profiles/verify`；当前 `web` profile 的安装状态不在该隔离测试断言范围内。

### AC-008：生命周期释放

- 对应规则：R-007
- 前置条件：已安装代理的 Agent。
- 操作或输入：触发 `agent/disposed`。
- 预期结果：工具、guard、提示段全部移除。
- 验证状态：通过
- 验证证据：`test/unit/proxy.test.mjs`。

## 7. 未决问题与假设

### Q-001：MCP resource 提示段保留

- 类型：暂用假设
- 内容：只删除 `mcp:<server>`，保留 `mcp-resource-servers`，因为 resource 工具仍可见。
- 影响范围：R-002。
- 是否阻塞：否。
- 决定或验证方式：已写入 R-002 和 D-005；后续如要隐藏 resources，需单独变更。

### Q-002：`mcp_list` 返回全部

- 类型：暂用假设
- 内容：按用户选择不设分页、不设硬上限；单行描述截断。
- 影响范围：R-004。
- 是否阻塞：否。
- 决定或验证方式：已在 README 记录；超大目录下需要改为分页接口。

### Q-003：PTC 真实运行时验证

- 类型：暂用假设
- 内容：PTC 跳过逻辑由单元测试的 `run_code` 标记覆盖；未在真实 PTC runtime 中启动端到端会话。
- 影响范围：R-001。
- 是否阻塞：否。
- 决定或验证方式：真实 PTC 会话需要完整 runtime 组合；当前以可见标记的契约测试为准。

## 8. 技术设计

### 8.1 模块

| 模块 | 职责 |
|---|---|
| `lib/index.js` | 插件入口、`Config` schema、按 Agent 激活、装配过滤、guard、提示段、生命周期、volatile 配置刷新 |
| `lib/catalog.js` | 读取 MCP schema、列表、搜索、describe、名称和描述处理 |
| `lib/call.js` | `mcp_call` 的嵌套 registry 调用、错误映射、内容投影 |
| `lib/client.js` | Web 设置卡片：`plugins.item`、四个字段、DSH 原生表单组件 |
| `cordis.patch.yml` | 顶层 profile 插入行与默认配置 |

### 8.2 激活数据流

```text
agent/created
  -> agent.ctx.inject(['tools','systemPrompt'])
  -> detect skip markers (run_code / code_run / tool_load)
  -> register mcp_list/search/describe/call on agent.ctx
  -> register guard
  -> register system-prompt/assemble (prepend)
  -> register preset:mcp-proxy section
```

### 8.3 装配数据流

```text
providers + proxy section
  -> waterfall
  -> proxy hook awaits next()
  -> remove mcp__* tools
  -> remove mcp:<server> sections
  -> if no MCP: remove four proxy tools and proxy section
  -> final request
```

### 8.4 工具契约

| 字段路径 | 类型 | 必填/出现条件 | 可为 null | 默认行为 | 含义与约束 |
|---|---|---|---|---|---|
| `mcp_list.server` | string | 可选 | 否 | 不过滤 | 按 MCP server 名过滤 |
| `mcp_search.query` | string | 必填 | 否 | 无 | 自然语言或名称片段 |
| `mcp_search.server` | string | 可选 | 否 | 不过滤 | 按 server 过滤 |
| `mcp_search.limit` | integer | 可选 | 否 | 10 | 最大 50 |
| `mcp_describe.name` | string | 必填 | 否 | 无 | 精确 MCP 工具名 |
| `mcp_call.name` | string | 必填 | 否 | 无 | 必须以 `mcp__` 开头 |
| `mcp_call.arguments` | object | 可选 | 否 | `{}` | 传给 MCP 工具的参数 |

### 8.4.1 Web 配置契约

| 字段 | 类型 | 默认 | 约束 | 生效方式 |
|---|---|---|---|---|
| `enabled` | boolean | `true` | 仅 `false` 关闭 | 立即移除或恢复已有 Agent 的代理能力 |
| `prefix` | string | `mcp__` | 非空 | 下一次隐藏、装配过滤和 guard 读取时生效 |
| `searchLimit` | integer | `10` | 1–50 | 下一次 `mcp_search` 使用 |
| `descriptionMaxChars` | integer | `200` | 1–2000 | 下一次 `mcp_list` / `mcp_search` 使用 |

四个字段均为 `Schema.*.volatile()`，由 DSH `SettingsForm` 暂存、保存时一次性提交；
插件监听 `loader/volatile-update` 原地刷新，不依赖 Agent 重建。

### 8.5 错误行为

- 直接 `mcp__*`：guard 返回固定拒绝文案。
- `mcp_call` 非 MCP 名称：`{ok:false,name,error:{message}}`。
- `mcp_call` 不存在或不可见：结构化失败。
- MCP registry 抛错或 `isError`：结构化失败，不穿透工具边界。
- 装配或服务探测失败：记录日志，跳过代理。

### 8.6 验证

- 单元：18 项，覆盖 catalog、`Config` schema、Web 配置客户端、激活/跳过、装配、guard、发现、调用、销毁、volatile 配置切换、首轮清空共存。
- 组合：3 项，覆盖真实 Cordis/services、真实 registry、真实 `dsh-mcp-client` + stdio fake server、codemode 跳过。
- 隔离 profile：`/tmp/dsh-mcp-proxy-home/profiles/verify`。
- 组合测试使用临时 `DSH_HOME`；当前 `web` profile 通过 bundle 安装，状态不在测试断言范围内。

### 8.7 已知限制

- 隐藏不是权限边界；registry 仍可被代码执行或其他插件访问。
- 不处理 PTC 的 `tools:sdk`。
- 不处理 MCP resources。
- 图片结果没有专用投影。
- `mcp_list` 返回全部，超大 MCP 目录可能产生大结果。
- 跳过判断只在 Agent 创建时执行一次。
