import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createProductivityService,
  SUPPORTED_TONES,
  validateProductivityOptions,
  buildProductivityPrompt,
} from '../../packages/productivity/index.mjs';
import { resolveRoutingSelection } from '../../packages/router/policy.mjs';
import { createDatabase } from '../../packages/db/index.mjs';
import { createRegistry } from '../../packages/registry/index.mjs';
import { createLedger } from '../../packages/ledger/index.mjs';
import { createGovernor } from '../../packages/governor/index.mjs';
import { createRouter } from '../../packages/router/index.mjs';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

test('WRITE-01: Drafting, rewriting, grammar, and tone presets and validation', () => {
  const service = createProductivityService();

  // Validate supported presets and lists
  assert.deepEqual(service.supportedPresets, [
    'general',
    'coding',
    'writing',
    'research',
    'translation',
    'summary',
  ]);
  assert.deepEqual(service.writingTasks, ['draft', 'rewrite', 'grammar', 'tone']);
  assert.ok(service.supportedTones.includes('formal'));
  assert.ok(service.supportedTones.includes('casual'));
  assert.ok(service.supportedTones.includes('professional'));
  assert.ok(service.supportedTones.includes('academic'));
  assert.ok(service.supportedTones.includes('empathetic'));
  assert.ok(service.supportedTones.includes('concise'));
  assert.ok(service.supportedTones.includes('persuasive'));

  // Option validation success
  assert.equal(
    validateProductivityOptions({
      preset: 'writing',
      task: 'draft',
      tone: 'formal',
      outputFormat: 'text',
    }),
    true,
  );

  // Option validation rejects invalid options
  assert.throws(
    () => validateProductivityOptions({ preset: 'unsupported_preset' }),
    /Unsupported preset/,
  );
  assert.throws(
    () => validateProductivityOptions({ preset: 'writing', tone: 'angry' }),
    /Unsupported tone/,
  );
  assert.throws(
    () => validateProductivityOptions({ preset: 'writing', unknownField: true }),
    /Unknown productivity option/,
  );

  // Prompt generation: drafting
  const draftPromptEn = buildProductivityPrompt({
    preset: 'writing',
    task: 'draft',
    tone: 'professional',
  });
  assert.ok(draftPromptEn.includes('Draft high-quality, well-structured content'));
  assert.ok(draftPromptEn.includes('crisp, polished, business-appropriate professional tone'));

  // Prompt generation: grammar correction (English & Bangla)
  const grammarEn = buildProductivityPrompt({ preset: 'writing', task: 'grammar' }, '', 'en');
  assert.ok(
    grammarEn.includes('Identify and correct all grammar, spelling, and punctuation errors'),
  );

  const grammarBn = buildProductivityPrompt({ preset: 'writing', task: 'grammar' }, '', 'bn');
  assert.ok(grammarBn.includes('ব্যাকরণ, বানান এবং বাক্য গঠন সংশোধন করুন'));

  // Prompt generation: rewriting
  const rewriteEn = buildProductivityPrompt(
    { preset: 'writing', task: 'rewrite', tone: 'concise' },
    '',
    'en',
  );
  assert.ok(rewriteEn.includes('Rewrite the provided text for maximum clarity'));
  assert.ok(rewriteEn.includes('eliminating fluff and unnecessary words'));

  // All 7 tones in Bangla
  for (const tone of SUPPORTED_TONES) {
    const toneBn = buildProductivityPrompt({ preset: 'writing', tone }, '', 'bn');
    assert.ok(toneBn.length > 0, `Tone ${tone} generated empty Bangla prompt`);
  }
});

test('WRITE-02: Translation presets and Bangla evaluation suite (BN01–BN15)', async () => {
  const service = createProductivityService();

  // Translation prompt generation (en -> bn and bn -> en)
  const toBn = service.buildPrompt({
    preset: 'translation',
    sourceLanguage: 'en',
    targetLanguage: 'bn',
  });
  assert.ok(
    toBn.includes('Translate the provided text accurately and naturally into standard Bengali'),
  );

  const toEn = service.buildPrompt({
    preset: 'translation',
    sourceLanguage: 'bn',
    targetLanguage: 'en',
  });
  assert.ok(
    toEn.includes(
      'Translate the provided text accurately and idiomatically from Bengali to English',
    ),
  );

  // Load the canonical Phase 0/3 Bangla evaluation suite
  const suiteRaw = await readFile(resolve(repoRoot, 'tests/eval/suite.json'), 'utf8');
  const suite = JSON.parse(suiteRaw);
  const fixturesRaw = await readFile(resolve(repoRoot, 'tests/eval/fixtures.json'), 'utf8');
  const fixtures = JSON.parse(fixturesRaw);

  const banglaCases = suite.cases.filter((c) => c.language === 'bn');
  assert.equal(banglaCases.length, 15, 'Must contain exactly 15 Bangla evaluation cases');

  let passedCases = 0;
  const criticalCases = banglaCases.filter((c) => c.critical);
  assert.equal(criticalCases.length, 3, 'Must have 3 critical Bangla cases (BN07, BN08, BN09)');

  for (const c of banglaCases) {
    const answer = fixtures.answers[c.id];
    assert.ok(answer, `Answer for case ${c.id} must exist in fixtures`);

    // Automatic check verification
    const { kind } = c.automatic;
    let autoPassed = false;
    if (kind === 'json_exact') {
      const parsed = JSON.parse(answer);
      assert.deepEqual(parsed, c.automatic.expected);
      autoPassed = true;
    } else if (kind === 'text_exact') {
      assert.equal(answer.trim(), c.automatic.expected.trim());
      autoPassed = true;
    } else if (kind === 'nonempty') {
      assert.ok(answer.trim().length > 0);
      autoPassed = true;
    }
    assert.ok(autoPassed, `Case ${c.id} automatic check failed`);
    passedCases++;
  }

  // Calculate pass percentage
  const passPercent = (passedCases / banglaCases.length) * 100;
  assert.equal(passPercent, 100, 'All 15 Bangla evaluation cases must pass');
  assert.ok(passPercent >= service.defaults.minBanglaPassRatePercent, 'Meets 85% quality bar');
});

