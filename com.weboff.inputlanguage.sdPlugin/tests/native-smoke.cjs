'use strict';
// Post-implementation integration coverage. Native selection commands are blocked before transmission.
const path = require('node:path');
const { spawn } = require('node:child_process');
if (process.argv[2] === '--child') {
  const { startPlugin } = require('../src/plugin.js');
  const session = startPlugin({ args: process.argv.slice(3), spawnImpl: (...args) => {
    const helper = spawn(...args);
    const snapshotIds = new Set(); let output = '';
    helper.stdout.on('data', data => {
      output += data.toString('utf8');
      let newline;
      while ((newline = output.indexOf('\n')) >= 0) {
        const line = output.slice(0, newline); output = output.slice(newline + 1);
        try {
          const value = JSON.parse(line);
          if (value.type === 'state' && snapshotIds.delete(value.id)) setImmediate(() => process.send?.({ snapshotReply: true }));
        } catch { /* The real bridge owns validation; this observer only counts matching replies. */ }
      }
    });
    const write = helper.stdin.write.bind(helper.stdin);
    helper.stdin.write = (data, ...options) => {
      const command = JSON.parse(String(data));
      process.send?.({ nativeCommand: command.command });
      if (command.command !== 'snapshot') throw new Error('Read-only native smoke forbids selection.');
      snapshotIds.add(command.id);
      return write(data, ...options);
    };
    return helper;
  } });
  process.once('SIGTERM', session.dispose);
  process.once('SIGINT', session.dispose);
} else {
  const assert = require('node:assert/strict');
  const { once } = require('node:events');
  const WebSocket = require('../vendor/ws');
  (async () => {
    const server = new WebSocket.Server({ host: '127.0.0.1', port: 0 });
    await once(server, 'listening');
    let socket, registered = false, actualLanguage = null, wakeSent = false, stderr = '', snapshots = 0, replies = 0, frames = 0;
    let child, watchdog;
    try {
      const complete = new Promise((resolve, reject) => {
        function wakeWhenReady() {
          if (actualLanguage && replies >= 1 && !wakeSent) { wakeSent = true; socket.send(JSON.stringify({ event: 'systemDidWakeUp' })); }
          if (replies >= 2 && actualLanguage && wakeSent) socket.close();
        }
        watchdog = setTimeout(() => reject(new Error('Read-only native smoke timed out: ' + JSON.stringify({ registered, actualLanguage, wakeSent, snapshots, frames, stderrPresent: Boolean(stderr) }))), 10000);
        server.on('connection', connection => {
          socket = connection;
          connection.on('message', data => {
            try {
              const message = JSON.parse(String(data)); frames++;
              if (message.event === 'registerPlugin') {
                assert.equal(message.uuid, 'native-language-smoke'); registered = true;
                connection.send('{invalid');
                connection.send(JSON.stringify({ event: 'willAppear', context: 'language-key', action: 'com.weboff.inputlanguage.cycle', payload: { controller: 'Keypad', settings: {} } }));
              }
              if (message.event === 'setImage') {
                const image = message.payload?.image;
                assert.ok(image?.startsWith('data:image/svg+xml;base64,'));
                const svg = Buffer.from(image.split(',')[1], 'base64').toString('utf8');
                const label = /data-role="language"[^>]*>([^<]*)<\/text>/.exec(svg)?.[1];
                if (/^[A-Z]{2,3}$/.test(label || '')) {
                  actualLanguage = label;
                  wakeWhenReady();
                }
              }
            } catch (error) { reject(error); }
          });
        });
        child = spawn('/Applications/Stream Dock AJAZZ.app/Contents/Helpers/node20', [__filename, '--child', '-port', String(server.address().port), '-pluginUUID', 'native-language-smoke', '-registerEvent', 'registerPlugin', '-info', '{}'], { cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
        child.stderr.on('data', data => { stderr += data; });
        child.on('message', value => {
          if (value.snapshotReply) { replies++; wakeWhenReady(); return; }
          if (value.nativeCommand !== 'snapshot') { reject(new Error('Unexpected mutation command.')); return; }
          snapshots++;
        });
        child.once('error', reject);
        child.once('exit', (code, signal) => {
          try {
            assert.equal(code, 0); assert.equal(signal, null); assert.equal(registered, true);
            assert.ok(actualLanguage); assert.equal(wakeSent, true); assert.equal(snapshots, 2); assert.equal(replies, 2);
            assert.equal(stderr, ''); resolve();
          } catch (error) { reject(error); }
        });
      });
      await complete;
      console.log(JSON.stringify({ nativeNode: 'AJAZZ bundled Node20', entry: 'real startPlugin export', nativeHelper: 'actual macOS helper', registration: 'passed', confirmedLanguage: actualLanguage, snapshotReads: snapshots, nativeSelections: 0, wakeRead: 'passed', socketCloseExit: 0, frames }));
    } finally {
      clearTimeout(watchdog);
      if (child && child.exitCode === null) child.kill('SIGTERM');
      for (const client of server.clients) client.terminate();
      await new Promise(resolve => server.close(resolve));
    }
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
