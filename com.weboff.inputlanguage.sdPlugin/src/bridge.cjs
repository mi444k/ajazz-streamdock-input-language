'use strict';
const { EventEmitter } = require('node:events');
const { StringDecoder } = require('node:string_decoder');
const { normalizeState } = require('./core.cjs');
const MESSAGES = {
  unavailable: 'Input source helper is unavailable.', timeout: 'Input source request timed out.',
  protocol: 'Input source helper returned an invalid response.', closed: 'Input source helper is closed.',
  invalid_command: 'Invalid input source command.', select_failed: 'The operating system could not select this input source.',
  conflict: 'The input source changed. Press again to choose the next source.'
};
function safeError(code) {
  const known = typeof code === 'string' && Object.hasOwn(MESSAGES, code);
  const error = new Error(known ? MESSAGES[code] : MESSAGES.unavailable);
  error.code = known ? code : 'unavailable';
  return error;
}
function validId(value) { return typeof value === 'string' && Boolean(value.trim()) && value.length <= 1024 && !/[\u0000-\u001f\u007f]/u.test(value); }
class InputSourceBridge extends EventEmitter {
  constructor({ helperPath, spawnImpl = require('node:child_process').spawn, timeoutMs = 3000, setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout } = {}) {
    super();
    Object.assign(this, { helperPath, spawnImpl, setTimeoutImpl, clearTimeoutImpl });
    this.timeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 3000;
    this.child = null; this.generation = 0; this.sequence = 0; this.pending = new Map();
    this.state = null; this.disposed = false; this.startPromise = null;
  }
  start() {
    if (this.startPromise) return this.startPromise;
    const promise = this.request('snapshot');
    this.startPromise = promise;
    promise.finally(() => { if (this.startPromise === promise) this.startPromise = null; }).catch(() => {});
    return promise;
  }
  launch() {
    const child = this.spawnImpl(this.helperPath, [], { stdio: ['pipe', 'pipe', 'ignore'], shell: false, windowsHide: true });
    this.child = child; this.state = null;
    const generation = ++this.generation;
    const current = () => this.child === child && this.generation === generation && !this.disposed;
    let decoder = new StringDecoder('utf8'), buffer = '', bytes = 0;
    child.stdout.on('data', chunk => {
      if (!current()) return;
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      let offset = 0;
      while (offset < data.length && current()) {
        const newline = data.indexOf(10, offset), end = newline < 0 ? data.length : newline;
        const segment = data.subarray(offset, end);
        bytes += segment.length;
        if (bytes > 65536) { this.fail(safeError('protocol')); return; }
        buffer += decoder.write(segment);
        if (newline < 0) break;
        buffer += decoder.end();
        this.line(buffer);
        decoder = new StringDecoder('utf8'); buffer = ''; bytes = 0;
        offset = newline + 1;
      }
    });
    child.on('error', () => { if (current()) this.fail(safeError('unavailable')); });
    child.on('exit', () => { if (current()) this.fail(safeError('unavailable'), false); });
    child.on('close', () => { if (current()) this.fail(safeError('unavailable'), false); });
    child.stdin.on?.('error', () => { if (current()) this.fail(safeError('unavailable')); });
  }
  line(line) {
    let raw;
    try { raw = JSON.parse(line); } catch { this.fail(safeError('protocol')); return; }
    if (raw?.type === 'error') {
      if (typeof raw.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(raw.id) || !['unavailable', 'invalid_command', 'select_failed', 'conflict'].includes(raw.code)) { this.fail(safeError('protocol')); return; }
      const error = safeError(raw.code);
      if (raw.code === 'unavailable') { this.fail(error); return; }
      const pending = this.pending.get(raw.id);
      if (pending) { this.pending.delete(raw.id); this.clearTimeoutImpl(pending.timer); pending.reject(error); }
      this.emit('fault', error);
      return;
    }
    const value = normalizeState(raw);
    if (!value) { this.fail(safeError('protocol')); return; }
    if (!this.state || value.revision > this.state.revision) {
      this.state = value;
      this.emit('state', structuredClone(value));
    }
    const pending = this.pending.get(value.id);
    if (pending) { this.pending.delete(value.id); this.clearTimeoutImpl(pending.timer); pending.resolve(structuredClone(this.state)); }
  }
  async request(command, sourceId, options = {}) {
    if (this.disposed) throw safeError('closed');
    if (!['snapshot', 'select'].includes(command)) throw safeError('invalid_command');
    if (command === 'select' && (!validId(sourceId) || !Object.hasOwn(options, 'expectedCurrentId') || (options.expectedCurrentId !== null && !validId(options.expectedCurrentId)))) throw safeError('invalid_command');
    if (command === 'select' && Object.hasOwn(options, 'expectedTargetToken') && (typeof options.expectedTargetToken !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(options.expectedTargetToken))) throw safeError('invalid_command');
    if (!this.child) {
      if (command !== 'snapshot') throw safeError('unavailable');
      try { this.launch(); } catch { this.fail(safeError('unavailable')); throw safeError('unavailable'); }
    }
    const id = this.generation + '-' + ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = this.setTimeoutImpl(() => this.fail(safeError('timeout')), this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.child.stdin.write(JSON.stringify({ id, command, ...(command === 'select' ? { sourceId, expectedCurrentId: options.expectedCurrentId, ...(options.expectedTargetToken === undefined ? {} : { expectedTargetToken: options.expectedTargetToken }) } : {}) }) + '\n'); }
      catch { this.fail(safeError('unavailable')); }
    });
  }
  fail(error, kill = true, notify = true) {
    const child = this.child;
    this.child = null; this.state = null; this.generation++;
    for (const pending of this.pending.values()) { this.clearTimeoutImpl(pending.timer); pending.reject(error); }
    this.pending.clear();
    if (child && kill) { try { child.stdin.end(); child.kill(); } catch { /* The helper is already unavailable. */ } }
    if (notify) this.emit('fault', error);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.fail(safeError('closed'), true, false);
  }
}
module.exports = { InputSourceBridge };
