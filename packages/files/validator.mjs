import { basename } from 'node:path';

const FORBIDDEN_SIGNATURES = [
  { name: 'Windows PE / DOS Executable', bytes: [0x4d, 0x5a] },
  { name: 'ELF Executable', bytes: [0x7f, 0x45, 0x4c, 0x46] },
  { name: 'Mach-O / Java Class', bytes: [0xca, 0xfe, 0xba, 0xbe] },
  { name: 'ZIP Archive', bytes: [0x50, 0x4b, 0x03, 0x04] },
  { name: 'GZIP Archive', bytes: [0x1f, 0x8b] },
  { name: '7-Zip Archive', bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] },
  { name: 'RAR Archive', bytes: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07] },
];

const SCRIPT_PREFIXES = ['#!', '<?php', '<html', '<script', 'eval(', 'exec('];

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * Sanitize a filename to prevent path traversal and reserved name exploits.
 */
export function sanitizeFilename(rawFilename) {
  if (typeof rawFilename !== 'string' || rawFilename.trim().length === 0) {
    throw new Error('Filename must be a non-empty string');
  }

  // Remove any directory components (both Unix and Windows slashes)
  let name = basename(rawFilename.replace(/\\/g, '/')).trim();

  // Strip null bytes and control characters (ASCII 0-31 and 127)
  name = name.replace(/[\x00-\x1f\x7f]/g, '');

  // Strip path traversal sequences
  name = name.replace(/\.\./g, '');

  // Keep only safe characters: alphanumeric, spaces, dots, dashes, underscores
  name = name.replace(/[^a-zA-Z0-9.\-_ ]/g, '_');

  // Strip leading and trailing dots/spaces
  name = name.replace(/^[. ]+|[. ]+$/g, '');

  if (name.length === 0 || WINDOWS_RESERVED.test(name)) {
    name = `file_${Date.now()}`;
  }

  if (name.length > 255) {
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
    const stem = name.slice(0, 255 - ext.length);
    name = `${stem}${ext}`;
  }

  return name;
}

/**
 * Sniff file buffer magic bytes and structure to detect actual content type.
 */
export function sniffContentType(buffer) {
  if (!Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array)) {
    throw new Error('Buffer must be a valid Buffer or Uint8Array');
  }

  if (buffer.length === 0) {
    throw new Error('File content is empty');
  }

  // Check forbidden executable and archive magic numbers
  for (const sig of FORBIDDEN_SIGNATURES) {
    if (buffer.length >= sig.bytes.length) {
      const match = sig.bytes.every((b, idx) => buffer[idx] === b);
      if (match) {
        throw new Error(`Forbidden file format detected: ${sig.name}`);
      }
    }
  }

  // Check PDF signature: %PDF- (0x25 0x50 0x44 0x46 0x2D)
  if (
    buffer.length >= 5 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46 &&
    buffer[4] === 0x2d
  ) {
    return 'application/pdf';
  }

  // Check if buffer contains null bytes (binary file)
  // Check the first 8192 bytes
  const scanLimit = Math.min(buffer.length, 8192);
  for (let i = 0; i < scanLimit; i++) {
    if (buffer[i] === 0x00) {
      throw new Error('Binary file or null byte detected in text content');
    }
  }

  // Check text content encoding - must be valid UTF-8
  const headText = buffer.subarray(0, scanLimit).toString('utf8');
  for (const scriptPrefix of SCRIPT_PREFIXES) {
    if (headText.trim().toLowerCase().startsWith(scriptPrefix)) {
      throw new Error(`Executable script content detected: ${scriptPrefix}`);
    }
  }

  return 'text/plain';
}

/**
 * Detect if text content is likely a CSV document.
 */
