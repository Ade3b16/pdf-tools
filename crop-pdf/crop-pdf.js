/**
 * Crop PDF Margins Tool (crop-pdf/crop-pdf.js)
 * Renders a live page preview with a crop boundary overlay via pdfjs-dist and
 * updates target page CropBox / MediaBox dimensions losslessly via pdf-lib.
 */
(function () {
  'use strict';

  const Utils = window.PDFToolUtils;
  if (!Utils) {
    console.error('Crop PDF: window.PDFToolUtils is not loaded.');
    return;
  }

  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  }

  const fileInput = document.getElementById('crop-file-input');
  const configPanel = document.getElementById('crop-config-panel');
  const fileNameEl = document.getElementById('crop-file-name');
  const fileMetaEl = document.getElementById('crop-file-meta');
  const preset20Btn = document.getElementById('crop-preset-20');
  const preset36Btn = document.getElementById('crop-preset-36');
  const resetBtn = document.getElementById('crop-reset-btn');
  const changeFileBtn = document.getElementById('crop-change-file-btn');

  const topInput = document.getElementById('crop-top');
  const bottomInput = document.getElementById('crop-bottom');
  const leftInput = document.getElementById('crop-left');
  const rightInput = document.getElementById('crop-right');
  const rangeInput = document.getElementById('crop-range');
  const rangeHint = document.getElementById('crop-range-hint');

  const prevPageBtn = document.getElementById('crop-prev-page');
  const nextPageBtn = document.getElementById('crop-next-page');
  const pageIndicator = document.getElementById('crop-page-indicator');
  const previewCanvas = document.getElementById('crop-preview-canvas');

  const submitBtn = document.getElementById('crop-submit-btn');
  const statusId = 'crop-status';

  /** @type {File|null} */
  let currentFile = null;
  let pdfJsDoc = null;
  let totalPages = 0;
  let currentPreviewPage = 1;
  let baseImageData = null;
  let previewScale = 1.0;
  let isProcessing = false;

  function getCropMarginsPt() {
    return {
      top: Math.max(0, parseFloat(topInput ? topInput.value : '0') || 0),
      bottom: Math.max(0, parseFloat(bottomInput ? bottomInput.value : '0') || 0),
      left: Math.max(0, parseFloat(leftInput ? leftInput.value : '0') || 0),
      right: Math.max(0, parseFloat(rightInput ? rightInput.value : '0') || 0)
    };
  }

  function setUniformTrim(pt) {
    [topInput, bottomInput, leftInput, rightInput].forEach((el) => {
      if (el) el.value = String(pt);
    });
    drawCropOverlay();
  }

  /**
   * Renders the current preview page and caches its base image pixels.
   */
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
    const targetW = Math.min(520, baseVp.width);
    previewScale = targetW / baseVp.width;
    const viewport = page.getViewport({ scale: previewScale });

    previewCanvas.width = Math.floor(viewport.width);
    previewCanvas.height = Math.floor(viewport.height);
    const ctx = previewCanvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);

    await page.render({ canvasContext: ctx, viewport }).promise;
    baseImageData = ctx.getImageData(0, 0, previewCanvas.width, previewCanvas.height);
    page.cleanup();
    drawCropOverlay();
  }

  /**
   * Draws shaded trimmed margins and a dashed red crop rectangle on the preview canvas.
   */
  function drawCropOverlay() {
    if (!previewCanvas || !baseImageData) return;
    const ctx = previewCanvas.getContext('2d');
    ctx.putImageData(baseImageData, 0, 0);

    const margins = getCropMarginsPt();
    const topPx = margins.top * previewScale;
    const bottomPx = margins.bottom * previewScale;
    const leftPx = margins.left * previewScale;
    const rightPx = margins.right * previewScale;

    const w = previewCanvas.width;
    const h = previewCanvas.height;
    const cropX = Math.min(w - 10, leftPx);
    const cropY = Math.min(h - 10, topPx);
    const cropW = Math.max(10, w - cropX - rightPx);
    const cropH = Math.max(10, h - cropY - bottomPx);

    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.25)';
    // Top shaded bar
    ctx.fillRect(0, 0, w, cropY);
    // Bottom shaded bar
    ctx.fillRect(0, cropY + cropH, w, h - (cropY + cropH));
    // Left shaded bar
    ctx.fillRect(0, cropY, cropX, cropH);
    // Right shaded bar
    ctx.fillRect(cropX + cropW, cropY, w - (cropX + cropW), cropH);

    ctx.strokeStyle = '#e11d48';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(cropX, cropY, cropW, cropH);
    ctx.restore();
  }

  /**
   * Loads a PDF document and initializes the live crop preview.
   * @param {File[]} files
   */
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
      buffer = null;

      if (fileNameEl) fileNameEl.textContent = file.name;
      if (fileMetaEl) {
        fileMetaEl.textContent = `${Utils.formatFileSize(file.size)} • ${totalPages} page${totalPages === 1 ? '' : 's'}`;
      }
      if (rangeInput) rangeInput.value = 'all';
      if (rangeHint) {
        rangeHint.textContent = `72 pt = 1 inch (25.4 mm). Enter "all" (1 to ${totalPages}) or custom page ranges.`;
      }

      if (configPanel) configPanel.hidden = false;
      await renderPreviewPage(1);
      Utils.showStatus(
        statusId,
        `Loaded "${file.name}". Adjust the Top, Bottom, Left, and Right trim values below.`,
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

  /**
   * Applies CropBox and MediaBox updates via pdf-lib and downloads the cropped PDF.
   */
  async function executeCrop() {
    if (isProcessing || !currentFile || totalPages < 1) return;
    if (!window.PDFLib) {
      Utils.showStatus(statusId, 'pdf-lib is not loaded.', 'error');
      return;
    }

    const parsed = Utils.parsePageRanges(rangeInput ? rangeInput.value : 'all', totalPages);
    if (!parsed.valid) {
      Utils.showStatus(statusId, parsed.error, 'error');
      return;
    }

    const margins = getCropMarginsPt();
    isProcessing = true;
    submitBtn.disabled = true;
    const originalBtnHtml = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Cropping Pages...</span>';

    let buffer = null;
    try {
      const { PDFDocument } = window.PDFLib;
      buffer = await currentFile.arrayBuffer();
      const pdfDoc = await PDFDocument.load(buffer);
      const pages = pdfDoc.getPages();

      for (const pageIdx of parsed.indices) {
        const page = pages[pageIdx];
        if (!page) continue;
        const box = page.getMediaBox();
        const newX = box.x + margins.left;
        const newY = box.y + margins.bottom;
        const newW = Math.max(36, box.width - margins.left - margins.right);
        const newH = Math.max(36, box.height - margins.top - margins.bottom);

        page.setCropBox(newX, newY, newW, newH);
        page.setMediaBox(newX, newY, newW, newH);
      }

      const outBytes = await pdfDoc.save();
      const baseName = Utils.getBaseFilename(currentFile.name, 'document');
      const outName = `${baseName}-cropped.pdf`;

      Utils.downloadBlob(outBytes, outName, 'application/pdf');
      Utils.showStatus(
        statusId,
        `Cropped ${parsed.indices.length} page(s) and downloaded "${outName}" (${Utils.formatFileSize(outBytes.byteLength)}).`,
        'success'
      );
    } catch (err) {
      console.error('Crop PDF error:', err);
      Utils.showStatus(
        statusId,
        `Failed to crop PDF: ${err && err.message ? err.message : 'Unexpected error.'}`,
        'error'
      );
    } finally {
      buffer = null;
      isProcessing = false;
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnHtml;
    }
  }

  Utils.initDropzone({
    dropzoneId: 'crop-dropzone',
    fileInputId: 'crop-file-input',
    acceptExtensions: ['.pdf', 'application/pdf'],
    multiple: false,
    statusId,
    onFiles: handleFileSelect
  });

  [topInput, bottomInput, leftInput, rightInput].forEach((input) => {
    if (input) {
      input.addEventListener('input', drawCropOverlay);
    }
  });

  if (preset20Btn) preset20Btn.addEventListener('click', () => setUniformTrim(20));
  if (preset36Btn) preset36Btn.addEventListener('click', () => setUniformTrim(36));
  if (resetBtn) resetBtn.addEventListener('click', () => setUniformTrim(0));

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
    submitBtn.addEventListener('click', executeCrop);
  }
})();
