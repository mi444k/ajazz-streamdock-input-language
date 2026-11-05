'use strict';
const { HostPlugin } = require('./host.cjs');
const { InputSourceBridge } = require('./bridge.cjs');
function parseLaunchArgs(args) {
  const allowed = new Set(['-port', '-pluginUUID', '-registerEvent', '-info']), values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    if (!allowed.has(args[index]) || values.has(args[index]) || typeof args[index + 1] !== 'string') throw new Error('Invalid plugin launch arguments.');
    values.set(args[index], args[index + 1]);
  }
  const rawPort = values.get('-port'), port = Number(rawPort), uuid = values.get('-pluginUUID'), registerEvent = values.get('-registerEvent');
  let info;
  try { info = JSON.parse(values.get('-info')); } catch { throw new Error('Invalid plugin metadata.'); }
  if (!/^\d+$/.test(rawPort || '') || !Number.isInteger(port) || port < 1 || port > 65535 || !uuid?.trim() || registerEvent !== 'registerPlugin' || !info || typeof info !== 'object' || Array.isArray(info)) throw new Error('Invalid plugin launch arguments.');
  return { port, uuid, registerEvent, info };
}
function startPlugin({ args = process.argv.slice(2), WebSocketImpl = require('../vendor/ws'), BridgeImpl = InputSourceBridge, spawnImpl, helperPath = require('node:path').join(__dirname, '../native/input-source-helper') } = {}) {
  const launch = parseLaunchArgs(args);
  const socket = new WebSocketImpl('ws://127.0.0.1:' + launch.port);
  const bridge = new BridgeImpl({ helperPath, spawnImpl });
  let disposed = false;
  const plugin = new HostPlugin({ uuid: launch.uuid, bridge, send: value => { if (!disposed && socket.readyState === 1) socket.send(JSON.stringify(value)); } });
  function dispose() {
    if (disposed) return;
    disposed = true; plugin.dispose();
    if (socket.readyState === 0 || socket.readyState === 1) socket.close();
  }
  socket.on('open', () => { if (!disposed) plugin.handle({ event: 'connected' }).catch(() => dispose()); });
  socket.on('message', data => {
    if (disposed) return;
    let message;
    try { message = JSON.parse(data.toString()); } catch { return; }
    plugin.handle(message).catch(() => { if (typeof message.context === 'string') plugin.send({ event: 'showAlert', context: message.context }); });
  });
  socket.on('close', dispose); socket.on('error', dispose);
  return { socket, plugin, bridge, dispose };
}
module.exports = { parseLaunchArgs, startPlugin };
if (require.main === module) {
  try {
    const session = startPlugin();
    process.once('SIGTERM', session.dispose); process.once('SIGINT', session.dispose);
  } catch { console.error('Input Language could not start. Check its Stream Dock installation.'); process.exitCode = 1; }
}
