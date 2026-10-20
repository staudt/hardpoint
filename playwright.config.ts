import { defineConfig } from '@playwright/test';
import { chromiumLaunchOptions } from './scripts/browser';

const PORT = 4173;
const BASE = process.env.BASE_PATH ?? '/hardpoint/';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}${BASE}`,
    viewport: { width: 1280, height: 720 },
    launchOptions: chromiumLaunchOptions(),
  },
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}${BASE}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
