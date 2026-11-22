/**
 * Compare Two PDFs Visually Tool (compare-pdf/compare-pdf.js)
 * Renders Page N of File A and File B side-by-side via pdfjs-dist and computes
 * a pixel-level diff overlay canvas highlighting additions/deletions in crimson red.
 */
(function () {
  'use strict';

  const Utils = window.PDFToolUtils;
  if (!Utils) {
    console.error('Compare PDF: window.PDFToolUtils is not loaded.');
    return;
  }

  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  }

  const labelA = document.getElementById('cmp-label-a');
  const metaA = document.getElementById('cmp-meta-a');
  const labelB = document.getElementById('cmp-label-b');
  const metaB = document.getElementById('cmp-meta-b');
  const viewerPanel = document.getElementById('cmp-viewer-panel');
  const diffBadge = document.getElementById('cmp-diff-badge');
  const scanAllBtn = document.getElementById('cmp-scan-all-btn');
  const prevPageBtn = document.getElementById('cmp-prev-page');
  const nextPageBtn = document.getElementById('cmp-next-page');
  const pageIndicator = document.getElementById('cmp-page-indicator');
  const canvasA = document.getElementById('cmp-canvas-a');
  const canvasB = document.getElementById('cmp-canvas-b');
  const canvasDiff = document.getElementById('cmp-canvas-diff');
  const statusId = 'cmp-status';

  let docA = null;
  let docB = null;
  let maxPages = 0;
  let currentPage = 1;
  let isScanning = false;

  async function loadPdfDocument(file) {
    const buffer = await file.arrayBuffer();
    const task = window.pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
    return task.promise;
  }

  async function renderPageToCanvas(pdfDoc, pageNum, targetCanvas, widthPx) {
    const ctx = targetCanvas.getContext('2d');
    if (!pdfDoc || pageNum > pdfDoc.numPages) {
      targetCanvas.width = widthPx;
      targetCanvas.height = Math.round(widthPx * 1.414);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No corresponding page', targetCanvas.width / 2, targetCanvas.height / 2);
      return;
    }

    const page = await pdfDoc.getPage(pageNum);
    const baseVp = page.getViewport({ scale: 1.0 });
    const scale = widthPx / baseVp.width;
    const viewport = page.getViewport({ scale });

    targetCanvas.width = Math.floor(viewport.width);
    targetCanvas.height = Math.floor(viewport.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);

    await page.render({ canvasContext: ctx, viewport }).promise;
    page.cleanup();
  }

  function computeDiffCanvas(cA, cB, cOut) {
    const w = Math.max(cA.width, cB.width);
    const h = Math.max(cA.height, cB.height);
    cOut.width = w;
    cOut.height = h;

    const ctxA = cA.getContext('2d');
    const ctxB = cB.getContext('2d');
    const ctxOut = cOut.getContext('2d');

    const dataA = ctxA.getImageData(0, 0, w, h).data;
    const dataB = ctxB.getImageData(0, 0, w, h).data;
    const outImg = ctxOut.createImageData(w, h);
    const out = outImg.data;

    let changedPixels = 0;
    const totalPixels = w * h;
    const threshold = 32;

    for (let i = 0; i < dataA.length; i += 4) {
      const dr = Math.abs(dataA[i] - dataB[i]);
      const dg = Math.abs(dataA[i + 1] - dataB[i + 1]);
      const db = Math.abs(dataA[i + 2] - dataB[i + 2]);

      if (dr + dg + db > threshold) {
        changedPixels += 1;
        out[i] = 225;
        out[i + 1] = 29;
        out[i + 2] = 72;
        out[i + 3] = 255;
      } else {
        // Dimmed grayscale background of unchanged content for context
        const gray = Math.round(0.299 * dataB[i] + 0.587 * dataB[i + 1] + 0.114 * dataB[i + 2]);
        const faded = Math.round(255 - (255 - gray) * 0.25);
        out[i] = faded;
        out[i + 1] = faded;
        out[i + 2] = faded;
        out[i + 3] = 255;
      }
    }

    ctxOut.putImageData(outImg, 0, 0);
    return totalPixels > 0 ? (changedPixels / totalPixels) * 100 : 0;
  }

  async function renderComparisonPage(pageNum) {
    if (!docA || !docB) return;
    currentPage = Math.min(maxPages, Math.max(1, pageNum));
    if (pageIndicator) {
      pageIndicator.textContent = `Page ${currentPage} of ${maxPages}`;
    }
    if (prevPageBtn) prevPageBtn.disabled = currentPage <= 1;
    if (nextPageBtn) nextPageBtn.disabled = currentPage >= maxPages;

    const targetW = 480;
    await renderPageToCanvas(docA, currentPage, canvasA, targetW);
    await renderPageToCanvas(docB, currentPage, canvasB, targetW);
    const diffPct = computeDiffCanvas(canvasA, canvasB, canvasDiff);

    if (diffBadge) {
      diffBadge.textContent =
        diffPct === 0
          ? `Page ${currentPage}: Identical (0.00% diff)`
          : `Page ${currentPage}: ${diffPct.toFixed(2)}% pixels changed`;
    }
  }

  async function handleSelectSide(side, files) {
    if (isScanning || !files || files.length === 0) return;
    const file = files[0];
    try {
      const loadedDoc = await loadPdfDocument(file);
      if (side === 'a') {
        if (docA) try { await docA.destroy(); } catch (_e) {}
        docA = loadedDoc;
        if (labelA) labelA.textContent = file.name;
        if (metaA) metaA.textContent = `${Utils.formatFileSize(file.size)} • ${docA.numPages} page(s)`;
      } else {
        if (docB) try { await docB.destroy(); } catch (_e) {}
        docB = loadedDoc;
        if (labelB) labelB.textContent = file.name;
        if (metaB) metaB.textContent = `${Utils.formatFileSize(file.size)} • ${docB.numPages} page(s)`;
      }

      if (docA && docB) {
        maxPages = Math.max(docA.numPages, docB.numPages);
        if (viewerPanel) viewerPanel.hidden = false;
        await renderComparisonPage(1);
        Utils.showStatus(
          statusId,
          `Comparing File A (${docA.numPages} pages) and File B (${docB.numPages} pages). Red pixels highlight differences.`,
          'info'
        );
      } else {
        Utils.showStatus(
          statusId,
          `Loaded File ${side.toUpperCase()}. Now select the second PDF to start visual comparison.`,
          'info'
        );
      }
    } catch (err) {
      Utils.showStatus(
        statusId,
        `Could not load PDF: ${err && err.message ? err.message : 'Invalid file.'}`,
        'error'
      );
    }
  }

  async function scanAllPages() {
    if (isScanning || !docA || !docB) return;
    isScanning = true;
    scanAllBtn.disabled = true;
    const changedPages = [];
    const tempA = document.createElement('canvas');
    const tempB = document.createElement('canvas');
    const tempDiff = document.createElement('canvas');

    try {
      for (let p = 1; p <= maxPages; p++) {
        Utils.showStatus(statusId, `Scanning page ${p} of ${maxPages} for differences...`, 'loading');
        await renderPageToCanvas(docA, p, tempA, 320);
        await renderPageToCanvas(docB, p, tempB, 320);
        const pct = computeDiffCanvas(tempA, tempB, tempDiff);
        if (pct > 0.01) {
          changedPages.push(`Page ${p} (${pct.toFixed(2)}%)`);
        }
      }

      if (changedPages.length === 0) {
        Utils.showStatus(statusId, `All ${maxPages} page(s) are visually identical between File A and File B.`, 'success');
      } else {
        Utils.showStatus(
          statusId,
          `Found differences on ${changedPages.length} of ${maxPages} page(s): ${changedPages.join(', ')}.`,
          'warning'
        );
      }
    } finally {
      Utils.cleanupCanvas(tempA);
      Utils.cleanupCanvas(tempB);
      Utils.cleanupCanvas(tempDiff);
      isScanning = false;
      scanAllBtn.disabled = false;
    }
  }

  Utils.initDropzone({
    dropzoneId: 'cmp-dropzone-a',
    fileInputId: 'cmp-input-a',
    acceptExtensions: ['.pdf', 'application/pdf'],
    multiple: false,
    statusId,
    onFiles: (files) => handleSelectSide('a', files)
  });

  Utils.initDropzone({
    dropzoneId: 'cmp-dropzone-b',
    fileInputId: 'cmp-input-b',
    acceptExtensions: ['.pdf', 'application/pdf'],
    multiple: false,
    statusId,
    onFiles: (files) => handleSelectSide('b', files)
  });

  if (prevPageBtn) {
    prevPageBtn.addEventListener('click', () => {
      if (currentPage > 1) renderComparisonPage(currentPage - 1);
    });
  }

  if (nextPageBtn) {
    nextPageBtn.addEventListener('click', () => {
      if (currentPage < maxPages) renderComparisonPage(currentPage + 1);
    });
  }

  if (scanAllBtn) {
    scanAllBtn.addEventListener('click', scanAllPages);
  }
})();
