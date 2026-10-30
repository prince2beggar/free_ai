import { readFile } from 'node:fs/promises';
import { AppError } from '../api/errors.mjs';

const defaults = JSON.parse(await readFile(new URL('./defaults.json', import.meta.url), 'utf8'));

export const SUPPORTED_PRESETS = [
  'general',
  'coding',
  'writing',
  'research',
  'translation',
  'summary',
];

export const WRITING_TASKS = ['draft', 'rewrite', 'grammar', 'tone'];
export const SUPPORTED_TONES = defaults.tones;
export const SUMMARY_STYLES = defaults.summaryStyles;
export const STRUCTURED_FORMATS = defaults.structuredFormats;

const fail = (code, message, status = 400) => {
  throw new AppError(status, code, message);
};

export function validateProductivityOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    fail('INVALID_PRODUCTIVITY_OPTIONS', 'Productivity options must be an object.');
  }

  const allowedFields = [
    'preset',
    'task',
    'tone',
    'sourceLanguage',
    'targetLanguage',
    'summaryStyle',
    'outputFormat',
    'jsonSchema',
    'maxInputChars',
    'maxInputTokens',
  ];

  for (const key of Object.keys(options)) {
    if (!allowedFields.includes(key)) {
      fail('INVALID_PRODUCTIVITY_OPTIONS', `Unknown productivity option: ${key}`);
    }
  }

  if (options.preset !== undefined && !SUPPORTED_PRESETS.includes(options.preset)) {
    fail('INVALID_PRODUCTIVITY_OPTIONS', `Unsupported preset: ${options.preset}`);
  }

  if (options.task !== undefined) {
    const validTasks = [...WRITING_TASKS, 'translate', 'summarize', 'explain'];
    if (!validTasks.includes(options.task)) {
      fail('INVALID_PRODUCTIVITY_OPTIONS', `Unsupported productivity task: ${options.task}`);
    }
  }

  if (options.tone !== undefined && !SUPPORTED_TONES.includes(options.tone)) {
    fail('INVALID_PRODUCTIVITY_OPTIONS', `Unsupported tone: ${options.tone}`);
  }

  if (
    options.sourceLanguage !== undefined &&
    !['en', 'bn', 'auto'].includes(options.sourceLanguage)
  ) {
    fail('INVALID_PRODUCTIVITY_OPTIONS', 'Source language must be en, bn, or auto.');
  }

  if (options.targetLanguage !== undefined && !['en', 'bn'].includes(options.targetLanguage)) {
    fail('INVALID_PRODUCTIVITY_OPTIONS', 'Target language must be en or bn.');
  }

  if (options.summaryStyle !== undefined && !SUMMARY_STYLES.includes(options.summaryStyle)) {
    fail('INVALID_PRODUCTIVITY_OPTIONS', `Unsupported summary style: ${options.summaryStyle}`);
  }

  if (options.outputFormat !== undefined && !STRUCTURED_FORMATS.includes(options.outputFormat)) {
    fail(
      'INVALID_PRODUCTIVITY_OPTIONS',
      `Unsupported structured output format: ${options.outputFormat}`,
    );
  }

  if (options.jsonSchema !== undefined) {
    if (
      !options.jsonSchema ||
      typeof options.jsonSchema !== 'object' ||
      Array.isArray(options.jsonSchema)
    ) {
      fail('INVALID_PRODUCTIVITY_OPTIONS', 'JSON schema must be a valid schema object.');
    }
  }

  return true;
}

