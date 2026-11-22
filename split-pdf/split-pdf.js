/**
 * Split PDF Tool (split-pdf/split-pdf.js)
 * Supports extracting custom page ranges into a single PDF or splitting every page /
 * multiple ranges into individual PDFs bundled inside a .zip via pdf-lib + JSZip.
 */
(function () {
  'use strict';

  const Utils = window.PDFToolUtils;
  if (!Utils) {
    console.error('Split PDF: window.PDFToolUtils is not loaded.');
    return;
  }

  const fileInput = document.getElementById('split-file-input');
  const configPanel = document.getElementById('split-config-panel');
  const fileNameEl = document.getElementById('split-file-name');
  const fileMetaEl = document.getElementById('split-file-meta');
  const changeFileBtn = document.getElementById('split-change-file-btn');
  const modeCards = Array.from(document.querySelectorAll('#pdf-tool-app [data-mode-card]'));
  const modeRadios = Array.from(document.querySelectorAll('#pdf-tool-app input[name="split-mode"]'));
  const rangeGroup = document.getElementById('split-range-group');
  const rangeInput = document.getElementById('split-range-input');
  const rangeHint = document.getElementById('split-range-hint');
  const submitBtn = document.getElementById('split-submit-btn');
  const statusId = 'split-status';

  /** @type {File|null} */
  let currentFile = null;
  let totalPages = 0;
  let isProcessing = false;

  /**
   * Returns currently selected split mode: 'extract' | 'burst-all' | 'burst-ranges'
   */
  function getSelectedMode() {
    const checked = modeRadios.find((r) => r.checked);
    return checked ? checked.value : 'extract';
  }

  /**
   * Syncs radio card highlights and range input visibility.
   */
  function updateModeUI() {
    const mode = getSelectedMode();
    modeCards.forEach((card) => {
      const cardMode = card.getAttribute('data-mode-card');
      card.classList.toggle('selected', cardMode === mode);
    });

    if (rangeGroup) {
      rangeGroup.hidden = mode === 'burst-all';
    }

    if (rangeHint && totalPages > 0) {
      if (mode === 'extract') {
        rangeHint.textContent = `Enter page numbers or ranges separated by commas (1 to ${totalPages}). All listed pages will be merged into one output PDF.`;
      } else if (mode === 'burst-ranges') {
        rangeHint.textContent = `Each comma-separated token (e.g. "1-2, 3-5, 6") will become its own separate PDF file inside the downloaded ZIP (valid pages: 1 to ${totalPages}).`;
      }
    }
  }

  /**
   * Loads a single PDF file, inspects its page count, and initializes the split controls.
   * @param {File[]} files
   */
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

      if (rangeInput) {
        rangeInput.value = count > 1 ? `1-${Math.min(count, 2)}` : '1';
      }

      if (configPanel) configPanel.hidden = false;
      updateModeUI();
      Utils.showStatus(
        statusId,
        `Loaded "${file.name}" (${count} page${count === 1 ? '' : 's'}). Choose your split mode below.`,
        'info'
      );
    } catch (err) {
      buffer = null;
      currentFile = null;
      totalPages = 0;
      if (configPanel) configPanel.hidden = true;
      const msg = err && err.message ? err.message : 'Unable to read PDF.';
      Utils.showStatus(
        statusId,
        /encrypted/i.test(msg)
          ? 'This PDF is password-protected. Please unlock it before splitting.'
          : `Could not open PDF: ${msg}`,
        'error'
      );
    }
  }

  /**
   * Executes the split operation according to the active mode.
   */
  async function executeSplit() {
    if (isProcessing || !currentFile || totalPages < 1) return;
    if (!window.PDFLib) {
      Utils.showStatus(statusId, 'pdf-lib is not loaded.', 'error');
      return;
    }

    const mode = getSelectedMode();
    const baseName = Utils.getBaseFilename(currentFile.name, 'document');

    // Validate page ranges up front if needed
    if (mode === 'extract') {
      const parsed = Utils.parsePageRanges(rangeInput ? rangeInput.value : '', totalPages, {
        allowDuplicates: true
      });
      if (!parsed.valid) {
        Utils.showStatus(statusId, parsed.error, 'error');
        return;
      }
    } else if (mode === 'burst-ranges') {
      const rawTokens = (rangeInput ? rangeInput.value : '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      if (rawTokens.length === 0) {
        Utils.showStatus(statusId, 'Please enter at least one range (e.g. 1-2, 3-4).', 'error');
        return;
      }
      for (const token of rawTokens) {
        const check = Utils.parsePageRanges(token, totalPages);
        if (!check.valid) {
          Utils.showStatus(statusId, check.error, 'error');
          return;
        }
      }
    }

    isProcessing = true;
    submitBtn.disabled = true;
    const originalBtnHtml = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Splitting PDF...</span>';

    let sourceBuffer = null;
    try {
      const { PDFDocument } = window.PDFLib;
      sourceBuffer = await currentFile.arrayBuffer();
      const sourcePdf = await PDFDocument.load(sourceBuffer);

      if (mode === 'extract') {
        const parsed = Utils.parsePageRanges(rangeInput.value, totalPages, { allowDuplicates: true });
        Utils.showStatus(statusId, `Extracting ${parsed.indices.length} page(s)...`, 'loading');

        const newPdf = await PDFDocument.create();
        const copiedPages = await newPdf.copyPages(sourcePdf, parsed.indices);
        copiedPages.forEach((p) => newPdf.addPage(p));

        const pdfBytes = await newPdf.save();
        const outName = `${baseName}-pages-${parsed.pages.slice(0, 4).join('_')}${parsed.pages.length > 4 ? '-etc' : ''}.pdf`;
        Utils.downloadBlob(pdfBytes, outName, 'application/pdf');
        Utils.showStatus(
          statusId,
          `Extracted ${parsed.indices.length} page(s) into "${outName}" (${Utils.formatFileSize(pdfBytes.byteLength)}).`,
          'success'
        );
      } else if (mode === 'burst-all') {
        if (!window.JSZip) {
          throw new Error('JSZip library failed to load.');
        }
        Utils.showStatus(statusId, `Splitting all ${totalPages} pages into individual PDFs...`, 'loading');
        const zip = new window.JSZip();
        const padLen = String(totalPages).length;

        for (let i = 0; i < totalPages; i++) {
          const singlePdf = await PDFDocument.create();
          const [copiedPage] = await singlePdf.copyPages(sourcePdf, [i]);
          singlePdf.addPage(copiedPage);
          const singleBytes = await singlePdf.save();
          const pageLabel = String(i + 1).padStart(padLen, '0');
          zip.file(`${baseName}-page-${pageLabel}.pdf`, singleBytes);
        }

        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const zipName = `${baseName}-all-pages.zip`;
        Utils.downloadBlob(zipBlob, zipName, 'application/zip');
        Utils.showStatus(
          statusId,
          `Split all ${totalPages} pages into "${zipName}" (${Utils.formatFileSize(zipBlob.size)}).`,
          'success'
        );
      } else if (mode === 'burst-ranges') {
        if (!window.JSZip) {
          throw new Error('JSZip library failed to load.');
        }
        const tokens = rangeInput.value
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);

        Utils.showStatus(statusId, `Creating ${tokens.length} split PDF files...`, 'loading');
        const zip = new window.JSZip();

        for (let tIdx = 0; tIdx < tokens.length; tIdx++) {
          const token = tokens[tIdx];
          const parsed = Utils.parsePageRanges(token, totalPages);
          const rangePdf = await PDFDocument.create();
          const copiedPages = await rangePdf.copyPages(sourcePdf, parsed.indices);
          copiedPages.forEach((p) => rangePdf.addPage(p));
          const rangeBytes = await rangePdf.save();
          const safeToken = token.replace(/\s+/g, '');
          zip.file(`${baseName}-part-${tIdx + 1}-pages-${safeToken}.pdf`, rangeBytes);
        }

        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const zipName = `${baseName}-split-ranges.zip`;
        Utils.downloadBlob(zipBlob, zipName, 'application/zip');
        Utils.showStatus(
          statusId,
          `Created ${tokens.length} PDF files inside "${zipName}" (${Utils.formatFileSize(zipBlob.size)}).`,
          'success'
        );
      }
    } catch (err) {
      console.error('Split PDF error:', err);
      Utils.showStatus(
        statusId,
        `Failed to split PDF: ${err && err.message ? err.message : 'Unexpected error.'}`,
        'error'
      );
    } finally {
      sourceBuffer = null;
      isProcessing = false;
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnHtml;
    }
  }

  Utils.initDropzone({
    dropzoneId: 'split-dropzone',
    fileInputId: 'split-file-input',
    acceptExtensions: ['.pdf', 'application/pdf'],
    multiple: false,
    statusId,
    onFiles: handleFileSelect
  });

  modeRadios.forEach((radio) => {
    radio.addEventListener('change', updateModeUI);
  });

  if (changeFileBtn && fileInput) {
    changeFileBtn.addEventListener('click', () => {
      if (!isProcessing) fileInput.click();
    });
  }

  if (submitBtn) {
    submitBtn.addEventListener('click', executeSplit);
  }
})();
