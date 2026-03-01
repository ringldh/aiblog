const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { buildIndex } = require("./generate-index");

function createServer(options = {}) {
  const root = options.root || process.cwd();
  const configFile = path.join(root, "blog.config.json");
  const now = () => Date.now();
  const failedAttempts = new Map();

  const mime = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml"
  };

  function sendJson(res, status, body, extraHeaders = {}) {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders
    });
    res.end(JSON.stringify(body));
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let data = "";
      req.on("data", (chunk) => {
        data += chunk;
        if (data.length > 2 * 1024 * 1024) {
          reject(new Error("request too large"));
          req.destroy();
        }
      });
      req.on("end", () => resolve(data));
      req.on("error", reject);
    });
  }

  function loadConfig() {
    if (!fs.existsSync(configFile)) return null;
    try {
      return JSON.parse(fs.readFileSync(configFile, "utf8"));
    } catch {
      return null;
    }
  }

  function parseCookies(req) {
    const out = {};
    const raw = req.headers.cookie || "";
    for (const part of raw.split(";")) {
      const [k, ...v] = part.trim().split("=");
      if (!k) continue;
      out[k] = decodeURIComponent(v.join("="));
    }
    return out;
  }

  function b64urlEncode(value) {
    return Buffer.from(value).toString("base64url");
  }

  function b64urlDecode(value) {
    return Buffer.from(value, "base64url").toString("utf8");
  }

  function timingSafeEqualText(a, b) {
    const aa = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (aa.length !== bb.length) return false;
    return crypto.timingSafeEqual(aa, bb);
  }

  function getEditorAuthSettings(config) {
    const auth = config?.editorAuth || {};
    return {
      enabled: Boolean(auth.enabled),
      passwordEnv: String(auth.passwordEnv || "EDITOR_PASSWORD"),
      password: String(auth.password || ""),
      sessionSecretEnv: String(auth.sessionSecretEnv || "EDITOR_SESSION_SECRET"),
      sessionSecret: String(auth.sessionSecret || ""),
      cookieName: String(auth.cookieName || "blog_editor_session"),
      sessionHours: Number(auth.sessionHours || 12),
      maxAttempts: Number(auth.maxAttempts || 5),
      cooldownMinutes: Number(auth.cooldownMinutes || 10)
    };
  }

  function resolveEditorPassword(settings) {
    return process.env[settings.passwordEnv] || settings.password || "";
  }

  function resolveSessionSecret(settings, password) {
    return process.env[settings.sessionSecretEnv] || settings.sessionSecret || password || "";
  }

  function createSessionToken(secret, hours) {
    const issuedAt = Math.floor(now() / 1000);
    const exp = issuedAt + Math.max(1, Math.floor(hours * 3600));
    const payload = { iat: issuedAt, exp };
    const encoded = b64urlEncode(JSON.stringify(payload));
    const sig = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
    return `${encoded}.${sig}`;
  }

  function verifySessionToken(token, secret) {
    const raw = String(token || "");
    const parts = raw.split(".");
    if (parts.length !== 2) return false;
    const [encoded, sig] = parts;
    const expected = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
    if (!timingSafeEqualText(sig, expected)) return false;
    let payload;
    try {
      payload = JSON.parse(b64urlDecode(encoded));
    } catch {
      return false;
    }
    return Number(payload.exp || 0) > Math.floor(now() / 1000);
  }

  function getClientKey(req) {
    const xff = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    return xff || req.socket.remoteAddress || "unknown";
  }

  function getLockState(clientKey) {
    const entry = failedAttempts.get(clientKey);
    if (!entry) return { locked: false, attempts: 0, retrySeconds: 0 };
    if (entry.blockedUntil && entry.blockedUntil > now()) {
      return {
        locked: true,
        attempts: entry.attempts,
        retrySeconds: Math.ceil((entry.blockedUntil - now()) / 1000)
      };
    }
    if (entry.blockedUntil && entry.blockedUntil <= now()) {
      failedAttempts.delete(clientKey);
      return { locked: false, attempts: 0, retrySeconds: 0 };
    }
    return { locked: false, attempts: entry.attempts, retrySeconds: 0 };
  }

  function registerFailedAttempt(clientKey, settings) {
    const prev = failedAttempts.get(clientKey) || { attempts: 0, blockedUntil: 0 };
    const attempts = prev.attempts + 1;
    const out = { attempts, blockedUntil: 0 };
    if (attempts >= settings.maxAttempts) {
      out.blockedUntil = now() + settings.cooldownMinutes * 60 * 1000;
    }
    failedAttempts.set(clientKey, out);
    return out;
  }

  function clearFailedAttempts(clientKey) {
    failedAttempts.delete(clientKey);
  }

  function getEditorAuthState(req, settings) {
    if (!settings.enabled) return { enabled: false, authenticated: true, misconfigured: false };
    const password = resolveEditorPassword(settings);
    const secret = resolveSessionSecret(settings, password);
    if (!password || !secret) return { enabled: true, authenticated: false, misconfigured: true };
    const cookies = parseCookies(req);
    const token = cookies[settings.cookieName];
    return { enabled: true, authenticated: verifySessionToken(token, secret), misconfigured: false };
  }

  function isEditorAuthenticated(req, settings) {
    return getEditorAuthState(req, settings).authenticated;
  }

  function stripMarkdown(text) {
    return String(text)
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^>\s?/gm, "")
      .replace(/^[-*+]\s+/gm, "")
      .replace(/^\d+\.\s+/gm, "")
      .replace(/[*_~>#-]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function inferTitle(markdown) {
    for (const line of String(markdown).split(/\r?\n/)) {
      const m = line.match(/^#\s+(.+)$/);
      if (m) return m[1].trim();
    }
    return "未命名文章";
  }

  function slugify(input) {
    const s = String(input || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-+/g, "-");
    if (s) return s;
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(
      d.getDate()
    ).padStart(2, "0")}`;
    const hms = `${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(
      2,
      "0"
    )}${String(d.getSeconds()).padStart(2, "0")}`;
    return `post-${ymd}-${hms}`;
  }

  function parseFrontMatter(content) {
    const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!match) return { meta: {}, body: content };
    const meta = {};
    for (const line of match[1].split("\n")) {
      const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.+)\s*$/);
      if (!kv) continue;
      meta[kv[1].trim()] = kv[2].trim().replace(/^"(.*)"$/, "$1");
    }
    return { meta, body: content.slice(match[0].length) };
  }

  function buildFrontMatter(meta, body) {
    const ordered = ["title", "date", "draft", "description"];
    const used = new Set();
    const lines = ["---"];

    for (const key of ordered) {
      if (!(key in meta)) continue;
      used.add(key);
      const value = meta[key];
      if (key === "draft") {
        lines.push(`draft: ${String(value).toLowerCase() === "true" ? "true" : "false"}`);
      } else if (key === "date") {
        lines.push(`date: ${value}`);
      } else {
        lines.push(`${key}: "${String(value).replaceAll('"', '\\"')}"`);
      }
    }

    for (const [k, v] of Object.entries(meta)) {
      if (used.has(k)) continue;
      lines.push(`${k}: "${String(v).replaceAll('"', '\\"')}"`);
    }

    lines.push("---", "");
    return lines.join("\n") + body.trim() + "\n";
  }

  function buildPostFileContent(payload) {
    const markdown = String(payload?.markdown || "").trim();
    if (!markdown) throw new Error("正文为空，不能发布。");

    const title = String(payload?.title || inferTitle(markdown)).trim();
    const slug = slugify(payload?.slug || title);
    const date = String(payload?.date || new Date().toISOString().slice(0, 10)).trim();
    const description = String(payload?.description || "").trim();
    const draft = Boolean(payload?.draft);

    const meta = { title, date, draft: draft ? "true" : "false" };
    if (description) meta.description = description;
    const content = buildFrontMatter(meta, markdown);
    const frontMatterPreview = content.split("\n\n")[0] + "\n";
    return { slug, draft, content, frontMatterPreview };
  }

  function buildSimpleDiff(existingText, incomingText, maxLines = 200) {
    const a = String(existingText).split(/\r?\n/);
    const b = String(incomingText).split(/\r?\n/);
    const len = Math.max(a.length, b.length);
    const lines = [];
    for (let i = 0; i < len && lines.length < maxLines; i++) {
      const left = a[i];
      const right = b[i];
      if (left === right) lines.push(`  ${left || ""}`);
      else {
        if (typeof left !== "undefined") lines.push(`- ${left}`);
        if (typeof right !== "undefined") lines.push(`+ ${right}`);
      }
    }
    if (len > maxLines) lines.push("... diff truncated ...");
    return lines.join("\n");
  }

  function getPostsDir() {
    return path.join(root, "posts");
  }

  function assertValidSlug(slug) {
    if (!/^[a-z0-9\u4e00-\u9fa5-]+$/i.test(String(slug || ""))) {
      throw new Error("无效 slug");
    }
  }

  function postFilePath(slug) {
    assertValidSlug(slug);
    return path.join(getPostsDir(), `${slug}.md`);
  }

  function listAllPosts() {
    const postsDir = getPostsDir();
    if (!fs.existsSync(postsDir)) return [];
    const files = fs
      .readdirSync(postsDir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.toLowerCase().endsWith(".md"))
      .map((d) => d.name);
    const out = [];
    for (const fileName of files) {
      const slug = path.basename(fileName, ".md");
      if (slug === "draft" || slug.startsWith("_")) continue;
      const full = path.join(postsDir, fileName);
      const stat = fs.statSync(full);
      const content = fs.readFileSync(full, "utf8");
      const { meta, body } = parseFrontMatter(content);
      out.push({
        slug,
        title: meta.title || inferTitle(body),
        date: meta.date || stat.mtime.toISOString().slice(0, 10),
        draft: String(meta.draft || "").toLowerCase() === "true",
        size: stat.size,
        updatedAt: stat.mtime.toISOString()
      });
    }
    out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return out;
  }

  async function setPostDraft(slug, draft) {
    const file = postFilePath(slug);
    if (!fs.existsSync(file)) throw new Error("文章不存在");
    const content = fs.readFileSync(file, "utf8");
    const parsed = parseFrontMatter(content);
    const meta = { ...parsed.meta };
    if (!meta.title) meta.title = inferTitle(parsed.body);
    if (!meta.date) meta.date = new Date().toISOString().slice(0, 10);
    meta.draft = draft ? "true" : "false";
    const next = buildFrontMatter(meta, parsed.body);
    fs.writeFileSync(file, next, "utf8");
    await buildIndex(root);
  }

  async function deletePost(slug) {
    const file = postFilePath(slug);
    if (!fs.existsSync(file)) throw new Error("文章不存在");
    fs.unlinkSync(file);
    await buildIndex(root);
  }

  async function generateAiSummary(markdown) {
    const config = loadConfig();
    if (!config) throw new Error("缺少 blog.config.json，请先复制示例配置。");
    const ai = config.aiSummary || {};
    if (!ai.enabled) throw new Error("请在 blog.config.json 中设置 aiSummary.enabled=true。");
    if (!ai.baseURL || !ai.model || !ai.apiKeyEnv) {
      throw new Error("请在 blog.config.json 中配置 aiSummary.baseURL/model/apiKeyEnv。");
    }
    const apiKey = process.env[ai.apiKeyEnv];
    if (!apiKey) throw new Error(`缺少环境变量 ${ai.apiKeyEnv}。`);
    if (!globalThis.fetch) throw new Error("当前 Node 版本不支持 fetch，请升级 Node。");

    const title = inferTitle(markdown);
    const maxInputChars = Number(ai.maxInputChars || 4000);
    const maxOutputChars = Number(ai.maxOutputChars || 140);
    const text = stripMarkdown(markdown).slice(0, maxInputChars);
    if (!text) throw new Error("正文为空，无法生成摘要。");

    const endpoint = `${String(ai.baseURL).replace(/\/$/, "")}/chat/completions`;
    const payload = {
      model: ai.model,
      temperature: 0.2,
      max_tokens: 120,
      messages: [
        {
          role: "system",
          content: "Generate one concise Chinese summary sentence for a blog post. Plain text only."
        },
        {
          role: "user",
          content: `请生成一句摘要（不超过${maxOutputChars}字）。标题：${title}\n正文：${text}`
        }
      ]
    };

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`AI 请求失败(${res.status}): ${txt.slice(0, 160)}`);
    }
    const data = await res.json();
    const summary = String(data?.choices?.[0]?.message?.content || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxOutputChars);
    if (!summary) throw new Error("模型未返回摘要。");
    return summary;
  }

  async function publishPost(payload) {
    const { slug, draft, content, frontMatterPreview } = buildPostFileContent(payload);
    const overwrite = Boolean(payload?.overwrite);
    const postsDir = getPostsDir();
    fs.mkdirSync(postsDir, { recursive: true });
    const mdPath = path.join(postsDir, `${slug}.md`);

    if (fs.existsSync(mdPath) && !overwrite) {
      const existing = fs.readFileSync(mdPath, "utf8");
      return {
        conflict: true,
        slug,
        message: `文章已存在：${slug}.md`,
        diff: buildSimpleDiff(existing, content),
        frontMatterPreview
      };
    }

    fs.writeFileSync(mdPath, content, "utf8");
    await buildIndex(root);
    return { conflict: false, slug, draft, path: `posts/${slug}.md`, frontMatterPreview };
  }

  function serveStatic(req, res, pathname) {
    const safePath = path.normalize(pathname).replace(/^(\.\.[\\/])+/, "");
    let fullPath = path.join(root, safePath);
    if (pathname === "/") fullPath = path.join(root, "index.html");
    if (!fullPath.startsWith(root)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }
    const ext = path.extname(fullPath).toLowerCase();
    res.writeHead(200, { "Content-Type": mime[ext] || "application/octet-stream" });
    fs.createReadStream(fullPath).pipe(res);
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = decodeURIComponent(url.pathname);
    const config = loadConfig();
    const editorAuth = getEditorAuthSettings(config);
    const clientKey = getClientKey(req);

    if (req.method === "GET" && pathname === "/api/editor/auth-status") {
      const state = getEditorAuthState(req, editorAuth);
      const lockState = getLockState(clientKey);
      if (state.misconfigured) {
        sendJson(res, 200, {
          ok: true,
          enabled: true,
          authenticated: false,
          message: `请配置 editorAuth.password 或环境变量 ${editorAuth.passwordEnv}`
        });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        enabled: state.enabled,
        authenticated: state.authenticated,
        locked: lockState.locked,
        retrySeconds: lockState.retrySeconds
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/editor/login") {
      try {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}");
        if (!editorAuth.enabled) {
          sendJson(res, 200, { ok: true, enabled: false, authenticated: true });
          return;
        }

        const lockState = getLockState(clientKey);
        if (lockState.locked) {
          sendJson(res, 429, {
            ok: false,
            message: `尝试次数过多，请在 ${lockState.retrySeconds} 秒后重试。`,
            retrySeconds: lockState.retrySeconds
          });
          return;
        }

        const password = resolveEditorPassword(editorAuth);
        const secret = resolveSessionSecret(editorAuth, password);
        if (!password || !secret) {
          sendJson(res, 400, {
            ok: false,
            message: `请配置 editorAuth.password 或环境变量 ${editorAuth.passwordEnv}`
          });
          return;
        }

        const incoming = String(body.password || "");
        if (!timingSafeEqualText(incoming, password)) {
          const fail = registerFailedAttempt(clientKey, editorAuth);
          if (fail.blockedUntil > now()) {
            const retrySeconds = Math.ceil((fail.blockedUntil - now()) / 1000);
            sendJson(res, 429, {
              ok: false,
              message: `尝试次数过多，请在 ${retrySeconds} 秒后重试。`,
              retrySeconds
            });
            return;
          }
          const attemptsLeft = Math.max(0, editorAuth.maxAttempts - fail.attempts);
          sendJson(res, 401, { ok: false, message: `密码错误，还可尝试 ${attemptsLeft} 次。` });
          return;
        }

        clearFailedAttempts(clientKey);
        const token = createSessionToken(secret, editorAuth.sessionHours);
        const maxAge = Math.max(1, Math.floor(editorAuth.sessionHours * 3600));
        sendJson(
          res,
          200,
          { ok: true, enabled: true, authenticated: true },
          {
            "Set-Cookie": `${editorAuth.cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
          }
        );
      } catch (err) {
        sendJson(res, 400, { ok: false, message: err.message });
      }
      return;
    }

    if (req.method === "POST" && pathname === "/api/editor/logout") {
      sendJson(
        res,
        200,
        { ok: true },
        { "Set-Cookie": `${editorAuth.cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` }
      );
      return;
    }

    const protectedApi =
      pathname === "/api/summary" ||
      pathname === "/api/publish" ||
      pathname === "/api/posts/manage" ||
      pathname === "/api/posts/delete" ||
      pathname === "/api/posts/set-draft";
    if (protectedApi && !isEditorAuthenticated(req, editorAuth)) {
      sendJson(res, 401, { ok: false, message: "未登录编辑器，请先输入密码。" });
      return;
    }

    if (req.method === "POST" && pathname === "/api/summary") {
      try {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}");
        const summary = await generateAiSummary(body.markdown || "");
        sendJson(res, 200, { ok: true, summary });
      } catch (err) {
        sendJson(res, 400, { ok: false, message: err.message });
      }
      return;
    }

    if (req.method === "POST" && pathname === "/api/publish") {
      try {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}");
        const result = await publishPost(body);
        if (result.conflict) sendJson(res, 409, { ok: false, ...result });
        else sendJson(res, 200, { ok: true, ...result });
      } catch (err) {
        sendJson(res, 400, { ok: false, message: err.message });
      }
      return;
    }

    if (req.method === "GET" && pathname === "/api/posts/manage") {
      try {
        sendJson(res, 200, { ok: true, posts: listAllPosts() });
      } catch (err) {
        sendJson(res, 400, { ok: false, message: err.message });
      }
      return;
    }

    if (req.method === "POST" && pathname === "/api/posts/delete") {
      try {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}");
        await deletePost(body.slug);
        sendJson(res, 200, { ok: true });
      } catch (err) {
        sendJson(res, 400, { ok: false, message: err.message });
      }
      return;
    }

    if (req.method === "POST" && pathname === "/api/posts/set-draft") {
      try {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}");
        await setPostDraft(body.slug, Boolean(body.draft));
        sendJson(res, 200, { ok: true });
      } catch (err) {
        sendJson(res, 400, { ok: false, message: err.message });
      }
      return;
    }

    if (req.method === "GET") {
      serveStatic(req, res, pathname);
      return;
    }

    res.writeHead(405);
    res.end("Method Not Allowed");
  });
}

if (require.main === module) {
  const server = createServer({ root: process.cwd() });
  const port = Number(process.env.PORT || 8000);
  server.listen(port, () => {
    console.log(`Dev server started: http://localhost:${port}`);
  });
}

module.exports = { createServer };
