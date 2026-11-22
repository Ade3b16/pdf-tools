/**
 * Page Numbers & Watermark PDF Tool (watermark-pdf/watermark-pdf.js)
 * Toggles between stamping formatted page numbers and customizable diagonal/centered
 * text watermarks across all or selected PDF pages using pdf-lib.
 */
(function () {
  'use strict';

  const Utils = window.PDFToolUtils;
  if (!Utils) {
    console.error('Watermark PDF: window.PDFToolUtils is not loaded.');
    return;
  }

  const fileInput = document.getElementById('wm-file-input');
  const configPanel = document.getElementById('wm-config-panel');
  const fileNameEl = document.getElementById('wm-file-name');
  const fileMetaEl = document.getElementById('wm-file-meta');
  const changeFileBtn = document.getElementById('wm-change-file-btn');
  const tabBtns = Array.from(document.querySelectorAll('#pdf-tool-app [data-wm-tab]'));
  const pageNumPanel = document.getElementById('wm-panel-page-numbers');
  const watermarkPanel = document.getElementById('wm-panel-watermark');

  // Page numbers controls
  const pnPosition = document.getElementById('pn-position');
  const pnFormat = document.getElementById('pn-format');
  const pnStartNum = document.getElementById('pn-start-num');
  const pnFontSize = document.getElementById('pn-font-size');

  // Watermark controls
  const wtText = document.getElementById('wt-text');
  const wtPlacement = document.getElementById('wt-placement');
  const wtFontSize = document.getElementById('wt-font-size');
  const wtFontSizeBadge = document.getElementById('wt-font-size-badge');
  const wtOpacity = document.getElementById('wt-opacity');
  const wtOpacityBadge = document.getElementById('wt-opacity-badge');
  const wtColor = document.getElementById('wt-color');

  // Shared controls
  const pageRangeInput = document.getElementById('wm-page-range');
  const pageRangeHint = document.getElementById('wm-page-range-hint');
  const submitBtn = document.getElementById('wm-submit-btn');
  const submitLabel = document.getElementById('wm-submit-label');
  const statusId = 'wm-status';

  /** @type {File|null} */
  let currentFile = null;
  let totalPages = 0;
  let activeMode = 'page-numbers'; // 'page-numbers' | 'watermark'
  let isProcessing = false;

  const COLOR_MAP = {
    gray: [0.35, 0.39, 0.45],
    red: [0.82, 0.15, 0.15],
    blue: [0.12, 0.29, 0.68],
    black: [0.06, 0.09, 0.14]
  };

  /**
   * Switches between Page Numbers mode and Text Watermark mode.
   * @param {'page-numbers'|'watermark'} mode
   */
  function setMode(mode) {
    activeMode = mode === 'watermark' ? 'watermark' : 'page-numbers';
    tabBtns.forEach((btn) => {
      const isMatch = btn.getAttribute('data-wm-tab') === activeMode;
      btn.classList.toggle('active', isMatch);
      btn.setAttribute('aria-selected', isMatch ? 'true' : 'false');
    });

    if (pageNumPanel) pageNumPanel.hidden = activeMode !== 'page-numbers';
    if (watermarkPanel) watermarkPanel.hidden = activeMode !== 'watermark';
    if (submitLabel) {
      submitLabel.textContent =
        activeMode === 'page-numbers'
          ? 'Apply Page Numbers'
          : 'Apply Watermark';
    }
  }

  /**
   * Formats a page number label according to user selection.
   */
  function formatPageLabel(displayNum, displayTotal, formatKey) {
    switch (formatKey) {
      case 'n-slash-total':
        return `${displayNum} / ${displayTotal}`;
      case 'n-only':
        return `${displayNum}`;
      case 'dash-n-dash':
        return `- ${displayNum} -`;
      case 'page-n-of-total':
      default:
        return `Page ${displayNum} of ${displayTotal}`;
    }
  }

  /**
   * Calculates (x, y) coordinates for horizontal text placement on a PDF page.
   */
  function computePositionCoords(positionKey, pageWidth, pageHeight, textWidth, textHeight, margin = 28) {
    let x = (pageWidth - textWidth) / 2;
    let y = margin;

    if (positionKey.endsWith('left')) {
      x = margin;
    } else if (positionKey.endsWith('right')) {
      x = Math.max(margin, pageWidth - textWidth - margin);
    }

    if (positionKey.startsWith('top')) {
      y = Math.max(margin, pageHeight - textHeight - margin);
    } else if (positionKey === 'center') {
      y = (pageHeight - textHeight) / 2;
    }

    return { x, y };
  }

  /**
   * Loads the selected PDF and inspects its page count.
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
      if (pageRangeInput) {
        pageRangeInput.value = 'all';
      }
      if (pageRangeHint) {
        pageRangeHint.textContent = `Use "all" for every page (1 to ${count}), or enter a custom range like "2-${count}" to skip a cover page.`;
      }

      if (configPanel) configPanel.hidden = false;
      Utils.showStatus(
        statusId,
        `Loaded "${file.name}" (${count} page${count === 1 ? '' : 's'}). Configure your stamp options below.`,
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
          ? 'This PDF is password-protected. Please unlock it before stamping.'
          : `Could not open PDF: ${msg}`,
        'error'
      );
    }
  }

  /**
   * Stamps either Page Numbers or a Text Watermark onto the selected pages.
   */
  async function executeStamp() {
    if (isProcessing || !currentFile || totalPages < 1) return;
    if (!window.PDFLib) {
      Utils.showStatus(statusId, 'pdf-lib is not loaded.', 'error');
      return;
    }

    const parsed = Utils.parsePageRanges(pageRangeInput ? pageRangeInput.value : 'all', totalPages);
    if (!parsed.valid) {
      Utils.showStatus(statusId, parsed.error, 'error');
      return;
    }

    if (activeMode === 'watermark') {
      const textVal = wtText ? wtText.value.trim() : '';
      if (!textVal) {
        Utils.showStatus(statusId, 'Please enter watermark text to stamp.', 'error');
        return;
      }
    }

    isProcessing = true;
    submitBtn.disabled = true;
    const originalBtnHtml = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Stamping PDF...</span>';
    Utils.showStatus(statusId, `Stamping ${parsed.indices.length} page(s)...`, 'loading');

    let buffer = null;
    try {
      const { PDFDocument, StandardFonts, rgb, degrees } = window.PDFLib;
      buffer = await currentFile.arrayBuffer();
      const pdfDoc = await PDFDocument.load(buffer);
      const pages = pdfDoc.getPages();
      const baseName = Utils.getBaseFilename(currentFile.name, 'document');

      if (activeMode === 'page-numbers') {
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const position = pnPosition ? pnPosition.value : 'bottom-center';
        const formatKey = pnFormat ? pnFormat.value : 'page-n-of-total';
        const startNumber = Math.max(1, parseInt(pnStartNum ? pnStartNum.value : '1', 10) || 1);
        const fontSize = Math.min(48, Math.max(6, parseInt(pnFontSize ? pnFontSize.value : '11', 10) || 11));
        const displayTotal = startNumber + parsed.indices.length - 1;

        for (let i = 0; i < parsed.indices.length; i++) {
          const pageIndex = parsed.indices[i];
          const page = pages[pageIndex];
          if (!page) continue;

          const displayNum = startNumber + i;
          const label = formatPageLabel(displayNum, displayTotal, formatKey);
          const { width, height } = page.getSize();
          const textWidth = font.widthOfTextAtSize(label, fontSize);
          const textHeight = font.heightAtSize(fontSize);
          const { x, y } = computePositionCoords(position, width, height, textWidth, textHeight, 26);

          page.drawText(label, {
            x,
            y,
            size: fontSize,
            font,
            color: rgb(0.15, 0.18, 0.22),
            opacity: 0.92
          });
        }

        const outBytes = await pdfDoc.save();
        const outName = `${baseName}-numbered.pdf`;
        Utils.downloadBlob(outBytes, outName, 'application/pdf');
        Utils.showStatus(
          statusId,
          `Stamped page numbers on ${parsed.indices.length} page(s) and downloaded "${outName}".`,
          'success'
        );
      } else {
        const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        const text = wtText.value.trim();
        const placement = wtPlacement ? wtPlacement.value : 'diagonal';
        const fontSize = Math.min(140, Math.max(12, parseInt(wtFontSize ? wtFontSize.value : '54', 10) || 54));
        const opacityPct = Math.min(100, Math.max(5, parseInt(wtOpacity ? wtOpacity.value : '25', 10) || 25));
        const opacity = opacityPct / 100;
        const rgbTriplet = COLOR_MAP[wtColor ? wtColor.value : 'gray'] || COLOR_MAP.gray;
        const color = rgb(rgbTriplet[0], rgbTriplet[1], rgbTriplet[2]);

        for (const pageIndex of parsed.indices) {
          const page = pages[pageIndex];
          if (!page) continue;
          const { width, height } = page.getSize();
          const textWidth = font.widthOfTextAtSize(text, fontSize);
          const textHeight = font.heightAtSize(fontSize);

          if (placement === 'diagonal') {
            const angleRad = (45 * Math.PI) / 180;
            const cos = Math.cos(angleRad);
            const sin = Math.sin(angleRad);
            // Center the rotated bounding box around (width / 2, height / 2)
            const x = width / 2 - (textWidth / 2) * cos + (textHeight / 2) * sin;
            const y = height / 2 - (textWidth / 2) * sin - (textHeight / 2) * cos;

            page.drawText(text, {
              x,
              y,
              size: fontSize,
              font,
              color,
              opacity,
              rotate: degrees(45)
            });
          } else {
            const { x, y } = computePositionCoords(placement, width, height, textWidth, textHeight, 32);
            page.drawText(text, {
              x,
              y,
              size: fontSize,
              font,
              color,
              opacity
            });
          }
        }

        const outBytes = await pdfDoc.save();
        const outName = `${baseName}-watermarked.pdf`;
        Utils.downloadBlob(outBytes, outName, 'application/pdf');
        Utils.showStatus(
          statusId,
          `Applied watermark "${text}" to ${parsed.indices.length} page(s) and downloaded "${outName}".`,
          'success'
        );
      }
    } catch (err) {
      console.error('Watermark PDF error:', err);
      Utils.showStatus(
        statusId,
        `Failed to stamp PDF: ${err && err.message ? err.message : 'Unexpected error.'}`,
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
    dropzoneId: 'wm-dropzone',
    fileInputId: 'wm-file-input',
    acceptExtensions: ['.pdf', 'application/pdf'],
    multiple: false,
    statusId,
    onFiles: handleFileSelect
  });

  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      setMode(btn.getAttribute('data-wm-tab'));
    });
  });

  if (wtFontSize && wtFontSizeBadge) {
    wtFontSize.addEventListener('input', () => {
      wtFontSizeBadge.textContent = `${wtFontSize.value} pt`;
    });
  }

  if (wtOpacity && wtOpacityBadge) {
    wtOpacity.addEventListener('input', () => {
      wtOpacityBadge.textContent = `${wtOpacity.value}%`;
    });
  }

  if (changeFileBtn && fileInput) {
    changeFileBtn.addEventListener('click', () => {
      if (!isProcessing) fileInput.click();
    });
  }

  if (submitBtn) {
    submitBtn.addEventListener('click', executeStamp);
  }
})();
