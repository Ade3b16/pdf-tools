/**
 * Grayscale PDF Tool (grayscale-pdf/grayscale-pdf.js)
 * Converts all or selected pages of a PDF into true luminance grayscale via
 * pdfjs-dist + off-screen <canvas> pixel transformation and rebuilds via pdf-lib.
 */
(function () {
  'use strict';

  const Utils = window.PDFToolUtils;
  if (!Utils) {
    console.error('Grayscale PDF: window.PDFToolUtils is not loaded.');
    return;
  }

  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  }

  const fileInput = document.getElementById('gray-file-input');
  const configPanel = document.getElementById('gray-config-panel');
  const fileNameEl = document.getElementById('gray-file-name');
  const fileMetaEl = document.getElementById('gray-file-meta');
  const changeFileBtn = document.getElementById('gray-change-file-btn');
  const contrastSelect = document.getElementById('gray-contrast');
  const scaleSelect = document.getElementById('gray-scale');
  const rangeInput = document.getElementById('gray-range');
  const rangeHint = document.getElementById('gray-range-hint');
  const submitBtn = document.getElementById('gray-submit-btn');
  const statusId = 'gray-status';

  /** @type {File|null} */
  let currentFile = null;
  let totalPages = 0;
  let isProcessing = false;

  /**
   * Loads the selected PDF and inspects total pages.
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
        rangeHint.textContent = `Use "all" (1 to ${count}) or custom ranges like "1-3". Unselected pages stay in original color.`;
      }

      if (configPanel) configPanel.hidden = false;
      Utils.showStatus(
        statusId,
        `Loaded "${file.name}" (${count} page${count === 1 ? '' : 's'}). Choose your grayscale settings below.`,
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
   * Applies ITU-R BT.601 luminance grayscale conversion in-place to Canvas ImageData.
   */
  function convertCanvasToGrayscale(ctx, width, height, highContrast) {
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    const factor = highContrast ? 1.25 : 1.0;

    for (let i = 0; i < data.length; i += 4) {
      let lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (highContrast) {
        lum = (lum - 128) * factor + 128;
        lum = lum < 0 ? 0 : lum > 255 ? 255 : lum;
      }
      const g = Math.round(lum);
      data[i] = g;
      data[i + 1] = g;
      data[i + 2] = g;
    }
    ctx.putImageData(imgData, 0, 0);
  }

  /**
   * Converts selected pages to grayscale and rebuilds the PDF.
   */
  async function executeGrayscale() {
    if (isProcessing || !currentFile || totalPages < 1) return;
    if (!window.pdfjsLib || !window.PDFLib) {
      Utils.showStatus(statusId, 'Required PDF libraries failed to load.', 'error');
      return;
    }

    const parsed = Utils.parsePageRanges(rangeInput ? rangeInput.value : 'all', totalPages);
    if (!parsed.valid) {
      Utils.showStatus(statusId, parsed.error, 'error');
      return;
    }

    const targetSet = new Set(parsed.indices);
    const highContrast = contrastSelect && contrastSelect.value === 'high-contrast';
    const scale = parseFloat(scaleSelect ? scaleSelect.value : '2.0') || 2.0;

    isProcessing = true;
    submitBtn.disabled = true;
    const originalBtnHtml = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Converting to Grayscale...</span>';

    let buffer = null;
    let pdfJsDoc = null;
    try {
      buffer = await currentFile.arrayBuffer();
      const { PDFDocument } = window.PDFLib;
      const sourcePdf = await PDFDocument.load(buffer);
      const outPdf = await PDFDocument.create();

      const loadingTask = window.pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
      pdfJsDoc = await loadingTask.promise;

      for (let idx = 0; idx < totalPages; idx++) {
        const pageNum = idx + 1;
        if (!targetSet.has(idx)) {
          const [copiedPage] = await outPdf.copyPages(sourcePdf, [idx]);
          outPdf.addPage(copiedPage);
          continue;
        }

        Utils.showStatus(statusId, `Converting page ${pageNum} of ${totalPages} to grayscale...`, 'loading');
        const page = await pdfJsDoc.getPage(pageNum);
        const origVp = page.getViewport({ scale: 1.0 });
        const renderVp = page.getViewport({ scale });

        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(renderVp.width);
        canvas.height = Math.floor(renderVp.height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        await page.render({ canvasContext: ctx, viewport: renderVp }).promise;
        convertCanvasToGrayscale(ctx, canvas.width, canvas.height, highContrast);

        const jpgBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
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
      const outName = `${baseName}-grayscale.pdf`;

      Utils.downloadBlob(outBytes, outName, 'application/pdf');
      Utils.showStatus(
        statusId,
        `Converted ${parsed.indices.length} page(s) to grayscale and downloaded "${outName}" (${Utils.formatFileSize(outBytes.byteLength)}).`,
        'success'
      );
    } catch (err) {
      console.error('Grayscale PDF error:', err);
      Utils.showStatus(
        statusId,
        `Failed to convert PDF to grayscale: ${err && err.message ? err.message : 'Unexpected error.'}`,
        'error'
      );
    } finally {
      if (pdfJsDoc) {
        try {
          await pdfJsDoc.destroy();
        } catch (_e) {}
      }
      buffer = null;
      isProcessing = false;
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnHtml;
    }
  }

  Utils.initDropzone({
    dropzoneId: 'gray-dropzone',
    fileInputId: 'gray-file-input',
    acceptExtensions: ['.pdf', 'application/pdf'],
    multiple: false,
    statusId,
    onFiles: handleFileSelect
  });

  if (changeFileBtn && fileInput) {
    changeFileBtn.addEventListener('click', () => {
      if (!isProcessing) fileInput.click();
    });
  }

  if (submitBtn) {
    submitBtn.addEventListener('click', executeGrayscale);
  }
})();
