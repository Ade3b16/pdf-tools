# Project Specification & Handoff: Modular Client-Side PDF & File Tools Suite

## 1. Project Context & Core Objective
We are building a multi-tool, 100% browser-based PDF and file utility website (modeled after **iLovePDF**) from scratch in a clean workspace.

* **Target Platform & Constraints:** The finished site will be hosted on a free **Blogger** (`.blogspot.com`) account for a non-technical owner who wants a **$0-forever, zero-maintenance** website monetized with **Google AdSense**.
* **Zero Backend Architecture:** Blogger does not support server-side runtimes (no Node.js, Python, PHP, or file storage). Every tool must process files **locally inside the visitor's browser** using client-side JavaScript. This eliminates server costs, removes upload/download network latency, and serves as a core privacy feature (files never leave the user's device).
* **Developer Profile & Workflow:** The developer knows vanilla HTML, CSS, and JavaScript, and develops locally in VS Code using Live Server before eventually deploying to Blogger.
* **Scalability Goal:** We are starting with a core 10-tool suite, but the folder structure, shared CSS/JS modules, and frontpage hub must be designed so new tools and utility categories can be added indefinitely without refactoring existing pages.

---

## 2. Non-Negotiable Technical & Architectural Rules

1. **Vanilla Stack Only (No Frameworks or Build Steps):**
   * Use pure **HTML5, CSS3, and ES6+ JavaScript**.
   * Do **not** introduce React, Vue, Svelte, TypeScript compilation, Vite, Webpack, or `npm` build pipelines. Everything must run directly in a browser via standard `<link>` and `<script>` tags.
2. **External File Hosting Strategy (GitHub + jsDelivr):**
   * Because Blogger lacks a traditional folder/file system, CSS and JS are separated into clean, standalone files in a public GitHub repository and loaded into Blogger Pages via **jsDelivr CDN** (`https://cdn.jsdelivr.net/gh/USERNAME/REPO@v1.0.0/...`).
   * During local development in VS Code, use relative paths (`../shared/tools.css`, `./tool.js`) so everything works offline with Live Server.
3. **Blogger HTML Paste Isolation:**
   * Blogger supplies the outer webpage shell (`<html>`, `<head>`, site header, navigation, and footer).
   * Every tool's `index.html` must wrap its embeddable markup between clear comment markers so only the inner fragment gets pasted into Blogger's **HTML view**:
     ```html
     <!-- ================= BLOGGER PASTE START ================= -->
     <!-- Scoped CSS link, #pdf-tool-app container, CDN scripts, and tool JS -->
     <!-- ================= BLOGGER PASTE END ================= -->
     ```
4. **Strict CSS Scoping (`#pdf-tool-app`):**
   * Blogger's master XML theme injects global styles for buttons, inputs, headings, and lists.
   * Wrap every tool (and the frontpage hub) in `<div id="pdf-tool-app">` and prefix **100% of CSS rules** with `#pdf-tool-app` (e.g., `#pdf-tool-app .primary-btn`) to prevent style collisions.
5. **Client-Side Memory & Performance Hygiene:**
   * Always release generated Blob download links with `URL.revokeObjectURL(url)` shortly after triggering downloads.
   * Clear off-screen `<canvas>` elements and large `ArrayBuffer` references once processing completes so mobile browsers do not hit memory limits.
   * Avoid tools that require heavy server-side layout reconstruction (specifically skip `PDF to Word` and `Word to PDF`, as pure JS cannot preserve complex `.docx` formatting reliably).

---

## 3. Modular Folder & File Architecture

Design the workspace around a shared core and isolated per-tool directories:

```text
pdf-tools/
├── HANDOFF.md                 # This architectural specification
├── index.html                 # Scalable frontpage tool directory / hub
├── shared/
│   ├── tools.css              # All scoped UI styles (#pdf-tool-app ...)
│   └── utils.js               # Global window.PDFToolUtils helper module
├── <tool-slug>/               # One self-contained folder per tool
│   ├── index.html             # Local preview shell + Blogger paste block
│   └── <tool-slug>.js         # Tool-specific state & processing logic
```

### Shared Core Responsibilities (`shared/`)
* **`shared/utils.js` (`window.PDFToolUtils`):** Centralize common browser operations so individual tools never duplicate boilerplate:
  * Drag-and-drop + `<input type="file">` binding (including resetting `input.value` so re-selecting the same file still fires `change`).
  * Human-readable file size formatting (`B`, `KB`, `MB`).
  * Blob creation and automatic file download triggering with delayed `URL.revokeObjectURL()`.
  * Unified status/error/success banner updates.
  * Reusable page-range string parser (e.g., converting `"1-3, 5, 8-10"` into validated 0-based page indices) for tools that operate on specific pages.
