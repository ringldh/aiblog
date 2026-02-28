function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function buildPostCard(post) {
  const aiText = post.aiDescription ? escapeHtml(post.aiDescription) : "未生成";
  const excerpt = escapeHtml(post.excerpt || "");
  const aiLabel = post.aiDescription ? "AI 摘要" : "AI 摘要（无）";
  return `
    <article class="card">
      <h3><a href="post.html?slug=${encodeURIComponent(post.slug)}">${escapeHtml(post.title)}</a></h3>
      <p class="meta">${escapeHtml(post.date || "")}</p>
      <p><span class="ai-badge">${aiLabel}</span> ${aiText}</p>
      <p><strong>正文摘录：</strong>${excerpt}</p>
    </article>
  `;
}

async function loadPosts() {
  const listEl = document.getElementById("post-list");
  if (!listEl) return;

  try {
    const res = await fetch("posts/index.json");
    if (!res.ok) {
      throw new Error("加载文章索引失败");
    }
    const posts = await res.json();
    if (!Array.isArray(posts) || posts.length === 0) {
      listEl.innerHTML = '<p class="muted">还没有文章。</p>';
      return;
    }
    listEl.innerHTML = posts.map(buildPostCard).join("");
  } catch (err) {
    listEl.innerHTML = `<p class="muted">加载失败：${escapeHtml(err.message)}</p>`;
  }
}

loadPosts();
