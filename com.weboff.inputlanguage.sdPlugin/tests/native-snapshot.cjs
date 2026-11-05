'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { normalizeState } = require('../src/core.cjs');

test('the compiled native snapshot reports the actual available macOS keyboard sources without switching them', () => {
  const text = execFileSync(path.join(__dirname, '../native/input-source-helper'), ['--snapshot'], { encoding: 'utf8', timeout: 5000 });
  const state = normalizeState(JSON.parse(text));
  assert.ok(state, 'the native helper reports a confirmed state rather than unavailable in this verified console session');
  assert.ok(state.current?.id);
  assert.ok(state.sources.length >= 1);
  assert.ok(state.sources.some(source => source.id === state.current.id));
});
