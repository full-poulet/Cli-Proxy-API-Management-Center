// Minimal CDP helper shared by the dev screenshot scripts.
// Claims ONE new tab in the already-running agent Chrome (chrome-agent, port 9222),
// never launches or kills the browser, and closes only that tab in `close()`.
const CDP = 'http://127.0.0.1:9222';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function openTab({ width = 1440, height = 900 } = {}) {
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
  const resize = (w, h) =>
    send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  const screenshot = async () => Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64');
  const typeText = async (text) => {
    await send('Input.insertText', { text });
  };
  const pressEnter = async () => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  };
  const close = async () => {
    try { await send('Target.closeTarget', { targetId: tab.id }); } catch {
      await fetch(`${CDP}/json/close/${tab.id}`);
    }
    ws.close();
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await resize(width, height);
  return { send, evaluate, waitFor, navigate, resize, screenshot, typeText, pressEnter, close };
}

/** Reset storage to the given theme/language, then log in at the fake backend with a dummy key. */
export async function loginFresh(page, app, { theme = 'dark', language = 'en', extraStorage = {} } = {}) {
  await page.navigate(app);
  await page.evaluate(`(() => {
    localStorage.clear();
    localStorage.setItem('cli-proxy-theme', JSON.stringify({ state: { theme: '${theme}' }, version: 0 }));
    localStorage.setItem('cli-proxy-language', JSON.stringify({ state: { language: '${language}' }, version: 0 }));
    ${Object.entries(extraStorage).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('\n')}
    return true; })()`);
  await page.navigate('about:blank');
  await page.navigate(`${app}#/login`);
  await page.waitFor(`!!document.querySelector('input[name="cpa-management-key"]')`);
  await page.evaluate(`document.querySelector('input[name="cpa-management-key"]').focus(), true`);
  await page.typeText('dev-fake-key');
  await page.pressEnter();
  await page.waitFor(`!location.hash.includes('/login')`);
}

/** In-app navigation via a sidebar link: hash-only Page.navigate calls after the first one
 *  do not trigger the page transition in headless Chrome, real link clicks do. */
export async function clickSidebar(page, hash) {
  await page.waitFor(`!!document.querySelector('a[href="${hash}"]')`);
  await page.evaluate(`document.querySelector('a[href="${hash}"]').click(), true`);
}
