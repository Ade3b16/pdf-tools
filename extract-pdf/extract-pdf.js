/**
 * Extract Text & Images Tool (extract-pdf/extract-pdf.js)
 * Extracts selectable text across pages into a previewable & downloadable .txt file
 * or exports rendered page images into a .zip archive via pdfjs-dist + JSZip.
 */
(function () {
  'use strict';

  const Utils = window.PDFToolUtils;
  if (!Utils) {
    console.error('Extract PDF: window.PDFToolUtils is not loaded.');
    return;
  }

  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  }

  const fileInput = document.getElementById('ext-file-input');
  const configPanel = document.getElementById('ext-config-panel');
  const fileNameEl = document.getElementById('ext-file-name');
  const fileMetaEl = document.getElementById('ext-file-meta');
  const changeFileBtn = document.getElementById('ext-change-file-btn');
  const tabBtns = Array.from(document.querySelectorAll('#pdf-tool-app [data-ext-tab]'));
  const rangeInput = document.getElementById('ext-range-input');
  const rangeHint = document.getElementById('ext-range-hint');
  const imgFormatGroup = document.getElementById('ext-img-format-group');
  const imgFormatSelect = document.getElementById('ext-img-format');
  const textResultWrap = document.getElementById('ext-text-result-wrap');
  const textOutput = document.getElementById('ext-text-output');
  const textStats = document.getElementById('ext-text-stats');
  const copyBtn = document.getElementById('ext-copy-btn');
  const submitBtn = document.getElementById('ext-submit-btn');
  const submitLabel = document.getElementById('ext-submit-label');
  const statusId = 'ext-status';

  /** @type {File|null} */
  let currentFile = null;
  let totalPages = 0;
  let activeMode = 'text'; // 'text' | 'images'
  let isProcessing = false;

  function setMode(mode) {
    activeMode = mode === 'images' ? 'images' : 'text';
    tabBtns.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-ext-tab') === activeMode);
    });
    if (imgFormatGroup) imgFormatGroup.hidden = activeMode !== 'images';
    if (textResultWrap && activeMode === 'images') {
      textResultWrap.hidden = true;
    }
    if (submitLabel) {
      submitLabel.textContent =
        activeMode === 'text'
          ? 'Extract Text'
          : 'Export Page Images';
    }
  }

  /**
   * Reconstructs readable lines of text from pdfjs getTextContent() items.
   * @param {Array} items
   * @returns {string}
   */
  function reconstructPageText(items) {
    if (!Array.isArray(items) || items.length === 0) return '';
    const lines = [];
    let currentLine = [];
    let lastY = null;

    for (const item of items) {
      if (typeof item.str !== 'string') continue;
      const y = item.transform && typeof item.transform[5] === 'number'
        ? Math.round(item.transform[5])
        : null;

      if (lastY !== null && y !== null && Math.abs(y - lastY) > 4) {
        lines.push(currentLine.join(' ').trim());
        currentLine = [];
      }
      if (item.str.trim()) {
        currentLine.push(item.str);
      }
      if (item.hasEOL) {
        lines.push(currentLine.join(' ').trim());
        currentLine = [];
        lastY = null;
      } else if (y !== null) {
        lastY = y;
      }
    }

    if (currentLine.length > 0) {
      lines.push(currentLine.join(' ').trim());
    }
    return lines.filter(Boolean).join('\n');
  }

  /**
   * Loads the selected PDF and inspects its page count.
   * @param {File[]} files
   */
  async function handleFileSelect(files) {
    if (isProcessing || !files || files.length === 0) return;
    if (!window.pdfjsLib) {
      Utils.showStatus(statusId, 'PDF.js library failed to load.', 'error');
      return;
    }

    const file = files[0];
    Utils.showStatus(statusId, `Inspecting "${file.name}"...`, 'loading');
    if (textResultWrap) textResultWrap.hidden = true;

    let buffer = null;
    try {
      buffer = await file.arrayBuffer();
      const loadingTask = window.pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
      const pdfDoc = await loadingTask.promise;
      const count = pdfDoc.numPages;
      await pdfDoc.destroy();
      buffer = null;

      currentFile = file;
      totalPages = count;

      if (fileNameEl) fileNameEl.textContent = file.name;
      if (fileMetaEl) {
        fileMetaEl.textContent = `${Utils.formatFileSize(file.size)} • ${count} page${count === 1 ? '' : 's'}`;
      }
      if (rangeInput) rangeInput.value = 'all';
      if (rangeHint) {
        rangeHint.textContent = `Enter "all" (1 to ${count}) or custom page ranges (e.g. 1-3, 5).`;
      }

      if (configPanel) configPanel.hidden = false;
      Utils.showStatus(
        statusId,
        `Loaded "${file.name}" (${count} page${count === 1 ? '' : 's'}). Choose Text or Image extraction below.`,
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

  /**
   * Executes either text extraction (.txt) or page image export (.zip).
   */
  async function executeExtraction() {
    if (isProcessing || !currentFile || totalPages < 1) return;
    if (!window.pdfjsLib) {
      Utils.showStatus(statusId, 'PDF.js library is not loaded.', 'error');
      return;
    }

    const parsed = Utils.parsePageRanges(rangeInput ? rangeInput.value : 'all', totalPages);
    if (!parsed.valid) {
      Utils.showStatus(statusId, parsed.error, 'error');
      return;
    }

    isProcessing = true;
    submitBtn.disabled = true;
    const originalBtnHtml = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Extracting...</span>';

    let buffer = null;
    let pdfDoc = null;
    try {
      buffer = await currentFile.arrayBuffer();
      const loadingTask = window.pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
      pdfDoc = await loadingTask.promise;
      const baseName = Utils.getBaseFilename(currentFile.name, 'document');

      if (activeMode === 'text') {
        const sections = [];
        for (let i = 0; i < parsed.pages.length; i++) {
          const pageNum = parsed.pages[i];
          Utils.showStatus(
            statusId,
            `Extracting text from page ${pageNum} (${i + 1} of ${parsed.pages.length})...`,
            'loading'
          );
          const page = await pdfDoc.getPage(pageNum);
          const textContent = await page.getTextContent();
          const pageText = reconstructPageText(textContent.items);
          sections.push(`--- Page ${pageNum} ---\n${pageText || '[No selectable text on this page]'}`);
          page.cleanup();
        }

        const fullText = sections.join('\n\n');
        const wordCount = fullText
          .replace(/--- Page \d+ ---/g, '')
          .trim()
          .split(/\s+/)
          .filter(Boolean).length;

        if (textResultWrap && textOutput && textStats) {
          textResultWrap.hidden = false;
          textOutput.value = fullText;
          textStats.textContent = `${wordCount} words • ${fullText.length} chars`;
        }

        const outName = `${baseName}-extracted-text.txt`;
        Utils.downloadBlob(fullText, outName, 'text/plain;charset=utf-8');
        Utils.showStatus(
          statusId,
          `Extracted text from ${parsed.pages.length} page(s) (${wordCount} words) and downloaded "${outName}".`,
          'success'
        );
      } else {
        if (!window.JSZip) {
          throw new Error('JSZip library failed to load.');
        }
        const format = imgFormatSelect && imgFormatSelect.value === 'jpeg' ? 'jpeg' : 'png';
        const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
        const ext = format === 'jpeg' ? 'jpg' : 'png';
        const zip = new window.JSZip();
        const padLen = String(totalPages).length;

        for (let i = 0; i < parsed.pages.length; i++) {
          const pageNum = parsed.pages[i];
          Utils.showStatus(
            statusId,
            `Exporting image for page ${pageNum} (${i + 1} of ${parsed.pages.length})...`,
            'loading'
          );
          const page = await pdfDoc.getPage(pageNum);
          const viewport = page.getViewport({ scale: 2.0 });

          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          await page.render({ canvasContext: ctx, viewport }).promise;
          const imgBlob = await new Promise((resolve) => canvas.toBlob(resolve, mimeType, 0.92));
          Utils.cleanupCanvas(canvas);
          page.cleanup();

          zip.file(`${baseName}-page-${String(pageNum).padStart(padLen, '0')}.${ext}`, imgBlob);
        }

        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const zipName = `${baseName}-extracted-images.zip`;
        Utils.downloadBlob(zipBlob, zipName, 'application/zip');
        Utils.showStatus(
          statusId,
          `Exported ${parsed.pages.length} page image(s) into "${zipName}" (${Utils.formatFileSize(zipBlob.size)}).`,
          'success'
        );
      }
    } catch (err) {
      console.error('Extract PDF error:', err);
      Utils.showStatus(
        statusId,
        `Extraction failed: ${err && err.message ? err.message : 'Unexpected error.'}`,
        'error'
      );
    } finally {
      if (pdfDoc) {
        try {
          await pdfDoc.destroy();
        } catch (_e) {}
      }
      buffer = null;
      isProcessing = false;
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnHtml;
    }
  }

  Utils.initDropzone({
    dropzoneId: 'ext-dropzone',
    fileInputId: 'ext-file-input',
    acceptExtensions: ['.pdf', 'application/pdf'],
    multiple: false,
    statusId,
    onFiles: handleFileSelect
  });

  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      setMode(btn.getAttribute('data-ext-tab'));
    });
  });

  if (copyBtn && textOutput) {
    copyBtn.addEventListener('click', async () => {
      if (!textOutput.value) return;
      try {
        await navigator.clipboard.writeText(textOutput.value);
        const prev = copyBtn.textContent;
        copyBtn.textContent = 'Copied';
        setTimeout(() => {
          copyBtn.textContent = prev;
        }, 1800);
      } catch (_err) {
        textOutput.select();
        document.execCommand('copy');
      }
    });
  }

  if (changeFileBtn && fileInput) {
    changeFileBtn.addEventListener('click', () => {
      if (!isProcessing) fileInput.click();
    });
  }

  if (submitBtn) {
    submitBtn.addEventListener('click', executeExtraction);
  }
})();
