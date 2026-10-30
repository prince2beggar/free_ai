import { inflateSync, inflateRawSync } from 'node:zlib';
import { checkCsvFormulaInjection } from './validator.mjs';

/**
 * Decode PDF literal string (e.g. inside parentheses).
 */
function decodePdfLiteralString(raw) {
  let result = '';
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === '\\' && i + 1 < raw.length) {
      const next = raw[i + 1];
      if (next === 'n') {
        result += '\n';
        i += 2;
      } else if (next === 'r') {
        result += '\r';
        i += 2;
      } else if (next === 't') {
        result += '\t';
        i += 2;
      } else if (next === 'b') {
        result += '\b';
        i += 2;
      } else if (next === 'f') {
        result += '\f';
        i += 2;
      } else if (next === '(' || next === ')' || next === '\\') {
        result += next;
        i += 2;
      } else if (/[0-7]/.test(next)) {
        // Octal escape \ooo
        let octal = next;
        let count = 1;
        while (count < 3 && i + 1 + count < raw.length && /[0-7]/.test(raw[i + 1 + count])) {
          octal += raw[i + 1 + count];
          count++;
        }
        result += String.fromCharCode(parseInt(octal, 8));
        i += 1 + count;
      } else {
        result += next;
        i += 2;
      }
    } else {
      result += raw[i];
      i++;
    }
  }
  return result;
}

/**
 * Extract text from PDF text operators (BT ... ET, Tj, TJ).
 */