export function buildProductivityPrompt(options = {}, basePrompt = '', language = 'en') {
  const parts = [];
  const langIsBn = language === 'bn';

  if (basePrompt) {
    parts.push(basePrompt);
  }

  const {
    preset,
    task,
    tone,
    sourceLanguage,
    targetLanguage,
    summaryStyle,
    outputFormat,
    jsonSchema,
  } = options;

  // Preset-specific core guidance
  if (preset === 'translation' || task === 'translate') {
    const src = sourceLanguage ?? 'auto';
    const tgt = targetLanguage ?? (langIsBn ? 'bn' : 'en');
    if (src === 'bn' || tgt === 'en') {
      parts.push(
        'Translate the provided text accurately and idiomatically from Bengali to English. Preserve formatting, numbers, and cultural nuances without commentary.',
      );
    } else {
      parts.push(
        'Translate the provided text accurately and naturally into standard Bengali (বাংলা). Preserve formatting, numbers, and meaning faithfully without commentary.',
      );
    }
  } else if (preset === 'writing') {
    if (task === 'grammar') {
      parts.push(
        langIsBn
          ? 'প্রদত্ত লেখার ব্যাকরণ, বানান এবং বাক্য গঠন সংশোধন করুন। মূল ভাব এবং অর্থ অক্ষুণ্ণ রাখুন।'
          : 'Identify and correct all grammar, spelling, and punctuation errors. Preserve the original voice and factual content.',
      );
    } else if (task === 'rewrite') {
      parts.push(
        langIsBn
          ? 'প্রদত্ত লেখাটি আরও স্পষ্ট, সাবলীল এবং আকর্ষণীয় করে পুনরায় লিখুন। তথ্য অপরিবর্তিত রাখুন।'
          : 'Rewrite the provided text for maximum clarity, conciseness, and natural flow while strictly preserving all facts.',
      );
    } else if (task === 'draft') {
      parts.push(
        langIsBn
          ? 'ব্যবহারকারীর নির্দেশনা অনুযায়ী উচ্চমানের কাঠামোবদ্ধ খসড়া প্রস্তুত করুন।'
          : 'Draft high-quality, well-structured content fulfilling the requested intent and format.',
      );
    }
  } else if (preset === 'summary' || task === 'summarize' || task === 'explain') {
    if (summaryStyle === 'bullets') {
      parts.push(
        langIsBn
          ? 'মূল পয়েন্টগুলো স্পষ্ট বুলেট তালিকায় উপস্থাপন করুন।'
          : 'Summarize the core takeaways as a clean bulleted list.',
      );
    } else if (summaryStyle === 'tldr') {
      parts.push(
        langIsBn
          ? 'খুব সংক্ষেপে এক বা দুই বাক্যে সারসংক্ষেপ লিখুন।'
          : 'Provide an ultra-concise TL;DR summary in one or two sentences.',
      );
    } else if (summaryStyle === 'simplified' || task === 'explain') {
      parts.push(
        langIsBn
          ? 'সহজ ও প্রাঞ্জল ভাষায় ব্যাখ্যা করুন যেন যেকোনো সাধারণ পাঠক বুঝতে পারেন (Explain Like I am 5)। কোনো অপ্রয়োজনীয় পারিভাষিক শব্দ ব্যবহার করবেন না।'
          : 'Provide a simple, jargon-free explanation accessible to beginners (Explain Like I am 5). Use intuitive analogies and clear language.',
      );
    } else {
      parts.push(
        langIsBn
          ? 'গুরুত্বপূর্ণ তথ্য এবং প্রেক্ষাপট তুলে ধরে একটি সংক্ষিপ্ত এক্সিকিউটিভ সামারি প্রস্তুত করুন।'
          : 'Provide a comprehensive executive summary capturing key themes, context, and implications.',
      );
    }
  }

  // Tone adjustments (WRITE-01)
  if (tone) {
    const toneMapEn = {
      formal: 'Use an authoritative, formal, and respectful tone.',
      casual: 'Use a warm, conversational, and accessible tone.',
      professional: 'Use a crisp, polished, business-appropriate professional tone.',
      academic: 'Use an objective, evidence-based academic tone with formal phrasing.',
      empathetic: 'Use an understanding, patient, and considerate empathetic tone.',
      concise: 'Be extremely direct, eliminating fluff and unnecessary words.',
      persuasive: 'Use compelling arguments and clear reasoning to build a persuasive case.',
    };
    const toneMapBn = {
      formal: 'গাম্ভীর্যপূর্ণ, শ্রদ্ধাশীল এবং আনুষ্ঠানিক ভাষা প্রয়োগ করুন।',
      casual: 'সহজ, প্রাত্যহিক ও অনানুষ্ঠানিক ভাষা ব্যবহার করুন।',
      professional: 'পেশাদার, পরিশীলিত এবং কর্মোপযোগী ভাষা ব্যবহার করুন।',
      academic: 'বস্তুনিষ্ঠ, তথ্যভিত্তিক ও প্রাতিষ্ঠানিক ভাষা ব্যবহার করুন।',
      empathetic: 'সহানুভূতিশীল, যত্নবান ও সংবেদনশীল ভঙ্গি বজায় রাখুন।',
      concise: 'অতিরিক্ত বাক্য বর্জন করে অত্যন্ত সংক্ষিপ্ত ও স্পষ্ট থাকুন।',
      persuasive: 'যুক্তিনির্ভর এবং প্রত্যয়দীপ্ত মনোভাব প্রকাশ করুন।',
    };
    parts.push(langIsBn ? (toneMapBn[tone] ?? toneMapEn[tone]) : toneMapEn[tone]);
  }

  // Structured output instructions (WRITE-04)
  if (outputFormat === 'table') {
    parts.push(
      langIsBn
        ? 'ফলাফলটি অবশ্যই পরিষ্কার মার্কডাউন টেবিলে (Markdown table) হেডার সহ প্রদর্শন করুন।'
        : 'Format the response as a clean Markdown table with headers and aligned columns.',
    );
  } else if (outputFormat === 'outline') {
    parts.push(
      langIsBn
        ? 'ফলাফলটি ক্রমানুযায়ী স্তরবিন্যস্ত আউটলাইনে (hierarchical bulleted outline) সাজান।'
        : 'Structure the response as a hierarchical outline with indented bullet levels.',
    );
  } else if (outputFormat === 'json') {
    if (jsonSchema) {
      parts.push(
        `Return ONLY valid JSON complying exactly with this schema without markdown fences or additional commentary:\n${JSON.stringify(jsonSchema, null, 2)}`,
      );
    } else {
      parts.push('Return ONLY valid JSON without markdown formatting or surrounding commentary.');
    }
  }

  return parts.join('\n\n');
}

