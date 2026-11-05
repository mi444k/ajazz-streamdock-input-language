'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { InputSourceBridge } = require('../src/bridge.cjs');
const en = { id: 'en', name: 'English', languages: ['en'] };
const ru = { id: 'ru', name: 'Русский', languages: ['ru'] };
const state = (revision, current = en) => ({ type: 'state', revision, current, sources: [en, ru] });
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const children = [], states = [], faults = [], timers = new Map(); let timerId = 0;
  const spawnImpl = (file, args, options) => {
    const child = new EventEmitter();
    Object.assign(child, { file, args, options, stdout: new PassThrough(), stderr: new PassThrough(), writes: [], killedCount: 0 });
    child.stdin = { write(data) { child.writes.push(JSON.parse(String(data).trim())); return true; }, end() {} };
    child.kill = () => { child.killedCount++; return true; };
    children.push(child); queueMicrotask(() => child.emit('spawn')); return child;
  };
  const bridge = new InputSourceBridge({ helperPath: '/fake/input-source-helper', spawnImpl, timeoutMs: 3000, setTimeoutImpl: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; }, clearTimeoutImpl: id => timers.delete(id) });
  bridge.on('state', value => states.push(value)); bridge.on('fault', error => faults.push(error));
  const send = (child, value) => child.stdout.write(JSON.stringify(value) + '\n');
  async function ready() {
    const pending = bridge.start(); await flush();
    assert.equal(children.length, 1, 'starting the bridge launches exactly one native helper');
    const child = children[0]; assert.equal(child.writes.length, 1);
    assert.equal(child.writes[0].command, 'snapshot'); send(child, { ...state(0), id: child.writes[0].id });
    return { child, value: await pending };
  }
  return { bridge, children, states, faults, timers, send, ready };
}

test('start requests a snapshot and publishes only sanitized confirmed native state', async () => {
  const f = fixture();
  try {
    const { child, value } = await f.ready();
    assert.equal(child.file, '/fake/input-source-helper'); assert.notEqual(child.options?.shell, true);
    assert.equal(value.current.id, 'en'); assert.equal(f.states.at(-1).current.id, 'en');
    f.send(child, { ...state(1, ru), private: 'RAW_NATIVE_DETAIL' });
    assert.equal(f.states.at(-1).current.id, 'ru'); assert.equal('private' in f.states.at(-1), false);
    assert.equal(child.writes.length, 1, 'external change notifications require no polling request');
  } finally { f.bridge.dispose(); }
});

test('JSON lines buffer split UTF8 bytes and do not publish incomplete state', async () => {
  const f = fixture();
  try {
    const { child } = await f.ready();
    const bytes = Buffer.from(JSON.stringify(state(1, ru)) + '\n');
    const split = bytes.indexOf(Buffer.from('Русский')) + 1;
    child.stdout.write(bytes.subarray(0, split)); assert.equal(f.states.at(-1).current.id, 'en');
    child.stdout.write(bytes.subarray(split)); assert.equal(f.states.at(-1).current.name, 'Русский');
    assert.equal(f.faults.length, 0);
  } finally { f.bridge.dispose(); }
});

test('select serializes the absolute source and expected current ID, then waits for actual readback', async () => {
  const f = fixture();
  try {
    const { child } = await f.ready();
    const pending = f.bridge.request('select', 'ru', { expectedCurrentId: 'en' }); await flush();
    assert.equal(child.writes.length, 2);
    assert.equal(child.writes[1].command, 'select'); assert.equal(child.writes[1].sourceId, 'ru'); assert.equal(child.writes[1].expectedCurrentId, 'en');
    assert.equal(f.states.at(-1).current.id, 'en', 'the requested target is never displayed optimistically');
    f.send(child, { ...state(1, en), id: child.writes[1].id });
    assert.equal((await pending).current.id, 'en', 'readback can differ from the target and remains authoritative');
  } finally { f.bridge.dispose(); }
});