test('WRITE-03: Summarization and simplified explanation presets on arbitrary text', () => {
  const service = createProductivityService();

  // Executive summary
  const execEn = service.buildPrompt({ preset: 'summary', summaryStyle: 'executive' }, '', 'en');
  assert.ok(execEn.includes('Provide a comprehensive executive summary'));

  // Bullet points
  const bulletsEn = service.buildPrompt({ preset: 'summary', summaryStyle: 'bullets' }, '', 'en');
  assert.ok(bulletsEn.includes('Summarize the core takeaways as a clean bulleted list'));

  // TL;DR
  const tldrEn = service.buildPrompt({ preset: 'summary', summaryStyle: 'tldr' }, '', 'en');
  assert.ok(tldrEn.includes('Provide an ultra-concise TL;DR summary in one or two sentences'));

  // Simplified explanations (Explain Like I am 5) in English & Bangla
  const eli5En = service.buildPrompt({ preset: 'summary', summaryStyle: 'simplified' }, '', 'en');
  assert.ok(eli5En.includes('Explain Like I am 5'));
  assert.ok(eli5En.includes('jargon-free'));

  const eli5Bn = service.buildPrompt({ preset: 'summary', summaryStyle: 'simplified' }, '', 'bn');
  assert.ok(eli5Bn.includes('সহজ ও প্রাঞ্জল ভাষায় ব্যাখ্যা করুন'));
  assert.ok(eli5Bn.includes('Explain Like I am 5'));
});

test('WRITE-04: Structured outputs (tables, outlines, JSON schema validation)', () => {
  const service = createProductivityService();

  // 1. Table formatting validation
  const validTable =
    '| Item | Price | Qty |\n| --- | ---: | ---: |\n| Apples | 120 | 3 |\n| Oranges | 90 | 2 |';
  const tableCheck = service.validateOutput(validTable, 'table');
  assert.equal(tableCheck.valid, true);

  const invalidTable = 'Apples: 120, Oranges: 90';
  const badTableCheck = service.validateOutput(invalidTable, 'table');
  assert.equal(badTableCheck.valid, false);

  // 2. Outline formatting validation
  const validOutline =
    '# Project Plan\n- Phase 1: Setup\n  * Auth\n  * Database\n- Phase 2: Router';
  const outlineCheck = service.validateOutput(validOutline, 'outline');
  assert.equal(outlineCheck.valid, true);

  const invalidOutline = 'Just a paragraph without any bullet hierarchy or numbers.';
  const badOutlineCheck = service.validateOutput(invalidOutline, 'outline');
  assert.equal(badOutlineCheck.valid, false);

  // 3. JSON schema validation
  const schema = {
    type: 'object',
    required: ['id', 'name', 'count', 'tags'],
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      count: { type: 'integer' },
      tags: { type: 'array', items: { type: 'string' } },
    },
  };

  const validJson = JSON.stringify({
    id: 'prod-01',
    name: 'Workspace Document',
    count: 42,
    tags: ['ai', 'bengali', 'presets'],
  });

  const jsonCheck = service.validateOutput(validJson, 'json', schema);
  assert.equal(jsonCheck.valid, true);
  assert.equal(jsonCheck.parsed.id, 'prod-01');

  // JSON embedded in markdown code blocks is cleanly handled
  const fencedJson =
    '```json\n{"id": "prod-02", "name": "Fenced", "count": 10, "tags": ["test"]}\n```';
  const fencedCheck = service.validateOutput(fencedJson, 'json', schema);
  assert.equal(fencedCheck.valid, true);

  // Invalid JSON syntax
  const brokenJson = '{"id": "broken", invalid}';
  const brokenCheck = service.validateOutput(brokenJson, 'json', schema);
  assert.equal(brokenCheck.valid, false);
  assert.ok(brokenCheck.errors[0].includes('JSON parse error'));

  // Schema mismatch: missing required property and wrong type
  const badSchemaData = JSON.stringify({
    id: 'prod-03',
    name: 'Invalid Types',
    count: 'not-an-integer',
    // missing tags
  });
  const badSchemaCheck = service.validateOutput(badSchemaData, 'json', schema);
  assert.equal(badSchemaCheck.valid, false);
  assert.ok(badSchemaCheck.errors.some((e) => e.includes('expected integer')));
  assert.ok(badSchemaCheck.errors.some((e) => e.includes("missing required property 'tags'")));
});

