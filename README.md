# Markdown 静态博客

## 1. 本地运行

```powershell
npm.cmd run start
```

会自动执行：
1. 生成文章索引 `posts/index.json`
2. 校验内容
3. 启动本地服务 `http://localhost:8000/index.html`

## 2. Git 管理建议

项目已使用 `.gitignore` 忽略敏感或本地文件：
- `blog.config.json`
- `blog.config.local.json`
- `.env`
- `.env.local`
- `posts/.ai-summary-cache.json`

可提交到仓库的示例文件：
- `blog.config.example.json`
- `.env.example`

## 3. 配置文件教程（如何修改）

### 3.1 创建本地配置

先复制示例配置：

```powershell
Copy-Item blog.config.example.json blog.config.json
```

然后编辑 `blog.config.json`：
- `excerptLength`：首页导读长度
- `aiSummary.enabled`：是否开启 AI 摘要
- `aiSummary.mode`：
  - `missing-meta`：只有没有 `description` 才生成 AI 摘要
  - `always`：每篇都走 AI（命中缓存时不会重复请求）
- `aiSummary.baseURL`：OpenAI-like 接口地址
- `aiSummary.model`：模型名
- `aiSummary.apiKeyEnv`：读取 API key 的环境变量名
- `forceRefresh`：`true` 时强制刷新摘要
- `allowStaleCache`：AI 调用失败时是否回退旧缓存

### 3.2 创建本地环境变量

先复制示例环境文件：

```powershell
Copy-Item .env.example .env
```

在 `.env` 里填入：

```env
OPENAI_API_KEY=your_real_key
```

也可以直接在当前终端设置：

```powershell
$env:OPENAI_API_KEY="your_real_key"
```

## 4. 生成索引与摘要

```powershell
npm.cmd run generate:index
```

索引字段说明：
- `description`：文章摘要（优先级：front matter > aiDescription > excerpt）
- `aiDescription`：AI 摘要（可能为空）
- `excerpt`：正文前 N 字
- `summarySource`：`meta` / `ai` / `ai-cache` / `ai-cache-stale` / `excerpt`

为避免重复生成，摘要缓存写入：
- `posts/.ai-summary-cache.json`

当文章内容未变化时，会命中缓存，不会重复调用 AI。

## 5. 常用命令

```powershell
npm.cmd run generate:index
npm.cmd run check:content
npm.cmd run build
npm.cmd run serve
npm.cmd run start
```
