import { defineConfig, devices } from '@playwright/test'

/**
 * Layer 1 e2e: the built web client in WebKit (Safari's engine, the closest
 * stand-in for the iOS WKWebView) with an iPhone 15 profile, against a scratch
 * wrangler dev + local D1 started in tests/e2e/global-setup.ts.
 *
 *   npm run test:e2e           run
 *   npm run test:e2e:update    re-record screenshot baselines
 */
export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  // One shared scratch DB: specs run in order, one worker.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: 'disabled', caret: 'hide', stylePath: './tests/e2e/support/screenshot.css' },
  },
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  // Baselines are per platform: WebKit renders fonts differently on Windows and Linux.
  snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{testFilePath}/{arg}{ext}',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-US',
    // The flap boards and cascades settle at once; screenshots don't catch a letter mid-flip.
    reducedMotion: 'reduce',
  },
  projects: [
    {
      name: 'iphone-webkit',
      use: { ...devices['iPhone 15'], browserName: 'webkit' },
    },
  ],
})
