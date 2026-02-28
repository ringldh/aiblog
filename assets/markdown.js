function fallbackRender(markdown) {
  const escaped = String(markdown)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<pre><code>${escaped}</code></pre>`;
}

function markdownToHtml(markdown) {
  if (!window.marked || !window.DOMPurify) {
    return fallbackRender(markdown);
  }
  const rawHtml = window.marked.parse(String(markdown), {
    gfm: true,
    breaks: false
  });
  return window.DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true }
  });
}
