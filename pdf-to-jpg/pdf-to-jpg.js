/**
 * PDF to JPG / PNG Tool (pdf-to-jpg/pdf-to-jpg.js)
 * Renders each selected PDF page onto an off-screen <canvas> via pdfjs-dist,
 * frees canvas memory after each page, and packages images into a .zip via JSZip.
 */
(function () {
  'use strict';

  const Utils = window.PDFToolUtils;
  if (!Utils) {
    console.error('PDF to JPG: window.PDFToolUtils is not loaded.');
    return;
  }

  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  }

  const fileInput = document.getElementById('pdf2img-file-input');
  const configPanel = document.getElementById('pdf2img-config-panel');
  const fileNameEl = document.getElementById('pdf2img-file-name');
  const fileMetaEl = document.getElementById('pdf2img-file-meta');
  const changeFileBtn = document.getElementById('pdf2img-change-file-btn');
  const formatSelect = document.getElementById('pdf2img-format');
  const scaleSelect = document.getElementById('pdf2img-scale');
  const qualityGroup = document.getElementById('pdf2img-quality-group');
  const qualityInput = document.getElementById('pdf2img-quality');
  const qualityBadge = document.getElementById('pdf2img-quality-badge');
  const rangeInput = document.getElementById('pdf2img-range');
  const rangeHint = document.getElementById('pdf2img-range-hint');
  const submitBtn = document.getElementById('pdf2img-submit-btn');
  const statusId = 'pdf2img-status';

  /** @type {File|null} */
  let currentFile = null;
  let totalPages = 0;
  let isProcessing = false;

  /**
   * Loads the selected PDF via pdfjs-dist to inspect total pages.
   * @param {File[]} files
   */
  async function handleFileSelect(files) {
    if (isProcessing || !files || files.length === 0) return;
    if (!window.pdfjsLib) {
      Utils.showStatus(statusId, 'PDF.js library failed to load.', 'error');
      return;
    }

    const file = files[0];
    Utils.showStatus(statusId, `Inspecting "${file.name}"...`, 'loading');

    let buffer = null;
    try {
      buffer = await file.arrayBuffer();
      const loadingTask = window.pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
      const pdfDoc = await loadingTask.promise;
      const count = pdfDoc.numPages;
      await pdfDoc.destroy();
      buffer = null;

      currentFile = file;
      totalPages = count;

      if (fileNameEl) fileNameEl.textContent = file.name;
      if (fileMetaEl) {
        fileMetaEl.textContent = `${Utils.formatFileSize(file.size)} • ${count} page${count === 1 ? '' : 's'}`;
      }
      if (rangeInput) rangeInput.value = 'all';
      if (rangeHint) {
        rangeHint.textContent = `Enter "all" (1 to ${count}) or custom ranges like "1-3, 5".`;
      }

      if (configPanel) configPanel.hidden = false;
      Utils.showStatus(
        statusId,
        `Loaded "${file.name}" (${count} page${count === 1 ? '' : 's'}). Choose your image format and resolution below.`,
        'info'
      );
    } catch (err) {
      buffer = null;
      currentFile = null;
      totalPages = 0;
      if (configPanel) configPanel.hidden = true;
      const msg = err && err.message ? err.message : 'Unable to read PDF.';
      Utils.showStatus(statusId, `Could not open PDF: ${msg}`, 'error');
    }
  }

  /**
   * Renders selected pages to JPG/PNG blobs and downloads either a single image or a .zip.
   */
  async function exportPdfToImages() {
    if (isProcessing || !currentFile || totalPages < 1) return;
    if (!window.pdfjsLib || !window.JSZip) {
      Utils.showStatus(statusId, 'Required libraries (PDF.js / JSZip) are not loaded.', 'error');
      return;
    }

    const parsed = Utils.parsePageRanges(rangeInput ? rangeInput.value : 'all', totalPages);
    if (!parsed.valid) {
      Utils.showStatus(statusId, parsed.error, 'error');
      return;
    }

    const format = formatSelect && formatSelect.value === 'png' ? 'png' : 'jpeg';
    const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
    const ext = format === 'png' ? 'png' : 'jpg';
    const scale = parseFloat(scaleSelect ? scaleSelect.value : '2.0') || 2.0;
    const quality = (parseInt(qualityInput ? qualityInput.value : '90', 10) || 90) / 100;
    const baseName = Utils.getBaseFilename(currentFile.name, 'document');

    isProcessing = true;
    submitBtn.disabled = true;
    const originalBtnHtml = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Rendering Pages...</span>';

    let buffer = null;
    let pdfDoc = null;
    try {
      buffer = await currentFile.arrayBuffer();
      const loadingTask = window.pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
      pdfDoc = await loadingTask.promise;

      const padLen = String(totalPages).length;
      const totalToRender = parsed.pages.length;

      if (totalToRender === 1) {
        const pageNum = parsed.pages[0];
        Utils.showStatus(statusId, `Rendering page ${pageNum}...`, 'loading');
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        await page.render({ canvasContext: ctx, viewport }).promise;
        const imgBlob = await new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));
        Utils.cleanupCanvas(canvas);
        page.cleanup();

        const singleName = `${baseName}-page-${String(pageNum).padStart(padLen, '0')}.${ext}`;
        Utils.downloadBlob(imgBlob, singleName, mimeType);
        Utils.showStatus(
          statusId,
          `Exported page ${pageNum} as "${singleName}" (${Utils.formatFileSize(imgBlob.size)}).`,
          'success'
        );
      } else {
        const zip = new window.JSZip();

        for (let i = 0; i < totalToRender; i++) {
          const pageNum = parsed.pages[i];
          Utils.showStatus(
            statusId,
            `Rendering page ${pageNum} (${i + 1} of ${totalToRender})...`,
            'loading'
          );

          const page = await pdfDoc.getPage(pageNum);
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          await page.render({ canvasContext: ctx, viewport }).promise;
          const imgBlob = await new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));
          Utils.cleanupCanvas(canvas);
          page.cleanup();

          const imgName = `${baseName}-page-${String(pageNum).padStart(padLen, '0')}.${ext}`;
          zip.file(imgName, imgBlob);
        }

        Utils.showStatus(statusId, 'Packaging images into ZIP archive...', 'loading');
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const zipName = `${baseName}-${ext}-images.zip`;
        Utils.downloadBlob(zipBlob, zipName, 'application/zip');
        Utils.showStatus(
          statusId,
          `Exported ${totalToRender} pages as ${ext.toUpperCase()} images in "${zipName}" (${Utils.formatFileSize(zipBlob.size)}).`,
          'success'
        );
      }
    } catch (err) {
      console.error('PDF to JPG error:', err);
      Utils.showStatus(
        statusId,
        `Failed to render PDF pages: ${err && err.message ? err.message : 'Unexpected error.'}`,
        'error'
      );
    } finally {
      if (pdfDoc) {
        try {
          await pdfDoc.destroy();
        } catch (_e) {}
      }
      buffer = null;
      isProcessing = false;
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnHtml;
    }
  }

  Utils.initDropzone({
    dropzoneId: 'pdf2img-dropzone',
    fileInputId: 'pdf2img-file-input',
    acceptExtensions: ['.pdf', 'application/pdf'],
    multiple: false,
    statusId,
    onFiles: handleFileSelect
  });

  if (formatSelect && qualityGroup) {
    formatSelect.addEventListener('change', () => {
      qualityGroup.hidden = formatSelect.value === 'png';
    });
  }

  if (qualityInput && qualityBadge) {
    qualityInput.addEventListener('input', () => {
      qualityBadge.textContent = `${qualityInput.value}%`;
    });
  }

  if (changeFileBtn && fileInput) {
    changeFileBtn.addEventListener('click', () => {
      if (!isProcessing) fileInput.click();
    });
  }

  if (submitBtn) {
    submitBtn.addEventListener('click', exportPdfToImages);
  }
})();