function extractTextFromPdfContentStream(streamContent) {
  const textPieces = [];
  const btEtRegex = /BT[\s\S]*?ET/g;
  let btMatch;

  while ((btMatch = btEtRegex.exec(streamContent)) !== null) {
    const block = btMatch[0];

    // Match (string) Tj or ' or "
    const tjRegex = /\(((?:\\.|[^()\\])*)\)\s*Tj/g;
    let match;
    while ((match = tjRegex.exec(block)) !== null) {
      textPieces.push(decodePdfLiteralString(match[1]));
    }

    // Match [(string) num (string)] TJ
    const tjArrayRegex = /\[([\s\S]*?)\]\s*TJ/g;
    while ((match = tjArrayRegex.exec(block)) !== null) {
      const arrayContent = match[1];
      const strRegex = /\(((?:\\.|[^()\\])*)\)/g;
      let strMatch;
      let combined = '';
      while ((strMatch = strRegex.exec(arrayContent)) !== null) {
        combined += decodePdfLiteralString(strMatch[1]);
      }
      if (combined.length > 0) {
        textPieces.push(combined);
      }
    }
  }

  return textPieces.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Extract text from a PDF Buffer safely without executing foreign code.
 */
export function extractTextFromPdf(buffer, maxChars = 500000) {
  const pdfString = buffer.toString('binary');

  // Count pages (/Type /Page but not /Pages)
  const pageMatches = pdfString.match(/\/Type\s*\/Page(?![a-zA-Z])/g);
  const pageCount = pageMatches ? pageMatches.length : 1;

  const extractedPages = [];

  // Find all stream ... endstream blocks
  // Look for both CRLF and LF stream delimiters
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let streamMatch;

  while ((streamMatch = streamRegex.exec(pdfString)) !== null) {
    const streamStart = streamMatch.index + streamMatch[0].indexOf('\n') + 1;
    const streamEnd = streamMatch.index + streamMatch[0].lastIndexOf('\nendstream');

    // Check if previous header says /Filter /FlateDecode
    const preHeader = pdfString.slice(Math.max(0, streamMatch.index - 300), streamMatch.index);
    const isFlate =
      preHeader.includes('/Filter/FlateDecode') || preHeader.includes('/Filter /FlateDecode');

    let decompressed = '';
    if (isFlate) {
      try {
        const rawBytes = buffer.subarray(streamStart, streamEnd);
        const inflated = inflateSync(rawBytes);
        decompressed = inflated.toString('latin1');
      } catch {
        try {
          const rawBytes = buffer.subarray(streamStart, streamEnd);
          const inflated = inflateRawSync(rawBytes);
          decompressed = inflated.toString('latin1');
        } catch {
          // Decompression failed; ignore this stream safely
          continue;
        }
      }
    } else {
      decompressed = pdfString.slice(streamStart, streamEnd);
    }

    const streamText = extractTextFromPdfContentStream(decompressed);
    if (streamText.length > 0) {
      extractedPages.push(streamText);
    }
  }

  let fullText = '';
  if (extractedPages.length > 0) {
    fullText = extractedPages.join('\n\n');
  } else {
    // Fallback: extract plain literal strings in BT ... ET from the raw uncompressed string
    const fallbackText = extractTextFromPdfContentStream(pdfString);
    fullText = fallbackText;
  }

  // If still empty, check for simple readable text lines
  if (!fullText || fullText.trim().length === 0) {
    fullText =
      '[PDF text content could not be extracted as text streams; empty or scanned image document]';
  }

  let isTruncated = false;
  if (fullText.length > maxChars) {
    fullText = fullText.slice(0, maxChars);
    isTruncated = true;
  }

  return {
    text: fullText,
    pageCount,
    isTruncated,
  };
}

/**
 * Extract and clean plain text content.
 */
export function extractTextFromTxt(buffer, maxChars = 500000) {
  let text = buffer.toString('utf8');
  // Normalize line breaks
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  let isTruncated = false;
  if (text.length > maxChars) {
    text = text.slice(0, maxChars);
    isTruncated = true;
  }

  const lines = text.split('\n');

  return {
    text,
    lineCount: lines.length,
    isTruncated,
  };
}

/**
 * Parse CSV rows respecting quotes and commas.
 */
export function parseCsvRows(rawText) {
  const rows = [];
  let currentRow = [];
  let currentCell = '';
  let insideQuotes = false;
  let wasQuoted = false;
  let i = 0;

  while (i < rawText.length) {
    const char = rawText[i];
    const next = rawText[i + 1];

    if (char === '"') {
      if (insideQuotes && next === '"') {
        currentCell += '"';
        i += 2;
        continue;
      }
      insideQuotes = !insideQuotes;
      wasQuoted = true;
      i++;
      continue;
    }

    if (!insideQuotes && (char === ',' || char === '\t' || char === ';')) {
      const cellVal = wasQuoted ? currentCell : currentCell.replace(/^[ ]+|[ ]+$/g, '');
      currentRow.push(cellVal);
      currentCell = '';
      wasQuoted = false;
      i++;
      continue;
    }

    if (!insideQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') i++;
      const cellVal = wasQuoted ? currentCell : currentCell.replace(/^[ ]+|[ ]+$/g, '');
      currentRow.push(cellVal);
      if (currentRow.some((c) => c.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = '';
      wasQuoted = false;
      i++;
      continue;
    }

    currentCell += char;
    i++;
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    const cellVal = wasQuoted ? currentCell : currentCell.replace(/^[ ]+|[ ]+$/g, '');
    currentRow.push(cellVal);
    if (currentRow.some((c) => c.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

/**
 * Extract and sanitize text from CSV.
 */
export function extractTextFromCsv(buffer, maxChars = 500000) {
  const rawText = buffer.toString('utf8');
  const formulaCheck = checkCsvFormulaInjection(rawText);
  const rows = parseCsvRows(rawText);

  if (rows.length === 0) {
    return {
      text: '',
      rowCount: 0,
      columnCount: 0,
      headers: [],
      hasFormulaPrefix: false,
      warning: null,
      isTruncated: false,
    };
  }

  const headers = rows[0];
  const columnCount = headers.length;
  const rowCount = rows.length;

  // Sanitize formula injection prefixes for plain text representation
  const sanitizedRows = rows.map((row) =>
    row.map((cell) => {
      if (/^[=+\-@\t\r]/.test(cell) && !/^[+-]?\d+(\.\d+)?$/.test(cell)) {
        return `'${cell}`;
      }
      return cell;
    }),
  );

  // Format as readable CSV text
  let formattedText = sanitizedRows.map((r) => r.join(', ')).join('\n');
  let isTruncated = false;
  if (formattedText.length > maxChars) {
    formattedText = formattedText.slice(0, maxChars);
    isTruncated = true;
  }

  return {
    text: formattedText,
    rowCount,
    columnCount,
    headers,
    hasFormulaPrefix: formulaCheck.hasFormulaPrefix,
    warning: formulaCheck.warning,
    isTruncated,
  };
}

/**
 * Estimate tokens based on extracted character length (~3.5 chars/token).
 */
export function estimateTokens(text, factor = 3.5) {
  if (typeof text !== 'string' || text.length === 0) return 0;
  return Math.max(1, Math.ceil(text.length / factor));
}

/**
 * Chunk a document into sequential sections for oversized documents (FILE-07).
 */
export function chunkIntoSections(extractedText, options = {}) {
  const { maxTokensPerSection = 1000, tokenFactor = 3.5, mimeType = 'text/plain' } = options;

  if (typeof extractedText !== 'string' || extractedText.trim().length === 0) {
    return [];
  }

  const totalTokens = estimateTokens(extractedText, tokenFactor);
  if (totalTokens <= maxTokensPerSection) {
    return [
      {
        sectionIndex: 1,
        title: 'Complete Document',
        tokenCount: totalTokens,
        charCount: extractedText.length,
        content: extractedText,
      },
    ];
  }

  const sections = [];
  const maxCharsPerSection = Math.floor(maxTokensPerSection * tokenFactor);

  if (mimeType === 'text/csv') {
    const lines = extractedText.split('\n');
    const header = lines[0];
    const dataLines = lines.slice(1);
    let currentBatch = [];
    let currentChars = header.length;
    let sectionIdx = 1;

    for (const line of dataLines) {
      if (currentChars + line.length > maxCharsPerSection && currentBatch.length > 0) {
        const content = [header, ...currentBatch].join('\n');
        sections.push({
          sectionIndex: sectionIdx++,
          title: `Rows Batch ${sectionIdx - 1}`,
          tokenCount: estimateTokens(content, tokenFactor),
          charCount: content.length,
          content,
        });
        currentBatch = [];
        currentChars = header.length;
      }
      currentBatch.push(line);
      currentChars += line.length + 1;
    }

    if (currentBatch.length > 0) {
      const content = [header, ...currentBatch].join('\n');
      sections.push({
        sectionIndex: sectionIdx,
        title: `Rows Batch ${sectionIdx}`,
        tokenCount: estimateTokens(content, tokenFactor),
        charCount: content.length,
        content,
      });
    }
  } else {
    // Text or PDF: split by paragraphs / line chunks
    const paragraphs = extractedText.split(/\n\s*\n/);
    let currentParagraphs = [];
    let currentChars = 0;
    let sectionIdx = 1;

    for (const para of paragraphs) {
      if (currentChars + para.length > maxCharsPerSection && currentParagraphs.length > 0) {
        const content = currentParagraphs.join('\n\n');
        sections.push({
          sectionIndex: sectionIdx++,
          title: `Section ${sectionIdx - 1}`,
          tokenCount: estimateTokens(content, tokenFactor),
          charCount: content.length,
          content,
        });
        currentParagraphs = [];
        currentChars = 0;
      }
      currentParagraphs.push(para);
      currentChars += para.length + 2;
    }

    if (currentParagraphs.length > 0) {
      const content = currentParagraphs.join('\n\n');
      sections.push({
        sectionIndex: sectionIdx,
        title: `Section ${sectionIdx}`,
        tokenCount: estimateTokens(content, tokenFactor),
        charCount: content.length,
        content,
      });
    }
  }

  return sections;
}
