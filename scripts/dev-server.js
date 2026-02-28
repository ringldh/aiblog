const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = process.cwd();
const PORT = Number(process.env.PORT || 8000);
const CONFIG_FILE = path.join(ROOT, "blog.config.json");
const sessions = new Map();

const MIME = {
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

function timingSafeEqualText(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
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
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `post-${y}${m}${d}-${hh}${mm}${ss}`;
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return null;
  }
}

function getEditorAuthSettings(config) {
  const auth = config?.editorAuth || {};
  return {
    enabled: Boolean(auth.enabled),
    passwordEnv: String(auth.passwordEnv || "EDITOR_PASSWORD"),
    password: String(auth.password || ""),
    cookieName: String(auth.cookieName || "blog_editor_session"),
    sessionHours: Number(auth.sessionHours || 12)
  };
}

function resolveEditorPassword(settings) {
  return process.env[settings.passwordEnv] || settings.password || "";
}

function isEditorAuthenticated(req, settings) {
  if (!settings.enabled) return true;
  const pwd = resolveEditorPassword(settings);
  if (!pwd) return false;
  const cookies = parseCookies(req);
  const token = cookies[settings.cookieName];
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp || exp < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function getEditorAuthState(req, settings) {
  if (!settings.enabled) return { enabled: false, authenticated: true, misconfigured: false };
  const pwd = resolveEditorPassword(settings);
  if (!pwd) return { enabled: true, authenticated: false, misconfigured: true };
  return {
    enabled: true,
    authenticated: isEditorAuthenticated(req, settings),
    misconfigured: false
  };
}

async function generateAiSummary(markdown) {
  const config = loadConfig();
  if (!config) {
    throw new Error("缺少 blog.config.json，请先从 blog.config.example.json 复制并配置。");
  }
  const ai = config.aiSummary || {};
  if (!ai.enabled) {
    throw new Error("请在 blog.config.json 中设置 aiSummary.enabled=true。");
  }
  if (!ai.baseURL || !ai.model || !ai.apiKeyEnv) {
    throw new Error("请在 blog.config.json 中配置 aiSummary.baseURL/model/apiKeyEnv。");
  }
  const apiKey = process.env[ai.apiKeyEnv];
  if (!apiKey) {
    throw new Error(`缺少环境变量 ${ai.apiKeyEnv}。`);
  }
  if (!globalThis.fetch) {
    throw new Error("当前 Node 版本不支持 fetch，请升级 Node。");
  }

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

function publishPost(payload) {
  const markdown = String(payload?.markdown || "");
  if (!markdown.trim()) throw new Error("正文为空，不能发布。");

  const title = String(payload?.title || inferTitle(markdown)).trim();
  const slug = slugify(payload?.slug || title);
  const date = String(payload?.date || new Date().toISOString().slice(0, 10)).trim();
  const description = String(payload?.description || "").trim();
  const overwrite = Boolean(payload?.overwrite);

  const postsDir = path.join(ROOT, "posts");
  fs.mkdirSync(postsDir, { recursive: true });
  const mdPath = path.join(postsDir, `${slug}.md`);
  if (fs.existsSync(mdPath) && !overwrite) {
    return { conflict: true, slug, message: `文章已存在：${slug}.md` };
  }

  let out = "---\n";
  out += `title: "${title.replaceAll('"', '\\"')}"\n`;
  out += `date: ${date}\n`;
  if (description) out += `description: "${description.replaceAll('"', '\\"')}"\n`;
  out += "---\n\n";
  out += markdown.trim() + "\n";
  fs.writeFileSync(mdPath, out, "utf8");

  execFileSync(process.execPath, [path.join("scripts", "generate-index.js")], {
    cwd: ROOT,
    stdio: "pipe"
  });
  return { conflict: false, slug };
}

function serveStatic(req, res, pathname) {
  const safePath = path.normalize(pathname).replace(/^(\.\.[\\/])+/, "");
  let fullPath = path.join(ROOT, safePath);
  if (pathname === "/") fullPath = path.join(ROOT, "index.html");
  if (!fullPath.startsWith(ROOT)) {
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
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(fullPath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);
  const config = loadConfig();
  const editorAuth = getEditorAuthSettings(config);

  if (req.method === "GET" && pathname === "/api/editor/auth-status") {
    const state = getEditorAuthState(req, editorAuth);
    if (state.misconfigured) {
      sendJson(res, 200, {
        ok: true,
        enabled: true,
        authenticated: false,
        message: `请配置 editorAuth.password 或环境变量 ${editorAuth.passwordEnv}`
      });
      return;
    }
    sendJson(res, 200, { ok: true, enabled: state.enabled, authenticated: state.authenticated });
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
      const pwd = resolveEditorPassword(editorAuth);
      if (!pwd) {
        sendJson(res, 400, {
          ok: false,
          message: `请配置 editorAuth.password 或环境变量 ${editorAuth.passwordEnv}`
        });
        return;
      }
      const incoming = String(body.password || "");
      if (!timingSafeEqualText(incoming, pwd)) {
        sendJson(res, 401, { ok: false, message: "密码错误" });
        return;
      }
      const token = crypto.randomBytes(24).toString("hex");
      const maxAge = Math.max(1, Math.floor(editorAuth.sessionHours * 3600));
      sessions.set(token, Date.now() + maxAge * 1000);
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
    const cookies = parseCookies(req);
    const token = cookies[editorAuth.cookieName];
    if (token) sessions.delete(token);
    sendJson(
      res,
      200,
      { ok: true },
      { "Set-Cookie": `${editorAuth.cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` }
    );
    return;
  }

  const protectedApi = pathname === "/api/summary" || pathname === "/api/publish";
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
      const result = publishPost(body);
      if (result.conflict) {
        sendJson(res, 409, { ok: false, ...result });
      } else {
        sendJson(res, 200, { ok: true, ...result });
      }
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

server.listen(PORT, () => {
  console.log(`Dev server started: http://localhost:${PORT}`);
});
