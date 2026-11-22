/**
 * Flatten PDF Forms & Layers Tool (flatten-pdf/flatten-pdf.js)
 * Supports lossless vector AcroForm flattening via pdf-lib (form.flatten())
 * or full-page 150 DPI raster flattening via pdfjs-dist + pdf-lib.
 */
(function () {
  'use strict';

  const Utils = window.PDFToolUtils;
  if (!Utils) {
    console.error('Flatten PDF: window.PDFToolUtils is not loaded.');
    return;
  }

  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  }

  const fileInput = document.getElementById('flat-file-input');
  const configPanel = document.getElementById('flat-config-panel');
  const fileNameEl = document.getElementById('flat-file-name');
  const fileMetaEl = document.getElementById('flat-file-meta');
  const changeFileBtn = document.getElementById('flat-change-file-btn');
  const modeCards = Array.from(document.querySelectorAll('#pdf-tool-app [data-flat-card]'));
  const modeRadios = Array.from(document.querySelectorAll('#pdf-tool-app input[name="flat-mode"]'));
  const submitBtn = document.getElementById('flat-submit-btn');
  const statusId = 'flat-status';

  /** @type {File|null} */
  let currentFile = null;
  let totalPages = 0;
  let detectedFieldCount = 0;
  let isProcessing = false;

  function getSelectedMode() {
    const checked = modeRadios.find((r) => r.checked);
    return checked ? checked.value : 'acroform';
  }

  function syncModeCards() {
    const mode = getSelectedMode();
    modeCards.forEach((card) => {
      card.classList.toggle('selected', card.getAttribute('data-flat-card') === mode);
    });
  }

  async function handleFileSelect(files) {
    if (isProcessing || !files || files.length === 0) return;
    const file = files[0];
    Utils.showStatus(statusId, `Inspecting form fields in "${file.name}"...`, 'loading');

    let buffer = null;
    try {
      buffer = await file.arrayBuffer();
      const pdfDoc = await window.PDFLib.PDFDocument.load(buffer, { updateMetadata: false });
      const count = pdfDoc.getPageCount();
      let fieldCount = 0;
      try {
        const form = pdfDoc.getForm();
        fieldCount = form.getFields().length;
      } catch (_formErr) {
        fieldCount = 0;
      }
      buffer = null;

      currentFile = file;
      totalPages = count;
      detectedFieldCount = fieldCount;

      if (fileNameEl) fileNameEl.textContent = file.name;
      if (fileMetaEl) {
        fileMetaEl.textContent = `${Utils.formatFileSize(file.size)} • ${count} page${count === 1 ? '' : 's'} • ${fieldCount} interactive form field${fieldCount === 1 ? '' : 's'} detected`;
      }

      if (configPanel) configPanel.hidden = false;
      syncModeCards();
      Utils.showStatus(
        statusId,
        fieldCount > 0
          ? `Detected ${fieldCount} interactive form field(s) in "${file.name}". Ready to flatten.`
          : `Loaded "${file.name}" (0 AcroForm fields found). You can still run Vector Flatten or Full Page Layer Bake.`,
        'info'
      );
    } catch (err) {
      buffer = null;
      currentFile = null;
      if (configPanel) configPanel.hidden = true;
      const msg = err && err.message ? err.message : 'Unable to read PDF.';
      Utils.showStatus(
        statusId,
        /encrypted/i.test(msg)
          ? 'This PDF is password-protected. Please unlock it before flattening.'
          : `Could not open PDF: ${msg}`,
        'error'
      );
    }
  }

  async function executeFlatten() {
    if (isProcessing || !currentFile || totalPages < 1) return;
    const mode = getSelectedMode();
    const baseName = Utils.getBaseFilename(currentFile.name, 'document');

    isProcessing = true;
    submitBtn.disabled = true;
    const originalBtnHtml = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Flattening PDF...</span>';

    let buffer = null;
    let pdfJsDoc = null;
    try {
      buffer = await currentFile.arrayBuffer();
      const { PDFDocument } = window.PDFLib;

      if (mode === 'acroform') {
        Utils.showStatus(statusId, 'Flattening interactive AcroForm fields...', 'loading');
        const pdfDoc = await PDFDocument.load(buffer);
        try {
          const form = pdfDoc.getForm();
          form.flatten();
        } catch (_e) {
          // Document had no AcroForm dictionary; proceed cleanly
        }
        const outBytes = await pdfDoc.save();
        const outName = `${baseName}-flattened.pdf`;
        Utils.downloadBlob(outBytes, outName, 'application/pdf');
        Utils.showStatus(
          statusId,
          `Flattened ${detectedFieldCount} form field(s) and downloaded "${outName}" (${Utils.formatFileSize(outBytes.byteLength)}).`,
          'success'
        );
      } else {
        if (!window.pdfjsLib) {
          throw new Error('PDF.js library is not loaded.');
        }
        const loadingTask = window.pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
        pdfJsDoc = await loadingTask.promise;
        const outPdf = await PDFDocument.create();

        for (let p = 1; p <= totalPages; p++) {
          Utils.showStatus(statusId, `Baking page ${p} of ${totalPages}...`, 'loading');
          const page = await pdfJsDoc.getPage(p);
          const origVp = page.getViewport({ scale: 1.0 });
          const renderVp = page.getViewport({ scale: 2.0 });

          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(renderVp.width);
          canvas.height = Math.floor(renderVp.height);
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          await page.render({ canvasContext: ctx, viewport: renderVp }).promise;
          const jpgBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
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
        const outName = `${baseName}-flattened-baked.pdf`;
        Utils.downloadBlob(outBytes, outName, 'application/pdf');
        Utils.showStatus(
          statusId,
          `Baked all ${totalPages} page(s) into flat layers and downloaded "${outName}" (${Utils.formatFileSize(outBytes.byteLength)}).`,
          'success'
        );
      }
    } catch (err) {
      console.error('Flatten PDF error:', err);
      Utils.showStatus(
        statusId,
        `Failed to flatten PDF: ${err && err.message ? err.message : 'Unexpected error.'}`,
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
    dropzoneId: 'flat-dropzone',
    fileInputId: 'flat-file-input',
    acceptExtensions: ['.pdf', 'application/pdf'],
    multiple: false,
    statusId,
    onFiles: handleFileSelect
  });

  modeRadios.forEach((r) => r.addEventListener('change', syncModeCards));

  if (changeFileBtn && fileInput) {
    changeFileBtn.addEventListener('click', () => {
      if (!isProcessing) fileInput.click();
    });
  }

  if (submitBtn) {
    submitBtn.addEventListener('click', executeFlatten);
  }
})();
