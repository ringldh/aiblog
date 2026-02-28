const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const POSTS_DIR = path.join(ROOT, "posts");
const OUT_FILE = path.join(POSTS_DIR, "index.json");
const CONFIG_FILE = path.join(ROOT, "blog.config.json");
const AI_CACHE_FILE = path.join(POSTS_DIR, ".ai-summary-cache.json");

function loadConfig() {
  const defaults = {
    excerptLength: 120,
    aiSummary: {
      enabled: false,
      mode: "missing-meta",
      baseURL: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      apiKeyEnv: "OPENAI_API_KEY",
      maxInputChars: 4000,
      maxOutputChars: 140,
      forceRefresh: false,
      allowStaleCache: true
    }
  };
  if (!fs.existsSync(CONFIG_FILE)) return defaults;
  const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  return {
    excerptLength: Number(parsed?.excerptLength || defaults.excerptLength),
    aiSummary: {
      enabled: Boolean(parsed?.aiSummary?.enabled),
      mode: parsed?.aiSummary?.mode || defaults.aiSummary.mode,
      baseURL: parsed?.aiSummary?.baseURL || defaults.aiSummary.baseURL,
      model: parsed?.aiSummary?.model || defaults.aiSummary.model,
      apiKeyEnv: parsed?.aiSummary?.apiKeyEnv || defaults.aiSummary.apiKeyEnv,
      maxInputChars: Number(parsed?.aiSummary?.maxInputChars || defaults.aiSummary.maxInputChars),
      maxOutputChars: Number(
        parsed?.aiSummary?.maxOutputChars || defaults.aiSummary.maxOutputChars
      ),
      forceRefresh: Boolean(parsed?.aiSummary?.forceRefresh),
      allowStaleCache:
        parsed?.aiSummary?.allowStaleCache === false
          ? false
          : defaults.aiSummary.allowStaleCache
    }
  };
}

function loadAiCache() {
  if (!fs.existsSync(AI_CACHE_FILE)) {
    return { version: 1, entries: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(AI_CACHE_FILE, "utf8"));
    if (!parsed || typeof parsed !== "object" || typeof parsed.entries !== "object") {
      return { version: 1, entries: {} };
    }
    return parsed;
  } catch {
    return { version: 1, entries: {} };
  }
}

function saveAiCache(cache) {
  fs.writeFileSync(AI_CACHE_FILE, JSON.stringify(cache, null, 2) + "\n", "utf8");
}

function readFrontMatter(content) {
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
    .replace(/\|/g, " ")
    .replace(/[*_~>#-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function inferTitle(body, slug) {
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^#\s+(.+)$/);
    if (m) return stripMarkdown(m[1]) || slug;
  }
  return slug;
}

function inferExcerpt(body, maxLen) {
  return stripMarkdown(body).slice(0, maxLen);
}

function normalizeDate(dateValue, stat) {
  if (typeof dateValue === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    return dateValue;
  }
  return stat.mtime.toISOString().slice(0, 10);
}

function shouldUseAiSummary(config, meta) {
  if (!config.aiSummary.enabled) return false;
  if (String(meta.ai_summary || "").toLowerCase() === "false") return false;
  if (config.aiSummary.mode === "always") return true;
  if (config.aiSummary.mode === "missing-meta") return !meta.description;
  return false;
}

function hashForSummary(title, body, config) {
  return crypto
    .createHash("sha256")
    .update(`${title}\n${body}\n${config.aiSummary.model}\n${config.aiSummary.maxOutputChars}`)
    .digest("hex");
}

async function requestAiSummary(title, body, config) {
  if (!globalThis.fetch) return "";
  const apiKey = process.env[config.aiSummary.apiKeyEnv];
  if (!apiKey) {
    console.warn(`[aiSummary] missing env ${config.aiSummary.apiKeyEnv}, skipped.`);
    return "";
  }

  const input = stripMarkdown(body).slice(0, config.aiSummary.maxInputChars);
  if (!input) return "";

  const endpoint = `${config.aiSummary.baseURL.replace(/\/$/, "")}/chat/completions`;
  const payload = {
    model: config.aiSummary.model,
    temperature: 0.2,
    max_tokens: 120,
    messages: [
      {
        role: "system",
        content: "Generate one concise Chinese summary sentence for a blog post. Plain text only."
      },
      {
        role: "user",
        content: `请生成一句摘要（不超过${config.aiSummary.maxOutputChars}字）。标题：${title}\n正文：${input}`
      }
    ]
  };

  try {
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
      console.warn(`[aiSummary] request failed ${res.status}: ${txt.slice(0, 160)}`);
      return "";
    }
    const data = await res.json();
    return String(data?.choices?.[0]?.message?.content || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, config.aiSummary.maxOutputChars);
  } catch (err) {
    console.warn(`[aiSummary] request error: ${err.message}`);
    return "";
  }
}

