'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { languageCode, displayLabel, nextSourceId, normalizeState } = require('../src/core.cjs');
const en = { id: 'english', name: 'English', languages: ['en-US'] };
const ru = { id: 'russian', name: 'Russian', languages: ['ru'] };
const de = { id: 'german', name: 'German', languages: ['de-DE'] };

test('display language uses only the primary BCP47 language, including two and three letter codes', () => {
  for (const [tag, code] of [['en-US', 'EN'], ['ru', 'RU'], ['de-CH', 'DE'], ['zh-Hans', 'ZH'], ['fil-PH', 'FIL']]) assert.equal(languageCode({ languages: [tag] }), code);
  for (const source of [null, {}, { id: 'russian', name: 'Russian', languages: [] }, { languages: ['', 'en'] }, { languages: ['invalid', 'ru'] }, { languages: ['en_US'] }]) assert.equal(languageCode(source), '--');
});

test('the key label is the language code when the source has a valid language tag', () => {
  for (const [tag, code] of [['en-US', 'EN'], ['ru', 'RU'], ['zh-Hant', 'ZH'], ['fil-PH', 'FIL']]) assert.equal(displayLabel({ id: 'x', name: 'Any name', languages: [tag] }), code);
});

test('sources without a usable language tag show their system name instead of a placeholder', () => {
  assert.equal(displayLabel({ id: 'hex', name: 'Unicode Hex Input', languages: [] }), 'Unicode Hex\u2026');
  assert.equal(displayLabel({ id: 'kotoeri', name: '\u3053\u3068\u3048\u308a', languages: ['invalid'] }), '\u3053\u3068\u3048\u308a');
  assert.equal(displayLabel({ id: 'custom', name: '  My Layout  ', languages: ['mul'] }), 'My Layout');
  assert.equal(displayLabel({ id: 'exact', name: 'TwelveChars!', languages: [] }), 'TwelveChars!');
  assert.equal(displayLabel({ id: 'emoji', name: '\u{1F600}'.repeat(13), languages: [] }), '\u{1F600}'.repeat(11) + '\u2026');
});

test('name fallback truncates whole visible characters and removes control and format characters', () => {
  const accented = 'Cafe\u0301 Layout Extended';
  assert.equal(displayLabel({ id: 'a', name: accented, languages: [] }), 'Cafe\u0301 Layout\u2026');
  const keycap = '1\uFE0F\u20E3';
  assert.equal(displayLabel({ id: 'k', name: keycap.repeat(13), languages: [] }), keycap.repeat(11) + '\u2026');
  assert.equal(displayLabel({ id: 'c', name: 'A\tB\u202eC\u200bD', languages: [] }), 'A B C D');
});

test('joiners that are part of real text survive the name clean-up', () => {
  const persian = '\u0641\u0627\u0631\u0633\u06cc\u200c\u0647\u0627';
  assert.equal(displayLabel({ id: 'p', name: persian, languages: [] }), persian);
  const technologist = '\u{1F469}\u200D\u{1F4BB}';
  assert.equal(displayLabel({ id: 't', name: technologist + ' Layout', languages: [] }), technologist + ' Layout');
});

test('a missing source or a blank name without a tag still shows the unknown placeholder', () => {
  for (const source of [null, undefined, {}, { id: 'blank', name: '   ', languages: [] }]) assert.equal(displayLabel(source), '--');
});

test('cycling uses actual source IDs in order, wraps, and preserves two distinct sources sharing one language', () => {
  const otherEnglish = { ...en, id: 'english-international' };
  const sources = [en, otherEnglish, ru, de, { ...ru, name: 'Duplicate ignored' }];
  assert.equal(nextSourceId('english', sources), 'english-international');
  assert.equal(nextSourceId('english-international', sources), 'russian');
  assert.equal(nextSourceId('german', sources), 'english');
  assert.equal(nextSourceId('absent', sources), 'english');
  assert.equal(nextSourceId('english', [en]), 'english');
  assert.equal(nextSourceId('english', []), null);
});

test('normalization sanitizes and independently copies confirmed state, preserving an unavailable current source', () => {
  const input = { type: 'state', revision: 9, id: 'generation-2', current: de, sources: [en, ru, { ...en, name: 'Duplicate' }], private: 'DROP' };
  const result = normalizeState(input);
  assert.deepEqual(result, { type: 'state', revision: 9, id: 'generation-2', current: de, sources: [en, ru] });
  result.current.name = 'Changed'; result.sources[0].languages.push('xx');
  assert.equal(input.current.name, 'German'); assert.deepEqual(input.sources[0].languages, ['en-US']);
});

test('normalization accepts an unknown current source and a large real-world ABC supported-language list', () => {
  const abc = { ...en, languages: Array.from({ length: 100 }, (_, index) => index ? 'de' : 'en') };
  const result = normalizeState({ type: 'state', revision: 0, current: null, sources: [abc] });
  assert.ok(result); assert.equal(result.current, null); assert.equal(result.sources[0].languages.length, 100);
  assert.equal(languageCode(result.sources[0]), 'EN');
});

test('invalid protocol shape, excessive fields and control characters are rejected without leaking a partial state', () => {
  const valid = { type: 'state', revision: 1, current: en, sources: [en, ru] };
  const invalid = [null, {}, { ...valid, type: 'target' }, { ...valid, revision: -1 }, { ...valid, revision: 1.5 }, { ...valid, revision: Number.MAX_SAFE_INTEGER + 1 }, { ...valid, id: '../secret' }, { ...valid, id: 'x'.repeat(129) }, { ...valid, sources: Array.from({ length: 257 }, () => en) }, { ...valid, current: { ...en, id: '' } }, { ...valid, current: { ...en, id: 'x'.repeat(1025) } }, { ...valid, current: { ...en, name: 'x'.repeat(1025) } }, { ...valid, current: { ...en, name: 'Bad\nname' } }, { ...valid, current: { ...en, languages: ['x'.repeat(65)] } }, { ...valid, current: { ...en, languages: Array(257).fill('en') } }];
  for (const value of invalid) assert.equal(normalizeState(value), null);
});

test('Windows foreground target tokens survive sanitization while malformed tokens reject the entire state', () => {
  const input = { type: 'state', revision: 1, current: en, sources: [en, ru], targetToken: 'foreground-42_a' };
  assert.equal(normalizeState(input)?.targetToken, 'foreground-42_a');
  for (const targetToken of ['', 'bad\nvalue', 'x'.repeat(129), 42, null]) assert.equal(normalizeState({ ...input, targetToken }), null);
  assert.equal(Object.hasOwn(normalizeState({ type: 'state', revision: 1, current: en, sources: [en] }), 'targetToken'), false, 'legacy macOS states remain unchanged');
});
