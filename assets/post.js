function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderToc(toc) {
  if (!Array.isArray(toc) || toc.length === 0) return "";
  const items = toc
    .map((item) => {
      const indent = Math.max(0, item.level - 1);
      return `<li style="margin-left:${indent * 12}px"><a href="#${escapeHtml(item.id)}">${escapeHtml(item.text)}</a></li>`;
    })
    .join("");
  return `
    <nav class="toc-box">
      <p class="toc-title">目录</p>
      <ul>${items}</ul>
    </nav>
  `;
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
    const rendered = renderMarkdown(markdown);

    document.title = `${title} - 我的博客`;
    contentEl.innerHTML = `
      <h1>${escapeHtml(title)}</h1>
      <p class="meta">${escapeHtml(date)}</p>
      <div class="summary-box">
        <span class="ai-badge">AI摘要</span>
        <p>${escapeHtml(ai || "未生成 AI 摘要")}</p>
      </div>
      ${renderToc(rendered.toc)}
      ${rendered.html}
    `;

    applyCodeHighlight(contentEl);
  } catch (err) {
    contentEl.innerHTML = `<p class="muted">加载失败：${escapeHtml(err.message)}</p>`;
  }
}

loadPostPage();