async function resolveAiSummary(slug, title, body, config, cache) {
  const contentHash = hashForSummary(title, body, config);
  const entry = cache.entries?.[slug];
  const isCacheHit =
    entry &&
    !config.aiSummary.forceRefresh &&
    entry.contentHash === contentHash &&
    entry.model === config.aiSummary.model &&
    entry.baseURL === config.aiSummary.baseURL &&
    typeof entry.summary === "string" &&
    entry.summary;
  if (isCacheHit) {
    return { summary: entry.summary, source: "ai-cache", contentHash };
  }

  const summary = await requestAiSummary(title, body, config);
  if (summary) {
    cache.entries[slug] = {
      summary,
      source: "ai",
      contentHash,
      model: config.aiSummary.model,
      baseURL: config.aiSummary.baseURL,
      updatedAt: new Date().toISOString()
    };
    return { summary, source: "ai", contentHash };
  }

  if (config.aiSummary.allowStaleCache && entry && entry.summary) {
    return { summary: entry.summary, source: "ai-cache-stale", contentHash };
  }
  return { summary: "", source: "", contentHash };
}

async function build() {
  const config = loadConfig();
  const cache = loadAiCache();
  if (!fs.existsSync(POSTS_DIR)) {
    throw new Error(`posts directory not found: ${POSTS_DIR}`);
  }

  const files = fs
    .readdirSync(POSTS_DIR, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.toLowerCase().endsWith(".md"))
    .map((d) => d.name);

  const posts = [];
  for (const fileName of files) {
    const fullPath = path.join(POSTS_DIR, fileName);
    const stat = fs.statSync(fullPath);
    const slug = path.basename(fileName, ".md");
    const content = fs.readFileSync(fullPath, "utf8");
    const { meta, body } = readFrontMatter(content);

    if (slug === "draft" || slug.startsWith("_")) continue;
    if (String(meta.draft || "").toLowerCase() === "true") continue;

    const title = meta.title || inferTitle(body, slug);
    const excerpt = inferExcerpt(body, config.excerptLength);
    let aiDescription = "";
    let summarySource = "excerpt";

    if (shouldUseAiSummary(config, meta)) {
      const resolved = await resolveAiSummary(slug, title, body, config, cache);
      aiDescription = resolved.summary;
      if (aiDescription) summarySource = resolved.source || "ai";
    }

    const description = meta.description || aiDescription || excerpt;
    if (meta.description) summarySource = "meta";

    posts.push({
      slug,
      title,
      date: normalizeDate(meta.date, stat),
      description,
      aiDescription,
      excerpt,
      summarySource
    });
  }

  posts.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return a.slug.localeCompare(b.slug);
  });

  fs.writeFileSync(OUT_FILE, JSON.stringify(posts, null, 2) + "\n", "utf8");
  saveAiCache(cache);
  console.log(`Generated ${posts.length} posts -> posts/index.json`);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
