/**
 * Rotate PDF Tool (rotate-pdf/rotate-pdf.js)
 * Reads each page's existing rotation angle and applies relative 90° Right,
 * 90° Left, or 180° Flip turns to all pages or specific page ranges via pdf-lib.
 */
(function () {
  'use strict';

  const Utils = window.PDFToolUtils;
  if (!Utils) {
    console.error('Rotate PDF: window.PDFToolUtils is not loaded.');
    return;
  }

  const fileInput = document.getElementById('rotate-file-input');
  const configPanel = document.getElementById('rotate-config-panel');
  const fileNameEl = document.getElementById('rotate-file-name');
  const fileMetaEl = document.getElementById('rotate-file-meta');
  const changeFileBtn = document.getElementById('rotate-change-file-btn');
  const angleCards = Array.from(document.querySelectorAll('#pdf-tool-app [data-angle-card]'));
  const angleRadios = Array.from(document.querySelectorAll('#pdf-tool-app input[name="rotate-angle"]'));
  const targetCards = Array.from(document.querySelectorAll('#pdf-tool-app [data-target-card]'));
  const targetRadios = Array.from(document.querySelectorAll('#pdf-tool-app input[name="rotate-target"]'));
  const rangeGroup = document.getElementById('rotate-range-group');
  const rangeInput = document.getElementById('rotate-range-input');
  const rangeHint = document.getElementById('rotate-range-hint');
  const submitBtn = document.getElementById('rotate-submit-btn');
  const statusId = 'rotate-status';

  /** @type {File|null} */
  let currentFile = null;
  let totalPages = 0;
  let isProcessing = false;

  function getSelectedAngleDelta() {
    const checked = angleRadios.find((r) => r.checked);
    return checked ? parseInt(checked.value, 10) : 90;
  }

  function getSelectedTargetMode() {
    const checked = targetRadios.find((r) => r.checked);
    return checked ? checked.value : 'all';
  }

  function syncFormUI() {
    const angle = String(getSelectedAngleDelta());
    angleCards.forEach((card) => {
      card.classList.toggle('selected', card.getAttribute('data-angle-card') === angle);
    });

    const target = getSelectedTargetMode();
    targetCards.forEach((card) => {
      card.classList.toggle('selected', card.getAttribute('data-target-card') === target);
    });

    if (rangeGroup) {
      rangeGroup.hidden = target !== 'custom';
    }

    if (rangeHint && totalPages > 0) {
      rangeHint.textContent = `Enter page numbers or ranges separated by commas (valid pages: 1 to ${totalPages}).`;
    }
  }

  /**
   * Loads a PDF file and inspects its page count and existing rotations.
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
      const pages = pdfDoc.getPages();
      const preRotatedCount = pages.filter((p) => (p.getRotation().angle % 360) !== 0).length;
      buffer = null;

      currentFile = file;
      totalPages = count;

      if (fileNameEl) fileNameEl.textContent = file.name;
      if (fileMetaEl) {
        const rotNote = preRotatedCount > 0 ? ` • ${preRotatedCount} page(s) have existing rotation` : '';
        fileMetaEl.textContent = `${Utils.formatFileSize(file.size)} • ${count} page${count === 1 ? '' : 's'}${rotNote}`;
      }

      if (rangeInput) {
        rangeInput.value = `1-${count}`;
      }

      if (configPanel) configPanel.hidden = false;
      syncFormUI();
      Utils.showStatus(
        statusId,
        `Loaded "${file.name}" (${count} page${count === 1 ? '' : 's'}). Select rotation angle and target pages below.`,
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
          ? 'This PDF is password-protected. Please unlock it before rotating.'
          : `Could not open PDF: ${msg}`,
        'error'
      );
    }
  }

  /**
   * Applies relative rotation to the selected pages and triggers download.
   */
  async function executeRotate() {
    if (isProcessing || !currentFile || totalPages < 1) return;
    if (!window.PDFLib) {
      Utils.showStatus(statusId, 'pdf-lib is not loaded.', 'error');
      return;
    }

    const targetMode = getSelectedTargetMode();
    const rangeQuery = targetMode === 'all' ? 'all' : (rangeInput ? rangeInput.value : '');
    const parsed = Utils.parsePageRanges(rangeQuery, totalPages);

    if (!parsed.valid) {
      Utils.showStatus(statusId, parsed.error, 'error');
      return;
    }

    const angleDelta = getSelectedAngleDelta();
    isProcessing = true;
    submitBtn.disabled = true;
    const originalBtnHtml = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Rotating Pages...</span>';
    Utils.showStatus(statusId, `Rotating ${parsed.indices.length} page(s)...`, 'loading');

    let buffer = null;
    try {
      const { PDFDocument, degrees } = window.PDFLib;
      buffer = await currentFile.arrayBuffer();
      const pdfDoc = await PDFDocument.load(buffer);
      const pages = pdfDoc.getPages();

      for (const pageIndex of parsed.indices) {
        const page = pages[pageIndex];
        if (!page) continue;
        const currentAngle = page.getRotation().angle || 0;
        const newAngle = ((currentAngle + angleDelta) % 360 + 360) % 360;
        page.setRotation(degrees(newAngle));
      }

      const rotatedBytes = await pdfDoc.save();
      const baseName = Utils.getBaseFilename(currentFile.name, 'document');
      const label = angleDelta === 90 ? '90cw' : angleDelta === 270 ? '90ccw' : '180';
      const outName = `${baseName}-rotated-${label}.pdf`;

      Utils.downloadBlob(rotatedBytes, outName, 'application/pdf');
      Utils.showStatus(
        statusId,
        `Rotated ${parsed.indices.length} of ${totalPages} page(s) and downloaded "${outName}".`,
        'success'
      );
    } catch (err) {
      console.error('Rotate PDF error:', err);
      Utils.showStatus(
        statusId,
        `Failed to rotate PDF: ${err && err.message ? err.message : 'Unexpected error.'}`,
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
    dropzoneId: 'rotate-dropzone',
    fileInputId: 'rotate-file-input',
    acceptExtensions: ['.pdf', 'application/pdf'],
    multiple: false,
    statusId,
    onFiles: handleFileSelect
  });

  angleRadios.forEach((r) => r.addEventListener('change', syncFormUI));
  targetRadios.forEach((r) => r.addEventListener('change', syncFormUI));

  if (changeFileBtn && fileInput) {
    changeFileBtn.addEventListener('click', () => {
      if (!isProcessing) fileInput.click();
    });
  }

  if (submitBtn) {
    submitBtn.addEventListener('click', executeRotate);
  }
})();
