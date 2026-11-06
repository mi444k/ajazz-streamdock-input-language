'use strict';
// Visual acceptance on actual Windows Chrome; all source states are synthetic.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { EventEmitter } = require('node:events');
const { HostPlugin } = require('../src/host.cjs');
assert.equal(process.platform, 'win32', 'Actual Windows rendering is required.');
const chrome = [process.env.CHROME_PATH, ...[process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean).map(root => path.join(root, 'Google/Chrome/Application/chrome.exe'))].find(file => file && fs.existsSync(file));
assert.ok(chrome, 'Windows Google Chrome is required.');
(async () => {
  const images = [];
  for (const code of ['en', 'ru', 'de', 'fil', null]) {
    const bridge = new EventEmitter(), sent = [];
    bridge.start = async () => ({ type: 'state', revision: 1, current: code ? { id: code, name: 'Example source', languages: [code] } : null, sources: [] });
    bridge.dispose = () => {};
    const host = new HostPlugin({ uuid: 'visual-fixture', bridge, send: value => sent.push(value) });
    try {
      await host.handle({ event: 'willAppear', action: 'com.weboff.inputlanguage.cycle', context: 'visual-key', payload: {} });
      const uri = sent.filter(value => value.event === 'setImage').at(-1).payload.image;
      images.push(Buffer.from(uri.split(',')[1], 'base64').toString('utf8'));
    } finally { host.dispose(); }
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'input-language-render-'));
  const output = path.join(__dirname, 'render-output'); fs.mkdirSync(output, { recursive: true });
  try {
    const html = `<!doctype html><meta charset="utf-8"><style>body{margin:16px;background:#fff;display:flex;gap:12px}section{width:160px}svg{width:128px;height:128px}svg text{font-family:'Trebuchet MS',sans-serif!important}section>svg+svg{width:64px;height:64px}</style>${images.map(image => `<section>${image}${image}</section>`).join('')}<pre id="result">pending</pre><script>(async()=>{await document.fonts.ready;const rows=[...document.querySelectorAll('svg text')].map(node=>{const a=node.getBoundingClientRect(),b=node.ownerSVGElement.getBoundingClientRect();return {x:(a.left-b.left)*64/b.width,right:(a.right-b.left)*64/b.width,y:(a.top-b.top)*64/b.height,bottom:(a.bottom-b.top)*64/b.height};});document.getElementById('result').textContent=JSON.stringify({ready:true,rows});})();</script>`;
    const input = path.join(temporary, 'render.html'); fs.writeFileSync(input, html.replace('<style>', '<style>pre{display:none}'));
    const result = spawnSync(chrome, ['--headless', '--no-first-run', `--user-data-dir=${path.join(temporary, 'profile')}`, '--dump-dom', '--virtual-time-budget=10000', '--window-size=960,350', `--screenshot=${path.join(output, 'input-language-windows.png')}`, pathToFileURL(input).href], { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true });
    assert.ifError(result.error); assert.equal(result.status, 0);
    const match = result.stdout.match(/<pre id="result">([^<]+)<\/pre>/); assert.ok(match);
    const data = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')); assert.equal(data.ready, true); assert.equal(data.rows.length, 20);
    for (const row of data.rows) for (const [key, value] of Object.entries(row)) assert.ok(Number.isFinite(value) && value >= -0.05 && value <= 64.05, 'Rendered ' + key + ' stays inside the key.');
    assert.ok(fs.statSync(path.join(output, 'input-language-windows.png')).size > 0);
    console.log(JSON.stringify({ platform: process.platform, syntheticCodes: 5, measuredTextRows: data.rows.length, allBoundsInside64: true, screenshot: 'input-language-windows.png' }));
  } finally { fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
