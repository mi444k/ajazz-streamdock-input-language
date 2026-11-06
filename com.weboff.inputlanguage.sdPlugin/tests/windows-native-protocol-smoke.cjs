'use strict';
// Read-only real-Windows integration acceptance. No source selection is requested.
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { normalizeState } = require('../src/core.cjs');
assert.equal(process.platform, 'win32', 'Actual Windows is required.');
const helper = path.join(__dirname, '../native/input-source-helper.exe');
function run(args, input) {
  const result = spawnSync(helper, args, { input, encoding: 'utf8', timeout: 10000, maxBuffer: 256 * 1024, windowsHide: true });
  assert.ifError(result.error); assert.equal(result.status, 0, 'Helper exits cleanly after stdin EOF.');
  assert.equal(result.stderr, '', 'Protocol errors must not leak raw native details.');
  return result.stdout.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}
const snapshots = run(['--snapshot']);
assert.equal(snapshots.length, 1);
const state = normalizeState(snapshots[0]);
assert.ok(state, 'A snapshot is a bounded state even without an active foreground window.');
assert.ok(state.sources.length >= 1);
assert.match(state.targetToken, /^[A-Za-z0-9_-]{1,128}$/);
const replies = run([], ['snapshot-first', 'snapshot-second'].map(id => JSON.stringify({ id, command: 'snapshot' })).join('\n') + '\n');
for (const id of ['snapshot-first', 'snapshot-second']) assert.ok(replies.some(value => value.id === id && normalizeState(value)), 'Real process roundtrips preserve correlation.');
for (const input of ['{invalid-json\n', 'PRIVATE_PROTOCOL_SENTINEL' + 'я'.repeat(40000) + '\n']) {
  const values = run([], input);
  assert.ok(values.some(value => value.type === 'error' && value.code === 'invalid_command'), 'Malformed/overlong lines produce fixed safe errors.');
  assert.equal(JSON.stringify(values).includes('PRIVATE_PROTOCOL_SENTINEL'), false);
}
console.log(JSON.stringify({ platform: process.platform, snapshotValid: true, sourceCount: state.sources.length,
  foregroundAvailable: Boolean(state.current), correlatedReadbacks: 2, malformedAndOversizeRejected: true, sourceSelections: 0 }));
