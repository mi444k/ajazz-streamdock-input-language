'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { parseLaunchArgs, startPlugin } = require('../src/plugin.js');
const args = ['-port', '23599', '-pluginUUID', 'language-instance', '-registerEvent', 'registerPlugin', '-info', '{}'];
const flush = () => new Promise(resolve => setImmediate(resolve));

test('AJAZZ launch flags are order independent and restrict the connection to a valid local port', () => {
  assert.deepEqual(parseLaunchArgs(['-info', '{"application":{"version":"2"}}', '-registerEvent', 'registerPlugin', '-pluginUUID', 'language-instance', '-port', '23599']), { port: 23599, uuid: 'language-instance', registerEvent: 'registerPlugin', info: { application: { version: '2' } } });
  for (const port of ['0', '65536', '-1', '23.5', '23599evil', '1@remote.invalid']) { const invalid = [...args]; invalid[1] = port; assert.throws(() => parseLaunchArgs(invalid)); }
  for (const info of ['null', '[]', '{bad']) { const invalid = [...args]; invalid[7] = info; assert.throws(() => parseLaunchArgs(invalid)); }
  assert.throws(() => parseLaunchArgs(['-port', '23599']));
});

function fixture() {
  const sockets = [], bridges = [];
  class Socket extends EventEmitter {
    static OPEN = 1;
    constructor(url) { super(); this.url = url; this.sent = []; this.readyState = 0; this.closed = 0; sockets.push(this); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.closed++; this.readyState = 3; this.emit('close'); }
    terminate() { this.close(); }
  }
  class Bridge extends EventEmitter {
    constructor(options) { super(); this.options = options; this.starts = 0; this.disposals = 0; bridges.push(this); }
    async start() { this.starts++; const value = { type: 'state', revision: 0, current: { id: 'en', name: 'English', languages: ['en'] }, sources: [{ id: 'en', name: 'English', languages: ['en'] }] }; this.emit('state', value); return value; }
    async request() { throw new Error('This integration must never select any input source.'); }
    dispose() { this.disposals++; }
  }
  return { sockets, bridges, Socket, Bridge, launch: () => startPlugin({ platform: 'darwin', args, WebSocketImpl: Socket, BridgeImpl: Bridge, helperPath: '/fake/helper' }) };
}

test('native entry registers over loopback and defers helper startup until an action becomes visible', async () => {
  const f = fixture(); const session = f.launch();
  assert.ok(session && session.socket && session.plugin && session.bridge, 'launching returns a live wired plugin session');
  try {
    assert.equal(f.sockets.length, 1); assert.equal(f.sockets[0].url, 'ws://127.0.0.1:23599');
    assert.equal(f.bridges.length, 1); assert.equal(f.bridges[0].starts, 0); assert.equal(f.bridges[0].options.helperPath, '/fake/helper');
    session.socket.readyState = 1; session.socket.emit('open'); await flush();
    assert.deepEqual(session.socket.sent, [{ event: 'registerPlugin', uuid: 'language-instance' }]);
    session.socket.emit('message', Buffer.from('{invalid')); await flush(); assert.equal(f.bridges[0].starts, 0);
    session.socket.emit('message', Buffer.from(JSON.stringify({ event: 'willAppear', action: 'com.weboff.inputlanguage.cycle', context: 'key', payload: { settings: {} } })));
    await flush(); assert.equal(f.bridges[0].starts, 1);
    assert.ok(session.socket.sent.some(message => message.event === 'setImage'));
  } finally { session.dispose(); }
  assert.equal(f.bridges[0].disposals, 1);
});

test('socket close or failure disposes the bridge exactly once and ignores later socket events', async () => {
  for (const event of ['close', 'error']) {
    const f = fixture(); const session = f.launch();
    assert.ok(session?.socket, 'a valid launch creates the socket needed for lifecycle handling');
    session.socket.readyState = 1; session.socket.emit('open'); await flush();
    assert.doesNotThrow(() => session.socket.emit(event, event === 'error' ? new Error('Fake transport failure') : undefined));
    session.dispose(); assert.equal(f.bridges[0].disposals, 1);
    const before = session.socket.sent.length;
    session.socket.emit('message', Buffer.from(JSON.stringify({ event: 'willAppear', action: 'com.weboff.inputlanguage.cycle', context: 'late', payload: { settings: {} } })));
    await flush(); assert.equal(f.bridges[0].starts, 0); assert.equal(session.socket.sent.length, before);
  }
});

test('manifest exposes one macOS Node20 action with keypad and knob support and existing assets', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.json'), 'utf8'));
  assert.equal(manifest.Version, '0.3.0'); assert.equal(manifest.Actions.length, 1);
  assert.equal(manifest.Nodejs.Version, '20'); assert.equal(manifest.CodePath, 'src/plugin.js');
  assert.ok(manifest.OS.some(value => value.Platform === 'mac' && value.MinimumVersion === '13.0'));
  const action = manifest.Actions[0]; assert.equal(action.UUID, 'com.weboff.inputlanguage.cycle');
  assert.deepEqual([...action.Controllers].sort(), ['Keypad', 'Knob']);
  assert.ok(action.States.length > 0); assert.ok(action.States.every(state => state.ShowTitle === true));
  for (const file of [manifest.CodePath, manifest.Icon, manifest.CategoryIcon, action.Icon, ...action.States.map(state => state.Image)]) assert.ok(typeof file === 'string' && fs.existsSync(path.join(__dirname, '..', file)), String(file));
});
