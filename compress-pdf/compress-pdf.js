/**
 * Compress PDF Tool (compress-pdf/compress-pdf.js)
 * Re-encodes PDF pages at selectable JPEG quality / DPI levels on an off-screen <canvas>
 * via pdfjs-dist, rebuilds the PDF via pdf-lib, and displays exact size-reduction stats.
 */
(function () {
  'use strict';

  const Utils = window.PDFToolUtils;
  if (!Utils) {
    console.error('Compress PDF: window.PDFToolUtils is not loaded.');
    return;
  }

  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  }

  const fileInput = document.getElementById('comp-file-input');
  const configPanel = document.getElementById('comp-config-panel');
  const fileNameEl = document.getElementById('comp-file-name');
  const fileMetaEl = document.getElementById('comp-file-meta');
  const changeFileBtn = document.getElementById('comp-change-file-btn');
  const presetCards = Array.from(document.querySelectorAll('#pdf-tool-app [data-preset-card]'));
  const presetRadios = Array.from(document.querySelectorAll('#pdf-tool-app input[name="comp-preset"]'));
  const qualityInput = document.getElementById('comp-quality');
  const qualityBadge = document.getElementById('comp-quality-badge');
  const scaleInput = document.getElementById('comp-scale');
  const scaleBadge = document.getElementById('comp-scale-badge');
  const statsBox = document.getElementById('comp-stats-box');
  const statOriginal = document.getElementById('comp-stat-original');
  const statNew = document.getElementById('comp-stat-new');
  const statSaving = document.getElementById('comp-stat-saving');
  const submitBtn = document.getElementById('comp-submit-btn');
  const statusId = 'comp-status';

  const PRESETS = {
    extreme: { quality: 50, scale: 1.0 },
    recommended: { quality: 70, scale: 1.4 },
    high: { quality: 85, scale: 1.8 }
  };

  /** @type {File|null} */
  let currentFile = null;
  let totalPages = 0;
  let isProcessing = false;

  function applyPresetValues(presetKey) {
    const preset = PRESETS[presetKey] || PRESETS.recommended;
    if (qualityInput && qualityBadge) {
      qualityInput.value = String(preset.quality);
      qualityBadge.textContent = `${preset.quality}%`;
    }
    if (scaleInput && scaleBadge) {
      scaleInput.value = String(preset.scale);
      scaleBadge.textContent = `${preset.scale.toFixed(1)}×`;
    }
    presetCards.forEach((card) => {
      card.classList.toggle('selected', card.getAttribute('data-preset-card') === presetKey);
    });
  }

  /**
   * Loads the selected PDF and inspects its page count.
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
    if (statsBox) statsBox.hidden = true;

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

      if (configPanel) configPanel.hidden = false;
      Utils.showStatus(
        statusId,
        `Loaded "${file.name}" (${Utils.formatFileSize(file.size)}, ${count} page${count === 1 ? '' : 's'}). Choose your compression level below.`,
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
   * Renders each page onto an off-screen canvas, re-encodes as JPEG, rebuilds the PDF
   * matching original PDF point dimensions, and shows exact size comparison metrics.
   */
  async function executeCompress() {
    if (isProcessing || !currentFile || totalPages < 1) return;
    if (!window.pdfjsLib || !window.PDFLib) {
      Utils.showStatus(statusId, 'Required PDF libraries failed to load.', 'error');
      return;
    }

    const quality = (parseInt(qualityInput ? qualityInput.value : '70', 10) || 70) / 100;
    const scale = parseFloat(scaleInput ? scaleInput.value : '1.4') || 1.4;

    isProcessing = true;
    submitBtn.disabled = true;
    const originalBtnHtml = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Compressing PDF...</span>';

    let buffer = null;
    let pdfJsDoc = null;
    try {
      buffer = await currentFile.arrayBuffer();
      const loadingTask = window.pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
      pdfJsDoc = await loadingTask.promise;

      const { PDFDocument } = window.PDFLib;
      const outPdf = await PDFDocument.create();

      for (let p = 1; p <= totalPages; p++) {
        Utils.showStatus(statusId, `Compressing page ${p} of ${totalPages}...`, 'loading');
        const page = await pdfJsDoc.getPage(p);
        const origViewport = page.getViewport({ scale: 1.0 });
        const renderViewport = page.getViewport({ scale });

        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(renderViewport.width);
        canvas.height = Math.floor(renderViewport.height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        await page.render({ canvasContext: ctx, viewport: renderViewport }).promise;
        const jpgBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
        Utils.cleanupCanvas(canvas);
        page.cleanup();

        let jpgBuffer = await jpgBlob.arrayBuffer();
        const embeddedJpg = await outPdf.embedJpg(jpgBuffer);
        jpgBuffer = null;

        const outPage = outPdf.addPage([origViewport.width, origViewport.height]);
        outPage.drawImage(embeddedJpg, {
          x: 0,
          y: 0,
          width: origViewport.width,
          height: origViewport.height
        });
      }

      const compressedBytes = await outPdf.save({ useObjectStreams: true });
      const origSize = currentFile.size;
      const newSize = compressedBytes.byteLength;
      const diffBytes = origSize - newSize;
      const pct = origSize > 0 ? ((diffBytes / origSize) * 100).toFixed(1) : '0.0';

      if (statsBox && statOriginal && statNew && statSaving) {
        statsBox.hidden = false;
        statOriginal.textContent = Utils.formatFileSize(origSize);
        statNew.textContent = Utils.formatFileSize(newSize);
        if (diffBytes >= 0) {
          statSaving.style.color = 'var(--pdf-success-text)';
          statSaving.textContent = `-${pct}% (Saved ${Utils.formatFileSize(diffBytes)})`;
        } else {
          statSaving.style.color = 'var(--pdf-warning-text)';
          statSaving.textContent = `+${Math.abs(parseFloat(pct)).toFixed(1)}% (Try Extreme preset)`;
        }
      }

      const baseName = Utils.getBaseFilename(currentFile.name, 'document');
      const outName = `${baseName}-compressed.pdf`;
      Utils.downloadBlob(compressedBytes, outName, 'application/pdf');

      if (diffBytes >= 0) {
        Utils.showStatus(
          statusId,
          `Compressed "${currentFile.name}" from ${Utils.formatFileSize(origSize)} to ${Utils.formatFileSize(newSize)} (-${pct}%) and downloaded "${outName}".`,
          'success'
        );
      } else {
        Utils.showStatus(
          statusId,
          `Downloaded "${outName}" (${Utils.formatFileSize(newSize)}). Note: Pure vector/text PDFs may grow when rasterized—lower the resolution scale or use Extreme Compression for smaller output.`,
          'warning'
        );
      }
    } catch (err) {
      console.error('Compress PDF error:', err);
      Utils.showStatus(
        statusId,
        `Failed to compress PDF: ${err && err.message ? err.message : 'Unexpected error.'}`,
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
    dropzoneId: 'comp-dropzone',
    fileInputId: 'comp-file-input',
    acceptExtensions: ['.pdf', 'application/pdf'],
    multiple: false,
    statusId,
    onFiles: handleFileSelect
  });

  presetRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.checked) applyPresetValues(radio.value);
    });
  });

  if (qualityInput && qualityBadge) {
    qualityInput.addEventListener('input', () => {
      qualityBadge.textContent = `${qualityInput.value}%`;
    });
  }

  if (scaleInput && scaleBadge) {
    scaleInput.addEventListener('input', () => {
      scaleBadge.textContent = `${parseFloat(scaleInput.value).toFixed(1)}×`;
    });
  }

  if (changeFileBtn && fileInput) {
    changeFileBtn.addEventListener('click', () => {
      if (!isProcessing) fileInput.click();
    });
  }

  if (submitBtn) {
    submitBtn.addEventListener('click', executeCompress);
  }
})();
