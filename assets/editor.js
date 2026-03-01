let editorLocked = false;

function renderPreview() {
  const inputEl = document.getElementById("md-input");
  const previewEl = document.getElementById("preview");
  if (!inputEl || !previewEl) return;
  const rendered = renderMarkdown(inputEl.value);
  previewEl.innerHTML = rendered.html;
  applyCodeHighlight(previewEl);
}

function setStatus(message, isError = false) {
  const statusEl = document.getElementById("editor-status");
  if (!statusEl) return;
  statusEl.textContent = message || "";
  statusEl.style.color = isError ? "#b91c1c" : "";
}

function setAuthStatus(message, isError = false) {
  const el = document.getElementById("auth-status");
  if (!el) return;
  el.textContent = message || "";
  el.style.color = isError ? "#b91c1c" : "";
}

function inferTitle(markdown) {
  for (const line of String(markdown).split(/\r?\n/)) {
    const m = line.match(/^#\s+(.+)$/);
    if (m) return m[1].trim();
  }
  return "未命名文章";
}

function escapeFrontMatterValue(text) {
  return String(text || "").replaceAll('"', '\\"');
}

function parseFrontMatter(content) {
  const match = String(content).match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { meta: {}, body: String(content) };
  const meta = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.+)\s*$/);
    if (!kv) continue;
    meta[kv[1].trim()] = kv[2].trim().replace(/^"(.*)"$/, "$1");
  }
  return { meta, body: String(content).slice(match[0].length) };
}

function buildFrontMatterPreview() {
  const title = document.getElementById("post-title")?.value.trim();
  const date = document.getElementById("post-date")?.value.trim();
  const summary = document.getElementById("ai-summary-output")?.value.trim();
  const draft = document.getElementById("post-draft")?.checked;
  const markdown = document.getElementById("md-input")?.value || "";

  const lines = ["---"];
  lines.push(`title: "${escapeFrontMatterValue(title || inferTitle(markdown))}"`);
  lines.push(`date: ${date || new Date().toISOString().slice(0, 10)}`);
  lines.push(`draft: ${draft ? "true" : "false"}`);
  if (summary) lines.push(`description: "${escapeFrontMatterValue(summary)}"`);
  lines.push("---");

  const panel = document.getElementById("frontmatter-preview");
  if (panel) panel.textContent = lines.join("\n");
}

function setEditorLocked(locked) {
  editorLocked = locked;
  const aiBtn = document.getElementById("btn-ai-summary");
  const pubBtn = document.getElementById("btn-publish");
  const draftBtn = document.getElementById("btn-save-draft");
  if (aiBtn) aiBtn.disabled = locked;
  if (pubBtn) pubBtn.disabled = locked;
  if (draftBtn) draftBtn.disabled = locked;
}

function showConflictDiff(diffText) {
  const panel = document.getElementById("conflict-panel");
  const diff = document.getElementById("conflict-diff");
  if (!panel || !diff) return;
  if (!diffText) {
    panel.classList.add("hidden");
    diff.textContent = "";
    return;
  }
  panel.classList.remove("hidden");
  diff.textContent = diffText;
}

async function refreshAuthState() {
  const panel = document.getElementById("auth-panel");
  const loginBtn = document.getElementById("btn-auth-login");
  const logoutBtn = document.getElementById("btn-auth-logout");
  if (!panel || !loginBtn || !logoutBtn) return;

  try {
    const res = await fetch("/api/editor/auth-status");
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setEditorLocked(true);
      panel.style.display = "block";
      setAuthStatus(data.message || "鉴权状态检查失败。", true);
      return;
    }
    if (!data.enabled) {
      panel.style.display = "none";
      setEditorLocked(false);
      return;
    }
    panel.style.display = "block";
    if (data.authenticated) {
      setEditorLocked(false);
      setAuthStatus("已登录");
      loginBtn.style.display = "inline-block";
      logoutBtn.style.display = "inline-block";
    } else {
      setEditorLocked(true);
      const lockMsg = data.locked ? `，已锁定 ${data.retrySeconds || 0} 秒` : "";
      setAuthStatus((data.message || "请先输入密码登录。") + lockMsg);
      loginBtn.style.display = "inline-block";
      logoutBtn.style.display = "none";
    }
  } catch (err) {
    panel.style.display = "block";
    setEditorLocked(true);
    setAuthStatus(`鉴权状态检查失败：${err.message}`, true);
  }
}

