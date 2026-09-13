import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/live-browser',
  workers: 1,
  timeout: 180000,
  use: { baseURL: 'http://localhost:4183', channel: 'msedge' },
  reporter: 'list',
});
