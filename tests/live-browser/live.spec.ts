import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
test('REAL Codex: persisted text and images, live browser streaming, second device and restart', async ({
  page,
  browser,
}) => {
  const cfg = JSON.parse(fs.readFileSync('.runtime/wsl.json', 'utf8'));
  const credentials = JSON.parse(
    execFileSync(
      'wsl.exe',
      [
        '-d',
        cfg.distro,
        '-u',
        cfg.user,
        '--exec',
        'cat',
        cfg.work + '/.data/live-browser-access.json',
      ],
      { encoding: 'utf8' },
    ),
  );
  async function login(p: any) {
    await p.goto('/');
    await p.getByLabel('Benutzername', { exact: true }).fill(credentials.username);
    await p.getByLabel('Passwort', { exact: true }).fill(credentials.password);
    await p.getByRole('button', { name: 'Anmelden', exact: true }).click();
    await p.getByRole('button', { name: 'Echter Machbarkeitstest', exact: true }).first().click();
  }
  await login(page);
  await expect(page.locator('.markdown').filter({ hasText: 'Sonnenbogen' }).first()).toBeVisible();
  const images = page.locator('.message.assistant img');
  expect(await images.count()).toBeGreaterThanOrEqual(2);
  for (let i = 0; i < (await images.count()); i++) {await images.nth(i).scrollIntoViewIfNeeded();await expect(images.nth(i)).toBeVisible();await images.nth(i).screenshot({path:`test-results/real-image-${i}.png`});}
  expect(
    await images.first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
  ).toBe(true);
  await images.first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Bild herunterladen', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
  await page.getByRole('button', { name: 'Schließen', exact: true }).click();
  const context = await browser.newContext();
  const second = await context.newPage();
  await login(second);
  let streamed = false;
  page.on('response', (r) => {
    if (r.url().includes('/events') && r.status() === 200) streamed = true;
  });
  await page.reload();
  await page.getByRole('button', { name: 'Echter Machbarkeitstest', exact: true }).first().click();
  await page
    .getByRole('textbox', { name: 'Nachricht', exact: true })
    .fill(
      'Antworte mit genau einem kurzen Satz und verwende die Wörter Browserprüfung erfolgreich.',
    );
  await page.getByRole('button', { name: 'Nachricht senden', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Antwort stoppen', exact: true })).toBeVisible();
  await expect(page.locator('.message.assistant').last()).toContainText(
    /Browserprüfung.*erfolgreich/,
    { timeout: 120000 },
  );
  await expect(second.locator('.message.assistant').last()).toContainText(
    /Browserprüfung.*erfolgreich/,
    { timeout: 15000 },
  );
  expect(streamed).toBe(true);
  await expect(page.getByRole('button', { name: 'Neu generieren', exact: true })).toBeEnabled();
  await page.screenshot({ path: 'test-results/real-chat.png', fullPage: true });
  await context.close();
});