async function loginEditor() {
  const input = document.getElementById("editor-password");
  if (!input) return;
  if (!input.value) {
    setAuthStatus("请输入密码。", true);
    return;
  }
  setAuthStatus("正在登录...");
  try {
    const res = await fetch("/api/editor/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: input.value })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.message || `登录失败(${res.status})`);
    input.value = "";
    await refreshAuthState();
  } catch (err) {
    setEditorLocked(true);
    setAuthStatus(`登录失败：${err.message}`, true);
  }
}

async function logoutEditor() {
  try {
    await fetch("/api/editor/logout", { method: "POST" });
  } finally {
    await refreshAuthState();
  }
}

function downloadMarkdown() {
  const inputEl = document.getElementById("md-input");
  if (!inputEl) return;
  const blob = new Blob([inputEl.value], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "draft.md";
  a.click();
  URL.revokeObjectURL(url);
  setStatus("已下载 draft.md");
}

async function generateAiSummary() {
  if (editorLocked) {
    setStatus("请先登录编辑器。", true);
    return;
  }
  const mdInput = document.getElementById("md-input");
  const outputEl = document.getElementById("ai-summary-output");
  if (!mdInput || !outputEl) return;

  setStatus("正在生成 AI 摘要...");
  outputEl.value = "正在生成...";
  try {
    const res = await fetch("/api/summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown: mdInput.value })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.message || `请求失败(${res.status})`);
    outputEl.value = data.summary || "";
    buildFrontMatterPreview();
    setStatus("AI 摘要生成成功。");
  } catch (err) {
    outputEl.value = "";
    buildFrontMatterPreview();
    setStatus(`AI 摘要失败：${err.message}`, true);
  }
}

async function submitPublish({ forceDraft = false } = {}) {
  if (editorLocked) {
    setStatus("请先登录编辑器。", true);
    return;
  }
  const mdInput = document.getElementById("md-input");
  const titleEl = document.getElementById("post-title");
  const slugEl = document.getElementById("post-slug");
  const dateEl = document.getElementById("post-date");
  const summaryEl = document.getElementById("ai-summary-output");
  const draftEl = document.getElementById("post-draft");
  if (!mdInput || !titleEl || !slugEl || !dateEl || !summaryEl || !draftEl) return;
  if (!mdInput.value.trim()) {
    setStatus("正文为空，不能发布。", true);
    return;
  }

  const payload = {
    markdown: mdInput.value,
    title: titleEl.value.trim() || inferTitle(mdInput.value),
    slug: slugEl.value.trim(),
    date: dateEl.value.trim(),
    description: summaryEl.value.trim(),
    draft: forceDraft ? true : Boolean(draftEl.checked)
  };

  showConflictDiff("");
  setStatus(forceDraft ? "正在保存草稿..." : "正在发布...");
  try {
    let res = await fetch("/api/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    let data = await res.json();
    if (res.status === 409) {
      showConflictDiff(data.diff || "");
      const yes = window.confirm(`${data.message}\n是否覆盖发布？`);
      if (!yes) {
        setStatus("发布已取消。");
        return;
      }
      res = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, overwrite: true })
      });
      data = await res.json();
    }
    if (!res.ok || !data.ok) throw new Error(data.message || `发布失败(${res.status})`);

    if (!slugEl.value.trim()) slugEl.value = data.slug || "";
    buildFrontMatterPreview();

    if (data.draft) {
      setStatus(`草稿已保存：${data.path}`);
      return;
    }
    setStatus(`发布成功：${data.path}`);
    window.location.href = `post.html?slug=${encodeURIComponent(data.slug)}`;
  } catch (err) {
    setStatus(`发布失败：${err.message}`, true);
  }
}

async function loadPostFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get("slug");
  if (!slug) return;

  try {
    const res = await fetch(`posts/${encodeURIComponent(slug)}.md`);
    if (!res.ok) throw new Error("文章不存在或读取失败");
    const text = await res.text();
    const parsed = parseFrontMatter(text);
    document.getElementById("post-title").value = parsed.meta.title || "";
    document.getElementById("post-slug").value = slug;
    document.getElementById("post-date").value = parsed.meta.date || "";
    document.getElementById("post-draft").checked = String(parsed.meta.draft || "").toLowerCase() === "true";
    document.getElementById("ai-summary-output").value = parsed.meta.description || "";
    document.getElementById("md-input").value = parsed.body.trim();
    renderPreview();
    buildFrontMatterPreview();
    setStatus(`已载入文章：${slug}`);
  } catch (err) {
    setStatus(`载入文章失败：${err.message}`, true);
  }
}

document.getElementById("btn-preview")?.addEventListener("click", renderPreview);
document.getElementById("btn-download")?.addEventListener("click", downloadMarkdown);
document.getElementById("btn-ai-summary")?.addEventListener("click", generateAiSummary);
document.getElementById("btn-publish")?.addEventListener("click", () => submitPublish());
document
  .getElementById("btn-save-draft")
  ?.addEventListener("click", () => submitPublish({ forceDraft: true }));
document.getElementById("btn-auth-login")?.addEventListener("click", loginEditor);
document.getElementById("btn-auth-logout")?.addEventListener("click", logoutEditor);

for (const id of ["post-title", "post-slug", "post-date", "post-draft", "ai-summary-output", "md-input"]) {
  document.getElementById(id)?.addEventListener("input", buildFrontMatterPreview);
  document.getElementById(id)?.addEventListener("change", buildFrontMatterPreview);
}

renderPreview();
buildFrontMatterPreview();
setEditorLocked(true);
refreshAuthState();
loadPostFromQuery();
