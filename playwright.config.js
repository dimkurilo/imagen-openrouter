// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/**
 * Playwright Test config for imagen-openrouter.
 * - Auto-starts the python static server on :8237 (reuses if already running).
 * - Chromium only (matches the OpenRouter web app target).
 * - Run:  npx playwright test          (headless, fast)
 *         npx playwright test --ui      (visual watch mode + time-travel)
 *         npx playwright test --headed  (visible browser)
 */
module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:8237',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'python3 -m http.server 8237 --bind 127.0.0.1',
    url: 'http://127.0.0.1:8237/',
    reuseExistingServer: true,
    timeout: 15_000,
  },
});
