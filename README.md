# Markdown 静态博客

新成员代码导读：`docs/项目代码导读.md`

## 1. 本地运行

```powershell
npm.cmd run start
```

会自动执行：
1. 生成文章索引 `posts/index.json`
2. 校验内容
3. 启动本地服务 `http://localhost:8000/index.html`

## 2. Git 与敏感文件

`.gitignore` 已忽略：
- `blog.config.json`
- `blog.config.local.json`
- `.env`
- `.env.local`
- `posts/.ai-summary-cache.json`

可提交的示例文件：
- `blog.config.example.json`
- `.env.example`

## 3. 配置文件教程

### 3.1 创建本地配置

```powershell
Copy-Item blog.config.example.json blog.config.json
```

`blog.config.json` 主要字段：
- `excerptLength`：首页“正文摘录”长度
- `editorAuth.enabled`：是否开启编辑器密码保护
- `editorAuth.passwordEnv`：密码环境变量名（默认 `EDITOR_PASSWORD`）
- `editorAuth.sessionHours`：登录会话时长（小时）
- `aiSummary.enabled`：是否开启 AI 摘要
- `aiSummary.mode`：`missing-meta` / `always`
- `aiSummary.baseURL`：OpenAI-like 接口地址
- `aiSummary.model`：模型名
- `aiSummary.apiKeyEnv`：API key 环境变量名
- `aiSummary.forceRefresh`：是否强制刷新摘要
- `aiSummary.allowStaleCache`：AI 调用失败时是否允许回退旧缓存

### 3.2 设置环境变量

```powershell
Copy-Item .env.example .env
```

在 `.env` 填写：

```env
OPENAI_API_KEY=your_real_key
EDITOR_PASSWORD=your_editor_password
```

或当前终端临时设置：

```powershell
$env:OPENAI_API_KEY="your_real_key"
$env:EDITOR_PASSWORD="your_editor_password"
```

## 4. 编辑页面使用

地址：`http://localhost:8000/editor.html`

编辑器启用密码保护后：
- 必须先输入密码登录
- 未登录时会禁用 `发布到网站` 和 `AI 生成摘要`
- `下载 .md` 与 `刷新预览` 仍可使用

按钮说明：
- `刷新预览`：渲染 Markdown
- `下载 .md`：下载草稿
- `发布到网站`：写入 `posts/{slug}.md` 并自动重建索引
- `AI 生成摘要`：读取服务端配置和环境变量调用模型

## 5. 索引与摘要缓存

运行：

```powershell
npm.cmd run generate:index
```

`posts/index.json` 包含字段：
- `description`
- `aiDescription`
- `excerpt`
- `summarySource`

摘要缓存文件：
- `posts/.ai-summary-cache.json`

当文章内容和模型配置未变化时，会命中缓存，不会重复生成所有文章摘要。

## 6. 常用命令

```powershell
npm.cmd run generate:index
npm.cmd run check:content
npm.cmd run build
npm.cmd run serve
npm.cmd run start
```
