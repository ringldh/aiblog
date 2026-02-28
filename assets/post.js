function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function loadPostPage() {
  const contentEl = document.getElementById("post-content");
  if (!contentEl) return;

  const params = new URLSearchParams(window.location.search);
  const slug = params.get("slug");
  if (!slug) {
    contentEl.innerHTML = '<p class="muted">缺少文章参数 slug。</p>';
    return;
  }

  try {
    const [indexRes, mdRes] = await Promise.all([
      fetch("posts/index.json"),
      fetch(`posts/${encodeURIComponent(slug)}.md`)
    ]);

    if (!indexRes.ok || !mdRes.ok) {
      throw new Error("文章不存在或加载失败");
    }

    const posts = await indexRes.json();
    const post = posts.find((p) => p.slug === slug);
    const markdown = await mdRes.text();
    const title = post?.title || slug;
    const date = post?.date || "";
    const ai = post?.aiDescription || "";

    document.title = `${title} - 我的博客`;
    contentEl.innerHTML = `
      <h1>${escapeHtml(title)}</h1>
      <p class="meta">${escapeHtml(date)}</p>
      <div class="summary-box">
        <span class="ai-badge">AI摘要</span>
        <p>${escapeHtml(ai || "未生成 AI 摘要")}</p>
      </div>
      ${markdownToHtml(markdown)}
    `;
  } catch (err) {
    contentEl.innerHTML = `<p class="muted">加载失败：${escapeHtml(err.message)}</p>`;
  }
}

loadPostPage();
