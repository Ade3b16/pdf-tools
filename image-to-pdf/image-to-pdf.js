/**
 * JPG / PNG / WebP to PDF Tool (image-to-pdf/image-to-pdf.js)
 * Normalizes uploaded images via HTML5 <canvas> and embeds them onto auto-sized
 * or standard A4 / US Letter PDF pages using pdf-lib.
 */
(function () {
  'use strict';

  const Utils = window.PDFToolUtils;
  if (!Utils) {
    console.error('Image to PDF: window.PDFToolUtils is not loaded.');
    return;
  }

  const fileInput = document.getElementById('img2pdf-file-input');
  const configPanel = document.getElementById('img2pdf-config-panel');
  const countBadge = document.getElementById('img2pdf-count-badge');
  const listEl = document.getElementById('img2pdf-list');
  const addMoreBtn = document.getElementById('img2pdf-add-more-btn');
  const clearBtn = document.getElementById('img2pdf-clear-btn');
  const pageSizeSelect = document.getElementById('img2pdf-page-size');
  const orientationSelect = document.getElementById('img2pdf-orientation');
  const marginSelect = document.getElementById('img2pdf-margin');
  const outputNameInput = document.getElementById('img2pdf-output-name');
  const submitBtn = document.getElementById('img2pdf-submit-btn');
  const statusId = 'img2pdf-status';

  const PAGE_PRESETS = {
    a4: { width: 595.28, height: 841.89 },
    letter: { width: 612, height: 792 }
  };

  /**
   * @type {Array<{ id: string, file: File, width: number, height: number }>}
   */
  let imageQueue = [];
  let isProcessing = false;
  let idSeq = 0;

  /**
   * Loads a File into an HTMLImageElement to read its natural dimensions or render to canvas.
   * @param {File} file
   * @returns {Promise<HTMLImageElement>}
   */
  function loadImageElement(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(`Unable to decode image "${file.name}".`));
      };
      img.src = url;
    });
  }

  /**
   * Normalizes an image file into PNG or JPEG ArrayBuffer via <canvas> so WebP and
   * EXIF-rotated images embed cleanly into pdf-lib.
   * @param {File} file
   * @returns {Promise<{ bytes: ArrayBuffer, isPng: boolean, width: number, height: number }>}
   */
  async function normalizeImageBytes(file) {
    const img = await loadImageElement(file);
    const width = img.naturalWidth || img.width || 1;
    const height = img.naturalHeight || img.height || 1;
    const isPng = (file.type || '').toLowerCase() === 'image/png' || file.name.toLowerCase().endsWith('.png');

    // Direct fast path for standard JPEG/PNG when possible, fallback or WebP via canvas
    const isWebP = (file.type || '').toLowerCase() === 'image/webp' || file.name.toLowerCase().endsWith('.webp');
    if (!isWebP && ((file.type || '').toLowerCase() === 'image/jpeg' || isPng)) {
      const rawBuffer = await file.arrayBuffer();
      return { bytes: rawBuffer, isPng, width, height };
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!isPng) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(img, 0, 0, width, height);

    const outMime = isPng ? 'image/png' : 'image/jpeg';
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, outMime, 0.92));
    Utils.cleanupCanvas(canvas);
    if (!blob) {
      throw new Error(`Failed to convert "${file.name}" via canvas.`);
    }
    const bytes = await blob.arrayBuffer();
    return { bytes, isPng, width, height };
  }

  /**
   * Handles incoming image files from dropzone or file input.
   * @param {File[]} files
   */
  async function handleIncomingImages(files) {
    if (isProcessing || !files || files.length === 0) return;
    Utils.clearStatus(statusId);

    for (const file of files) {
      try {
        const img = await loadImageElement(file);
        idSeq += 1;
        imageQueue.push({
          id: `img-${Date.now()}-${idSeq}`,
          file,
          width: img.naturalWidth || img.width,
          height: img.naturalHeight || img.height
        });
      } catch (err) {
        Utils.showStatus(statusId, err.message, 'warning');
      }
    }
    renderQueue();
  }

  /**
   * Renders the ordered image queue and updates controls.
   */
  function renderQueue() {
    if (!configPanel || !listEl) return;

    if (imageQueue.length === 0) {
      configPanel.hidden = true;
      listEl.innerHTML = '';
      submitBtn.disabled = true;
      return;
    }

    configPanel.hidden = false;
    const totalBytes = imageQueue.reduce((sum, item) => sum + (item.file.size || 0), 0);
    if (countBadge) {
      countBadge.textContent = `${imageQueue.length} image${imageQueue.length === 1 ? '' : 's'} (${Utils.formatFileSize(totalBytes)})`;
    }

    listEl.innerHTML = imageQueue
      .map((item, idx) => {
        const isFirst = idx === 0;
        const isLast = idx === imageQueue.length - 1;
        const ext = (item.file.name.split('.').pop() || 'IMG').toUpperCase();
        return `
          <li class="file-item" data-id="${item.id}">
            <div class="file-item-info">
              <span class="file-item-index">${idx + 1}</span>
              <div class="file-item-details">
                <div class="file-item-name" title="${Utils.escapeHtml(item.file.name)}">
                  ${Utils.escapeHtml(item.file.name)}
                </div>
                <div class="file-item-meta">
                  ${ext} • ${item.width} × ${item.height} px • ${Utils.formatFileSize(item.file.size)}
                </div>
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
                title="Remove image"
                aria-label="Remove ${Utils.escapeHtml(item.file.name)}"
                ${isProcessing ? 'disabled' : ''}
              >✕</button>
            </div>
          </li>
        `;
      })
      .join('');

    submitBtn.disabled = isProcessing || imageQueue.length === 0;
  }

  function moveItem(fromIdx, toIdx) {
    if (toIdx < 0 || toIdx >= imageQueue.length) return;
    const [moved] = imageQueue.splice(fromIdx, 1);
    imageQueue.splice(toIdx, 0, moved);
    renderQueue();
  }

  function removeItem(idx) {
    if (idx < 0 || idx >= imageQueue.length) return;
    imageQueue.splice(idx, 1);
    renderQueue();
  }

  /**
   * Builds the PDF from queued images and triggers download.
   */
  async function convertImagesToPdf() {
    if (isProcessing || imageQueue.length === 0) return;
    if (!window.PDFLib) {
      Utils.showStatus(statusId, 'pdf-lib is not loaded.', 'error');
      return;
    }

    isProcessing = true;
    renderQueue();
    const originalBtnHtml = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Building PDF...</span>';

    try {
      const { PDFDocument } = window.PDFLib;
      const pdfDoc = await PDFDocument.create();
      const pageSizeKey = pageSizeSelect ? pageSizeSelect.value : 'fit';
      const orientationKey = orientationSelect ? orientationSelect.value : 'auto';
      const marginPt = parseInt(marginSelect ? marginSelect.value : '0', 10) || 0;

      for (let i = 0; i < imageQueue.length; i++) {
        const entry = imageQueue[i];
        Utils.showStatus(
          statusId,
          `Embedding image ${i + 1} of ${imageQueue.length} ("${entry.file.name}")...`,
          'loading'
        );

        let normalized = await normalizeImageBytes(entry.file);
        let embeddedImg;
        try {
          embeddedImg = normalized.isPng
            ? await pdfDoc.embedPng(normalized.bytes)
            : await pdfDoc.embedJpg(normalized.bytes);
        } catch (_embedErr) {
          // Fallback: force canvas JPEG re-encode if file extension mismatched actual header
          const img = await loadImageElement(entry.file);
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || 1;
          canvas.height = img.naturalHeight || 1;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);
          const jpgBlob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
          Utils.cleanupCanvas(canvas);
          const jpgBuf = await jpgBlob.arrayBuffer();
          embeddedImg = await pdfDoc.embedJpg(jpgBuf);
        }
        normalized = null;

        const imgW = embeddedImg.width;
        const imgH = embeddedImg.height;

        if (pageSizeKey === 'fit') {
          const pageW = imgW + marginPt * 2;
          const pageH = imgH + marginPt * 2;
          const page = pdfDoc.addPage([pageW, pageH]);
          page.drawImage(embeddedImg, {
            x: marginPt,
            y: marginPt,
            width: imgW,
            height: imgH
          });
        } else {
          const preset = PAGE_PRESETS[pageSizeKey] || PAGE_PRESETS.a4;
          let pageW = preset.width;
          let pageH = preset.height;

          const wantLandscape =
            orientationKey === 'landscape' ||
            (orientationKey === 'auto' && imgW > imgH);

          if (wantLandscape && pageW < pageH) {
            [pageW, pageH] = [pageH, pageW];
          } else if (!wantLandscape && pageW > pageH) {
            [pageW, pageH] = [pageH, pageW];
          }

          const availW = Math.max(20, pageW - marginPt * 2);
          const availH = Math.max(20, pageH - marginPt * 2);
          const scale = Math.min(availW / imgW, availH / imgH);
          const drawW = imgW * scale;
          const drawH = imgH * scale;
          const drawX = (pageW - drawW) / 2;
          const drawY = (pageH - drawH) / 2;

          const page = pdfDoc.addPage([pageW, pageH]);
          page.drawImage(embeddedImg, {
            x: drawX,
            y: drawY,
            width: drawW,
            height: drawH
          });
        }
      }

      const pdfBytes = await pdfDoc.save();
      const rawName = (outputNameInput && outputNameInput.value.trim()) || 'images-converted.pdf';
      const outName = rawName.toLowerCase().endsWith('.pdf') ? rawName : `${rawName}.pdf`;

      Utils.downloadBlob(pdfBytes, outName, 'application/pdf');
      Utils.showStatus(
        statusId,
        `Converted ${imageQueue.length} image(s) into "${outName}" (${Utils.formatFileSize(pdfBytes.byteLength)}).`,
        'success'
      );
    } catch (err) {
      console.error('Image to PDF error:', err);
      Utils.showStatus(
        statusId,
        `Failed to convert images: ${err && err.message ? err.message : 'Unexpected error.'}`,
        'error'
      );
    } finally {
      isProcessing = false;
      submitBtn.innerHTML = originalBtnHtml;
      renderQueue();
    }
  }

  Utils.initDropzone({
    dropzoneId: 'img2pdf-dropzone',
    fileInputId: 'img2pdf-file-input',
    acceptExtensions: ['.jpg', '.jpeg', '.png', '.webp', 'image/jpeg', 'image/png', 'image/webp'],
    multiple: true,
    statusId,
    onFiles: handleIncomingImages
  });

  if (listEl) {
    listEl.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn || isProcessing) return;
      const action = btn.getAttribute('data-action');
      const idx = parseInt(btn.getAttribute('data-index'), 10);
      if (Number.isNaN(idx)) return;
      if (action === 'up') moveItem(idx, idx - 1);
      else if (action === 'down') moveItem(idx, idx + 1);
      else if (action === 'remove') removeItem(idx);
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
      imageQueue = [];
      Utils.clearStatus(statusId);
      renderQueue();
    });
  }

  if (submitBtn) {
    submitBtn.addEventListener('click', convertImagesToPdf);
  }
})();
