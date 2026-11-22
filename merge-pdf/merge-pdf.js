/**
 * Merge PDF Tool (merge-pdf/merge-pdf.js)
 * Combines multiple local PDF files in user-defined order using pdf-lib.
 */
(function () {
  'use strict';

  const Utils = window.PDFToolUtils;
  if (!Utils) {
    console.error('Merge PDF: window.PDFToolUtils is not loaded.');
    return;
  }

  const fileInput = document.getElementById('merge-file-input');
  const queuePanel = document.getElementById('merge-queue-panel');
  const fileListEl = document.getElementById('merge-file-list');
  const fileCountEl = document.getElementById('merge-file-count');
  const addMoreBtn = document.getElementById('merge-add-more-btn');
  const clearBtn = document.getElementById('merge-clear-btn');
  const outputNameInput = document.getElementById('merge-output-name');
  const submitBtn = document.getElementById('merge-submit-btn');
  const statusId = 'merge-status';

  /**
   * @type {Array<{ id: string, file: File, pageCount: number|null, error: string|null }>}
   */
  let fileQueue = [];
  let isProcessing = false;
  let idCounter = 0;

  /**
   * Reads the PDF page count using pdf-lib so users see exact page totals before merging.
   * @param {File} file
   * @returns {Promise<{ pageCount: number|null, error: string|null }>}
   */
  async function inspectPdfFile(file) {
    if (!window.PDFLib) {
      return { pageCount: null, error: null };
    }
    let buffer = null;
    try {
      buffer = await file.arrayBuffer();
      const pdfDoc = await window.PDFLib.PDFDocument.load(buffer, {
        updateMetadata: false
      });
      const count = pdfDoc.getPageCount();
      buffer = null;
      return { pageCount: count, error: null };
    } catch (err) {
      buffer = null;
      const msg = err && err.message ? err.message : 'Unable to read PDF';
      if (/encrypted/i.test(msg)) {
        return { pageCount: null, error: 'Password-protected / encrypted PDF' };
      }
      return { pageCount: null, error: 'Corrupted or invalid PDF file' };
    }
  }

  /**
   * Adds newly selected PDF files to the merge queue and inspects their page counts.
   * @param {File[]} files
   */
  async function handleIncomingFiles(files) {
    if (isProcessing || !files || files.length === 0) return;
    Utils.clearStatus(statusId);

    for (const file of files) {
      idCounter += 1;
      const entry = {
        id: `pdf-item-${Date.now()}-${idCounter}`,
        file,
        pageCount: null,
        error: null
      };
      fileQueue.push(entry);
      renderQueue();

      const info = await inspectPdfFile(file);
      entry.pageCount = info.pageCount;
      entry.error = info.error;
      renderQueue();
    }

    const invalidEntries = fileQueue.filter((item) => item.error);
    if (invalidEntries.length > 0) {
      Utils.showStatus(
        statusId,
        `One or more files cannot be merged (${invalidEntries[0].file.name}: ${invalidEntries[0].error}). Please remove invalid files before merging.`,
        'warning'
      );
    } else if (fileQueue.length === 1) {
      Utils.showStatus(
        statusId,
        'Add at least one more PDF file so you have 2 or more files to merge.',
        'info'
      );
    }
  }

  /**
   * Renders the reorderable file queue list and updates totals/button states.
   */
  function renderQueue() {
    if (!queuePanel || !fileListEl) return;

    if (fileQueue.length === 0) {
      queuePanel.hidden = true;
      fileListEl.innerHTML = '';
      submitBtn.disabled = true;
      return;
    }

    queuePanel.hidden = false;

    const totalPages = fileQueue.reduce((acc, item) => acc + (item.pageCount || 0), 0);
    const totalBytes = fileQueue.reduce((acc, item) => acc + (item.file.size || 0), 0);

    if (fileCountEl) {
      fileCountEl.textContent = `${fileQueue.length} file${fileQueue.length === 1 ? '' : 's'} • ${totalPages} page${totalPages === 1 ? '' : 's'} (${Utils.formatFileSize(totalBytes)})`;
    }

    fileListEl.innerHTML = fileQueue
      .map((item, idx) => {
        const isFirst = idx === 0;
        const isLast = idx === fileQueue.length - 1;
        let metaText = Utils.formatFileSize(item.file.size);
        if (item.error) {
          metaText += ` • ${Utils.escapeHtml(item.error)}`;
        } else if (typeof item.pageCount === 'number') {
          metaText += ` • ${item.pageCount} page${item.pageCount === 1 ? '' : 's'}`;
        } else {
          metaText += ' • Inspecting...';
        }

        return `
          <li class="file-item" data-id="${item.id}">
            <div class="file-item-info">
              <span class="file-item-index">${idx + 1}</span>
              <div class="file-item-details">
                <div class="file-item-name" title="${Utils.escapeHtml(item.file.name)}">
                  ${Utils.escapeHtml(item.file.name)}
                </div>
                <div class="file-item-meta">${metaText}</div>
              </div>
            </div>
            <div class="file-item-actions">
              <button
                type="button"
                class="icon-btn"
                data-action="up"
                data-index="${idx}"
                title="Move up"
                aria-label="Move ${Utils.escapeHtml(item.file.name)} up"
                ${isFirst || isProcessing ? 'disabled' : ''}
              >↑</button>
              <button
                type="button"
                class="icon-btn"
                data-action="down"
                data-index="${idx}"
                title="Move down"
                aria-label="Move ${Utils.escapeHtml(item.file.name)} down"
                ${isLast || isProcessing ? 'disabled' : ''}
              >↓</button>
              <button
                type="button"
                class="icon-btn danger"
                data-action="remove"
                data-index="${idx}"
                title="Remove file"
                aria-label="Remove ${Utils.escapeHtml(item.file.name)}"
                ${isProcessing ? 'disabled' : ''}
              >✕</button>
            </div>
          </li>
        `;
      })
      .join('');

    const hasErrors = fileQueue.some((item) => Boolean(item.error));
    const stillInspecting = fileQueue.some((item) => item.pageCount === null && !item.error);
    submitBtn.disabled = isProcessing || fileQueue.length < 2 || hasErrors || stillInspecting;
  }

  /**
   * Moves an item in fileQueue from `fromIdx` to `toIdx`.
   */
  function moveItem(fromIdx, toIdx) {
    if (toIdx < 0 || toIdx >= fileQueue.length) return;
    const [moved] = fileQueue.splice(fromIdx, 1);
    fileQueue.splice(toIdx, 0, moved);
    renderQueue();
  }

  /**
   * Removes an item at `idx`.
   */
  function removeItem(idx) {
    if (idx < 0 || idx >= fileQueue.length) return;
    fileQueue.splice(idx, 1);
    Utils.clearStatus(statusId);
    renderQueue();
  }

  /**
   * Combines all queued PDFs in sequence using pdf-lib and downloads the merged PDF.
   */
  async function mergeQueuedPdfs() {
    if (isProcessing || fileQueue.length < 2) return;
    if (!window.PDFLib) {
      Utils.showStatus(statusId, 'PDF library failed to load. Please check your internet connection.', 'error');
      return;
    }

    isProcessing = true;
    renderQueue();
    const originalBtnHtml = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Merging PDFs...</span>';
    Utils.showStatus(statusId, `Merging ${fileQueue.length} PDF documents locally...`, 'loading');

    try {
      const { PDFDocument } = window.PDFLib;
      const mergedPdf = await PDFDocument.create();

      for (let i = 0; i < fileQueue.length; i++) {
        const entry = fileQueue[i];
        let arrayBuffer = await entry.file.arrayBuffer();
        const sourcePdf = await PDFDocument.load(arrayBuffer);
        const copiedPages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
        copiedPages.forEach((page) => mergedPdf.addPage(page));
        // Release buffer reference immediately for client-side memory hygiene
        arrayBuffer = null;
      }

      const mergedBytes = await mergedPdf.save();
      const rawName = (outputNameInput && outputNameInput.value.trim()) || 'merged-document.pdf';
      const finalName = rawName.toLowerCase().endsWith('.pdf') ? rawName : `${rawName}.pdf`;

      Utils.downloadBlob(mergedBytes, finalName, 'application/pdf');
      Utils.showStatus(
        statusId,
        `Success! Merged ${fileQueue.length} files (${mergedPdf.getPageCount()} pages, ${Utils.formatFileSize(mergedBytes.byteLength)}) into "${finalName}".`,
        'success'
      );
    } catch (err) {
      console.error('Merge PDF error:', err);
      Utils.showStatus(
        statusId,
        `Failed to merge PDFs: ${err && err.message ? err.message : 'An unexpected error occurred.'}`,
        'error'
      );
    } finally {
      isProcessing = false;
      submitBtn.innerHTML = originalBtnHtml;
      renderQueue();
    }
  }

  // Initialize dropzone
  Utils.initDropzone({
    dropzoneId: 'merge-dropzone',
    fileInputId: 'merge-file-input',
    acceptExtensions: ['.pdf', 'application/pdf'],
    multiple: true,
    statusId,
    onFiles: handleIncomingFiles
  });

  // Delegated click handler for Up / Down / Remove buttons
  if (fileListEl) {
    fileListEl.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn || isProcessing) return;
      const action = btn.getAttribute('data-action');
      const index = parseInt(btn.getAttribute('data-index'), 10);
      if (Number.isNaN(index)) return;

      if (action === 'up') moveItem(index, index - 1);
      else if (action === 'down') moveItem(index, index + 1);
      else if (action === 'remove') removeItem(index);
    });
  }

  if (addMoreBtn && fileInput) {
    addMoreBtn.addEventListener('click', () => {
      if (!isProcessing) fileInput.click();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (isProcessing) return;
      fileQueue = [];
      Utils.clearStatus(statusId);
      renderQueue();
    });
  }

  if (submitBtn) {
    submitBtn.addEventListener('click', mergeQueuedPdfs);
  }
})();