export function checkInputLimits(text, customLimits = {}) {
  if (typeof text !== 'string') {
    fail('INVALID_INPUT', 'Input text must be a string.');
  }

  const maxChars = customLimits.maxInputChars ?? defaults.maxInputChars;
  const maxTokens = customLimits.maxInputTokens ?? defaults.maxInputTokens;

  // Approximate tokens: ~4 characters per token for English, ~2-3 chars for Bengali
  const charLength = text.length;
  const estimatedTokens = Math.ceil(charLength / 3.5);

  if (charLength > maxChars || estimatedTokens > maxTokens) {
    const excessTokens = Math.max(0, estimatedTokens - maxTokens);
    const excessChars = Math.max(0, charLength - maxChars);
    const chunkCapacity = customLimits.chunkSize ?? maxChars;
    const suggestedChunks = Math.max(2, Math.ceil(charLength / chunkCapacity));

    return {
      allowed: false,
      code: 'INPUT_EXCEEDS_LIMIT',
      message: `Input of ${charLength} characters (~${estimatedTokens} tokens) exceeds the limit of ${maxChars} chars (~${maxTokens} tokens). Please reduce the input size or use section-by-section chunking.`,
      charLength,
      maxChars,
      estimatedTokens,
      maxTokens,
      excessChars,
      excessTokens,
      suggestedChunks,
    };
  }

  return {
    allowed: true,
    charLength,
    estimatedTokens,
  };
}

export function chunkContent(text, options = {}) {
  if (typeof text !== 'string') {
    fail('INVALID_INPUT', 'Input text must be a string.');
  }

  const chunkSize = options.chunkSize ?? defaults.defaultChunkChars;
  const overlap = options.overlap ?? defaults.defaultChunkOverlapChars;

  if (text.length <= chunkSize) {
    return [
      {
        index: 1,
        total: 1,
        text,
        startChar: 0,
        endChar: text.length,
        isFirst: true,
        isLast: true,
      },
    ];
  }

  const chunks = [];
  let start = 0;

  while (start < text.length) {
    let end = start + chunkSize;

    if (end >= text.length) {
      end = text.length;
    } else {
      // Try to break at a paragraph boundary (\n\n) or sentence boundary (. ! ? \n)
      const lookback = Math.min(300, end - start - 50);
      const searchSlice = text.slice(end - lookback, end);

      const paragraphBreak = searchSlice.lastIndexOf('\n\n');
      if (paragraphBreak !== -1) {
        end = end - lookback + paragraphBreak + 2;
      } else {
        const sentenceBreak = Math.max(
          searchSlice.lastIndexOf('. '),
          searchSlice.lastIndexOf('। '), // Bengali dari
          searchSlice.lastIndexOf('? '),
          searchSlice.lastIndexOf('!\n'),
          searchSlice.lastIndexOf('\n'),
        );
        if (sentenceBreak !== -1) {
          end = end - lookback + sentenceBreak + 1;
        }
      }
    }

    const chunkText = text.slice(start, end).trim();
    if (chunkText.length > 0) {
      chunks.push({
        index: chunks.length + 1,
        total: 0, // Filled after loop
        text: chunkText,
        startChar: start,
        endChar: end,
        isFirst: chunks.length === 0,
        isLast: end >= text.length,
      });
    }

    if (end >= text.length) {
      break;
    }

    start = Math.max(start + 1, end - overlap);
  }

  for (const c of chunks) {
    c.total = chunks.length;
  }

  return chunks;
}

