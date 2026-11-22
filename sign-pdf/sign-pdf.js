/**
 * Sign PDF Tool (sign-pdf/sign-pdf.js)
 * Interactive <canvas> signature pad (mouse + touch) + image upload, live page preview
 * with click-to-place positioning via pdfjs-dist, and PDF stamping via pdf-lib.
 */
(function () {
  'use strict';

  const Utils = window.PDFToolUtils;
  if (!Utils) {
    console.error('Sign PDF: window.PDFToolUtils is not loaded.');
    return;
  }

  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  }

  const fileInput = document.getElementById('sign-file-input');
  const configPanel = document.getElementById('sign-config-panel');
  const fileNameEl = document.getElementById('sign-file-name');
  const fileMetaEl = document.getElementById('sign-file-meta');
  const changeFileBtn = document.getElementById('sign-change-file-btn');

  const tabBtns = Array.from(document.querySelectorAll('#pdf-tool-app [data-sign-tab]'));
  const drawPanel = document.getElementById('sign-draw-panel');
  const uploadPanel = document.getElementById('sign-upload-panel');

  const padCanvas = document.getElementById('sign-pad-canvas');
  const inkColorSelect = document.getElementById('sign-ink-color');
  const clearPadBtn = document.getElementById('sign-clear-pad-btn');

  const sigImageInput = document.getElementById('sign-image-input');
  const sigImageStatus = document.getElementById('sign-image-status');

  const pageScopeSelect = document.getElementById('sign-page-scope');
  const positionSelect = document.getElementById('sign-position');
  const scaleInput = document.getElementById('sign-scale');
  const scaleBadge = document.getElementById('sign-scale-badge');

  const prevPageBtn = document.getElementById('sign-prev-page');
  const nextPageBtn = document.getElementById('sign-next-page');
  const pageIndicator = document.getElementById('sign-page-indicator');
  const previewCanvas = document.getElementById('sign-preview-canvas');

  const submitBtn = document.getElementById('sign-submit-btn');
  const statusId = 'sign-status';

  /** @type {File|null} */
  let currentFile = null;
  let pdfJsDoc = null;
  let totalPages = 0;
  let currentPreviewPage = 1;
  let basePageImageData = null;

  let activeTab = 'draw'; // 'draw' | 'upload'
  let hasDrawnStrokes = false;
  let isDrawing = false;
  let lastPoint = { x: 0, y: 0 };

  /** @type {HTMLImageElement|null} */
  let uploadedSigImage = null;

  // Normalized (0..1) custom center coordinates if user clicks directly on preview canvas
  /** @type {{ normX: number, normY: number }|null} */
  let customPlacement = null;
  let isProcessing = false;

  /**
   * Initializes the drawing pad canvas events for mouse and touch pointer events.
   */
  function initSignaturePad() {
    if (!padCanvas) return;
    const ctx = padCanvas.getContext('2d');
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.8;
    ctx.strokeStyle = inkColorSelect ? inkColorSelect.value : '#0f172a';

    function getCanvasCoords(e) {
      const rect = padCanvas.getBoundingClientRect();
      const scaleX = padCanvas.width / (rect.width || 1);
      const scaleY = padCanvas.height / (rect.height || 1);
      const clientX = e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches && e.touches[0] ? e.touches[0].clientY : e.clientY;
      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY
      };
    }

    function startStroke(e) {
      e.preventDefault();
      isDrawing = true;
      hasDrawnStrokes = true;
      ctx.strokeStyle = inkColorSelect ? inkColorSelect.value : '#0f172a';
      lastPoint = getCanvasCoords(e);
      ctx.beginPath();
      ctx.arc(lastPoint.x, lastPoint.y, 1.2, 0, Math.PI * 2);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();
    }

    function moveStroke(e) {
      if (!isDrawing) return;
      e.preventDefault();
      const pt = getCanvasCoords(e);
      ctx.beginPath();
      ctx.moveTo(lastPoint.x, lastPoint.y);
      ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
      lastPoint = pt;
    }

    function endStroke() {
      if (!isDrawing) return;
      isDrawing = false;
      drawPreviewOverlay();
    }

    padCanvas.addEventListener('mousedown', startStroke);
    padCanvas.addEventListener('mousemove', moveStroke);
    window.addEventListener('mouseup', endStroke);

    padCanvas.addEventListener('touchstart', startStroke, { passive: false });
    padCanvas.addEventListener('touchmove', moveStroke, { passive: false });
    padCanvas.addEventListener('touchend', endStroke);
  }

  function clearSignaturePad() {
    if (!padCanvas) return;
    const ctx = padCanvas.getContext('2d');
    ctx.clearRect(0, 0, padCanvas.width, padCanvas.height);
    hasDrawnStrokes = false;
    drawPreviewOverlay();
  }

  /**
   * Computes signature placement box { x, y, width, height } in top-left canvas space
   * for a given container width/height and signature aspect ratio.
   */
  function computeSignatureBoxTopLeft(containerW, containerH, sigAspect) {
    const scalePct = (parseInt(scaleInput ? scaleInput.value : '26', 10) || 26) / 100;
    const boxW = containerW * scalePct;
    const boxH = boxW / (sigAspect || 3.33);
    const margin = Math.max(16, containerW * 0.045);

    if (customPlacement) {
      const x = Math.min(containerW - boxW, Math.max(0, customPlacement.normX * containerW - boxW / 2));
      const y = Math.min(containerH - boxH, Math.max(0, customPlacement.normY * containerH - boxH / 2));
      return { x, y, width: boxW, height: boxH };
    }

    const pos = positionSelect ? positionSelect.value : 'bottom-right';
    let x = containerW - boxW - margin;
    let y = containerH - boxH - margin;

    if (pos === 'bottom-left') {
      x = margin;
      y = containerH - boxH - margin;
    } else if (pos === 'bottom-center') {
      x = (containerW - boxW) / 2;
      y = containerH - boxH - margin;
    } else if (pos === 'center') {
      x = (containerW - boxW) / 2;
      y = (containerH - boxH) / 2;
    } else if (pos === 'top-right') {
      x = containerW - boxW - margin;
      y = margin;
    }

    return { x, y, width: boxW, height: boxH };
  }

  /**
   * Renders the current preview page via pdfjs-dist and caches its ImageData so
   * signature overlay updates are instantaneous.
   */
  async function renderPreviewPage(pageNum) {
    if (!pdfJsDoc || !previewCanvas) return;
    currentPreviewPage = Math.min(totalPages, Math.max(1, pageNum));
    if (pageIndicator) {
      pageIndicator.textContent = `Page ${currentPreviewPage} of ${totalPages}`;
    }
    if (prevPageBtn) prevPageBtn.disabled = currentPreviewPage <= 1;
    if (nextPageBtn) nextPageBtn.disabled = currentPreviewPage >= totalPages;

    const page = await pdfJsDoc.getPage(currentPreviewPage);
    const baseViewport = page.getViewport({ scale: 1 });
    const targetWidth = Math.min(540, baseViewport.width);
    const scale = targetWidth / baseViewport.width;
    const viewport = page.getViewport({ scale });

    previewCanvas.width = Math.floor(viewport.width);
    previewCanvas.height = Math.floor(viewport.height);
    const ctx = previewCanvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);

    await page.render({ canvasContext: ctx, viewport }).promise;
    basePageImageData = ctx.getImageData(0, 0, previewCanvas.width, previewCanvas.height);
    page.cleanup();
    drawPreviewOverlay();
  }

  /**
   * Draws the live signature bounding box and signature preview onto the cached PDF page canvas.
   */
  function drawPreviewOverlay() {
    if (!previewCanvas || !basePageImageData) return;
    const ctx = previewCanvas.getContext('2d');
    ctx.putImageData(basePageImageData, 0, 0);

    let sigSource = null;
    let sigAspect = 600 / 180;

    if (activeTab === 'draw' && hasDrawnStrokes && padCanvas) {
      sigSource = padCanvas;
      sigAspect = padCanvas.width / padCanvas.height;
    } else if (activeTab === 'upload' && uploadedSigImage) {
      sigSource = uploadedSigImage;
      sigAspect = (uploadedSigImage.naturalWidth || 300) / (uploadedSigImage.naturalHeight || 100);
    }

    const box = computeSignatureBoxTopLeft(previewCanvas.width, previewCanvas.height, sigAspect);

    ctx.save();
    ctx.strokeStyle = '#e5322d';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.fillStyle = 'rgba(229, 50, 45, 0.06)';
    ctx.fillRect(box.x, box.y, box.width, box.height);
    ctx.strokeRect(box.x, box.y, box.width, box.height);

    if (sigSource) {
      ctx.drawImage(sigSource, box.x, box.y, box.width, box.height);
    } else {
      ctx.fillStyle = '#b91c1c';
      ctx.font = '600 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Signature Here', box.x + box.width / 2, box.y + box.height / 2);
    }
    ctx.restore();
  }

  /**
   * Loads the selected PDF document for previewing and signing.
   * @param {File[]} files
   */
  async function handlePdfSelect(files) {
    if (isProcessing || !files || files.length === 0) return;
    const file = files[0];
    Utils.showStatus(statusId, `Loading "${file.name}"...`, 'loading');

    if (pdfJsDoc) {
      try {
        await pdfJsDoc.destroy();
      } catch (_e) {}
      pdfJsDoc = null;
    }

    let buffer = null;
    try {
      buffer = await file.arrayBuffer();
      const loadingTask = window.pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
      pdfJsDoc = await loadingTask.promise;
      totalPages = pdfJsDoc.numPages;
      currentFile = file;
      buffer = null;

      if (fileNameEl) fileNameEl.textContent = file.name;
      if (fileMetaEl) {
        fileMetaEl.textContent = `${Utils.formatFileSize(file.size)} • ${totalPages} page${totalPages === 1 ? '' : 's'}`;
      }

      if (configPanel) configPanel.hidden = false;
      customPlacement = null;
      await renderPreviewPage(1);

      Utils.showStatus(
        statusId,
        `Loaded "${file.name}". Draw or upload your signature below, then click on the page preview to position it.`,
        'info'
      );
    } catch (err) {
      buffer = null;
      currentFile = null;
      totalPages = 0;
      if (configPanel) configPanel.hidden = true;
      Utils.showStatus(
        statusId,
        `Could not load PDF: ${err && err.message ? err.message : 'Invalid file.'}`,
        'error'
      );
    }
  }

  /**
   * Exports active signature (from draw pad or uploaded image) as PNG ArrayBuffer + aspect ratio.
   * @returns {Promise<{ pngBytes: ArrayBuffer, aspect: number }>}
   */
  async function getSignaturePngBytes() {
    if (activeTab === 'draw') {
      if (!hasDrawnStrokes || !padCanvas) {
        throw new Error('Please draw your signature on the signature pad first.');
      }
      const blob = await new Promise((resolve) => padCanvas.toBlob(resolve, 'image/png'));
      const pngBytes = await blob.arrayBuffer();
      return { pngBytes, aspect: padCanvas.width / padCanvas.height };
    } else {
      if (!uploadedSigImage) {
        throw new Error('Please upload a signature image first.');
      }
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = uploadedSigImage.naturalWidth || 300;
      tempCanvas.height = uploadedSigImage.naturalHeight || 100;
      const ctx = tempCanvas.getContext('2d');
      ctx.drawImage(uploadedSigImage, 0, 0);
      const blob = await new Promise((resolve) => tempCanvas.toBlob(resolve, 'image/png'));
      const aspect = tempCanvas.width / tempCanvas.height;
      Utils.cleanupCanvas(tempCanvas);
      const pngBytes = await blob.arrayBuffer();
      return { pngBytes, aspect };
    }
  }

  /**
   * Stamps the signature PNG onto the target PDF page(s) using pdf-lib and downloads the signed PDF.
   */
  async function executeSignPdf() {
    if (isProcessing || !currentFile || totalPages < 1) return;
    if (!window.PDFLib) {
      Utils.showStatus(statusId, 'pdf-lib is not loaded.', 'error');
      return;
    }

    let sigData;
    try {
      sigData = await getSignaturePngBytes();
    } catch (validationErr) {
      Utils.showStatus(statusId, validationErr.message, 'error');
      return;
    }

    isProcessing = true;
    submitBtn.disabled = true;
    const originalBtnHtml = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Signing PDF...</span>';

    let buffer = null;
    try {
      const { PDFDocument } = window.PDFLib;
      buffer = await currentFile.arrayBuffer();
      const pdfDoc = await PDFDocument.load(buffer);
      const pages = pdfDoc.getPages();
      const pngImage = await pdfDoc.embedPng(sigData.pngBytes);

      const scope = pageScopeSelect ? pageScopeSelect.value : 'current';
      let targetIndices = [currentPreviewPage - 1];
      if (scope === 'last') {
        targetIndices = [totalPages - 1];
      } else if (scope === 'all') {
        targetIndices = pages.map((_, idx) => idx);
      }

      for (const idx of targetIndices) {
        const page = pages[idx];
        if (!page) continue;
        const { width: pageW, height: pageH } = page.getSize();
        const boxTopLeft = computeSignatureBoxTopLeft(pageW, pageH, sigData.aspect);
        // Convert top-left Y to bottom-left PDF Y coordinate
        const pdfY = pageH - boxTopLeft.y - boxTopLeft.height;

        page.drawImage(pngImage, {
          x: boxTopLeft.x,
          y: pdfY,
          width: boxTopLeft.width,
          height: boxTopLeft.height
        });
      }

      const signedBytes = await pdfDoc.save();
      const baseName = Utils.getBaseFilename(currentFile.name, 'document');
      const outName = `${baseName}-signed.pdf`;

      Utils.downloadBlob(signedBytes, outName, 'application/pdf');
      Utils.showStatus(
        statusId,
        `Signed ${targetIndices.length} page(s) and downloaded "${outName}".`,
        'success'
      );
    } catch (err) {
      console.error('Sign PDF error:', err);
      Utils.showStatus(
        statusId,
        `Failed to sign PDF: ${err && err.message ? err.message : 'Unexpected error.'}`,
        'error'
      );
    } finally {
      buffer = null;
      isProcessing = false;
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnHtml;
    }
  }

  initSignaturePad();

  Utils.initDropzone({
    dropzoneId: 'sign-dropzone',
    fileInputId: 'sign-file-input',
    acceptExtensions: ['.pdf', 'application/pdf'],
    multiple: false,
    statusId,
    onFiles: handlePdfSelect
  });

  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTab = btn.getAttribute('data-sign-tab') === 'upload' ? 'upload' : 'draw';
      tabBtns.forEach((b) => b.classList.toggle('active', b === btn));
      if (drawPanel) drawPanel.hidden = activeTab !== 'draw';
      if (uploadPanel) uploadPanel.hidden = activeTab !== 'upload';
      drawPreviewOverlay();
    });
  });

  if (clearPadBtn) {
    clearPadBtn.addEventListener('click', clearSignaturePad);
  }

  if (sigImageInput) {
    sigImageInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        uploadedSigImage = img;
        if (sigImageStatus) {
          sigImageStatus.textContent = `Loaded "${file.name}" (${img.naturalWidth} × ${img.naturalHeight} px).`;
        }
        drawPreviewOverlay();
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        Utils.showStatus(statusId, 'Could not load signature image.', 'error');
      };
      img.src = url;
    });
  }

  if (positionSelect) {
    positionSelect.addEventListener('change', () => {
      customPlacement = null;
      drawPreviewOverlay();
    });
  }

  if (scaleInput && scaleBadge) {
    scaleInput.addEventListener('input', () => {
      scaleBadge.textContent = `${scaleInput.value}%`;
      drawPreviewOverlay();
    });
  }

  if (previewCanvas) {
    previewCanvas.addEventListener('click', (e) => {
      const rect = previewCanvas.getBoundingClientRect();
      const normX = (e.clientX - rect.left) / (rect.width || 1);
      const normY = (e.clientY - rect.top) / (rect.height || 1);
      customPlacement = {
        normX: Math.min(1, Math.max(0, normX)),
        normY: Math.min(1, Math.max(0, normY))
      };
      drawPreviewOverlay();
    });
  }

  if (prevPageBtn) {
    prevPageBtn.addEventListener('click', () => {
      if (currentPreviewPage > 1) renderPreviewPage(currentPreviewPage - 1);
    });
  }

  if (nextPageBtn) {
    nextPageBtn.addEventListener('click', () => {
      if (currentPreviewPage < totalPages) renderPreviewPage(currentPreviewPage + 1);
    });
  }

  if (changeFileBtn && fileInput) {
    changeFileBtn.addEventListener('click', () => {
      if (!isProcessing) fileInput.click();
    });
  }

  if (submitBtn) {
    submitBtn.addEventListener('click', executeSignPdf);
  }
})();
