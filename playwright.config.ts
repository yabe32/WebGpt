import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/browser',
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:4173',
    browserName: 'chromium',
    channel: 'msedge',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node node_modules/tsx/dist/cli.mjs tests/browser-server.ts',
    url: 'http://localhost:4173/api/auth',
    reuseExistingServer: false,
  },
  reporter: 'list',
});
