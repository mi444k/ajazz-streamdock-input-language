'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('the release manifest exposes a Windows 10 Node20 entry alongside the supported macOS entry', () => {
  const root = path.join(__dirname, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const windows = manifest.OS.find(value => value.Platform === 'windows');
  assert.ok(windows, 'Windows must be an advertised supported platform, rather than only having an unused CodePathWin');
  assert.equal(windows.MinimumVersion, '10');
  assert.equal(manifest.OS.find(value => value.Platform === 'mac')?.MinimumVersion, '13.0');
  assert.equal(manifest.Nodejs.Version, '20');
  assert.equal(manifest.CodePathWin, 'src/plugin.js');
  assert.ok(fs.existsSync(path.join(root, manifest.CodePathWin)));
  assert.equal(manifest.Version, '0.3.0');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version, '0.3.0');
  assert.ok(manifest.Actions.every(action => !action.OS || action.OS.includes('windows')));
});

test('the package test command discovers test files without depending on shell wildcard expansion', () => {
  const root = path.join(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const command = /^node\s+(.+)$/.exec(pkg.scripts.test);
  assert.ok(command, 'the test command uses the current Node runtime');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'streamdock-portable-test-'));
  try {
    fs.mkdirSync(path.join(temporary, 'tests'));
    fs.writeFileSync(path.join(temporary, 'package.json'), JSON.stringify({ type: 'commonjs' }));
    fs.writeFileSync(path.join(temporary, 'tests', 'portable.test.cjs'), "const test=require('node:test');const assert=require('node:assert/strict');test('portable fixture',()=>assert.equal(1,1));\n");
    if (fs.existsSync(path.join(root, 'scripts'))) fs.cpSync(path.join(root, 'scripts'), path.join(temporary, 'scripts'), { recursive: true });
    const result = spawnSync(process.execPath, command[1].split(/\s+/), { cwd: temporary, encoding: 'utf8', shell: false });
    assert.equal(result.status, 0, 'a Windows-style unexpanded argv must still discover and execute the test');
    assert.match(result.stdout, /# tests 1\b/);
    assert.match(result.stdout, /# pass 1\b/);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});


test('entry chooses the native helper for the actual platform and rejects unsupported systems before allocating resources', () => {
  const { EventEmitter } = require('node:events');
  const { startPlugin } = require('../src/plugin.js');
  let allocations = 0;
  class Socket extends EventEmitter { constructor() { super(); allocations++; this.readyState = 3; } }
  class Helper extends EventEmitter { constructor(options) { super(); this.options = options; } dispose() {} }
  const args = ['-port', '23599', '-pluginUUID', 'platform-fixture', '-registerEvent', 'registerPlugin', '-info', '{}'];
  function launch(platform, extra = {}) { return startPlugin({ args, platform, WebSocketImpl: Socket, BridgeImpl: Helper, ...extra }); }
  for (const [platform, name] of [['win32', 'input-source-helper.exe'], ['darwin', 'input-source-helper']]) {
    const session = launch(platform);
    try { assert.equal(path.basename(session.bridge.options.helperPath), name, 'platform routing must choose the correct executable'); }
    finally { session.dispose(); }
  }
  const custom = launch('win32', { helperPath: '/synthetic/override-helper' });
  try { assert.equal(custom.bridge.options.helperPath, '/synthetic/override-helper'); } finally { custom.dispose(); }
  const before = allocations;
  assert.throws(() => launch('unsupported-os'), 'unsupported systems fail rather than trying to execute a macOS binary');
  assert.equal(allocations, before, 'unsupported launch must not allocate a socket');
});

test('the action shows a user-stylable native title for the language label', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  const action = manifest.Actions.find(value => value.UUID === 'com.weboff.inputlanguage.cycle');
  assert.equal(action.UserTitleEnabled, true);
  assert.ok(action.States.every(state => state.ShowTitle === true));
});
