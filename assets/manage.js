let authed = false;

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function setAuthStatus(msg, isError = false) {
  const el = document.getElementById("auth-status");
  if (!el) return;
  el.textContent = msg || "";
  el.style.color = isError ? "#b91c1c" : "";
}

function setManageStatus(msg, isError = false) {
  const el = document.getElementById("manage-status");
  if (!el) return;
  el.textContent = msg || "";
  el.style.color = isError ? "#b91c1c" : "";
}

async function refreshAuth() {
  try {
    const res = await fetch("/api/editor/auth-status");
    const data = await res.json();
    if (!res.ok || !data.ok) {
      authed = false;
      setAuthStatus(data.message || "鉴权状态检查失败", true);
      return;
    }
    if (!data.enabled) {
      authed = true;
      setAuthStatus("当前未启用密码保护。");
      return;
    }
    authed = Boolean(data.authenticated);
    if (authed) {
      setAuthStatus("已登录");
    } else {
      const lockMsg = data.locked ? `，已锁定 ${data.retrySeconds || 0} 秒` : "";
      setAuthStatus("未登录" + lockMsg);
    }
  } catch (err) {
    authed = false;
    setAuthStatus(`鉴权状态检查失败：${err.message}`, true);
  }
}

async function login() {
  const input = document.getElementById("editor-password");
  if (!input?.value) {
    setAuthStatus("请输入密码", true);
    return;
  }
  try {
    const res = await fetch("/api/editor/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: input.value })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.message || `登录失败(${res.status})`);
    input.value = "";
    await refreshAuth();
    await loadPosts();
  } catch (err) {
    setAuthStatus(`登录失败：${err.message}`, true);
  }
}

async function logout() {
  await fetch("/api/editor/logout", { method: "POST" });
  await refreshAuth();
  const body = document.getElementById("manage-body");
  if (body) {
    body.innerHTML = '<tr><td colspan="6" class="muted">请先登录并刷新列表。</td></tr>';
  }
}

function rowHtml(post) {
  const status = post.draft ? '<span class="pill draft">草稿</span>' : '<span class="pill pub">已发布</span>';
  return `
    <tr data-slug="${escapeHtml(post.slug)}">
      <td>${escapeHtml(post.title || "")}</td>
      <td>${escapeHtml(post.slug || "")}</td>
      <td>${escapeHtml(post.date || "")}</td>
      <td>${status}</td>
      <td>${escapeHtml((post.updatedAt || "").replace("T", " ").replace("Z", ""))}</td>
      <td class="op-col">
        <a href="post.html?slug=${encodeURIComponent(post.slug)}" target="_blank" rel="noopener">查看</a>
        <a href="editor.html?slug=${encodeURIComponent(post.slug)}">编辑</a>
        <button type="button" data-action="toggle" data-slug="${escapeHtml(post.slug)}" data-draft="${post.draft ? "1" : "0"}">
          ${post.draft ? "发布" : "转草稿"}
        </button>
        <button type="button" class="danger" data-action="delete" data-slug="${escapeHtml(post.slug)}">删除</button>
      </td>
    </tr>
  `;
}

async function loadPosts() {
  const body = document.getElementById("manage-body");
  if (!body) return;
  if (!authed) {
    body.innerHTML = '<tr><td colspan="6" class="muted">请先登录。</td></tr>';
    return;
  }
  setManageStatus("正在加载...");
  try {
    const res = await fetch("/api/posts/manage");
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.message || `加载失败(${res.status})`);
    const posts = Array.isArray(data.posts) ? data.posts : [];
    if (posts.length === 0) {
      body.innerHTML = '<tr><td colspan="6" class="muted">暂无文章。</td></tr>';
    } else {
      body.innerHTML = posts.map(rowHtml).join("");
    }
    setManageStatus(`共 ${posts.length} 篇文章。`);
  } catch (err) {
    body.innerHTML = `<tr><td colspan="6" class="muted">${escapeHtml(err.message)}</td></tr>`;
    setManageStatus(`加载失败：${err.message}`, true);
  }
}

async function toggleDraft(slug, currentDraft) {
  const toDraft = !currentDraft;
  const action = toDraft ? "转为草稿" : "发布文章";
  if (!window.confirm(`确认${action}：${slug} ?`)) return;
  setManageStatus("正在更新状态...");
  const res = await fetch("/api/posts/set-draft", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, draft: toDraft })
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.message || `更新失败(${res.status})`);
  await loadPosts();
}

async function deletePost(slug) {
  if (!window.confirm(`确认删除文章：${slug} ?`)) return;
  setManageStatus("正在删除...");
  const res = await fetch("/api/posts/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug })
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.message || `删除失败(${res.status})`);
  await loadPosts();
}

document.getElementById("btn-auth-login")?.addEventListener("click", login);
document.getElementById("btn-auth-logout")?.addEventListener("click", logout);
document.getElementById("btn-refresh")?.addEventListener("click", loadPosts);
document.getElementById("manage-body")?.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const action = btn.getAttribute("data-action");
  const slug = btn.getAttribute("data-slug") || "";
  try {
    if (action === "toggle") {
      await toggleDraft(slug, btn.getAttribute("data-draft") === "1");
    } else if (action === "delete") {
      await deletePost(slug);
    }
  } catch (err) {
    setManageStatus(err.message, true);
  }
});

refreshAuth().then(loadPosts);
