import assert from 'node:assert/strict';
import { test } from 'node:test';
import { examples, getReply, validateDemoConfig } from '../../apps/web/dist/mock.js';

const config = validateDemoConfig({ maxInputChars: 600, maxMessages: 40, chunkDelayMs: 18 });
test('configuration rejects coercion, unknown fields and out-of-bounds values', () => {
  for (const value of [
    null,
    [],
    {},
    { ...config, maxInputChars: '600' },
    { ...config, chunkDelayMs: 0 },
    { ...config, maxMessages: 201 },
    { ...config, maxMessages: 3 },
    { ...config, enabled: true },
  ])
    assert.throws(() => validateDemoConfig(value));
});
test('only supported languages and bounded nonempty synthetic input are accepted', () => {
  for (const input of ['', '  ', 'x'.repeat(601)])
    assert.throws(() => getReply(input, 'en', config));
  assert.throws(() => getReply('demo', 'other', config));
});
test('English and Bangla examples produce explicitly canned responses without echoing input', () => {
  for (const language of ['en', 'bn']) {
    assert.equal(examples[language].length, 3);
    for (const input of examples[language])
      assert.match(
        getReply(input, language, config),
        language === 'en' ? /sample|prewritten/ : /নমুনা|ডেমো/,
      );
  }
  const hostile = '<script>window.stolen=true</script>';
  assert.ok(!getReply(hostile, 'en', config).includes(hostile));
});
