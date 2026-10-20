import { expect, test } from '@playwright/test';

const SCENES = ['desert', 'test', 'viewer'];

for (const scene of SCENES) {
  test(`boots ${scene} scene without errors and renders frames`, async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await page.goto(`./?scene=${scene}&seed=1`);
    await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 20_000 });
    const f0 = await page.evaluate(() => window.__game.frames());
    await page.waitForFunction((start) => window.__game.frames() > start + 5, f0, { timeout: 20_000 });

    // WebGL actually produced pixels (not a blank/black canvas).
    const nonBlank = await page.evaluate(() => window.__game.litFraction());
    expect(nonBlank).toBeGreaterThan(0.5);

    expect(await page.evaluate(() => window.__game.errors)).toEqual([]);
    expect(consoleErrors).toEqual([]);
    await page.screenshot({ path: `test-results/smoke-${scene}.png` });
  });
}

test('combat: autopilot firefight damages the training dummies without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto('./?scene=desert&mode=range&seed=1&fire=7&t=8');
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 30_000 });
  const state = await page.evaluate(() => {
    const world = window.__game.game!.world;
    const enemies = world.mechs.filter((m) => m.team === 1);
    const damaged = enemies.filter((m) => m.combat.integrity('ct') < 1 || !m.combat.alive).length;
    return { damaged, playerHeat: world.mechs[0]!.combat.heat };
  });
  expect(state.damaged).toBeGreaterThan(0);
  expect(state.playerHeat).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('instant action: first wave spawns AI hostiles that engage', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('./?scene=desert&seed=1&t=20');
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 30_000 });
  const state = await page.evaluate(() => {
    const g = window.__game.game!;
    const m = g.mission!;
    const player = g.player.state;
    const nearest = Math.min(...m.hostiles.map((h) => Math.hypot(h.mech.state.x - player.x, h.mech.state.z - player.z)));
    return { wave: m.wave, phase: m.phase, hostiles: m.hostiles.length, nearest };
  });
  expect(state.wave).toBe(1);
  expect(state.phase).toBe('combat');
  expect(state.hostiles).toBeGreaterThan(0);
  expect(state.nearest).toBeLessThan(450); // closed in from 550–800 m
  expect(errors).toEqual([]);
});
