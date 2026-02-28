const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildIndex } = require("../scripts/generate-index");

async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "blog-gen-"));
  const posts = path.join(tmp, "posts");
  fs.mkdirSync(posts, { recursive: true });

  fs.writeFileSync(
    path.join(tmp, "blog.config.json"),
    JSON.stringify({ excerptLength: 80, aiSummary: { enabled: false } }, null, 2),
    "utf8"
  );

  fs.writeFileSync(
    path.join(posts, "hello.md"),
    ["---", 'title: "你好"', "date: 2026-02-28", "draft: false", "---", "", "# 你好", "", "这是正文内容。"].join("\n"),
    "utf8"
  );

  fs.writeFileSync(
    path.join(posts, "hidden.md"),
    ["---", 'title: "草稿"', "draft: true", "---", "", "不应该出现在索引中"].join("\n"),
    "utf8"
  );

  await buildIndex(tmp);

  const out = JSON.parse(fs.readFileSync(path.join(posts, "index.json"), "utf8"));
  assert.equal(out.length, 1);
  assert.equal(out[0].slug, "hello");
  assert.equal(out[0].title, "你好");
  assert.equal(out[0].summarySource, "excerpt");
  assert.ok(typeof out[0].excerpt === "string" && out[0].excerpt.length > 0);
}

module.exports = { run };
