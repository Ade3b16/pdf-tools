/**
 * Header, Footer & Bates Numbering Tool (header-footer-pdf/header-footer-pdf.js)
 * Stamps running 3-column top headers and bottom footers with dynamic {page},
 * {total}, {date}, and {bates} tokens across all or selected pages via pdf-lib.
 */
(function () {
  'use strict';

  const Utils = window.PDFToolUtils;
  if (!Utils) {
    console.error('Header Footer PDF: window.PDFToolUtils is not loaded.');
    return;
  }

  const fileInput = document.getElementById('hf-file-input');
  const configPanel = document.getElementById('hf-config-panel');
  const fileNameEl = document.getElementById('hf-file-name');
  const fileMetaEl = document.getElementById('hf-file-meta');
  const batesPresetBtn = document.getElementById('hf-bates-preset-btn');
  const changeFileBtn = document.getElementById('hf-change-file-btn');

  const topLeft = document.getElementById('hf-top-left');
  const topCenter = document.getElementById('hf-top-center');
  const topRight = document.getElementById('hf-top-right');
  const bottomLeft = document.getElementById('hf-bottom-left');
  const bottomCenter = document.getElementById('hf-bottom-center');
  const bottomRight = document.getElementById('hf-bottom-right');

  const batesPrefix = document.getElementById('hf-bates-prefix');
  const batesStart = document.getElementById('hf-bates-start');
  const batesDigits = document.getElementById('hf-bates-digits');
  const fontSizeInput = document.getElementById('hf-font-size');
  const marginInput = document.getElementById('hf-margin');
  const rangeInput = document.getElementById('hf-range');

  const submitBtn = document.getElementById('hf-submit-btn');
  const statusId = 'hf-status';

  /** @type {File|null} */
  let currentFile = null;
  let totalPages = 0;
  let isProcessing = false;

  function expandTokens(template, vars) {
    if (!template) return '';
    return String(template)
      .replace(/\{page\}/gi, String(vars.page))
      .replace(/\{total\}/gi, String(vars.total))
      .replace(/\{date\}/gi, vars.date)
      .replace(/\{bates\}/gi, vars.bates);
  }

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

      if (configPanel) configPanel.hidden = false;
      Utils.showStatus(
        statusId,
        `Loaded "${file.name}" (${count} page${count === 1 ? '' : 's'}). Configure header, footer, or Bates tokens below.`,
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

  async function executeHeaderFooter() {
    if (isProcessing || !currentFile || totalPages < 1) return;
    const parsed = Utils.parsePageRanges(rangeInput ? rangeInput.value : 'all', totalPages);
    if (!parsed.valid) {
      Utils.showStatus(statusId, parsed.error, 'error');
      return;
    }

    const fields = {
      tl: topLeft ? topLeft.value.trim() : '',
      tc: topCenter ? topCenter.value.trim() : '',
      tr: topRight ? topRight.value.trim() : '',
      bl: bottomLeft ? bottomLeft.value.trim() : '',
      bc: bottomCenter ? bottomCenter.value.trim() : '',
      br: bottomRight ? bottomRight.value.trim() : ''
    };

    if (!Object.values(fields).some(Boolean)) {
      Utils.showStatus(statusId, 'Please enter text in at least one header or footer field.', 'error');
      return;
    }

    const prefix = batesPrefix ? batesPrefix.value : 'DOC-';
    const startNum = Math.max(1, parseInt(batesStart ? batesStart.value : '1', 10) || 1);
    const padDigits = Math.min(10, Math.max(1, parseInt(batesDigits ? batesDigits.value : '5', 10) || 5));
    const fontSize = Math.min(32, Math.max(6, parseInt(fontSizeInput ? fontSizeInput.value : '10', 10) || 10));
    const margin = Math.min(100, Math.max(10, parseInt(marginInput ? marginInput.value : '24', 10) || 24));
    const todayStr = new Date().toISOString().slice(0, 10);

    isProcessing = true;
    submitBtn.disabled = true;
    const originalBtnHtml = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Stamping Pages...</span>';

    let buffer = null;
    try {
      const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
      buffer = await currentFile.arrayBuffer();
      const pdfDoc = await PDFDocument.load(buffer);
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const pages = pdfDoc.getPages();
      const color = rgb(0.15, 0.18, 0.24);

      for (let i = 0; i < parsed.indices.length; i++) {
        const pageIdx = parsed.indices[i];
        const page = pages[pageIdx];
        if (!page) continue;

        const { width, height } = page.getSize();
        const textH = font.heightAtSize(fontSize);
        const topY = Math.max(margin, height - textH - margin);
        const bottomY = margin;

        const batesNum = `${prefix}${String(startNum + i).padStart(padDigits, '0')}`;
        const vars = {
          page: pageIdx + 1,
          total: totalPages,
          date: todayStr,
          bates: batesNum
        };

        const slots = [
          { raw: fields.tl, align: 'left', y: topY },
          { raw: fields.tc, align: 'center', y: topY },
          { raw: fields.tr, align: 'right', y: topY },
          { raw: fields.bl, align: 'left', y: bottomY },
          { raw: fields.bc, align: 'center', y: bottomY },
          { raw: fields.br, align: 'right', y: bottomY }
        ];

        for (const slot of slots) {
          if (!slot.raw) continue;
          const text = expandTokens(slot.raw, vars);
          const textW = font.widthOfTextAtSize(text, fontSize);
          let x = margin;
          if (slot.align === 'center') {
            x = (width - textW) / 2;
          } else if (slot.align === 'right') {
            x = Math.max(margin, width - textW - margin);
          }
          page.drawText(text, {
            x,
            y: slot.y,
            size: fontSize,
            font,
            color
          });
        }
      }

      const outBytes = await pdfDoc.save();
      const baseName = Utils.getBaseFilename(currentFile.name, 'document');
      const outName = `${baseName}-header-footer.pdf`;

      Utils.downloadBlob(outBytes, outName, 'application/pdf');
      Utils.showStatus(
        statusId,
        `Stamped headers and footers on ${parsed.indices.length} page(s) and downloaded "${outName}".`,
        'success'
      );
    } catch (err) {
      console.error('Header Footer PDF error:', err);
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
    dropzoneId: 'hf-dropzone',
    fileInputId: 'hf-file-input',
    acceptExtensions: ['.pdf', 'application/pdf'],
    multiple: false,
    statusId,
    onFiles: handleFileSelect
  });

  if (batesPresetBtn) {
    batesPresetBtn.addEventListener('click', () => {
      if (topLeft) topLeft.value = 'CONFIDENTIAL';
      if (topCenter) topCenter.value = '';
      if (topRight) topRight.value = '{date}';
      if (bottomLeft) bottomLeft.value = '';
      if (bottomCenter) bottomCenter.value = 'Page {page} of {total}';
      if (bottomRight) bottomRight.value = '{bates}';
      Utils.showStatus(statusId, 'Loaded standard legal Bates numbering preset.', 'info');
    });
  }

  if (changeFileBtn && fileInput) {
    changeFileBtn.addEventListener('click', () => {
      if (!isProcessing) fileInput.click();
    });
  }

  if (submitBtn) {
    submitBtn.addEventListener('click', executeHeaderFooter);
  }
})();
