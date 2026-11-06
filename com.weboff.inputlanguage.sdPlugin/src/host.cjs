'use strict';
const { languageCode, nextSourceId, normalizeState } = require('./core.cjs');
const ACTION = 'com.weboff.inputlanguage.cycle';
function keyImage(code, failed) {
  const size = code.length > 2 ? 20 : 30;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><defs><linearGradient id="background" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#10253a"/><stop offset="1" stop-color="#244b69"/></linearGradient></defs><rect width="64" height="64" fill="url(#background)"/><text data-role="language" x="32" y="41" text-anchor="middle" font-family="Avenir Next" font-weight="700" font-size="' + size + '" fill="#f5fbff">' + code + '</text><text x="32" y="57" text-anchor="middle" font-family="Avenir Next" font-size="7" fill="' + (failed ? '#ffb8b0' : '#b3cddd') + '">' + (failed ? 'Unavailable' : 'Input language') + '</text></svg>';
  return 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');
}
class HostPlugin {
  constructor({ uuid, send, bridge } = {}) {
    this.uuid = uuid; this.sendMessage = send; this.bridge = bridge;
    this.visible = new Map(); this.state = null; this.disposed = false; this.failed = false;
    this.started = false; this.startPromise = null; this.cycleBusy = false;
    this.epoch = 0; this.cycleToken = null; this.wakePromise = null;
    this.onState = value => this.confirm(value);
    this.onFault = error => {
      if (this.disposed) return;
      if (!['conflict', 'select_failed', 'invalid_command'].includes(error?.code)) {
        this.epoch++; this.state = null; this.started = false; this.failed = true;
        this.startPromise = null; this.wakePromise = null; this.cycleToken = null; this.cycleBusy = false;
      }
      this.tick();
    };
    bridge.on('state', this.onState); bridge.on('fault', this.onFault);
  }
  send(value) { if (!this.disposed && typeof this.sendMessage === 'function') this.sendMessage(value); }
  confirm(value) {
    if (this.disposed) return null;
    const clean = normalizeState(value);
    if (!clean) return null;
    if (this.state && clean.revision <= this.state.revision) return this.state;
    this.state = clean; this.started = true; this.failed = false; this.tick();
    return clean;
  }
  async ensureStarted() {
    if (this.started) return this.state;
    if (this.startPromise) return this.startPromise;
    const epoch = this.epoch;
    const promise = (async () => {
      try { const value = await this.bridge.start(); return !this.disposed && epoch === this.epoch ? this.confirm(value) : null; }
      catch (error) { if (epoch === this.epoch) this.onFault(error); return null; }
    })();
    this.startPromise = promise;
    try { return await promise; }
    finally { if (this.startPromise === promise) this.startPromise = null; }
  }
  async cycle(context) {
    if (this.disposed || this.cycleBusy) return;
    this.cycleBusy = true;
    const token = {}, epoch = this.epoch;
    this.cycleToken = token;
    try {
      const snapshot = normalizeState(await this.bridge.request('snapshot'));
      if (this.disposed || epoch !== this.epoch || !snapshot) return;
      const confirmed = this.confirm(snapshot);
      const sourceId = nextSourceId(confirmed.current?.id, confirmed.sources);
      if (sourceId === null) return;
      const result = await this.bridge.request('select', sourceId, { expectedCurrentId: confirmed.current?.id ?? null, ...(confirmed.targetToken === undefined ? {} : { expectedTargetToken: confirmed.targetToken }) });
      if (!this.disposed && epoch === this.epoch) {
        const actual = this.confirm(result);
        if (actual?.current?.id !== sourceId) this.send({ event: 'showAlert', context });
      }
    } catch (error) {
      if (this.disposed || epoch !== this.epoch) return;
      this.onFault(error);
      this.send({ event: 'showAlert', context });
    } finally { if (this.cycleToken === token) { this.cycleToken = null; this.cycleBusy = false; } }
  }
  async wake() {
    if (!this.visible.size || this.disposed) return;
    if (this.wakePromise) return this.wakePromise;
    if (this.startPromise) return this.startPromise;
    const epoch = this.epoch;
    const promise = (async () => {
      try {
        const value = await (this.started ? this.bridge.request('snapshot') : this.bridge.start());
        if (!this.disposed && epoch === this.epoch) this.confirm(value);
      } catch (error) { if (epoch === this.epoch) this.onFault(error); }
    })();
    this.wakePromise = promise;
    try { await promise; } finally { if (this.wakePromise === promise) this.wakePromise = null; }
  }
  async handle(message) {
    if (this.disposed || !message || typeof message !== 'object') return;
    if (message.event === 'connected') { this.send({ event: 'registerPlugin', uuid: this.uuid }); return; }
    if (message.event === 'systemDidWakeUp') { await this.wake(); return; }
    if (message.action !== ACTION || typeof message.context !== 'string') return;
    if (message.event === 'willAppear') {
      this.visible.set(message.context, { controller: typeof message.payload?.controller === 'string' ? message.payload.controller : 'Keypad' });
      this.tick(); await this.ensureStarted();
    } else if (message.event === 'willDisappear') this.visible.delete(message.context);
    else {
      const item = this.visible.get(message.context);
      if (!item) return;
      if ((message.event === 'keyUp' && item.controller === 'Keypad') || (message.event === 'dialUp' && ['Knob', 'Encoder'].includes(item.controller))) await this.cycle(message.context);
    }
  }
  tick() {
    if (this.disposed) return;
    const image = keyImage(languageCode(this.state?.current), this.failed);
    for (const [context, item] of this.visible) {
      if (item.lastImage === image) continue;
      this.send({ event: 'setTitle', context, payload: { title: '', target: 0 } });
      this.send({ event: 'setImage', context, payload: { image, target: 0 } });
      item.lastImage = image;
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.epoch++;
    this.bridge.off('state', this.onState); this.bridge.off('fault', this.onFault);
    this.bridge.dispose(); this.visible.clear(); this.state = null;
  }
}
module.exports = { HostPlugin };
