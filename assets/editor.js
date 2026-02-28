let editorLocked = false;

function renderPreview() {
  const inputEl = document.getElementById("md-input");
  const previewEl = document.getElementById("preview");
  if (!inputEl || !previewEl) return;
  previewEl.innerHTML = markdownToHtml(inputEl.value);
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

function setEditorLocked(locked) {
  editorLocked = locked;
  const aiBtn = document.getElementById("btn-ai-summary");
  const pubBtn = document.getElementById("btn-publish");
  if (aiBtn) aiBtn.disabled = locked;
  if (pubBtn) pubBtn.disabled = locked;
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
      loginBtn.style.display = "none";
      logoutBtn.style.display = "inline-block";
    } else {
      setEditorLocked(true);
      setAuthStatus(data.message || "请先输入密码登录。");
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
  const password = input.value;
  if (!password) {
    setAuthStatus("请输入密码。", true);
    return;
  }
  setAuthStatus("正在登录...");
  try {
    const res = await fetch("/api/editor/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.message || `登录失败(${res.status})`);
    }
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
    if (!res.ok || !data.ok) {
      throw new Error(data.message || `请求失败(${res.status})`);
    }
    outputEl.value = data.summary || "";
    setStatus("AI 摘要生成成功。");
  } catch (err) {
    outputEl.value = "";
    setStatus(`AI 摘要失败：${err.message}`, true);
  }
}

async function publishPost() {
  if (editorLocked) {
    setStatus("请先登录编辑器。", true);
    return;
  }
  const mdInput = document.getElementById("md-input");
  const titleEl = document.getElementById("post-title");
  const slugEl = document.getElementById("post-slug");
  const dateEl = document.getElementById("post-date");
  const summaryEl = document.getElementById("ai-summary-output");
  if (!mdInput || !titleEl || !slugEl || !dateEl || !summaryEl) return;

  const markdown = mdInput.value;
  if (!markdown.trim()) {
    setStatus("正文为空，不能发布。", true);
    return;
  }

  const payload = {
    markdown,
    title: titleEl.value.trim() || inferTitle(markdown),
    slug: slugEl.value.trim(),
    date: dateEl.value.trim(),
    description: summaryEl.value.trim()
  };

  setStatus("正在发布...");
  try {
    let res = await fetch("/api/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    let data = await res.json();
    if (res.status === 409) {
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
    if (!res.ok || !data.ok) {
      throw new Error(data.message || `发布失败(${res.status})`);
    }
    if (!slugEl.value.trim()) slugEl.value = data.slug || "";
    setStatus(`发布成功：posts/${data.slug}.md，索引已更新。`);
  } catch (err) {
    setStatus(`发布失败：${err.message}`, true);
  }
}

document.getElementById("btn-preview")?.addEventListener("click", renderPreview);
document.getElementById("btn-download")?.addEventListener("click", downloadMarkdown);
document.getElementById("btn-ai-summary")?.addEventListener("click", generateAiSummary);
document.getElementById("btn-publish")?.addEventListener("click", publishPost);
document.getElementById("btn-auth-login")?.addEventListener("click", loginEditor);
document.getElementById("btn-auth-logout")?.addEventListener("click", logoutEditor);

renderPreview();
setEditorLocked(true);
refreshAuthState();
