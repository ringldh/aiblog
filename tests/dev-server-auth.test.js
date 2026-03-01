const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createServer } = require("../scripts/dev-server");

async function runRateLimitCase() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "blog-auth-"));
  fs.mkdirSync(path.join(tmp, "posts"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "index.html"), "<!doctype html><title>x</title>", "utf8");
  fs.writeFileSync(
    path.join(tmp, "blog.config.json"),
    JSON.stringify(
      {
        editorAuth: {
          enabled: true,
          password: "pass123",
          sessionSecret: "secret123",
          maxAttempts: 2,
          cooldownMinutes: 1
        },
        aiSummary: { enabled: false }
      },
      null,
      2
    ),
    "utf8"
  );

  const server = createServer({ root: tmp });
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const bad1 = await fetch(`${base}/api/editor/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "x1" })
  });
  assert.equal(bad1.status, 401);

  const bad2 = await fetch(`${base}/api/editor/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "x2" })
  });
  assert.equal(bad2.status, 429);

  await new Promise((resolve) => server.close(resolve));
}

async function runAuthCase() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "blog-auth-ok-"));
  fs.mkdirSync(path.join(tmp, "posts"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "index.html"), "<!doctype html><title>x</title>", "utf8");
  fs.writeFileSync(
    path.join(tmp, "blog.config.json"),
    JSON.stringify(
      {
        editorAuth: {
          enabled: true,
          password: "pass123",
          sessionSecret: "secret123"
        },
        aiSummary: { enabled: false }
      },
      null,
      2
    ),
    "utf8"
  );

  const server = createServer({ root: tmp });
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const loginRes = await fetch(`${base}/api/editor/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "pass123" })
  });
  assert.equal(loginRes.status, 200);
  const setCookie = loginRes.headers.get("set-cookie");
  assert.ok(setCookie);
  const cookieHeader = setCookie.split(";")[0];

  const summaryRes = await fetch(`${base}/api/summary`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader
    },
    body: JSON.stringify({ markdown: "# hi" })
  });
  assert.equal(summaryRes.status, 400);

  const manageRes = await fetch(`${base}/api/posts/manage`, {
    headers: { Cookie: cookieHeader }
  });
  assert.equal(manageRes.status, 200);
  const manageData = await manageRes.json();
  assert.equal(manageData.ok, true);
  assert.ok(Array.isArray(manageData.posts));

  await new Promise((resolve) => server.close(resolve));
}

async function run() {
  await runRateLimitCase();
  await runAuthCase();
}

module.exports = { run };
