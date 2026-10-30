import { readFile } from 'node:fs/promises';
import {
  SUPPORTED_PRESETS,
  WRITING_TASKS,
  SUPPORTED_TONES,
  SUMMARY_STYLES,
  STRUCTURED_FORMATS,
  validateProductivityOptions,
  buildProductivityPrompt,
  checkInputLimits,
  chunkContent,
  validateStructuredOutput,
} from './presets.mjs';
import { PRODUCTIVITY_TEMPLATES } from './templates.mjs';

export { PRODUCTIVITY_TEMPLATES };

const defaults = JSON.parse(await readFile(new URL('./defaults.json', import.meta.url), 'utf8'));

export function createProductivityService(options = {}) {
  const config = {
    ...defaults,
    ...options,
  };

  return {
    supportedPresets: SUPPORTED_PRESETS,
    writingTasks: WRITING_TASKS,
    supportedTones: SUPPORTED_TONES,
    summaryStyles: SUMMARY_STYLES,
    structuredFormats: STRUCTURED_FORMATS,
    templates: PRODUCTIVITY_TEMPLATES,
    defaults: config,

    validateOptions(opts) {
      return validateProductivityOptions(opts);
    },

    buildPrompt(opts, basePrompt = '', language = 'en') {
      validateProductivityOptions(opts);
      const systemPrompt = config.systemPrompts[opts.preset] ?? basePrompt;
      return buildProductivityPrompt(opts, systemPrompt, language);
    },

    checkLimits(text, customLimits = {}) {
      return checkInputLimits(text, {
        maxInputChars: customLimits.maxInputChars ?? config.maxInputChars,
        maxInputTokens: customLimits.maxInputTokens ?? config.maxInputTokens,
      });
    },

    chunk(text, chunkOpts = {}) {
      return chunkContent(text, {
        chunkSize: chunkOpts.chunkSize ?? config.defaultChunkChars,
        overlap: chunkOpts.overlap ?? config.defaultChunkOverlapChars,
      });
    },

    validateOutput(rawText, format, schema = null) {
      return validateStructuredOutput(rawText, format, schema);
    },
  };
}

export * from './presets.mjs';
