'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { HostPlugin } = require('../src/host.cjs');
const action = 'com.weboff.inputlanguage.cycle';
const en = { id: 'en', name: 'English', languages: ['en'] };
const ru = { id: 'ru', name: 'Russian', languages: ['ru'] };
const de = { id: 'de', name: 'German', languages: ['de'] };
const state = (revision = 0, current = en, sources = [en, ru, de]) => ({ type: 'state', revision, current, sources });
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const sent = [], calls = [];
  const bridge = new EventEmitter();
  bridge.start = async () => { calls.push(['start']); const value = state(); bridge.emit('state', value); return value; };
  bridge.request = async (command, sourceId, options) => {
    calls.push([command, sourceId, options]);
    const value = command === 'snapshot' ? state(1) : state(2, ru);
    bridge.emit('state', value); return value;
  };
  bridge.dispose = () => { calls.push(['dispose']); };
  const plugin = new HostPlugin({ uuid: 'language-instance', send: value => sent.push(value), bridge });
  const appear = (context = 'a', controller = 'Keypad') => plugin.handle({ event: 'willAppear', context, action, payload: { controller, settings: {} } });
  const press = (context = 'a', event = 'keyUp', suppliedAction = action) => plugin.handle({ event, context, action: suppliedAction });
  function label(context = 'a') {
    const image = sent.filter(value => value.event === 'setImage' && value.context === context).at(-1)?.payload.image;
    if (typeof image !== 'string' || !image.startsWith('data:image/svg+xml;base64,')) return null;
    const svg = Buffer.from(image.split(',')[1], 'base64').toString('utf8');
    return /<text\b[^>]*data-role="language"[^>]*>([^<]*)<\/text>/.exec(svg)?.[1];
  }
  return { plugin, bridge, sent, calls, appear, press, label };
}

test('connection registers only this plugin, with no credential or account settings requests', async () => {
  const f = fixture();
  try { await f.plugin.handle({ event: 'connected' }); assert.deepEqual(f.sent, [{ event: 'registerPlugin', uuid: 'language-instance' }]); }
  finally { f.plugin.dispose(); }
});

test('visible keys share native startup and all receive external source updates without polling', async () => {
  const f = fixture();
  try {
    await Promise.all([f.appear('a'), f.appear('b', 'Knob')]);
    assert.equal(f.calls.filter(call => call[0] === 'start').length, 1);
    assert.equal(f.label('a'), 'EN'); assert.equal(f.label('b'), 'EN');
    f.bridge.emit('state', state(2, ru));
    assert.equal(f.label('a'), 'RU'); assert.equal(f.label('b'), 'RU');
    const count = f.calls.length; f.plugin.tick(); f.plugin.tick(); assert.equal(f.calls.length, count);
    assert.ok(f.sent.filter(value => value.event === 'setTitle').every(value => value.payload.title === ''));
    await f.plugin.handle({ event: 'willDisappear', context: 'b', action });
    const before = f.sent.filter(value => value.context === 'b').length;
    f.bridge.emit('state', state(3, de)); assert.equal(f.label('a'), 'DE');
    assert.equal(f.sent.filter(value => value.context === 'b').length, before);
  } finally { f.plugin.dispose(); }
});

test('cycle target and expected-current guard come from a fresh snapshot, with actual readback authoritative', async () => {
  const f = fixture(); let release;
  try {
    await f.appear(); f.calls.length = 0;
    f.bridge.request = async (command, sourceId, options) => {
      f.calls.push([command, sourceId, options]);
      if (command === 'snapshot') { const value = state(1, ru); f.bridge.emit('state', value); return value; }
      return new Promise(resolve => { release = value => { f.bridge.emit('state', value); resolve(value); }; });
    };
    const pending = f.press(); await flush();
    assert.deepEqual(f.calls.map(call => call[0]), ['snapshot', 'select']);
    assert.equal(f.calls[1][1], 'de'); assert.deepEqual(f.calls[1][2], { expectedCurrentId: 'ru' });
    assert.equal(f.label(), 'RU', 'the requested DE target is not painted before confirmed readback');
    release(state(2, en)); await pending; assert.equal(f.label(), 'EN');
  } finally { f.plugin.dispose(); }
});

