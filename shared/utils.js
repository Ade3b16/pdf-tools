/**
 * PDF Tools Suite — Shared Client-Side Utilities (shared/utils.js)
 * Exposes window.PDFToolUtils for zero-build, 100% browser-based tools.
 */
(function (window) {
  'use strict';

  /**
   * Resolves either a DOM element reference or an element ID string.
   * @param {HTMLElement|string} target
   * @returns {HTMLElement|null}
   */
  function resolveElement(target) {
    if (!target) return null;
    if (typeof target === 'string') {
      return document.getElementById(target.replace(/^#/, ''));
    }
    return target instanceof HTMLElement ? target : null;
  }

  /**
   * Escapes special HTML characters to prevent XSS when rendering file names.
   * @param {string} str
   * @returns {string}
   */
  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Strips file extension and unsafe path characters for clean output filenames.
   * @param {string} filename
   * @param {string} [fallback='document']
   * @returns {string}
   */
  function getBaseFilename(filename, fallback = 'document') {
    if (!filename || typeof filename !== 'string') return fallback;
    const withoutExt = filename.replace(/\.[^/.]+$/, '');
    const cleaned = withoutExt.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
    return cleaned || fallback;
  }

  /**
   * Formats byte count into human-readable string (B, KB, MB, GB).
   * @param {number} bytes
   * @param {number} [decimals=2]
   * @returns {string}
   */
  function formatFileSize(bytes, decimals = 2) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const k = 1024;
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
    if (i === 0) return `${bytes} B`;
    const dm = Math.max(0, decimals);
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${units[i]}`;
  }

  /**
   * Checks whether a File matches an optional list of extensions or MIME prefixes.
   * @param {File} file
   * @param {string[]} acceptExtensions - e.g. ['.pdf'] or ['.jpg', '.jpeg', '.png', '.webp']
   * @returns {boolean}
   */
  function matchesAcceptedType(file, acceptExtensions) {
    if (!Array.isArray(acceptExtensions) || acceptExtensions.length === 0) {
      return true;
    }
    const lowerName = (file.name || '').toLowerCase();
    const lowerMime = (file.type || '').toLowerCase();

    return acceptExtensions.some((rule) => {
      const normalized = String(rule).trim().toLowerCase();
      if (!normalized) return true;
      if (normalized.startsWith('.')) {
        return lowerName.endsWith(normalized);
      }
      if (normalized.endsWith('/*')) {
        const baseMime = normalized.slice(0, -1);
        return lowerMime.startsWith(baseMime);
      }
      return lowerMime === normalized || lowerName.endsWith(`.${normalized}`);
    });
  }

  /**
   * Binds drag-and-drop, click, keyboard activation, and <input type="file"> change
   * events to a dropzone container. Automatically resets input.value so re-selecting
   * the same file still triggers the change handler.
   *
   * @param {Object} config
   * @param {HTMLElement|string} config.dropzoneId - Dropzone element or ID
   * @param {HTMLElement|string} config.fileInputId - File input element or ID
   * @param {function(File[]): void} config.onFiles - Callback receiving validated File array
   * @param {string[]} [config.acceptExtensions=[]] - Allowed extensions (e.g. ['.pdf'])
   * @param {boolean} [config.multiple=true] - Allow multiple files
   * @param {HTMLElement|string} [config.statusId] - Optional status banner ID for rejection warnings
   */
  function initDropzone(config = {}) {
    const dropzone = resolveElement(config.dropzoneId);
    const fileInput = resolveElement(config.fileInputId);
    const onFiles = config.onFiles;
    const acceptExtensions = config.acceptExtensions || [];
    const multiple = config.multiple !== false;

    if (!dropzone || !fileInput || typeof onFiles !== 'function') {
      console.warn('PDFToolUtils.initDropzone: Missing dropzone, fileInput, or onFiles callback.');
      return;
    }

    function processIncomingFiles(fileList) {
      if (!fileList || fileList.length === 0) return;
      const incoming = Array.from(fileList);
      const validFiles = incoming.filter((f) => matchesAcceptedType(f, acceptExtensions));

      if (validFiles.length === 0) {
        if (config.statusId) {
          const expected = acceptExtensions.length ? acceptExtensions.join(', ') : 'supported';
          showStatus(
            config.statusId,
            `Unsupported file format. Please select ${expected} files.`,
            'error'
          );
        }
        return;
      }

      if (validFiles.length < incoming.length && config.statusId) {
        showStatus(
          config.statusId,
          `Skipped ${incoming.length - validFiles.length} unsupported file(s).`,
          'warning'
        );
      }

      onFiles(multiple ? validFiles : [validFiles[0]]);
    }

    // Trigger file picker when clicking anywhere in the dropzone
    dropzone.addEventListener('click', (e) => {
      if (e.target === fileInput) return;
      fileInput.click();
    });

    // Keyboard accessibility (Enter / Space)
    dropzone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fileInput.click();
      }
    });

    // File input change handler with immediate value reset
    fileInput.addEventListener('change', (e) => {
      processIncomingFiles(e.target.files);
      fileInput.value = '';
    });

    // Drag & Drop events
    ['dragenter', 'dragover'].forEach((eventName) => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add('dragover');
      });
    });

    ['dragleave', 'dragend'].forEach((eventName) => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('dragover');
      });
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer && e.dataTransfer.files) {
        processIncomingFiles(e.dataTransfer.files);
      }
    });
  }

  /**
   * Creates a Blob from bytes/Blob, triggers a browser file download, and revokes
   * the Object URL after a short delay to prevent memory leaks.
   *
   * @param {Blob|Uint8Array|ArrayBuffer|string} data
   * @param {string} filename
   * @param {string} [mimeType='application/pdf']
   */
  function downloadBlob(data, filename, mimeType = 'application/pdf') {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename || 'download.pdf';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    // Delayed revocation ensures mobile and desktop browsers start the download cleanly
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 2000);
  }

  /**
   * Updates a unified status/error/success/warning/loading banner inside #pdf-tool-app.
   *
   * @param {HTMLElement|string} containerOrId
   * @param {string} message
   * @param {'info'|'success'|'warning'|'error'|'loading'} [type='info']
   */
  function showStatus(containerOrId, message, type = 'info') {
    const el = resolveElement(containerOrId);
    if (!el) return;

    if (!message) {
      clearStatus(el);
      return;
    }

    const validTypes = ['info', 'success', 'warning', 'error', 'loading'];
    const normalizedType = validTypes.includes(type) ? type : 'info';
    el.className = `status-banner ${normalizedType}`;
    el.removeAttribute('hidden');
    el.setAttribute('role', normalizedType === 'error' ? 'alert' : 'status');

    el.innerHTML = `<span>${escapeHtml(message)}</span>`;
  }

  /**
   * Hides and clears a status banner element.
   * @param {HTMLElement|string} containerOrId
   */
  function clearStatus(containerOrId) {
    const el = resolveElement(containerOrId);
    if (!el) return;
    el.textContent = '';
    el.setAttribute('hidden', 'hidden');
  }

  /**
   * Parses a user-entered page range string (e.g., "1-3, 5, 8-10") into validated,
   * 0-based page indices.
   *
   * @param {string} rangeStr - User input such as "1-3, 5, 8-10" or "all"
   * @param {number} maxPages - Total pages in the loaded PDF (1-based upper bound)
   * @param {Object} [options]
   * @param {boolean} [options.allowDuplicates=false] - Keep duplicate occurrences if true
   * @returns {{ valid: boolean, indices: number[], pages: number[], error: string|null }}
   */
  function parsePageRanges(rangeStr, maxPages, options = {}) {
    const total = Number(maxPages);
    if (!Number.isInteger(total) || total < 1) {
      return {
        valid: false,
        indices: [],
        pages: [],
        error: 'Document has no valid pages loaded.'
      };
    }

    const raw = String(rangeStr ?? '').trim();
    if (!raw || raw.toLowerCase() === 'all') {
      const allIndices = Array.from({ length: total }, (_, idx) => idx);
      return {
        valid: true,
        indices: allIndices,
        pages: allIndices.map((i) => i + 1),
        error: null
      };
    }

    const tokens = raw.split(',').map((t) => t.trim()).filter(Boolean);
    if (tokens.length === 0) {
      return {
        valid: false,
        indices: [],
        pages: [],
        error: 'Please enter at least one page number or range (e.g. 1-3, 5).'
      };
    }

    const resultIndices = [];
    const seen = new Set();
    const allowDuplicates = Boolean(options.allowDuplicates);

    for (const token of tokens) {
      if (/^\d+$/.test(token)) {
        const pageNum = parseInt(token, 10);
        if (pageNum < 1 || pageNum > total) {
          return {
            valid: false,
            indices: [],
            pages: [],
            error: `Page ${pageNum} is out of bounds (document has ${total} page${total === 1 ? '' : 's'}).`
          };
        }
        const idx = pageNum - 1;
        if (allowDuplicates || !seen.has(idx)) {
          seen.add(idx);
          resultIndices.push(idx);
        }
      } else if (/^(\d+)\s*-\s*(\d+)$/.test(token)) {
        const match = token.match(/^(\d+)\s*-\s*(\d+)$/);
        const start = parseInt(match[1], 10);
        const end = parseInt(match[2], 10);

        if (start < 1 || start > total || end < 1 || end > total) {
          return {
            valid: false,
            indices: [],
            pages: [],
            error: `Range "${token}" is out of bounds (valid pages: 1 to ${total}).`
          };
        }

        const step = start <= end ? 1 : -1;
        for (let p = start; step > 0 ? p <= end : p >= end; p += step) {
          const idx = p - 1;
          if (allowDuplicates || !seen.has(idx)) {
            seen.add(idx);
            resultIndices.push(idx);
          }
        }
      } else {
        return {
          valid: false,
          indices: [],
          pages: [],
          error: `Invalid range token "${token}". Use numbers and hyphens separated by commas (e.g. 1-3, 5).`
        };
      }
    }

    return {
      valid: true,
      indices: resultIndices,
      pages: resultIndices.map((i) => i + 1),
      error: null
    };
  }

  /**
   * Releases off-screen <canvas> backing store memory so mobile browsers
   * do not hit memory limits during multi-page rendering.
   *
   * @param {HTMLCanvasElement} canvas
   */
  function cleanupCanvas(canvas) {
    if (!canvas || !(canvas instanceof HTMLCanvasElement)) return;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    canvas.width = 0;
    canvas.height = 0;
  }

  // Export global singleton namespace
  window.PDFToolUtils = {
    escapeHtml,
    getBaseFilename,
    formatFileSize,
    initDropzone,
    downloadBlob,
    showStatus,
    clearStatus,
    parsePageRanges,
    cleanupCanvas
  };
})(window);
