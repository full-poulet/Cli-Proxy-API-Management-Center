// Render-check the Quota page layouts against dev/fake-usage-api.py (which stubs the
// upstream usage calls) using the headless agent Chrome. Claims ONE tab, logs in, loads
// every credential with "Refresh all credentials", then captures:
//   ledger-dark-idle.png  Ledger before any quota is loaded (click-to-load rows)
//   ledger-dark.png     Ledger layout, emails masked (default)
//   card-dark.png       Card layout, same data
//   routing-masked.png  Routing page with masked emails and the "est." marker
// Usage: node dev/screenshot-ledger.mjs [port]
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clickSidebar, loginFresh, openTab, sleep } from './cdp.mjs';

const PORT = process.argv[2] || '8899';
const APP = `http://127.0.0.1:${PORT}/`;
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'screenshots');
mkdirSync(OUT, { recursive: true });

const viewStorage = (layout) =>
  JSON.stringify({ state: { layout, showEmails: false, showGeneralWeekly: false }, version: 0 });

const page = await openTab({ width: 1440, height: 1000 });
try {
  for (const layout of ['ledger', 'cards']) {
    await loginFresh(page, APP, {
      theme: 'dark',
      extraStorage: { 'cli-proxy-quota-view': viewStorage(layout) },
    });
    await clickSidebar(page, '#/quota');
    await page.waitFor(`document.querySelector('h1')?.textContent === 'Quota Management'`, 10000);
    await page.waitFor(`document.body.innerText.includes('4 credentials')`);
    if (layout === 'ledger') {
      await sleep(1200);
      writeFileSync(join(OUT, 'ledger-dark-idle.png'), await page.screenshot());
    }
    // Load every credential through the header action (click-to-load otherwise).
    await page.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Refresh all credentials')).click(), true`);
    await page.waitFor(`document.body.innerText.includes('4 loaded')`, 20000);
    await sleep(2500); // reveal + meter animations
    const info = await page.evaluate(`({
      layout: ${JSON.stringify(layout)},
      names: [...document.querySelectorAll('span')].map(s => s.textContent).filter(t => /\\.json$/.test(t)),
      big: [...document.querySelectorAll('article span')].map(s => s.textContent).filter(t => /^\\d+%$|^--$/.test(t)).slice(0, 4),
      noReset: (document.body.innerText.match(/No reset pending/g) || []).length,
      chips: [...document.querySelectorAll('span')].map(s => s.textContent).filter(t => /^#\\d/.test(t)),
    })`);
    console.log(JSON.stringify(info));
    writeFileSync(join(OUT, layout === 'ledger' ? 'ledger-dark.png' : 'card-dark.png'), await page.screenshot());
    if (layout === 'ledger') {
      // Full-height variant so the Codex group and the timeline below are checked too.
      await page.resize(1440, 1800);
      await sleep(600);
      writeFileSync(join(OUT, 'ledger-dark-full.png'), await page.screenshot());
      await page.resize(1440, 1000);

      // Interaction checks: "Show" reveals Claude's general 7-day column, "Show emails" unmasks.
      await page.evaluate(`[...document.querySelectorAll('article button')].find(b => b.textContent === 'Show').click(), true`);
      await sleep(300);
      const shown = await page.evaluate(`({
        sevenDayColumns: [...document.querySelectorAll('span')].filter(s => s.textContent === '7-day limit').length,
        toggle: [...document.querySelectorAll('article button')].map(b => b.textContent).filter(t => /^(Show|Hide)$/.test(t)),
      })`);
      console.log('after Show', JSON.stringify(shown));
      await page.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Show emails')).click(), true`);
      await sleep(300);
      const unmasked = await page.evaluate(`[...document.querySelectorAll('span')].map(s => s.textContent).filter(t => /\.json$/.test(t)).slice(0, 4)`);
      console.log('after Show emails', JSON.stringify(unmasked));
      await page.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Hide emails')).click(), true`);
      await page.evaluate(`[...document.querySelectorAll('article button')].find(b => b.textContent === 'Hide').click(), true`);
    }
  }

  // Light theme sanity pass of the ledger (tokens, not layout).
  await loginFresh(page, APP, { theme: 'light', extraStorage: { 'cli-proxy-quota-view': viewStorage('ledger') } });
  await clickSidebar(page, '#/quota');
  await page.waitFor(`document.body.innerText.includes('4 credentials')`);
  await page.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Refresh all credentials')).click(), true`);
  await page.waitFor(`document.body.innerText.includes('4 loaded')`, 20000);
  await sleep(2000);
  writeFileSync(join(OUT, 'ledger-light.png'), await page.screenshot());

  // Routing page with masked emails (same session, same store flag).
  await clickSidebar(page, '#/routing');
  await page.waitFor(`document.querySelector('h1')?.textContent === 'Routing' && document.body.innerText.includes('Next up')`);
  await sleep(2000);
  const routing = await page.evaluate(`({
    identities: [...document.querySelectorAll('article header span')].map(s => s.textContent).filter(t => t.includes('@')),
    est: (document.body.innerText.match(/est\\./g) || []).length,
  })`);
  console.log('routing', JSON.stringify(routing));
  writeFileSync(join(OUT, 'routing-masked.png'), await page.screenshot());
} finally {
  await page.close();
}