* **`shared/tools.css`:** Provide clean, responsive, mobile-first styles for the hub grid, category filter/search bar, dropzone, reorderable file list, radio/option cards, range inputs, thumbnail grids, primary action buttons, and status messages.

### Standardized CDN Libraries
Load third-party libraries via jsDelivr only on the specific tool pages that need them:
* **`pdf-lib` (`1.17.1`):** Creating, merging, splitting, rotating, reordering, stamping text/page numbers, and embedding PNG/JPG images into PDFs (`window.PDFLib`).
* **`pdfjs-dist` (Mozilla PDF.js):** Rendering PDF pages onto HTML5 `<canvas>` elements for thumbnails, image export, compression, and text extraction.
* **`jszip` (`3.10.2`):** Bundling multi-file outputs (such as *Split All Pages* or *PDF to JPG*) into a single `.zip` download (`window.JSZip`).

---

## 4. Phased Build Roadmap

Build incrementally—test each piece locally in the browser before moving to the next, and activate its card on the root `index.html` hub as each tool is completed.

### Phase 0: Foundation & Extensible Frontpage Hub
* Create `shared/tools.css`, `shared/utils.js`, and root `index.html`.
* Build the frontpage hub with a responsive card grid, status badges (`Active` vs. `Planned`), and lightweight category filtering/search so the hub scales smoothly from 10 tools to 20+ tools later.

### Phase 1: Pure `pdf-lib` Document Manipulation
1. **Merge PDF (`merge-pdf/`):** Upload multiple PDFs, reorder via up/down controls or remove items, and combine into a single PDF.
2. **Split PDF (`split-pdf/`):** Inspect page count on load; support extracting custom page ranges into one PDF or splitting every page into individual PDFs inside a `.zip`.
3. **Rotate PDF (`rotate-pdf/`):** Read each page's existing rotation angle and apply relative `90° Right`, `90° Left`, or `180° Flip` turns to all pages or specific page ranges.
4. **Page Numbers & Watermark (`watermark-pdf/`):** Toggle between stamping customizable page numbers (position, format, starting number) and diagonal/centered text watermarks (text, font size, opacity).

### Phase 2: `<canvas>`, Images & Signatures
5. **JPG / PNG / WebP to PDF (`image-to-pdf/`):** Accept multiple images, reorder them, normalize formats via HTML5 `<canvas>`, and embed onto auto-sized or standard A4 PDF pages.
6. **PDF to JPG / PNG (`pdf-to-jpg/`):** Render each PDF page onto an off-screen `<canvas>` via `pdfjs-dist` with selectable resolution/quality and download all images as a `.zip`.
7. **Sign PDF (`sign-pdf/`):** Provide an interactive drawing pad `<canvas>` (mouse + touch support, clear button, ink color) or signature image upload, preview target page placement, and stamp onto the PDF.

### Phase 3: Visual Page Grids, Compression & Extraction
8. **Organize PDF (`organize-pdf/`):** Render page thumbnails via `pdfjs-dist` so users can visually reorder, duplicate, or delete individual pages before saving.
9. **Compress PDF (`compress-pdf/`):** Re-encode PDF pages at selectable JPEG quality/DPI levels on `<canvas>`, rebuild the PDF, and display exact file-size reduction stats.
10. **Extract Text & Images (`extract-pdf/`):** Extract selectable text across pages into a `.txt` file or export rendered/embedded page images into a `.zip`.

### Phase 4: Future Expansion Ideas (Post-MVP)
Because every tool is an isolated folder sharing `shared/tools.css` and `shared/utils.js`, the suite can later expand into:
* **More PDF Utilities:** Crop PDF pages, Edit PDF Metadata (title/author/keywords), Grayscale / Black-and-White PDF converter, Flatten PDF, or Header/Footer stamper.
* **Companion Browser File Tools:** Client-side Image Compressor / Resizer / Format Converter (WebP ↔ PNG ↔ JPG), QR Code Generator, or Text/Markdown utilities—all sharing the exact same Blogger-compatible shell.

---

## 5. Blogger Deployment Reference (When Account Access Is Ready)
1. Push the project folder to a public GitHub repository and tag a release (e.g., `v1.0.0`).
2. Swap relative paths (`../shared/...`, `./tool.js`) inside each tool's `BLOGGER PASTE` block with `https://cdn.jsdelivr.net/gh/USERNAME/REPO@v1.0.0/...`.
3. Create a Blogger **Page** per tool (switching the editor to **HTML view** before pasting—never switch back to Compose view after adding `<script>` tags).
4. Update the frontpage hub card links to point to the published Blogger Page URLs (`/p/merge-pdf.html`, etc.) and configure a Blogger custom redirect from `/` to the hub page URL.

---