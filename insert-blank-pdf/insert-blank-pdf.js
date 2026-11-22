/**
 * Insert Blank Pages Tool (insert-blank-pdf/insert-blank-pdf.js)
 * Inserts blank pages before or after specific pages, or interleaved after every page,
 * matching existing page dimensions or standard A4/Letter sizes via pdf-lib.
 */
(function () {
  'use strict';

  const Utils = window.PDFToolUtils;
  if (!Utils) {
    console.error('Insert Blank PDF: window.PDFToolUtils is not loaded.');
    return;
  }

  const fileInput = document.getElementById('blank-file-input');
  const configPanel = document.getElementById('blank-config-panel');
  const fileNameEl = document.getElementById('blank-file-name');
  const fileMetaEl = document.getElementById('blank-file-meta');
  const changeFileBtn = document.getElementById('blank-change-file-btn');
  const modeCards = Array.from(document.querySelectorAll('#pdf-tool-app [data-blank-card]'));
  const modeRadios = Array.from(document.querySelectorAll('#pdf-tool-app input[name="blank-mode"]'));
  const targetGroup = document.getElementById('blank-target-group');
  const targetInput = document.getElementById('blank-target-pages');
  const targetHint = document.getElementById('blank-target-hint');
  const countInput = document.getElementById('blank-count');
  const sizeSelect = document.getElementById('blank-size');
  const submitBtn = document.getElementById('blank-submit-btn');
  const statusId = 'blank-status';

  const SIZE_PRESETS = {
    'a4-p': [595.28, 841.89],
    'a4-l': [841.89, 595.28],
    'letter-p': [612, 792]
  };

  /** @type {File|null} */
  let currentFile = null;
  let totalPages = 0;
  let isProcessing = false;

  function getSelectedMode() {
    const checked = modeRadios.find((r) => r.checked);
    return checked ? checked.value : 'after';
  }

  function syncModeUI() {
    const mode = getSelectedMode();
    modeCards.forEach((card) => {
      card.classList.toggle('selected', card.getAttribute('data-blank-card') === mode);
    });
    if (targetGroup) {
      targetGroup.hidden = mode === 'every';
    }
  }

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
      if (targetInput) targetInput.value = '1';
      if (targetHint) {
        targetHint.textContent = `Enter page numbers or ranges separated by commas (valid pages: 1 to ${count}).`;
      }

      if (configPanel) configPanel.hidden = false;
      syncModeUI();
      Utils.showStatus(
        statusId,
        `Loaded "${file.name}" (${count} page${count === 1 ? '' : 's'}). Configure where to insert blank pages below.`,
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

  async function executeInsertBlank() {
    if (isProcessing || !currentFile || totalPages < 1) return;
    const mode = getSelectedMode();
    const rangeStr = mode === 'every' ? 'all' : (targetInput ? targetInput.value : '1');
    const parsed = Utils.parsePageRanges(rangeStr, totalPages);

    if (!parsed.valid) {
      Utils.showStatus(statusId, parsed.error, 'error');
      return;
    }

    const blankCount = Math.min(20, Math.max(1, parseInt(countInput ? countInput.value : '1', 10) || 1));
    const sizeKey = sizeSelect ? sizeSelect.value : 'match';
    const targetSet = new Set(parsed.indices);

    isProcessing = true;
    submitBtn.disabled = true;
    const originalBtnHtml = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Inserting Blank Pages...</span>';

    let buffer = null;
    try {
      const { PDFDocument } = window.PDFLib;
      buffer = await currentFile.arrayBuffer();
      const sourcePdf = await PDFDocument.load(buffer);
      const outPdf = await PDFDocument.create();

      const allIndices = sourcePdf.getPageIndices();
      const copiedPages = await outPdf.copyPages(sourcePdf, allIndices);
      let insertedTotal = 0;

      for (let i = 0; i < copiedPages.length; i++) {
        const page = copiedPages[i];
        const { width, height } = page.getSize();
        const blankDims = SIZE_PRESETS[sizeKey] || [width, height];

        if (mode === 'before' && targetSet.has(i)) {
          for (let b = 0; b < blankCount; b++) {
            outPdf.addPage(blankDims);
            insertedTotal += 1;
          }
        }

        outPdf.addPage(page);

        if ((mode === 'after' || mode === 'every') && targetSet.has(i)) {
          for (let b = 0; b < blankCount; b++) {
            outPdf.addPage(blankDims);
            insertedTotal += 1;
          }
        }
      }

      const outBytes = await outPdf.save();
      const baseName = Utils.getBaseFilename(currentFile.name, 'document');
      const outName = `${baseName}-with-blanks.pdf`;

      Utils.downloadBlob(outBytes, outName, 'application/pdf');
      Utils.showStatus(
        statusId,
        `Inserted ${insertedTotal} blank page(s) (new total: ${outPdf.getPageCount()} pages) and downloaded "${outName}".`,
        'success'
      );
    } catch (err) {
      console.error('Insert Blank PDF error:', err);
      Utils.showStatus(
        statusId,
        `Failed to insert blank pages: ${err && err.message ? err.message : 'Unexpected error.'}`,
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
    dropzoneId: 'blank-dropzone',
    fileInputId: 'blank-file-input',
    acceptExtensions: ['.pdf', 'application/pdf'],
    multiple: false,
    statusId,
    onFiles: handleFileSelect
  });

  modeRadios.forEach((r) => r.addEventListener('change', syncModeUI));

  if (changeFileBtn && fileInput) {
    changeFileBtn.addEventListener('click', () => {
      if (!isProcessing) fileInput.click();
    });
  }

  if (submitBtn) {
    submitBtn.addEventListener('click', executeInsertBlank);
  }
})();
