// Render-check the Routing page against dev/fake-usage-api.py using the headless agent Chrome.
// Claims ONE new tab over CDP, logs in with a dummy key, captures /routing in light and
// dark theme at 1440x900, then closes only that tab. Usage: node dev/screenshot-routing.mjs [port]
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clickSidebar, loginFresh, openTab, sleep } from './cdp.mjs';

const PORT = process.argv[2] || '8899';
const APP = `http://127.0.0.1:${PORT}/`;
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'screenshots');
mkdirSync(OUT, { recursive: true });

const page = await openTab({ width: 1440, height: 900 });
try {
  for (const theme of ['light', 'dark']) {
    await loginFresh(page, APP, { theme });

    await clickSidebar(page, '#/routing');
    await page.waitFor(`document.querySelector('h1')?.textContent === 'Routing' && document.body.innerText.includes('Next up')`);
    await sleep(2500); // let reveal + meter animations settle
    const info = await page.evaluate(`({ theme: document.documentElement.getAttribute('data-theme'),
      hash: location.hash, title: document.querySelector('h1')?.textContent,
      badges: [...document.querySelectorAll('article span')].map(s => s.textContent).filter(t => /^#|Exhausted|No reading|Disabled/.test(t)).slice(0, 8) })`);
    console.log(theme, JSON.stringify(info));
    writeFileSync(join(OUT, `routing-${theme}.png`), await page.screenshot());
    // Full-page variant so the explainer + "Recent changes" below the fold are checked too.
    await page.evaluate(`document.querySelector('details') && (document.querySelector('details').open = true)`);
    await page.resize(1440, 1700);
    await sleep(600);
    writeFileSync(join(OUT, `routing-${theme}-full.png`), await page.screenshot());
    await page.resize(1440, 900);

    // Bonus: the Quota page rank chips (same login session).
    await clickSidebar(page, '#/quota');
    await page.waitFor(`document.querySelector('h1')?.textContent === 'Quota Management'`, 10000);
    await sleep(1500);
    const chips = await page.evaluate(`[...document.querySelectorAll('span')].map(s => s.textContent).filter(t => /^#\\d/.test(t))`);
    console.log(theme, 'quota chips', JSON.stringify(chips));
    writeFileSync(join(OUT, `quota-${theme}.png`), await page.screenshot());
  }
} finally {
  await page.close();
}
