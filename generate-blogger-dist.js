/**
 * Generates ready-to-paste Blogger HTML snippets in ./blogger-dist/
 * using jsDelivr CDN URLs for https://github.com/Ade3b16/pdf-tools.git
 *
 * Usage:
 *   node generate-blogger-dist.js [versionTag]
 *   (default versionTag: v1.0.0)
 */
const fs = require('fs');
const path = require('path');

const GITHUB_USER = 'Ade3b16';
const GITHUB_REPO = 'pdf-tools';
const VERSION_TAG = process.argv[2] || 'v1.0.0';
const CDN_BASE = `https://cdn.jsdelivr.net/gh/${GITHUB_USER}/${GITHUB_REPO}@${VERSION_TAG}`;
const HUB_BLOGGER_PATH = '/p/pdf-tools.html';

const TOOLS = [
  'merge-pdf',
  'split-pdf',
  'rotate-pdf',
  'watermark-pdf',
  'image-to-pdf',
  'pdf-to-jpg',
  'sign-pdf',
  'organize-pdf',
  'compress-pdf',
  'extract-pdf',
  'metadata-pdf',
  'grayscale-pdf',
  'crop-pdf',
  'image-converter',
  'flatten-pdf',
  'insert-blank-pdf',
  'header-footer-pdf',
  'nup-pdf',
  'redact-pdf',
  'compare-pdf'
];

const START_MARKER = '<!-- ================= BLOGGER PASTE START ================= -->';
const END_MARKER = '<!-- ================= BLOGGER PASTE END ================= -->';

function extractPasteBlock(htmlContent, sourceFile) {
  const startIdx = htmlContent.indexOf(START_MARKER);
  const endIdx = htmlContent.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    throw new Error(`Missing Blogger paste markers in ${sourceFile}`);
  }
  return htmlContent.slice(startIdx + START_MARKER.length, endIdx).trim();
}

const outDir = path.join(__dirname, 'blogger-dist');
fs.mkdirSync(outDir, { recursive: true });

// 1. Build Frontpage Hub snippet -> blogger-dist/pdf-tools.html
const hubRaw = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
let hubSnippet = extractPasteBlock(hubRaw, 'index.html');

hubSnippet = hubSnippet
  .replace(/href="\.\/shared\/tools\.css"/g, `href="${CDN_BASE}/shared/tools.css"`)
  .replace(/src="\.\/shared\/utils\.js"/g, `src="${CDN_BASE}/shared/utils.js"`);

for (const slug of TOOLS) {
  const localHref = `href="./${slug}/index.html"`;
  const bloggerHref = `href="/p/${slug}.html"`;
  hubSnippet = hubSnippet.split(localHref).join(bloggerHref);
}

const hubOutPath = path.join(outDir, 'pdf-tools.html');
fs.writeFileSync(
  hubOutPath,
  `<!-- Blogger Page Permalink Slug: pdf-tools (/p/pdf-tools.html) -->\n${hubSnippet}\n`,
  'utf8'
);

// 2. Build 20 Tool Page snippets -> blogger-dist/<tool-slug>.html
for (const slug of TOOLS) {
  const toolFile = path.join(__dirname, slug, 'index.html');
  const raw = fs.readFileSync(toolFile, 'utf8');
  let snippet = extractPasteBlock(raw, `${slug}/index.html`);

  snippet = snippet
    .replace(/href="\.\.\/shared\/tools\.css"/g, `href="${CDN_BASE}/shared/tools.css"`)
    .replace(/src="\.\.\/shared\/utils\.js"/g, `src="${CDN_BASE}/shared/utils.js"`)
    .replace(new RegExp(`src="\\./${slug}\\.js"`, 'g'), `src="${CDN_BASE}/${slug}/${slug}.js"`)
    .replace(/href="\.\.\/index\.html"/g, `href="${HUB_BLOGGER_PATH}"`);

  const toolOutPath = path.join(outDir, `${slug}.html`);
  fs.writeFileSync(
    toolOutPath,
    `<!-- Blogger Page Permalink Slug: ${slug} (/p/${slug}.html) -->\n${snippet}\n`,
    'utf8'
  );
}

console.log(`Generated 21 ready-to-paste Blogger files in ./blogger-dist/ pointing to ${CDN_BASE}`);
