/**
 * N-Up PDF Grid Tool (nup-pdf/nup-pdf.js)
 * Combines 2, 4, or 6 source PDF pages onto each output A4/Letter sheet losslessly
 * using pdfDoc.embedPages() with optional slide frame borders.
 */
(function () {
  'use strict';

  const Utils = window.PDFToolUtils;
  if (!Utils) {
    console.error('N-Up PDF: window.PDFToolUtils is not loaded.');
    return;
  }

  const fileInput = document.getElementById('nup-file-input');
  const configPanel = document.getElementById('nup-config-panel');
  const fileNameEl = document.getElementById('nup-file-name');
  const fileMetaEl = document.getElementById('nup-file-meta');
  const changeFileBtn = document.getElementById('nup-change-file-btn');
  const gridTypeSelect = document.getElementById('nup-grid-type');
  const sheetSizeSelect = document.getElementById('nup-sheet-size');
  const orientationSelect = document.getElementById('nup-orientation');
  const borderSelect = document.getElementById('nup-border');
  const submitBtn = document.getElementById('nup-submit-btn');
  const statusId = 'nup-status';

  const SHEET_SIZES = {
    a4: { width: 595.28, height: 841.89 },
    letter: { width: 612, height: 792 }
  };

  /** @type {File|null} */
  let currentFile = null;
  let totalPages = 0;
  let isProcessing = false;

  async function handleFileSelect(files) {
    if (isProcessing || !files || files.length === 0) return;
    const file = files[0];
    Utils.showStatus(statusId, `Inspecting "${file.name}"...`, 'loading');

    let buffer = null;
    try {
      buffer = await file.arrayBuffer();
      const pdfDoc = await window.PDFLib.PDFDocument.load(buffer, { updateMetadata: false });
      const count = pdfDoc.getPageCount();
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
        `Loaded "${file.name}" (${count} page${count === 1 ? '' : 's'}). Select your N-Up grid layout below.`,
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

  async function executeNup() {
    if (isProcessing || !currentFile || totalPages < 1) return;

    const perSheet = parseInt(gridTypeSelect ? gridTypeSelect.value : '4', 10) || 4;
    const sheetKey = sheetSizeSelect ? sheetSizeSelect.value : 'a4';
    const isLandscape = (orientationSelect ? orientationSelect.value : 'landscape') === 'landscape';
    const drawBorder = (borderSelect ? borderSelect.value : 'yes') === 'yes';

    const baseSize = SHEET_SIZES[sheetKey] || SHEET_SIZES.a4;
    const sheetW = isLandscape ? Math.max(baseSize.width, baseSize.height) : Math.min(baseSize.width, baseSize.height);
    const sheetH = isLandscape ? Math.min(baseSize.width, baseSize.height) : Math.max(baseSize.width, baseSize.height);

    let cols = 2;
    let rows = 2;
    if (perSheet === 2) {
      cols = isLandscape ? 2 : 1;
      rows = isLandscape ? 1 : 2;
    } else if (perSheet === 6) {
      cols = isLandscape ? 3 : 2;
      rows = isLandscape ? 2 : 3;
    }

    isProcessing = true;
    submitBtn.disabled = true;
    const originalBtnHtml = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Building N-Up Sheets...</span>';

    let buffer = null;
    try {
      const { PDFDocument, rgb } = window.PDFLib;
      buffer = await currentFile.arrayBuffer();
      const sourcePdf = await PDFDocument.load(buffer);
      const outPdf = await PDFDocument.create();

      const sourcePages = sourcePdf.getPages();
      const embeddedPages = await outPdf.embedPages(sourcePages);

      const outerMargin = 24;
      const cellGap = 14;
      const availW = sheetW - outerMargin * 2 - cellGap * (cols - 1);
      const availH = sheetH - outerMargin * 2 - cellGap * (rows - 1);
      const cellW = availW / cols;
      const cellH = availH / rows;

      const sheetCount = Math.ceil(embeddedPages.length / perSheet);

      for (let s = 0; s < sheetCount; s++) {
        const sheet = outPdf.addPage([sheetW, sheetH]);

        for (let slot = 0; slot < perSheet; slot++) {
          const pageIdx = s * perSheet + slot;
          if (pageIdx >= embeddedPages.length) break;

          const embedded = embeddedPages[pageIdx];
          const col = slot % cols;
          const row = Math.floor(slot / cols);

          const cellX = outerMargin + col * (cellW + cellGap);
          // Top-to-bottom row index mapped to bottom-left PDF coordinates
          const cellY = sheetH - outerMargin - (row + 1) * cellH - row * cellGap;

          const scale = Math.min(cellW / embedded.width, cellH / embedded.height);
          const drawW = embedded.width * scale;
          const drawH = embedded.height * scale;
          const drawX = cellX + (cellW - drawW) / 2;
          const drawY = cellY + (cellH - drawH) / 2;

          sheet.drawPage(embedded, {
            x: drawX,
            y: drawY,
            width: drawW,
            height: drawH
          });

          if (drawBorder) {
            sheet.drawRectangle({
              x: drawX,
              y: drawY,
              width: drawW,
              height: drawH,
              borderColor: rgb(0.75, 0.78, 0.82),
              borderWidth: 0.75
            });
          }
        }
      }

      const outBytes = await outPdf.save();
      const baseName = Utils.getBaseFilename(currentFile.name, 'document');
      const outName = `${baseName}-${perSheet}up.pdf`;

      Utils.downloadBlob(outBytes, outName, 'application/pdf');
      Utils.showStatus(
        statusId,
        `Combined ${totalPages} page(s) into ${sheetCount} ${perSheet}-Up sheet(s) and downloaded "${outName}".`,
        'success'
      );
    } catch (err) {
      console.error('N-Up PDF error:', err);
      Utils.showStatus(
        statusId,
        `Failed to create N-Up PDF: ${err && err.message ? err.message : 'Unexpected error.'}`,
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
    dropzoneId: 'nup-dropzone',
    fileInputId: 'nup-file-input',
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
    submitBtn.addEventListener('click', executeNup);
  }
})();
