function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function buildSocialLinks(links) {
  return links
    .map((item) => {
      const name = escapeHtml(item.name || "");
      const url = escapeHtml(item.url || "#");
      return `<a href="${url}" target="_blank" rel="noopener">${name}</a>`;
    })
    .join("");
}

async function loadSiteConfig() {
  const targets = [
    document.getElementById("social-links"),
    document.getElementById("social-links-hero")
  ].filter(Boolean);
  if (targets.length === 0) return;

  try {
    let res = await fetch("site.config.json");
    if (!res.ok) {
      res = await fetch("site.config.example.json");
    }
    if (!res.ok) throw new Error("site config load failed");

    const config = await res.json();
    const links = Array.isArray(config?.socialLinks) ? config.socialLinks : [];
    const html = buildSocialLinks(links);
    for (const t of targets) {
      t.innerHTML = html;
    }
  } catch {
    for (const t of targets) {
      t.innerHTML = "";
    }
  }
}

loadSiteConfig();
