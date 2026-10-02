// Live render-check of the deployed panel: logs in with the management key from env CPA_KEY
// (never printed), refreshes the Quota page, visits the Routing page, saves screenshots.
// Usage: CPA_KEY=... node dev/live-check.mjs https://bb1.tailee0991.ts.net:8444/management.html out-prefix
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const CDP = 'http://127.0.0.1:9222';
const APP = process.argv[2]; const PREFIX = process.argv[3] || 'live';
const KEY = process.env.CPA_KEY; if (!KEY) throw new Error('CPA_KEY missing');
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'screenshots'); mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tab = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map(); const errors = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 200));
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } };
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => { const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (exceptionDetails) throw new Error(exceptionDetails.text); return result.value; };
const waitFor = async (expr, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await evaluate(expr)) return true; await sleep(250); } return false; };
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, `${PREFIX}-${name}.png`), Buffer.from(s.data, 'base64')); };
try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: APP }); await sleep(1500);
  await evaluate(`localStorage.setItem('cli-proxy-theme', JSON.stringify({ state: { theme: 'dark' }, version: 0 })); localStorage.setItem('cli-proxy-language', JSON.stringify({ state: { language: 'en' }, version: 0 })); true`);
  await send('Page.navigate', { url: APP + '#/login' }); await sleep(1500);
  if (await evaluate(`!!document.querySelector('input[name="cpa-management-key"]')`)) {
    await evaluate(`document.querySelector('input[name="cpa-management-key"]').focus(), true`);
    await send('Input.insertText', { text: KEY });
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  }
  console.log('login ok:', await waitFor(`!location.hash.includes('/login') && !!document.querySelector('a[href="#/quota"]')`));
  await shot('dashboard');
  await evaluate(`document.querySelector('a[href="#/quota"]').click(), true`);
  await waitFor(`document.querySelector('h1')?.textContent === 'Quota Management'`);
  await sleep(1500);
  const btn = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => /Refresh all/i.test(b.textContent)); if (b) { b.click(); return true; } return false; })()`);
  console.log('refresh-all clicked:', btn); await sleep(12000);
  console.log('quota text:', await evaluate(`document.body.innerText.replace(/\\s+/g,' ').slice(0, 1800)`));
  await shot('quota');
  await evaluate(`document.querySelector('a[href="#/routing"]').click(), true`);
  await waitFor(`document.querySelector('h1')?.textContent === 'Routing'`); await sleep(4000);
  console.log('routing text:', await evaluate(`document.body.innerText.replace(/\\s+/g,' ').slice(0, 1500)`));
  await shot('routing');
  console.log('page errors:', JSON.stringify([...new Set(errors)].slice(0, 6)));
} finally { try { await send('Target.closeTarget', { targetId: tab.id }); } catch { await fetch(`${CDP}/json/close/${tab.id}`); } ws.close(); }