export function isCsvContent(text) {
  if (typeof text !== 'string' || text.trim().length === 0) return false;
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return false;

  const candidateDelimiters = [',', '\t', ';', '|'];
  for (const delim of candidateDelimiters) {
    const firstCount = lines[0].split(delim).length;
    if (firstCount >= 2) {
      // Check if subsequent lines have roughly the same delimiter count
      const matches = lines
        .slice(1, Math.min(lines.length, 5))
        .every((l) => Math.abs(l.split(delim).length - firstCount) <= 1);
      if (matches) return true;
    }
  }
  return false;
}

/**
 * Scan CSV text for potential formula injection prefixes (=, +, -, @, \t, \r).
 */
export function checkCsvFormulaInjection(text) {
  const lines = text.split(/\r?\n/);
  const formulaPrefixes = ['=', '+', '-', '@', '\t', '\r'];
  let formulaFound = false;

  for (const line of lines) {
    const cells = line.split(/[,;\t]/);
    for (const rawCell of cells) {
      let cell = rawCell.trim();
      while (cell.startsWith('"') || cell.startsWith("'")) {
        cell = cell.slice(1).trim();
      }
      if (cell.length > 0 && formulaPrefixes.includes(cell[0])) {
        // Exclude simple negative or positive numbers like -12.34 or +5
        if ((cell[0] === '-' || cell[0] === '+') && /^[+-]?\d+(\.\d+)?$/.test(cell)) {
          continue;
        }
        formulaFound = true;
        break;
      }
    }
    if (formulaFound) break;
  }

  return {
    hasFormulaPrefix: formulaFound,
    warning: formulaFound
      ? 'CSV contains cells starting with formula trigger characters (=, +, -, @). Safe extraction applied.'
      : null,
  };
}

/**
 * Validate file upload request: filename, size, mime type, and magic bytes.
 */
export function validateFileUpload({
  filename,
  buffer,
  declaredMimeType = null,
  maxSizeBytes = 10485760,
  allowedMimeTypes = ['application/pdf', 'text/plain', 'text/csv'],
}) {
  if (!buffer || buffer.length === 0) {
    const err = new Error('File content is empty');
    err.code = 'FILE_EMPTY';
    throw err;
  }

  if (buffer.length > maxSizeBytes) {
    const err = new Error(
      `File size (${buffer.length} bytes) exceeds maximum limit (${maxSizeBytes} bytes)`,
    );
    err.code = 'FILE_TOO_LARGE';
    throw err;
  }

  const sanitized = sanitizeFilename(filename);
  const sniffedMime = sniffContentType(buffer);

  // If sniffed as text/plain, check if it's CSV
  let effectiveMime = sniffedMime;
  if (sniffedMime === 'text/plain') {
    const lowerName = sanitized.toLowerCase();
    if (
      lowerName.endsWith('.csv') ||
      declaredMimeType === 'text/csv' ||
      isCsvContent(buffer.toString('utf8'))
    ) {
      effectiveMime = 'text/csv';
    }
  }

  // Ensure effective mime is allowed
  if (!allowedMimeTypes.includes(effectiveMime)) {
    const err = new Error(`Unsupported MIME type: ${effectiveMime}`);
    err.code = 'UNSUPPORTED_MIME_TYPE';
    throw err;
  }

  // Check declared MIME type if provided
  if (declaredMimeType) {
    const normDeclared = declaredMimeType.toLowerCase().split(';')[0].trim();
    if (normDeclared !== effectiveMime) {
      // Allow text/plain declaring as text/csv or vice versa if text content
      const textFamily = ['text/plain', 'text/csv'];
      if (!textFamily.includes(normDeclared) || !textFamily.includes(effectiveMime)) {
        const err = new Error(
          `Declared MIME type "${normDeclared}" does not match inspected content "${effectiveMime}"`,
        );
        err.code = 'MIME_TYPE_MISMATCH';
        throw err;
      }
    }
  }

  return {
    valid: true,
    sanitizedFilename: sanitized,
    effectiveMimeType: effectiveMime,
    sizeBytes: buffer.length,
  };
}
