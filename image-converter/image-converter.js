/**
 * Image Format Converter Tool (image-converter/image-converter.js)
 * Batch-converts and optionally resizes images between WebP, PNG, and JPG locally
 * via HTML5 <canvas>, downloading a single image or a .zip bundle via JSZip.
 */
(function () {
  'use strict';

  const Utils = window.PDFToolUtils;
  if (!Utils) {
    console.error('Image Converter: window.PDFToolUtils is not loaded.');
    return;
  }

  const fileInput = document.getElementById('imgconv-file-input');
  const configPanel = document.getElementById('imgconv-config-panel');
  const countBadge = document.getElementById('imgconv-count-badge');
  const listEl = document.getElementById('imgconv-list');
  const addMoreBtn = document.getElementById('imgconv-add-more-btn');
  const clearBtn = document.getElementById('imgconv-clear-btn');
  const formatSelect = document.getElementById('imgconv-format');
  const qualityGroup = document.getElementById('imgconv-quality-group');
  const qualityInput = document.getElementById('imgconv-quality');
  const qualityBadge = document.getElementById('imgconv-quality-badge');
  const resizeSelect = document.getElementById('imgconv-resize');
  const submitBtn = document.getElementById('imgconv-submit-btn');
  const statusId = 'imgconv-status';

  /**
   * @type {Array<{ id: string, file: File, width: number, height: number }>}
   */
  let imageQueue = [];
  let isProcessing = false;
  let idCounter = 0;

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

  function computeTargetSize(origW, origH, resizeMode) {
    if (resizeMode === 'scale-50') {
      return {
        width: Math.max(1, Math.round(origW * 0.5)),
        height: Math.max(1, Math.round(origH * 0.5))
      };
    }
    const maxDim = resizeMode === 'max-1920' ? 1920 : resizeMode === 'max-1280' ? 1280 : 0;
    if (maxDim > 0 && (origW > maxDim || origH > maxDim)) {
      const ratio = Math.min(maxDim / origW, maxDim / origH);
      return {
        width: Math.max(1, Math.round(origW * ratio)),
        height: Math.max(1, Math.round(origH * ratio))
      };
    }
    return { width: origW, height: origH };
  }

  async function handleIncomingFiles(files) {
    if (isProcessing || !files || files.length === 0) return;
    Utils.clearStatus(statusId);

    for (const file of files) {
      try {
        const img = await loadImageElement(file);
        idCounter += 1;
        imageQueue.push({
          id: `ic-${Date.now()}-${idCounter}`,
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

  async function convertSingleImage(entry, mimeType, quality, resizeMode) {
    const img = await loadImageElement(entry.file);
    const origW = img.naturalWidth || img.width || 1;
    const origH = img.naturalHeight || img.height || 1;
    const { width, height } = computeTargetSize(origW, origH, resizeMode);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    if (mimeType === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));
    Utils.cleanupCanvas(canvas);
    if (!blob) {
      throw new Error(`Failed to convert "${entry.file.name}".`);
    }
    return blob;
  }

  async function executeBatchConversion() {
    if (isProcessing || imageQueue.length === 0) return;

    const format = formatSelect ? formatSelect.value : 'jpeg';
    const mimeType = format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg';
    const ext = format === 'png' ? 'png' : format === 'webp' ? 'webp' : 'jpg';
    const quality = (parseInt(qualityInput ? qualityInput.value : '90', 10) || 90) / 100;
    const resizeMode = resizeSelect ? resizeSelect.value : 'original';

    isProcessing = true;
    renderQueue();
    const originalBtnHtml = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Converting...</span>';

    try {
      if (imageQueue.length === 1) {
        const entry = imageQueue[0];
        Utils.showStatus(statusId, `Converting "${entry.file.name}" to ${ext.toUpperCase()}...`, 'loading');
        const outBlob = await convertSingleImage(entry, mimeType, quality, resizeMode);
        const baseName = Utils.getBaseFilename(entry.file.name, 'image');
        const outName = `${baseName}.${ext}`;

        Utils.downloadBlob(outBlob, outName, mimeType);
        Utils.showStatus(
          statusId,
          `Converted "${entry.file.name}" to "${outName}" (${Utils.formatFileSize(outBlob.size)}).`,
          'success'
        );
      } else {
        if (!window.JSZip) {
          throw new Error('JSZip library failed to load.');
        }
        const zip = new window.JSZip();
        const usedNames = new Set();

        for (let i = 0; i < imageQueue.length; i++) {
          const entry = imageQueue[i];
          Utils.showStatus(
            statusId,
            `Converting image ${i + 1} of ${imageQueue.length} ("${entry.file.name}")...`,
            'loading'
          );
          const outBlob = await convertSingleImage(entry, mimeType, quality, resizeMode);
          const baseName = Utils.getBaseFilename(entry.file.name, `image-${i + 1}`);
          let outName = `${baseName}.${ext}`;
          if (usedNames.has(outName.toLowerCase())) {
            outName = `${baseName}-${i + 1}.${ext}`;
          }
          usedNames.add(outName.toLowerCase());
          zip.file(outName, outBlob);
        }

        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const zipName = `converted-${ext}-images.zip`;
        Utils.downloadBlob(zipBlob, zipName, 'application/zip');
        Utils.showStatus(
          statusId,
          `Converted ${imageQueue.length} images to ${ext.toUpperCase()} inside "${zipName}" (${Utils.formatFileSize(zipBlob.size)}).`,
          'success'
        );
      }
    } catch (err) {
      console.error('Image Converter error:', err);
      Utils.showStatus(
        statusId,
        `Conversion failed: ${err && err.message ? err.message : 'Unexpected error.'}`,
        'error'
      );
    } finally {
      isProcessing = false;
      submitBtn.innerHTML = originalBtnHtml;
      renderQueue();
    }
  }

  Utils.initDropzone({
    dropzoneId: 'imgconv-dropzone',
    fileInputId: 'imgconv-file-input',
    acceptExtensions: ['.webp', '.png', '.jpg', '.jpeg', 'image/webp', 'image/png', 'image/jpeg'],
    multiple: true,
    statusId,
    onFiles: handleIncomingFiles
  });

  if (listEl) {
    listEl.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action="remove"]');
      if (!btn || isProcessing) return;
      const idx = parseInt(btn.getAttribute('data-index'), 10);
      if (!Number.isNaN(idx) && idx >= 0 && idx < imageQueue.length) {
        imageQueue.splice(idx, 1);
        renderQueue();
      }
    });
  }

  if (formatSelect && qualityGroup) {
    formatSelect.addEventListener('change', () => {
      qualityGroup.hidden = formatSelect.value === 'png';
    });
  }

  if (qualityInput && qualityBadge) {
    qualityInput.addEventListener('input', () => {
      qualityBadge.textContent = `${qualityInput.value}%`;
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
    submitBtn.addEventListener('click', executeBatchConversion);
  }
})();
