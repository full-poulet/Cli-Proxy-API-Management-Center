// Render-check the Routing page against dev/fake-usage-api.py using the headless agent Chrome.
// Claims ONE new tab over CDP, logs in with a dummy key, captures /routing in light and
// dark theme at 1440x900, then closes only that tab. Usage: node dev/screenshot-routing.mjs [port]
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CDP = 'http://127.0.0.1:9222';
const PORT = process.argv[2] || '8899';
const APP = `http://127.0.0.1:${PORT}/`;
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'screenshots');
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tab = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let seq = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.method === 'Runtime.exceptionThrown') {
    console.error('page exception:', msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  }
  if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) {
    console.error('console.' + msg.params.type + ':', msg.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300));
  }
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const { result, exceptionDetails } = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.text);
  return result.value;
};
const waitFor = async (expression, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await sleep(200);
  }
  throw new Error(`timeout waiting for: ${expression}`);
};
const navigate = async (url) => {
  await send('Page.navigate', { url });
  await sleep(600);
};

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });

  for (const theme of ['light', 'dark']) {
    await navigate(APP);
    await evaluate(`(() => {
      localStorage.clear();
      localStorage.setItem('cli-proxy-theme', JSON.stringify({ state: { theme: '${theme}' }, version: 0 }));
      localStorage.setItem('cli-proxy-language', JSON.stringify({ state: { language: 'en' }, version: 0 }));
      return true; })()`);
    await navigate('about:blank');
    await navigate(`${APP}#/login`);
    await waitFor(`!!document.querySelector('input[name="cpa-management-key"]')`);
    await evaluate(`document.querySelector('input[name="cpa-management-key"]').focus(), true`);
    await send('Input.insertText', { text: 'dev-fake-key' });
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await waitFor(`!location.hash.includes('/login')`);

    // In-app navigation via the sidebar: hash-only Page.navigate calls after the first one
    // do not trigger the page transition in headless Chrome, real link clicks do.
    await waitFor(`!!document.querySelector('a[href="#/routing"]')`);
    await evaluate(`document.querySelector('a[href="#/routing"]').click(), true`);
    await waitFor(`document.querySelector('h1')?.textContent === 'Routing' && document.body.innerText.includes('Next up')`);
    await sleep(2500); // let reveal + meter animations settle
    const info = await evaluate(`({ theme: document.documentElement.getAttribute('data-theme'),
      hash: location.hash, title: document.querySelector('h1')?.textContent,
      badges: [...document.querySelectorAll('article span')].map(s => s.textContent).filter(t => /^#|Exhausted|No reading|Disabled/.test(t)).slice(0, 8) })`);
    console.log(theme, JSON.stringify(info));
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, `routing-${theme}.png`), Buffer.from(shot.data, 'base64'));
    // Full-page variant so the explainer + "Recent changes" below the fold are checked too.
    await evaluate(`document.querySelector('details') && (document.querySelector('details').open = true)`);
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1700, deviceScaleFactor: 1, mobile: false });
    await sleep(600);
    const full = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, `routing-${theme}-full.png`), Buffer.from(full.data, 'base64'));
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

    // Bonus: the Quota page rank chips (same login session).
    await waitFor(`!!document.querySelector('a[href="#/quota"]')`);
    await evaluate(`document.querySelector('a[href="#/quota"]').click(), true`);
    await waitFor(`document.querySelector('h1')?.textContent === 'Quota Management'`, 10000);
    await sleep(1500);
    const chips = await evaluate(`[...document.querySelectorAll('article header span')].map(s => s.textContent).filter(t => /^#\\d/.test(t))`);
    console.log(theme, 'quota chips', JSON.stringify(chips));
    const quotaShot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, `quota-${theme}.png`), Buffer.from(quotaShot.data, 'base64'));
  }
} finally {
  try { await send('Target.closeTarget', { targetId: tab.id }); } catch {
    await fetch(`${CDP}/json/close/${tab.id}`);
  }
  ws.close();
}
