# Markdown 静态博客

新成员代码导读：`docs/项目代码导读.md`

## 1. 本地运行

```powershell
npm.cmd run start
```

执行流程：
1. 生成文章索引 `posts/index.json`
2. 校验内容完整性
3. 启动本地服务 `http://localhost:8000`

## 2. 配置文件

创建本地配置：

```powershell
Copy-Item blog.config.example.json blog.config.json
Copy-Item .env.example .env
```

关键配置：
- `editorAuth.enabled`：是否开启编辑器密码保护
- `editorAuth.passwordEnv`：编辑器密码环境变量（默认 `EDITOR_PASSWORD`）
- `editorAuth.sessionSecretEnv`：会话签名密钥环境变量（默认 `EDITOR_SESSION_SECRET`）
- `editorAuth.maxAttempts`：最大失败次数
- `editorAuth.cooldownMinutes`：失败锁定分钟数
- `aiSummary.*`：OpenAI-like 摘要接口配置

`.env` 示例：

```env
OPENAI_API_KEY=your_real_key
EDITOR_PASSWORD=your_editor_password
EDITOR_SESSION_SECRET=your_session_secret
```

## 3. 编辑器功能

地址：`http://localhost:8000/editor.html`

已支持：
- 密码登录后才能使用 `发布到网站` / `AI 生成摘要`
- 登录失败次数限制与冷却锁定
- `保存草稿`（写入 `draft: true`，不会出现在首页）
- `Front Matter 预览`
- 发布冲突时显示差异并可选择覆盖
- 发布成功自动跳转文章详情页

## 4. 页面能力

- 首页显示：标题、日期、AI 摘要、正文摘录
- 文章页显示：标题下 AI 摘要 + 正文目录（TOC）+ 代码高亮
- 全站社媒位：`Bilibili / 抖音 / 小红书`
  - 配置文件：`site.config.json`（或示例 `site.config.example.json`）

## 5. 索引与缓存

运行：

```powershell
npm.cmd run generate:index
```

生成字段：
- `description`
- `aiDescription`
- `excerpt`
- `summarySource`

缓存文件：
- `posts/.ai-summary-cache.json`

同一文章内容和模型配置不变时，会命中缓存，避免重复生成摘要。

## 6. 测试与 CI

本地测试：

```powershell
npm.cmd test
```

CI：
- `.github/workflows/ci.yml`
- push / PR 会自动执行 `npm run build` 和 `npm test`

## 7. 常用命令

```powershell
npm.cmd run generate:index
npm.cmd run check:content
npm.cmd run build
npm.cmd run test
npm.cmd run serve
npm.cmd run start
```