export function validateStructuredOutput(rawText, format, schema = null) {
  if (typeof rawText !== 'string') {
    return { valid: false, errors: ['Output must be a string.'] };
  }

  const trimmed = rawText.trim();

  if (format === 'json') {
    let parsed;
    try {
      // Strip potential markdown code fences if present
      let cleaned = trimmed;
      if (cleaned.startsWith('```json')) {
        cleaned = cleaned.slice(7);
      } else if (cleaned.startsWith('```')) {
        cleaned = cleaned.slice(3);
      }
      if (cleaned.endsWith('```')) {
        cleaned = cleaned.slice(0, -3);
      }
      parsed = JSON.parse(cleaned.trim());
    } catch (err) {
      return { valid: false, errors: [`JSON parse error: ${err.message}`] };
    }

    if (schema) {
      const errors = [];
      validateJsonAgainstSchema(parsed, schema, '', errors);
      if (errors.length > 0) {
        return { valid: false, errors, parsed };
      }
    }

    return { valid: true, parsed };
  }

  if (format === 'table') {
    const lines = trimmed.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length < 2) {
      return { valid: false, errors: ['Table requires at least a header line and separator row.'] };
    }
    const hasPipes = lines[0].includes('|') && lines[1].includes('|');
    const hasDelimiter = /\|[\s-:]+\|/.test(lines[1]);
    if (!hasPipes || !hasDelimiter) {
      return {
        valid: false,
        errors: ['Output does not match Markdown table structure (| ... |).'],
      };
    }
    return { valid: true, lineCount: lines.length };
  }

  if (format === 'outline') {
    const lines = trimmed.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length < 1) {
      return { valid: false, errors: ['Outline cannot be empty.'] };
    }
    const isBulleted = lines.some((l) => /^\s*([*\-+]|\d+\.)\s+/.test(l));
    if (!isBulleted) {
      return { valid: false, errors: ['Output lacks bulleted or numbered outline hierarchy.'] };
    }
    return { valid: true, lineCount: lines.length };
  }

  return { valid: true };
}

function validateJsonAgainstSchema(data, schema, path = '', errors = []) {
  if (!schema || typeof schema !== 'object') return;

  const currentPath = path || 'root';

  if (schema.type) {
    const type = schema.type;
    if (type === 'string' && typeof data !== 'string') {
      errors.push(`${currentPath}: expected string, got ${typeof data}`);
    } else if (type === 'number' && typeof data !== 'number') {
      errors.push(`${currentPath}: expected number, got ${typeof data}`);
    } else if (type === 'integer' && (!Number.isInteger(data) || typeof data !== 'number')) {
      errors.push(`${currentPath}: expected integer, got ${typeof data}`);
    } else if (type === 'boolean' && typeof data !== 'boolean') {
      errors.push(`${currentPath}: expected boolean, got ${typeof data}`);
    } else if (type === 'array' && !Array.isArray(data)) {
      errors.push(`${currentPath}: expected array, got ${typeof data}`);
    } else if (
      type === 'object' &&
      (typeof data !== 'object' || data === null || Array.isArray(data))
    ) {
      errors.push(
        `${currentPath}: expected object, got ${Array.isArray(data) ? 'array' : typeof data}`,
      );
    }
  }

  if (
    schema.required &&
    Array.isArray(schema.required) &&
    typeof data === 'object' &&
    data !== null
  ) {
    for (const req of schema.required) {
      if (data[req] === undefined) {
        errors.push(`${currentPath}: missing required property '${req}'`);
      }
    }
  }

  if (schema.properties && typeof data === 'object' && data !== null && !Array.isArray(data)) {
    for (const [prop, propSchema] of Object.entries(schema.properties)) {
      if (data[prop] !== undefined) {
        validateJsonAgainstSchema(data[prop], propSchema, `${currentPath}.${prop}`, errors);
      }
    }
  }

  if (schema.items && Array.isArray(data)) {
    data.forEach((item, idx) => {
      validateJsonAgainstSchema(item, schema.items, `${currentPath}[${idx}]`, errors);
    });
  }
}
