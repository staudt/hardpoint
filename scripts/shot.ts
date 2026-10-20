/**
 * Screenshot tool for visual review (by humans or Claude agents).
 *
 *   npm run shot -- --view "scene=desert&cam=orbit&t=3" [--view ...] [--name desert] [--w 1280 --h 720]
 *
 * Starts a Vite dev server, loads each view (query string), waits for the game
 * to render, saves shots/<name>-<i>.png, and prints console errors. Exits 1 if
 * any page reported errors. `t=` freezes the sim at that time for determinism.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { chromiumLaunchOptions } from './browser';

const { values } = parseArgs({
  options: {
    view: { type: 'string', multiple: true, default: ['scene=desert&cam=orbit&t=3'] },
    name: { type: 'string', default: 'shot' },
    w: { type: 'string', default: '1280' },
    h: { type: 'string', default: '720' },
    wait: { type: 'string', default: '1500' },
  },
});

const outDir = resolve('shots');
mkdirSync(outDir, { recursive: true });

const server = await createServer({ server: { port: 0, strictPort: false }, logLevel: 'error' });
await server.listen();
const address = server.httpServer?.address();
const port = typeof address === 'object' && address ? address.port : 5173;

const browser = await chromium.launch(chromiumLaunchOptions());
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: Number(values.w), height: Number(values.h) } });
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

  for (const [i, view] of values.view.entries()) {
    errors.length = 0;
    const url = `http://localhost:${port}/?${view}`;
    await page.goto(url);
    try {
      await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 30_000 });
      await page.waitForFunction(() => window.__game.frames() > 3, null, { timeout: 30_000 });
    } catch {
      errors.push('[timeout] game never became ready / rendered');
    }
    await page.waitForTimeout(Number(values.wait));
    const file = `${outDir}/${values.name}-${i}.png`;
    await page.screenshot({ path: file });
    const pageErrors = await page.evaluate(() => window.__game?.errors ?? ['__game missing']).catch(() => []);
    const all = [...errors.filter((e) => !e.startsWith('[warning]')), ...pageErrors];
    const stats = await page.evaluate(() => window.__game?.stats()).catch(() => null);
    const info = stats ? `  [${(stats.triangles / 1000).toFixed(0)}k tris, ${stats.calls} calls]` : '';
    console.log(`${all.length ? 'FAIL' : 'ok  '} ${file}  <- ${view}${info}`);
    for (const e of errors) console.log(`     ${e}`);
    for (const e of pageErrors) console.log(`     [game] ${e}`);
    if (all.length) failed = true;
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
