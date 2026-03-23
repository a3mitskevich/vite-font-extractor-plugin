import "./style.css";

// JS import with ?subset= — demonstrates runtime font URL for Rive/Canvas use cases
import subsetFontUrl from "@fontsource/roboto/files/roboto-latin-400-normal.woff2?subset=Hello";

document.getElementById("js-font-url").textContent = subsetFontUrl;

// Known original sizes from npm packages (before any processing)
const FONT_COMPARISONS = [
  {
    name: "Material Icons (.woff2)",
    originalSize: 124_404,
    subsetFamily: "Material Icons",
    format: "woff2",
  },
  {
    name: "Roboto Latin (.woff2)",
    originalSize: 21_884,
    subsetFamily: "Roboto Subset",
    format: "woff2",
  },
  {
    name: "Press Start 2P (.woff2)",
    originalSize: 12_512,
    subsetFamily: "Pixel Proof",
    format: "woff2",
  },
];

// Find actual font URL from DOM styles (works in dev + build)
function findFontUrl(family, format) {
  // 1. Try document.styleSheets (works in build/preview)
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules || sheet.rules;
    } catch {
      continue;
    }
    if (!rules) continue;
    for (const rule of rules) {
      if (rule.type !== CSSRule.FONT_FACE_RULE) continue;
      const fam = rule.style.getPropertyValue("font-family").replace(/['"]/g, "").trim();
      if (fam !== family) continue;
      const src = rule.style.getPropertyValue("src");
      const re = /url\(["']?([^"')]+\.(?:woff2|woff|ttf|eot)[^"')]*?)["']?\)/g;
      let m;
      while ((m = re.exec(src))) {
        if (m[1].includes("." + format)) return m[1];
      }
    }
  }
  // 2. Try inline <style> tags (works in dev/HMR)
  for (const style of document.querySelectorAll("style")) {
    const text = style.textContent || "";
    if (!text.includes(family)) continue;
    const re = new RegExp(
      `font-family:\\s*["']?${family}["']?[\\s\\S]*?url\\(["']?([^"')]+\\.${format}[^"')]*?)["']?\\)`,
      "g",
    );
    const m = re.exec(text);
    if (m) return m[1];
  }
  return null;
}

async function getSize(url) {
  const response = await fetch(url);
  const blob = await response.blob();
  return blob.size;
}

async function measureFontSizes() {
  await document.fonts.ready;
  // Small delay to ensure styles are injected in dev mode
  await new Promise((r) => setTimeout(r, 100));

  const tbody = document.getElementById("size-table-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  for (const font of FONT_COMPARISONS) {
    const row = document.createElement("tr");
    try {
      const subsetUrl = findFontUrl(font.subsetFamily, font.format);
      if (!subsetUrl) {
        row.innerHTML = `<td>${font.name}</td><td>${formatBytes(font.originalSize)}</td><td>not found</td><td>—</td>`;
        tbody.appendChild(row);
        continue;
      }
      const subsetSize = await getSize(subsetUrl);
      const reduction = Math.round((1 - subsetSize / font.originalSize) * 100);
      row.innerHTML = `
        <td>${font.name}</td>
        <td>${formatBytes(font.originalSize)}</td>
        <td>${formatBytes(subsetSize)}</td>
        <td class="highlight">${reduction > 0 ? reduction + "%" : "—"}</td>
      `;
    } catch {
      row.innerHTML = `<td>${font.name}</td><td>${formatBytes(font.originalSize)}</td><td>—</td><td>—</td>`;
    }
    tbody.appendChild(row);
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  return (bytes / 1024).toFixed(1) + " KB";
}

// Glyph check: verify which characters are present in the subset font
const glyphTests = [
  { text: "Hello World", description: "Latin text", expectPresent: true },
  { text: "ABCDEFGHIJ", description: "Uppercase Latin", expectPresent: true },
  { text: "0123456789", description: "Digits", expectPresent: true },
  { text: "Привет Мир", description: "Cyrillic text", expectPresent: false },
  { text: "你好世界", description: "Chinese text", expectPresent: false },
  { text: "مرحبا", description: "Arabic text", expectPresent: false },
];

async function runGlyphChecks() {
  await document.fonts.ready;

  const container = document.getElementById("glyph-checks");
  if (!container) return;

  const fontSpec = '24px "Roboto Subset"';

  for (const test of glyphTests) {
    const isPresent = document.fonts.check(fontSpec, test.text);

    const row = document.createElement("div");
    row.className = `glyph-check ${isPresent ? "present" : "missing"}`;
    row.innerHTML = `
      <span class="status">${isPresent ? "✓" : "✗"}</span>
      <span class="text">${test.text}</span>
      <span class="verdict">
        ${test.description} — ${isPresent ? "glyphs present" : "glyphs stripped"}
      </span>
    `;
    container.appendChild(row);
  }
}

async function runAllChecks() {
  await runGlyphChecks();
  await measureFontSizes();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", runAllChecks);
} else {
  runAllChecks();
}
