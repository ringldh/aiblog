function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function fallbackRender(markdown) {
  const html = `<pre><code>${escapeHtml(String(markdown))}</code></pre>`;
  return { html, toc: [] };
}

function slugifyHeading(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5\- ]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function renderMarkdown(markdown) {
  if (!window.marked || !window.DOMPurify) {
    return fallbackRender(markdown);
  }

  const rawHtml = window.marked.parse(String(markdown), {
    gfm: true,
    breaks: false
  });
  const safeHtml = window.DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true }
  });

  const doc = new DOMParser().parseFromString(safeHtml, "text/html");
  const toc = [];
  const usedIds = new Set();

  for (const heading of doc.body.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    const level = Number(heading.tagName.slice(1));
    let id = heading.id || slugifyHeading(heading.textContent || "");
    if (!id) id = `heading-${toc.length + 1}`;
    let unique = id;
    let i = 2;
    while (usedIds.has(unique)) {
      unique = `${id}-${i++}`;
    }
    heading.id = unique;
    usedIds.add(unique);
    toc.push({ id: unique, text: heading.textContent || "", level });
  }

  return { html: doc.body.innerHTML, toc };
}

function markdownToHtml(markdown) {
  return renderMarkdown(markdown).html;
}

function applyCodeHighlight(root) {
  if (!window.hljs || !root) return;
  for (const code of root.querySelectorAll("pre code")) {
    window.hljs.highlightElement(code);
  }
}
