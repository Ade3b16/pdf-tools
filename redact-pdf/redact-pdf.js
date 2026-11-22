/**
 * Redact PDF Tool (redact-pdf/redact-pdf.js)
 * Interactive drag-to-redact canvas overlay per page. Pages containing redactions
 * are raster-baked at 200 DPI so the underlying text stream is permanently destroyed.
 */
(function () {
  'use strict';

  const Utils = window.PDFToolUtils;
  if (!Utils) {
    console.error('Redact PDF: window.PDFToolUtils is not loaded.');
    return;
  }

  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  }

  const fileInput = document.getElementById('red-file-input');
  const configPanel = document.getElementById('red-config-panel');
  const fileNameEl = document.getElementById('red-file-name');
  const fileMetaEl = document.getElementById('red-file-meta');
  const boxCounterEl = document.getElementById('red-box-counter');
  const changeFileBtn = document.getElementById('red-change-file-btn');
  const fillColorSelect = document.getElementById('red-fill-color');
  const undoBtn = document.getElementById('red-undo-btn');
  const clearPageBtn = document.getElementById('red-clear-page-btn');
  const prevPageBtn = document.getElementById('red-prev-page');
  const nextPageBtn = document.getElementById('red-next-page');
  const pageIndicator = document.getElementById('red-page-indicator');
  const previewCanvas = document.getElementById('red-preview-canvas');
  const submitBtn = document.getElementById('red-submit-btn');
  const statusId = 'red-status';

  /** @type {File|null} */
  let currentFile = null;
  let pdfJsDoc = null;
  let totalPages = 0;
  let currentPreviewPage = 1;
  let basePageImageData = null;

  /**
   * Normalized redaction rectangles (0..1 coords) indexed by 1-based page number
   * @type {Object<number, Array<{ x: number, y: number, w: number, h: number, color: string }>>}
   */
  let redactionsByPage = {};
  let isDragging = false;
  let dragStart = { x: 0, y: 0 };
  let dragCurrent = { x: 0, y: 0 };
  let isProcessing = false;

  function getTotalRedactionCount() {
    return Object.values(redactionsByPage).reduce((sum, list) => sum + (list ? list.length : 0), 0);
  }

  function updateBoxCounter() {
    const total = getTotalRedactionCount();
    const pageList = redactionsByPage[currentPreviewPage] || [];
    if (boxCounterEl) {
      boxCounterEl.textContent = `${total} total (${pageList.length} on page ${currentPreviewPage})`;
    }
  }

  async function renderPreviewPage(pageNum) {
    if (!pdfJsDoc || !previewCanvas) return;
    currentPreviewPage = Math.min(totalPages, Math.max(1, pageNum));
    if (pageIndicator) {
      pageIndicator.textContent = `Page ${currentPreviewPage} of ${totalPages}`;
    }
    if (prevPageBtn) prevPageBtn.disabled = currentPreviewPage <= 1;
    if (nextPageBtn) nextPageBtn.disabled = currentPreviewPage >= totalPages;

    const page = await pdfJsDoc.getPage(currentPreviewPage);
    const baseVp = page.getViewport({ scale: 1.0 });
    const targetW = Math.min(620, baseVp.width);
    const scale = targetW / baseVp.width;
    const viewport = page.getViewport({ scale });

    previewCanvas.width = Math.floor(viewport.width);
    previewCanvas.height = Math.floor(viewport.height);
    const ctx = previewCanvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);

    await page.render({ canvasContext: ctx, viewport }).promise;
    basePageImageData = ctx.getImageData(0, 0, previewCanvas.width, previewCanvas.height);
    page.cleanup();
    drawRedactionOverlay();
    updateBoxCounter();
  }

  function drawRedactionOverlay() {
    if (!previewCanvas || !basePageImageData) return;
    const ctx = previewCanvas.getContext('2d');
    ctx.putImageData(basePageImageData, 0, 0);

    const w = previewCanvas.width;
    const h = previewCanvas.height;
    const boxes = redactionsByPage[currentPreviewPage] || [];

    ctx.save();
    for (const box of boxes) {
      const rx = box.x * w;
      const ry = box.y * h;
      const rw = box.w * w;
      const rh = box.h * h;
      ctx.fillStyle = box.color || '#000000';
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeStyle = '#e11d48';
      ctx.lineWidth = 1;
      ctx.strokeRect(rx, ry, rw, rh);
    }

    if (isDragging) {
      const x = Math.min(dragStart.x, dragCurrent.x);
      const y = Math.min(dragStart.y, dragCurrent.y);
      const bw = Math.abs(dragCurrent.x - dragStart.x);
      const bh = Math.abs(dragCurrent.y - dragStart.y);
      ctx.fillStyle = 'rgba(225, 29, 72, 0.25)';
      ctx.fillRect(x, y, bw, bh);
      ctx.strokeStyle = '#e11d48';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, bw, bh);
    }
    ctx.restore();
  }

  function initCanvasDragEvents() {
    if (!previewCanvas) return;

    function getCoords(e) {
      const rect = previewCanvas.getBoundingClientRect();
      const scaleX = previewCanvas.width / (rect.width || 1);
      const scaleY = previewCanvas.height / (rect.height || 1);
      const clientX = e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches && e.touches[0] ? e.touches[0].clientY : e.clientY;
      return {
        x: Math.min(previewCanvas.width, Math.max(0, (clientX - rect.left) * scaleX)),
        y: Math.min(previewCanvas.height, Math.max(0, (clientY - rect.top) * scaleY))
      };
    }

    function onStart(e) {
      if (isProcessing || !basePageImageData) return;
      e.preventDefault();
      isDragging = true;
      dragStart = getCoords(e);
      dragCurrent = { ...dragStart };
      drawRedactionOverlay();
    }

    function onMove(e) {
      if (!isDragging) return;
      e.preventDefault();
      dragCurrent = getCoords(e);
      drawRedactionOverlay();
    }

    function onEnd() {
      if (!isDragging) return;
      isDragging = false;
      const w = previewCanvas.width || 1;
      const h = previewCanvas.height || 1;
      const x = Math.min(dragStart.x, dragCurrent.x);
      const y = Math.min(dragStart.y, dragCurrent.y);
      const bw = Math.abs(dragCurrent.x - dragStart.x);
      const bh = Math.abs(dragCurrent.y - dragStart.y);

      if (bw > 6 && bh > 6) {
        if (!redactionsByPage[currentPreviewPage]) {
          redactionsByPage[currentPreviewPage] = [];
        }
        redactionsByPage[currentPreviewPage].push({
          x: x / w,
          y: y / h,
          w: bw / w,
          h: bh / h,
          color: fillColorSelect ? fillColorSelect.value : '#000000'
        });
      }
      drawRedactionOverlay();
      updateBoxCounter();
    }

    previewCanvas.addEventListener('mousedown', onStart);
    previewCanvas.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);

    previewCanvas.addEventListener('touchstart', onStart, { passive: false });
    previewCanvas.addEventListener('touchmove', onMove, { passive: false });
    previewCanvas.addEventListener('touchend', onEnd);
  }

  async function handleFileSelect(files) {
    if (isProcessing || !files || files.length === 0) return;
    const file = files[0];
    Utils.showStatus(statusId, `Loading "${file.name}"...`, 'loading');

    if (pdfJsDoc) {
      try {
        await pdfJsDoc.destroy();
      } catch (_e) {}
      pdfJsDoc = null;
    }

    let buffer = null;
    try {
      buffer = await file.arrayBuffer();
      const loadingTask = window.pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
      pdfJsDoc = await loadingTask.promise;
      totalPages = pdfJsDoc.numPages;
      currentFile = file;
      redactionsByPage = {};
      buffer = null;

      if (fileNameEl) fileNameEl.textContent = file.name;
      if (fileMetaEl) {
        fileMetaEl.textContent = `${Utils.formatFileSize(file.size)} • ${totalPages} page${totalPages === 1 ? '' : 's'}`;
      }

      if (configPanel) configPanel.hidden = false;
      await renderPreviewPage(1);
      Utils.showStatus(
        statusId,
        `Loaded "${file.name}". Drag across sensitive text on the page preview below to mark redactions.`,
        'info'
      );
    } catch (err) {
      buffer = null;
      currentFile = null;
      totalPages = 0;
      if (configPanel) configPanel.hidden = true;
      Utils.showStatus(
        statusId,
        `Could not open PDF: ${err && err.message ? err.message : 'Invalid file.'}`,
        'error'
      );
    }
  }

  async function executeRedaction() {
    if (isProcessing || !currentFile || totalPages < 1) return;
    const totalBoxes = getTotalRedactionCount();
    if (totalBoxes === 0) {
      Utils.showStatus(statusId, 'Please draw at least one redaction box on a page before applying.', 'error');
      return;
    }

    isProcessing = true;
    submitBtn.disabled = true;
    const originalBtnHtml = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Baking Redactions...</span>';

    let buffer = null;
    try {
      buffer = await currentFile.arrayBuffer();
      const { PDFDocument } = window.PDFLib;
      const sourcePdf = await PDFDocument.load(buffer);
      const outPdf = await PDFDocument.create();

      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        const boxes = redactionsByPage[pageNum] || [];
        if (boxes.length === 0) {
          const [copied] = await outPdf.copyPages(sourcePdf, [pageNum - 1]);
          outPdf.addPage(copied);
          continue;
        }

        Utils.showStatus(statusId, `Permanently redacting page ${pageNum} of ${totalPages}...`, 'loading');
        const page = await pdfJsDoc.getPage(pageNum);
        const origVp = page.getViewport({ scale: 1.0 });
        const renderVp = page.getViewport({ scale: 2.2 });

        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(renderVp.width);
        canvas.height = Math.floor(renderVp.height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        await page.render({ canvasContext: ctx, viewport: renderVp }).promise;

        // Burn opaque redaction boxes directly into the rasterized canvas pixels
        for (const box of boxes) {
          ctx.fillStyle = box.color || '#000000';
          ctx.fillRect(
            box.x * canvas.width,
            box.y * canvas.height,
            box.w * canvas.width,
            box.h * canvas.height
          );
        }

        const jpgBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
        Utils.cleanupCanvas(canvas);
        page.cleanup();

        let jpgBytes = await jpgBlob.arrayBuffer();
        const embeddedJpg = await outPdf.embedJpg(jpgBytes);
        jpgBytes = null;

        const outPage = outPdf.addPage([origVp.width, origVp.height]);
        outPage.drawImage(embeddedJpg, {
          x: 0,
          y: 0,
          width: origVp.width,
          height: origVp.height
        });
      }

      const outBytes = await outPdf.save();
      const baseName = Utils.getBaseFilename(currentFile.name, 'document');
      const outName = `${baseName}-redacted.pdf`;

      Utils.downloadBlob(outBytes, outName, 'application/pdf');
      Utils.showStatus(
        statusId,
        `Permanently applied ${totalBoxes} redaction(s) and downloaded "${outName}".`,
        'success'
      );
    } catch (err) {
      console.error('Redact PDF error:', err);
      Utils.showStatus(
        statusId,
        `Failed to redact PDF: ${err && err.message ? err.message : 'Unexpected error.'}`,
        'error'
      );
    } finally {
      buffer = null;
      isProcessing = false;
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnHtml;
    }
  }

  initCanvasDragEvents();

  Utils.initDropzone({
    dropzoneId: 'red-dropzone',
    fileInputId: 'red-file-input',
    acceptExtensions: ['.pdf', 'application/pdf'],
    multiple: false,
    statusId,
    onFiles: handleFileSelect
  });

  if (undoBtn) {
    undoBtn.addEventListener('click', () => {
      const list = redactionsByPage[currentPreviewPage];
      if (list && list.length > 0) {
        list.pop();
        drawRedactionOverlay();
        updateBoxCounter();
      }
    });
  }

  if (clearPageBtn) {
    clearPageBtn.addEventListener('click', () => {
      redactionsByPage[currentPreviewPage] = [];
      drawRedactionOverlay();
      updateBoxCounter();
    });
  }

  if (prevPageBtn) {
    prevPageBtn.addEventListener('click', () => {
      if (currentPreviewPage > 1) renderPreviewPage(currentPreviewPage - 1);
    });
  }

  if (nextPageBtn) {
    nextPageBtn.addEventListener('click', () => {
      if (currentPreviewPage < totalPages) renderPreviewPage(currentPreviewPage + 1);
    });
  }

  if (changeFileBtn && fileInput) {
    changeFileBtn.addEventListener('click', () => {
      if (!isProcessing) fileInput.click();
    });
  }

  if (submitBtn) {
    submitBtn.addEventListener('click', executeRedaction);
  }
})();
