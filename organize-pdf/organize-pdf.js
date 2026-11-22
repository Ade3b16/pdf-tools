/**
 * Organize PDF Tool (organize-pdf/organize-pdf.js)
 * Renders page thumbnails via pdfjs-dist so users can visually reorder, rotate,
 * duplicate, or delete individual pages before exporting via pdf-lib.
 */
(function () {
  'use strict';

  const Utils = window.PDFToolUtils;
  if (!Utils) {
    console.error('Organize PDF: window.PDFToolUtils is not loaded.');
    return;
  }

  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  }

  const fileInput = document.getElementById('org-file-input');
  const gridPanel = document.getElementById('org-grid-panel');
  const fileNameEl = document.getElementById('org-file-name');
  const pageCountEl = document.getElementById('org-page-count');
  const reverseBtn = document.getElementById('org-reverse-btn');
  const resetBtn = document.getElementById('org-reset-btn');
  const changeFileBtn = document.getElementById('org-change-file-btn');
  const thumbnailGrid = document.getElementById('org-thumbnail-grid');
  const submitBtn = document.getElementById('org-submit-btn');
  const statusId = 'org-status';

  /** @type {File|null} */
  let currentFile = null;
  /** @type {string[]} Data URLs indexed by original 0-based page index */
  let thumbDataUrls = [];
  /**
   * Active page items list
   * @type {Array<{ uid: string, origIndex: number, extraRotation: number }>}
   */
  let pageItems = [];
  let isProcessing = false;
  let uidCounter = 0;

  /**
   * Resets `pageItems` back to the original 1..N page sequence.
   */
  function resetToOriginalOrder() {
    pageItems = thumbDataUrls.map((_, idx) => {
      uidCounter += 1;
      return {
        uid: `p-${uidCounter}`,
        origIndex: idx,
        extraRotation: 0
      };
    });
    renderThumbnailGrid();
  }

  /**
   * Renders the interactive grid of page cards.
   */
  function renderThumbnailGrid() {
    if (!thumbnailGrid) return;
    if (pageCountEl) {
      pageCountEl.textContent = `${pageItems.length} page${pageItems.length === 1 ? '' : 's'}`;
    }

    const canDelete = pageItems.length > 1;

    thumbnailGrid.innerHTML = pageItems
      .map((item, idx) => {
        const isFirst = idx === 0;
        const isLast = idx === pageItems.length - 1;
        const thumbSrc = thumbDataUrls[item.origIndex] || '';
        const rotLabel = item.extraRotation ? ` (+${item.extraRotation}°)` : '';

        return `
          <div class="thumbnail-card" data-uid="${item.uid}">
            <div class="thumbnail-canvas-wrap">
              <img
                src="${thumbSrc}"
                alt="Page ${item.origIndex + 1} thumbnail"
                style="transform: rotate(${item.extraRotation}deg); transition: transform 150ms ease;"
              />
            </div>
            <div class="thumbnail-badge">
              #${idx + 1} <span style="font-weight: 400; color: var(--pdf-text-light);">(Orig. P${item.origIndex + 1}${rotLabel})</span>
            </div>
            <div class="thumbnail-actions">
              <button
                type="button"
                class="icon-btn"
                data-action="left"
                data-index="${idx}"
                title="Move earlier"
                aria-label="Move page ${idx + 1} earlier"
                ${isFirst || isProcessing ? 'disabled' : ''}
              >←</button>
              <button
                type="button"
                class="icon-btn"
                data-action="rotate"
                data-index="${idx}"
                title="Rotate 90° clockwise"
                aria-label="Rotate page ${idx + 1} 90 degrees"
                ${isProcessing ? 'disabled' : ''}
              >↻</button>
              <button
                type="button"
                class="icon-btn"
                data-action="duplicate"
                data-index="${idx}"
                title="Duplicate page"
                aria-label="Duplicate page ${idx + 1}"
                ${isProcessing ? 'disabled' : ''}
              >⧉</button>
              <button
                type="button"
                class="icon-btn danger"
                data-action="delete"
                data-index="${idx}"
                title="Delete page"
                aria-label="Delete page ${idx + 1}"
                ${!canDelete || isProcessing ? 'disabled' : ''}
              >✕</button>
              <button
                type="button"
                class="icon-btn"
                data-action="right"
                data-index="${idx}"
                title="Move later"
                aria-label="Move page ${idx + 1} later"
                ${isLast || isProcessing ? 'disabled' : ''}
              >→</button>
            </div>
          </div>
        `;
      })
      .join('');

    if (submitBtn) {
      submitBtn.disabled = isProcessing || pageItems.length === 0;
    }
  }

  /**
   * Loads the selected PDF and generates lightweight thumbnail data URLs via pdfjs-dist,
   * cleaning up each off-screen <canvas> immediately.
   * @param {File[]} files
   */
  async function handleFileSelect(files) {
    if (isProcessing || !files || files.length === 0) return;
    if (!window.pdfjsLib) {
      Utils.showStatus(statusId, 'PDF.js library failed to load.', 'error');
      return;
    }

    const file = files[0];
    isProcessing = true;
    Utils.showStatus(statusId, `Loading "${file.name}" and generating page thumbnails...`, 'loading');

    let buffer = null;
    let pdfDoc = null;
    try {
      buffer = await file.arrayBuffer();
      const loadingTask = window.pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
      pdfDoc = await loadingTask.promise;
      const numPages = pdfDoc.numPages;

      thumbDataUrls = [];
      for (let p = 1; p <= numPages; p++) {
        Utils.showStatus(statusId, `Rendering thumbnail ${p} of ${numPages}...`, 'loading');
        const page = await pdfDoc.getPage(p);
        const baseVp = page.getViewport({ scale: 1 });
        const scale = Math.min(1.0, 220 / Math.max(baseVp.width, baseVp.height));
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        await page.render({ canvasContext: ctx, viewport }).promise;
        thumbDataUrls.push(canvas.toDataURL('image/jpeg', 0.78));
        Utils.cleanupCanvas(canvas);
        page.cleanup();
      }

      currentFile = file;
      if (fileNameEl) fileNameEl.textContent = file.name;
      if (gridPanel) gridPanel.hidden = false;
      isProcessing = false;
      resetToOriginalOrder();

      Utils.showStatus(
        statusId,
        `Loaded ${numPages} page thumbnail(s). Reorder, rotate, duplicate, or delete pages below.`,
        'info'
      );
    } catch (err) {
      isProcessing = false;
      currentFile = null;
      thumbDataUrls = [];
      pageItems = [];
      if (gridPanel) gridPanel.hidden = true;
      Utils.showStatus(
        statusId,
        `Could not open PDF: ${err && err.message ? err.message : 'Invalid file.'}`,
        'error'
      );
    } finally {
      if (pdfDoc) {
        try {
          await pdfDoc.destroy();
        } catch (_e) {}
      }
      buffer = null;
    }
  }

  /**
   * Builds the new PDF in the exact visual page sequence and rotation state.
   */
  async function saveOrganizedPdf() {
    if (isProcessing || !currentFile || pageItems.length === 0) return;
    if (!window.PDFLib) {
      Utils.showStatus(statusId, 'pdf-lib is not loaded.', 'error');
      return;
    }

    isProcessing = true;
    renderThumbnailGrid();
    const originalBtnHtml = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Building PDF...</span>';
    Utils.showStatus(statusId, `Assembling ${pageItems.length} organized page(s)...`, 'loading');

    let buffer = null;
    try {
      const { PDFDocument, degrees } = window.PDFLib;
      buffer = await currentFile.arrayBuffer();
      const sourcePdf = await PDFDocument.load(buffer);
      const outPdf = await PDFDocument.create();

      const indicesToCopy = pageItems.map((item) => item.origIndex);
      const copiedPages = await outPdf.copyPages(sourcePdf, indicesToCopy);

      copiedPages.forEach((page, idx) => {
        const extraRot = pageItems[idx].extraRotation || 0;
        if (extraRot !== 0) {
          const currentAngle = page.getRotation().angle || 0;
          page.setRotation(degrees((currentAngle + extraRot) % 360));
        }
        outPdf.addPage(page);
      });

      const outBytes = await outPdf.save();
      const baseName = Utils.getBaseFilename(currentFile.name, 'document');
      const outName = `${baseName}-organized.pdf`;

      Utils.downloadBlob(outBytes, outName, 'application/pdf');
      Utils.showStatus(
        statusId,
        `Saved organized PDF with ${pageItems.length} page(s) as "${outName}" (${Utils.formatFileSize(outBytes.byteLength)}).`,
        'success'
      );
    } catch (err) {
      console.error('Organize PDF error:', err);
      Utils.showStatus(
        statusId,
        `Failed to save organized PDF: ${err && err.message ? err.message : 'Unexpected error.'}`,
        'error'
      );
    } finally {
      buffer = null;
      isProcessing = false;
      submitBtn.innerHTML = originalBtnHtml;
      renderThumbnailGrid();
    }
  }

  Utils.initDropzone({
    dropzoneId: 'org-dropzone',
    fileInputId: 'org-file-input',
    acceptExtensions: ['.pdf', 'application/pdf'],
    multiple: false,
    statusId,
    onFiles: handleFileSelect
  });

  if (thumbnailGrid) {
    thumbnailGrid.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn || isProcessing) return;
      const action = btn.getAttribute('data-action');
      const idx = parseInt(btn.getAttribute('data-index'), 10);
      if (Number.isNaN(idx) || idx < 0 || idx >= pageItems.length) return;

      if (action === 'left' && idx > 0) {
        const [moved] = pageItems.splice(idx, 1);
        pageItems.splice(idx - 1, 0, moved);
      } else if (action === 'right' && idx < pageItems.length - 1) {
        const [moved] = pageItems.splice(idx, 1);
        pageItems.splice(idx + 1, 0, moved);
      } else if (action === 'rotate') {
        pageItems[idx].extraRotation = (pageItems[idx].extraRotation + 90) % 360;
      } else if (action === 'duplicate') {
        uidCounter += 1;
        pageItems.splice(idx + 1, 0, {
          uid: `p-${uidCounter}`,
          origIndex: pageItems[idx].origIndex,
          extraRotation: pageItems[idx].extraRotation
        });
      } else if (action === 'delete' && pageItems.length > 1) {
        pageItems.splice(idx, 1);
      }
      renderThumbnailGrid();
    });
  }

  if (reverseBtn) {
    reverseBtn.addEventListener('click', () => {
      if (isProcessing) return;
      pageItems.reverse();
      renderThumbnailGrid();
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (isProcessing) return;
      resetToOriginalOrder();
    });
  }

  if (changeFileBtn && fileInput) {
    changeFileBtn.addEventListener('click', () => {
      if (!isProcessing) fileInput.click();
    });
  }

  if (submitBtn) {
    submitBtn.addEventListener('click', saveOrganizedPdf);
  }
})();
