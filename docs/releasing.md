# 发布到 npm

本仓库使用 GitHub Actions + npm OIDC trusted publishing 发布
`@lolkda/dsh-mcp-proxy`，发布流程中不保存 `NPM_TOKEN`。

## 前置条件

- npm 包必须已经存在。npm 的 trusted publisher 只能在已有包上配置；
  当前包尚未发布时，需要先完成一次 bootstrap publish。
- npm 账号必须拥有 `@lolkda` scope 的发布权限；可以用
  `npm whoami --registry=https://registry.npmjs.org` 确认登录身份。
- GitHub 仓库必须公开，且 `package.json` 的 `repository.url` 必须与仓库一致：

  ```json
  "repository": {
    "type": "git",
    "url": "git+https://github.com/lolkda/dsh-mcp-proxy.git"
  }
  ```

- 发布 workflow 文件名为 `.github/workflows/ci.yml`，npm 端配置时必须填写
  `ci.yml`。

## 第一次发布（bootstrap）

trusted publisher 配置前，先让包在 npm 上存在：

```bash
npm login --registry=https://registry.npmjs.org
npm publish --access public --registry=https://registry.npmjs.org
```

如果使用一次性 granular access token，发布完成后应立即吊销该 token。

## 配置 trusted publisher

在 npmjs.com 打开包设置：

```text
Packages → @lolkda/dsh-mcp-proxy → Settings → Trusted publishing
```

选择 GitHub Actions，填写：

| 字段 | 值 |
|---|---|
| Organization or user | `lolkda` |
| Repository | `dsh-mcp-proxy` |
| Workflow filename | `ci.yml` |
| Environment name | 留空 |
| Allowed actions | `npm publish` |

注意：

- workflow 文件名只填文件名，不填路径，必须带 `.yml` 或 `.yaml`。
- 如果以后给 workflow 加了 GitHub Environment，例如 `npm`，需要在这里填写
  同名 environment，并在 `publish` job 上添加 `environment: npm`。
- 新建的 trusted publisher 配置必须在 2 天内完成第一次成功 OIDC 发布，否则
  配置会过期。

## 正常发版

1. 修改 `package.json` 的 `version`，例如 `0.1.1`。
2. 提交版本变更。
3. 创建并推送 tag：

   ```bash
   git tag v0.1.1
   git push origin main --tags
   ```

4. GitHub Actions 会先运行 `test` job，再运行 `publish` job。`publish` job
   拥有 `id-token: write` 权限，npm CLI 会自动用 OIDC 换取短期发布凭证。

也可以在 GitHub Actions 页面手动触发：

```text
Actions → CI → Run workflow → publish: true
```

手动发布不会校验 tag 与版本号是否一致，只校验 `package.json` 是否允许发布。

## 工作流行为

- `test`：运行 `npm run check`，并生成和上传 npm tarball 构建产物。
- `publish`：只在以下条件执行：
  - 推送到 `v*` tag；或
  - 手动触发且 `publish` 输入为 `true`。
- 发布前会检查：
  - `package.json` 不是 `private`；
  - `repository.url` 与 GitHub 仓库一致；
  - tag 版本与 `package.json` 版本一致（tag 触发时）。
- 发布命令：

  ```bash
  npm publish --access public
  ```

## 安全说明

- 不需要在 GitHub Secrets 中配置 `NPM_TOKEN`。
- `publish` job 只申请 `contents: read` 和 `id-token: write`。
- 建议在 trusted publisher 验证成功后，到 npm 包设置的 Publishing access 中
  选择 “Require two-factor authentication and disallow tokens”，关闭传统
  token 发布。
- OIDC 发布只能运行在 GitHub-hosted runner；self-hosted runner 当前不受支持。
