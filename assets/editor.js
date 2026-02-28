const AI_SETTINGS_KEY = "blog_editor_ai_settings_v1";

function renderPreview() {
  const inputEl = document.getElementById("md-input");
  const previewEl = document.getElementById("preview");
  if (!inputEl || !previewEl) return;
  previewEl.innerHTML = markdownToHtml(inputEl.value);
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
}

function loadAiSettings() {
  try {
    const raw = localStorage.getItem(AI_SETTINGS_KEY);
    if (!raw) return;
    const settings = JSON.parse(raw);
    document.getElementById("ai-baseurl").value = settings.baseURL || "";
    document.getElementById("ai-model").value = settings.model || "";
    document.getElementById("ai-key").value = settings.apiKey || "";
  } catch {
    // no-op
  }
}

function saveAiSettings() {
  const settings = {
    baseURL: document.getElementById("ai-baseurl").value.trim(),
    model: document.getElementById("ai-model").value.trim(),
    apiKey: document.getElementById("ai-key").value.trim()
  };
  localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(settings));
  return settings;
}

function stripMarkdown(text) {
  return String(text)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/[*_~>#-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function inferTitle(md) {
  for (const line of md.split(/\r?\n/)) {
    const m = line.match(/^#\s+(.+)$/);
    if (m) return m[1].trim();
  }
  return "未命名文章";
}

async function generateAiSummary() {
  const outputEl = document.getElementById("ai-summary-output");
  const mdInput = document.getElementById("md-input");
  if (!outputEl || !mdInput) return;

  const settings = saveAiSettings();
  if (!settings.baseURL || !settings.model || !settings.apiKey) {
    outputEl.value = "请先填写 Base URL / Model / API Key。";
    return;
  }

  const title = inferTitle(mdInput.value);
  const text = stripMarkdown(mdInput.value).slice(0, 4000);
  if (!text) {
    outputEl.value = "正文为空，无法生成摘要。";
    return;
  }

  outputEl.value = "正在生成摘要...";
  const endpoint = `${settings.baseURL.replace(/\/$/, "")}/chat/completions`;
  const payload = {
    model: settings.model,
    temperature: 0.2,
    max_tokens: 120,
    messages: [
      {
        role: "system",
        content: "Generate one concise Chinese summary sentence for a blog post. Plain text only."
      },
      {
        role: "user",
        content: `请生成一句摘要（不超过140字）。标题：${title}\n正文：${text}`
      }
    ]
  };

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      outputEl.value = `请求失败：${res.status}`;
      return;
    }
    const data = await res.json();
    const summary = String(data?.choices?.[0]?.message?.content || "")
      .replace(/\s+/g, " ")
      .trim();
    outputEl.value = summary || "模型未返回摘要。";
  } catch (err) {
    outputEl.value = `请求异常：${err.message}`;
  }
}

document.getElementById("btn-preview")?.addEventListener("click", renderPreview);
document.getElementById("btn-download")?.addEventListener("click", downloadMarkdown);
document.getElementById("btn-ai-summary")?.addEventListener("click", generateAiSummary);

loadAiSettings();
renderPreview();
