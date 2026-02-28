const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const POSTS_DIR = path.join(ROOT, "posts");
const INDEX_FILE = path.join(POSTS_DIR, "index.json");

function fail(msg) {
  console.error(`[check:content] ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(INDEX_FILE)) {
  fail("missing posts/index.json, run npm run generate:index first.");
}

const raw = fs.readFileSync(INDEX_FILE, "utf8");
let posts;
try {
  posts = JSON.parse(raw);
} catch (err) {
  fail(`invalid JSON in posts/index.json: ${err.message}`);
}

if (!Array.isArray(posts)) {
  fail("posts/index.json must be an array.");
}

const seen = new Set();
for (const [i, post] of posts.entries()) {
  const prefix = `item #${i + 1}`;
  if (!post || typeof post !== "object") {
    fail(`${prefix} must be object.`);
  }
  for (const key of ["slug", "title", "date", "description", "excerpt", "summarySource"]) {
    if (typeof post[key] !== "string" || !post[key].trim()) {
      fail(`${prefix} has invalid "${key}".`);
    }
  }
  if (post.aiDescription != null && typeof post.aiDescription !== "string") {
    fail(`${prefix} has invalid "aiDescription".`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(post.date)) {
    fail(`${prefix} date must be YYYY-MM-DD.`);
  }
  if (seen.has(post.slug)) {
    fail(`duplicated slug "${post.slug}".`);
  }
  seen.add(post.slug);
  const mdFile = path.join(POSTS_DIR, `${post.slug}.md`);
  if (!fs.existsSync(mdFile)) {
    fail(`missing markdown file for slug "${post.slug}" -> ${mdFile}`);
  }
}

console.log(`[check:content] OK (${posts.length} posts)`);