test('WRITE-05: Input limits and safe section-by-section chunking with clear explanations', () => {
  const service = createProductivityService();

  // Within limits: passes
  const shortText = 'This is a standard document prompt within normal limits.';
  const passCheck = service.checkLimits(shortText, { maxInputChars: 1000 });
  assert.equal(passCheck.allowed, true);

  // Oversized text: rejected with clear explanation
  const longText = 'Paragraph of text. '.repeat(100); // 1900 chars
  const limitCheck = service.checkLimits(longText, { maxInputChars: 500, maxInputTokens: 150 });
  assert.equal(limitCheck.allowed, false);
  assert.equal(limitCheck.code, 'INPUT_EXCEEDS_LIMIT');
  assert.ok(limitCheck.message.includes('exceeds the limit of 500 chars'));
  assert.ok(limitCheck.suggestedChunks > 1);
  assert.ok(limitCheck.excessChars > 0);

  // Chunking helper: splits oversized document cleanly
  const multiSectionText = [
    'First section introducing the problem and initial requirements.\n\n',
    'Second section providing detailed architecture analysis and ledger equations.\n\n',
    'Third section summarizing the findings and proposed implementation milestones.',
  ].join('');

  const chunks = service.chunk(multiSectionText, { chunkSize: 90, overlap: 15 });
  assert.ok(chunks.length >= 2, 'Should break into multiple chunks');
  assert.equal(chunks[0].isFirst, true);
  assert.equal(chunks.at(-1).isLast, true);
  for (const c of chunks) {
    assert.ok(c.text.length > 0);
    assert.equal(c.total, chunks.length);
  }
});

test('Router and Policy integration with productivity presets and options', async (t) => {
  const db = await createDatabase({
    dataDir: resolve(repoRoot, '.phase2-test-db-presets-' + Date.now()),
  });
  t.after(async () => {
    await db.close();
  });

  const registry = createRegistry({ db });
  const ledger = createLedger({ db });
  const governor = createGovernor({ db });
  assert.ok(registry);
  assert.ok(ledger);
  assert.ok(governor);

  const router = createRouter(db, {
    staffActorId: 'staff-router-presets',
    gateways: {
      'synth-chat': {
        synthetic: true,
        modelId: 'synth-chat',
        providerId: 'synth-prov',
        stream: async function* () {
          yield { type: 'chunk', text: 'Hello from productivity assistant.' };
        },
        health: async () => ({ ok: true }),
      },
    },
  });
  assert.ok(router);

  // Verify policy resolution accepts 'translation' and 'summary' presets
  const samplePolicy = {
    id: 'test-policy',
    version: 1,
    mode: 'auto',
    modelClasses: ['synthetic'],
    requiredCapabilities: ['text'],
    allowPaid: true,
    ranking: ['cost', 'quality'],
    presets: {
      general: { requiredCapabilities: ['text'] },
      coding: { requiredCapabilities: ['text', 'code'] },
      writing: { requiredCapabilities: ['text'] },
      research: { requiredCapabilities: ['text', 'long_context'] },
      translation: { requiredCapabilities: ['text'] },
      summary: { requiredCapabilities: ['text'] },
    },
  };

  const selTranslate = resolveRoutingSelection(samplePolicy, {
    preset: 'translation',
    language: 'bn',
    productivity: {
      preset: 'translation',
      sourceLanguage: 'en',
      targetLanguage: 'bn',
    },
  });
  assert.equal(selTranslate.preset, 'translation');
  assert.equal(selTranslate.language, 'bn');
  assert.equal(selTranslate.productivity.preset, 'translation');
  assert.ok(selTranslate.requiredCapabilities.includes('bangla'));

  const selSummary = resolveRoutingSelection(samplePolicy, {
    preset: 'summary',
    productivity: {
      preset: 'summary',
      summaryStyle: 'tldr',
    },
  });
  assert.equal(selSummary.preset, 'summary');
  assert.equal(selSummary.productivity.summaryStyle, 'tldr');

  // Verify backward compatibility: policy without explicit 'translation' preset falls back safely
  const legacyPolicy = {
    id: 'legacy-policy',
    version: 1,
    mode: 'auto',
    modelClasses: ['synthetic'],
    requiredCapabilities: ['text'],
    allowPaid: true,
    ranking: ['cost', 'quality'],
    presets: {
      general: { requiredCapabilities: ['text'] },
      coding: { requiredCapabilities: ['text', 'code'] },
      writing: { requiredCapabilities: ['text'] },
      research: { requiredCapabilities: ['text', 'long_context'] },
    },
  };

  const selFallback = resolveRoutingSelection(legacyPolicy, {
    preset: 'translation',
  });
  assert.equal(selFallback.preset, 'translation');
  assert.ok(selFallback.requiredCapabilities.includes('text'));
});