test('malformed JSON and overlong byte lines kill the helper with a fixed safe fault and allow explicit restart', async () => {
  for (const data of ['{"private":"RAW_NATIVE_DETAIL"}\n', 'RAW_NATIVE_DETAIL' + 'я'.repeat(32769)]) {
    const f = fixture();
    try {
      const { child } = await f.ready();
      child.stdout.write(data);
      assert.equal(child.killedCount, 1); assert.equal(f.faults.length, 1);
      assert.doesNotMatch(f.faults[0].message, /RAW_NATIVE_DETAIL|яя/);
      assert.equal(f.children.length, 1, 'a protocol failure never restarts automatically');
      const pending = f.bridge.start(); await flush(); assert.equal(f.children.length, 2);
      const next = f.children[1]; assert.equal(next.writes[0].command, 'snapshot');
      f.send(child, state(99, ru));
      f.send(next, { ...state(0, en), id: next.writes[0].id });
      assert.equal((await pending).current.id, 'en'); assert.equal(f.states.at(-1).revision, 0);
    } finally { f.bridge.dispose(); }
  }
});

test('request timeout kills the child without replaying requests and a late reply cannot revive its generation', async () => {
  const f = fixture();
  try {
    const { child } = await f.ready();
    const pending = f.bridge.request('snapshot');
    const rejected = assert.rejects(pending, error => /timed out|timeout/i.test(error.message)); await flush();
    const deadline = [...f.timers.values()].find(timer => timer.delay === 3000); assert.ok(deadline);
    deadline.fn(); await rejected;
    assert.equal(child.killedCount, 1); assert.equal(child.writes.length, 2);
    const before = f.states.length; f.send(child, { ...state(9, ru), id: child.writes[1].id }); assert.equal(f.states.length, before);
    assert.equal(f.children.length, 1);
  } finally { f.bridge.dispose(); }
});

test('dispose rejects pending work, tears down one helper and cannot spawn another child', async () => {
  const f = fixture(); const { child } = await f.ready();
  const pending = f.bridge.request('snapshot');
  const rejected = assert.rejects(pending); await flush();
  f.bridge.dispose(); f.bridge.dispose();
  assert.equal(child.killedCount, 1);
  await rejected;
  const before = f.states.length; f.send(child, state(7, ru)); assert.equal(f.states.length, before);
  await assert.rejects(() => f.bridge.start()); assert.equal(f.children.length, 1);
});

test('unsupported relative-cycle commands are rejected without writing to the native helper', async () => {
  const f = fixture();
  try {
    const { child } = await f.ready();
    await assert.rejects(() => f.bridge.request('next'));
    assert.equal(child.writes.length, 1);
  } finally { f.bridge.dispose(); }
});

test('older native revisions cannot repaint newer confirmed state', async () => {
  const f = fixture();
  try {
    const { child } = await f.ready();
    f.send(child, state(5, ru)); f.send(child, state(4, en));
    assert.equal(f.states.at(-1).current.id, 'ru'); assert.equal(f.states.at(-1).revision, 5);
    const pending = f.bridge.request('snapshot'); await flush();
    f.send(child, { ...state(3, en), id: child.writes.at(-1).id });
    assert.equal((await pending).current.id, 'ru', 'a matching delayed reply resolves the latest confirmed snapshot');
  } finally { f.bridge.dispose(); }
});

test('CAS conflict rejects safely while preserving the actual separately confirmed source and never retries selection', async () => {
  const f = fixture();
  try {
    const { child } = await f.ready();
    const pending = f.bridge.request('select', 'ru', { expectedCurrentId: 'en' }); await flush();
    assert.equal(child.writes.length, 2);
    const rejected = assert.rejects(pending, error => { assert.equal(error.code, 'conflict'); assert.doesNotMatch(error.message, /RAW_NATIVE_DETAIL/); return true; });
    const de = { id: 'de', name: 'German', languages: ['de'] };
    f.send(child, state(1, de));
    f.send(child, { type: 'error', id: child.writes[1].id, code: 'conflict', message: 'RAW_NATIVE_DETAIL' });
    await rejected;
    assert.equal(f.states.at(-1).current.id, 'de'); assert.equal(child.killedCount, 0);
    assert.equal(child.writes.length, 2);
  } finally { f.bridge.dispose(); }
});
