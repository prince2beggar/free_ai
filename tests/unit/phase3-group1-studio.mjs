import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';
import { PRODUCTIVITY_TEMPLATES } from '../../packages/productivity/index.mjs';
import { createDatabase, migrateUp, seedSynthetic } from '../../packages/db/index.mjs';
import { createApp } from '../../packages/api/server.mjs';
import { loadConfig } from '../../packages/api/config.mjs';
import { createFileService } from '../../packages/files/index.mjs';

test('Group 1 Studio: Productivity templates registry and bilingual prompt generation', () => {
  const expectedTemplates = ['email', 'resume', 'proposal', 'meeting', 'content', 'presentation'];

  for (const tplId of expectedTemplates) {
    const tpl = PRODUCTIVITY_TEMPLATES[tplId];
    assert.ok(tpl, `Template ${tplId} must exist`);
    assert.ok(tpl.name && typeof tpl.name === 'string', `${tplId} name must be string`);
    assert.ok(tpl.nameBn && typeof tpl.nameBn === 'string', `${tplId} nameBn must be string`);
    assert.ok(Array.isArray(tpl.fields) && tpl.fields.length > 0, `${tplId} must have fields`);
    assert.equal(typeof tpl.buildPrompt, 'function', `${tplId} buildPrompt must be a function`);

    // Test English prompt build
    const dummyData = {};
    for (const f of tpl.fields) {
      dummyData[f.key] = `Test_${f.key}_Value`;
    }
    const promptEn = tpl.buildPrompt(dummyData, 'en');
    assert.ok(
      typeof promptEn === 'string' && promptEn.length > 50,
      'English prompt is rich string',
    );
    assert.ok(promptEn.includes('Test_'), 'English prompt includes field values');

    // Test Bengali prompt build
    const promptBn = tpl.buildPrompt(dummyData, 'bn');
    assert.ok(
      typeof promptBn === 'string' && promptBn.length > 50,
      'Bengali prompt is rich string',
    );
    assert.ok(promptBn.includes('Test_'), 'Bengali prompt includes field values');
  }
});

test('Group 1 HTTP API: GET /api/productivity/templates returns full template definitions', async (t) => {
  const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
  const testStorageDir = resolve(repoRoot, '.phase3-test-studio-' + Date.now());

  const db = await createDatabase();
  await migrateUp(db, { throughVersion: 10 });
  await seedSynthetic(db);

  const config = await loadConfig({}, { port: 0, limits: { chunkDelayMs: 0 } });
  const files = createFileService({ db, storageDir: testStorageDir });
  const server = createApp({ db, config, files });

  await server.ready;
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const base = `http://127.0.0.1:${server.address().port}`;

  t.after(async () => {
    await server.shutdown();
    await rm(testStorageDir, { recursive: true, force: true });
    await db.close();
  });

  // Call GET /api/productivity/templates
  const res = await fetch(`${base}/api/productivity/templates`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.ok(data.templates);
  assert.ok(data.templates.email);
  assert.ok(data.templates.resume);
  assert.ok(data.templates.proposal);
  assert.ok(data.templates.meeting);
  assert.ok(data.templates.content);
  assert.ok(data.templates.presentation);
  assert.equal(data.templates.email.category, 'writing');
  assert.equal(data.templates.presentation.category, 'writing');
});