test('one shared cycle lock ignores overlapping presses without queuing another source change', async () => {
  const f = fixture(); let release;
  try {
    await f.appear('a'); await f.appear('b'); f.calls.length = 0;
    const normal = f.bridge.request;
    f.bridge.request = async (command, ...args) => {
      if (command !== 'snapshot') return normal(command, ...args);
      f.calls.push(['snapshot']); return new Promise(resolve => { release = resolve; });
    };
    const first = f.press('a'); const second = f.press('b'); await flush();
    assert.deepEqual(f.calls, [['snapshot']]);
    release(state(1)); await Promise.all([first, second]);
    assert.deepEqual(f.calls.map(call => call[0]), ['snapshot', 'select']);
    await flush(); assert.equal(f.calls.length, 2);
  } finally { f.plugin.dispose(); }
});

test('controller-specific release events are the only input events allowed to cycle', async () => {
  const f = fixture();
  try {
    await f.appear('key', 'Keypad'); await f.appear('knob', 'Knob'); await f.appear('encoder', 'Encoder'); f.calls.length = 0;
    for (const [context, event, suppliedAction] of [['key', 'keyDown', action], ['key', 'dialUp', action], ['knob', 'keyUp', action], ['knob', 'dialDown', action], ['knob', 'dialRotate', action], ['missing', 'keyUp', action], ['key', 'keyUp', 'other.action']]) await f.press(context, event, suppliedAction);
    assert.deepEqual(f.calls, []);
    await f.press('key'); await f.press('knob', 'dialUp'); await f.press('encoder', 'dialUp');
    assert.deepEqual(f.calls.map(call => call[0]), ['snapshot', 'select', 'snapshot', 'select', 'snapshot', 'select']);
  } finally { f.plugin.dispose(); }
});

test('conflict retains the actual confirmed language and reports failure without automatic retries', async () => {
  const f = fixture();
  try {
    await f.appear(); f.calls.length = 0;
    f.bridge.request = async command => {
      f.calls.push([command]);
      if (command === 'snapshot') return state(1);
      f.bridge.emit('state', state(2, de)); throw Object.assign(new Error('The input source changed. Try again.'), { code: 'conflict' });
    };
    await f.press();
    assert.equal(f.label(), 'DE'); assert.deepEqual(f.calls.map(call => call[0]), ['snapshot', 'select']);
    assert.ok(f.sent.some(value => value.event === 'showAlert' && value.context === 'a'));
  } finally { f.plugin.dispose(); }
});

test('fatal helper faults render unknown, while an empty fresh source list never attempts select', async () => {
  const f = fixture();
  try {
    await f.appear(); f.bridge.emit('fault', Object.assign(new Error('Native helper unavailable.'), { code: 'unavailable' }));
    assert.equal(f.label(), '--'); f.calls.length = 0;
    f.bridge.request = async command => { f.calls.push([command]); const value = state(1, null, []); f.bridge.emit('state', value); return value; };
    await f.press(); assert.deepEqual(f.calls, [['snapshot']]); assert.equal(f.label(), '--');
  } finally { f.plugin.dispose(); }
});

test('dispose removes bridge listeners and late results cannot repaint or issue selection', async () => {
  const f = fixture(); let release;
  await f.appear(); f.calls.length = 0;
  f.bridge.request = async command => { f.calls.push([command]); return new Promise(resolve => { release = resolve; }); };
  const pending = f.press(); await flush(); assert.deepEqual(f.calls, [['snapshot']]);
  f.plugin.dispose(); f.plugin.dispose();
  assert.equal(f.bridge.listenerCount('state'), 0); assert.equal(f.bridge.listenerCount('fault'), 0);
  const before = f.sent.length; f.bridge.emit('state', state(9, ru)); release(state(9, ru)); await pending;
  assert.equal(f.sent.length, before); assert.equal(f.calls.filter(call => call[0] === 'select').length, 0);
  assert.equal(f.calls.filter(call => call[0] === 'dispose').length, 1);
});

test('a newer external source event is not repainted by an older resolved snapshot continuation', async () => {
  const f = fixture(); let releaseSnapshot, releaseSelect;
  try {
    await f.appear();
    f.bridge.request = async command => command === 'snapshot' ? new Promise(resolve => { releaseSnapshot = resolve; }) : new Promise(resolve => { releaseSelect = resolve; });
    const pending = f.press();
    releaseSnapshot(state(9, ru)); f.bridge.emit('state', state(10, de));
    await flush();
    assert.equal(f.label(), 'DE', 'a resolved older reply cannot repaint a newer confirmed source');
    if (releaseSelect) releaseSelect(state(10, de));
    await pending;
  } finally { f.plugin.dispose(); }
});

