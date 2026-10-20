import { existsSync } from 'node:fs';
import type { LaunchOptions } from '@playwright/test';

/**
 * Chromium launch options shared by e2e tests and the screenshot tool.
 * Playwright's bundled browser isn't supported on every distro (e.g. Arch),
 * so prefer CHROMIUM_PATH or a system Chromium when present.
 */
export function chromiumLaunchOptions(): LaunchOptions {
  const candidates = [process.env.CHROMIUM_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const executablePath = process.env.CI ? undefined : candidates.find((p) => p && existsSync(p));
  const gpu = process.env.SHOT_GPU === '1';
  return {
    executablePath,
    args: gpu
      ? ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=vulkan', '--enable-features=Vulkan']
      : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  };
}
