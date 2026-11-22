/**
 * Edit PDF Metadata Tool (metadata-pdf/metadata-pdf.js)
 * Reads, edits, or wipes PDF document properties (Title, Author, Subject, Keywords,
 * Creator, Producer) locally in the browser using pdf-lib.
 */
(function () {
  'use strict';

  const Utils = window.PDFToolUtils;
  if (!Utils) {
    console.error('Metadata PDF: window.PDFToolUtils is not loaded.');
    return;
  }

  const fileInput = document.getElementById('meta-file-input');
  const configPanel = document.getElementById('meta-config-panel');
  const fileNameEl = document.getElementById('meta-file-name');
  const fileMetaEl = document.getElementById('meta-file-meta');
  const wipeBtn = document.getElementById('meta-wipe-btn');
  const changeFileBtn = document.getElementById('meta-change-file-btn');

  const titleInput = document.getElementById('meta-title');
  const authorInput = document.getElementById('meta-author');
  const subjectInput = document.getElementById('meta-subject');
  const keywordsInput = document.getElementById('meta-keywords');
  const creatorInput = document.getElementById('meta-creator');
  const producerInput = document.getElementById('meta-producer');

  const submitBtn = document.getElementById('meta-submit-btn');
  const statusId = 'meta-status';

  /** @type {File|null} */
  let currentFile = null;
  let isProcessing = false;

  /**
   * Loads the selected PDF and populates form inputs with its existing metadata.
   * @param {File[]} files
   */
  async function handleFileSelect(files) {
    if (isProcessing || !files || files.length === 0) return;
    if (!window.PDFLib) {
      Utils.showStatus(statusId, 'pdf-lib is not loaded.', 'error');
      return;
    }

    const file = files[0];
    Utils.showStatus(statusId, `Reading metadata from "${file.name}"...`, 'loading');

    let buffer = null;
    try {
      buffer = await file.arrayBuffer();
      const pdfDoc = await window.PDFLib.PDFDocument.load(buffer, { updateMetadata: false });
      const count = pdfDoc.getPageCount();

      if (titleInput) titleInput.value = pdfDoc.getTitle() || '';
      if (authorInput) authorInput.value = pdfDoc.getAuthor() || '';
      if (subjectInput) subjectInput.value = pdfDoc.getSubject() || '';
      if (keywordsInput) keywordsInput.value = pdfDoc.getKeywords() || '';
      if (creatorInput) creatorInput.value = pdfDoc.getCreator() || '';
      if (producerInput) producerInput.value = pdfDoc.getProducer() || '';
      buffer = null;

      currentFile = file;
      if (fileNameEl) fileNameEl.textContent = file.name;
      if (fileMetaEl) {
        fileMetaEl.textContent = `${Utils.formatFileSize(file.size)} • ${count} page${count === 1 ? '' : 's'}`;
      }

      if (configPanel) configPanel.hidden = false;
      Utils.showStatus(
        statusId,
        `Loaded "${file.name}". Edit or clear the metadata fields below and click Save Metadata.`,
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
          ? 'This PDF is password-protected. Please unlock it before editing metadata.'
          : `Could not open PDF: ${msg}`,
        'error'
      );
    }
  }

  /**
   * Clears all metadata inputs for quick privacy stripping.
   */
  function clearAllFields() {
    [titleInput, authorInput, subjectInput, keywordsInput, creatorInput, producerInput].forEach((el) => {
      if (el) el.value = '';
    });
    Utils.showStatus(statusId, 'Cleared all metadata fields. Click Save Metadata to export the stripped PDF.', 'info');
  }

  /**
   * Writes updated metadata properties into the PDF and triggers download.
   */
  async function saveMetadata() {
    if (isProcessing || !currentFile) return;
    if (!window.PDFLib) {
      Utils.showStatus(statusId, 'pdf-lib is not loaded.', 'error');
      return;
    }

    isProcessing = true;
    submitBtn.disabled = true;
    const originalBtnHtml = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Saving Metadata...</span>';

    let buffer = null;
    try {
      const { PDFDocument } = window.PDFLib;
      buffer = await currentFile.arrayBuffer();
      const pdfDoc = await PDFDocument.load(buffer, { updateMetadata: false });

      pdfDoc.setTitle(titleInput ? titleInput.value.trim() : '');
      pdfDoc.setAuthor(authorInput ? authorInput.value.trim() : '');
      pdfDoc.setSubject(subjectInput ? subjectInput.value.trim() : '');

      const rawKeywords = keywordsInput ? keywordsInput.value.trim() : '';
      const keywordList = rawKeywords
        ? rawKeywords.split(',').map((k) => k.trim()).filter(Boolean)
        : [];
      pdfDoc.setKeywords(keywordList);

      pdfDoc.setCreator(creatorInput ? creatorInput.value.trim() : '');
      pdfDoc.setProducer(producerInput ? producerInput.value.trim() : '');
      pdfDoc.setModificationDate(new Date());

      const outBytes = await pdfDoc.save();
      const baseName = Utils.getBaseFilename(currentFile.name, 'document');
      const outName = `${baseName}-metadata.pdf`;

      Utils.downloadBlob(outBytes, outName, 'application/pdf');
      Utils.showStatus(
        statusId,
        `Saved updated metadata and downloaded "${outName}" (${Utils.formatFileSize(outBytes.byteLength)}).`,
        'success'
      );
    } catch (err) {
      console.error('Metadata PDF error:', err);
      Utils.showStatus(
        statusId,
        `Failed to update metadata: ${err && err.message ? err.message : 'Unexpected error.'}`,
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
    dropzoneId: 'meta-dropzone',
    fileInputId: 'meta-file-input',
    acceptExtensions: ['.pdf', 'application/pdf'],
    multiple: false,
    statusId,
    onFiles: handleFileSelect
  });

  if (wipeBtn) {
    wipeBtn.addEventListener('click', () => {
      if (!isProcessing) clearAllFields();
    });
  }

  if (changeFileBtn && fileInput) {
    changeFileBtn.addEventListener('click', () => {
      if (!isProcessing) fileInput.click();
    });
  }

  if (submitBtn) {
    submitBtn.addEventListener('click', saveMetadata);
  }
})();