test('a fatal helper fault invalidates resolved startup and snapshot continuations from that helper generation', async () => {
  for (const operation of ['start', 'snapshot']) {
    const f = fixture(); let release, pending;
    try {
      if (operation === 'start') {
        f.bridge.start = async () => new Promise(resolve => { release = resolve; });
        pending = f.appear();
      } else {
        await f.appear(); f.calls.length = 0;
        f.bridge.request = async command => { f.calls.push([command]); return command === 'snapshot' ? new Promise(resolve => { release = resolve; }) : state(10, ru); };
        pending = f.press();
      }
      release(state(9, ru));
      f.bridge.emit('fault', Object.assign(new Error('Helper unavailable.'), { code: 'unavailable' }));
      await pending;
      assert.equal(f.label(), '--', operation + ': a dead helper cannot restore a resolved old label');
      assert.equal(f.calls.some(call => call[0] === 'select'), false);
    } finally { f.plugin.dispose(); }
  }
});

test('a selection acknowledgement for a different actual source reports failure while retaining actual readback', async () => {
  const f = fixture();
  try {
    await f.appear(); f.calls.length = 0;
    f.bridge.request = async (command, sourceId, options) => { f.calls.push([command, sourceId, options]); return state(command === 'snapshot' ? 1 : 2, en); };
    await f.press();
    assert.equal(f.calls[1][1], 'ru'); assert.equal(f.label(), 'EN');
    assert.ok(f.sent.some(message => message.event === 'showAlert' && message.context === 'a'));
    assert.deepEqual(f.calls.map(call => call[0]), ['snapshot', 'select']);
  } finally { f.plugin.dispose(); }
});

test('context-free wake refreshes visible keys read-only, coalesces pending wakes and can recover a helper fault', async () => {
  const f = fixture(); let release;
  try {
    await f.plugin.handle({ event: 'systemDidWakeUp' }); assert.deepEqual(f.calls, [], 'an unused plugin does not start a helper on wake');
    await f.appear(); f.calls.length = 0;
    const read = async () => { f.calls.push(['wake-read']); return new Promise(resolve => { release = value => { f.bridge.emit('state', value); resolve(value); }; }); };
    f.bridge.start = read;
    f.bridge.request = async command => { assert.equal(command, 'snapshot'); return read(); };
    const first = f.plugin.handle({ event: 'systemDidWakeUp' });
    const second = f.plugin.handle({ event: 'systemDidWakeUp' }); await flush();
    assert.deepEqual(f.calls, [['wake-read']]);
    release(state(5, ru)); await Promise.all([first, second]); assert.equal(f.label(), 'RU');
    f.bridge.emit('fault', Object.assign(new Error('Helper unavailable.'), { code: 'unavailable' })); assert.equal(f.label(), '--');
    f.calls.length = 0;
    const recoveredRead = async () => { f.calls.push(['wake-read']); const value = state(0, de); f.bridge.emit('state', value); return value; };
    f.bridge.start = recoveredRead;
    f.bridge.request = async command => { assert.equal(command, 'snapshot'); return recoveredRead(); };
    await f.plugin.handle({ event: 'systemDidWakeUp' });
    assert.deepEqual(f.calls, [['wake-read']]); assert.equal(f.label(), 'DE');
  } finally { f.plugin.dispose(); }
});

test('Windows cycle binds the selection to the fresh foreground token and preserves actual state after a focus conflict', async () => {
  const f = fixture();
  try {
    await f.appear(); f.calls.length = 0;
    f.bridge.request = async (command, sourceId, options) => {
      f.calls.push([command, sourceId, options]);
      if (command === 'snapshot') return { ...state(1, en), targetToken: 'foreground-a' };
      f.bridge.emit('state', { ...state(2, en), targetToken: 'foreground-b' });
      const error = new Error('The input source changed before selection.'); error.code = 'conflict'; throw error;
    };
    await f.press();
    assert.deepEqual(f.calls, [['snapshot', undefined, undefined], ['select', 'ru', { expectedCurrentId: 'en', expectedTargetToken: 'foreground-a' }]]);
    assert.equal(f.label(), 'EN');
    assert.ok(f.sent.some(message => message.event === 'showAlert'));
    assert.equal(f.calls.length, 2, 'a focus conflict never retries or switches a different foreground application');
    f.bridge.request = async (command, sourceId, options) => { f.calls.push([command, sourceId, options]); return { ...state(command === 'select' ? 4 : 3, command === 'select' ? ru : en), targetToken: 'foreground-b' }; };
    await f.press(); assert.equal(f.label(), 'RU', 'a later explicit press can recover using a new snapshot');
    assert.equal(f.calls.at(-1)[2].expectedTargetToken, 'foreground-b');
  } finally { f.plugin.dispose(); }
});
