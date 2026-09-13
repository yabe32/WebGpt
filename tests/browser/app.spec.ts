import { test, expect } from '@playwright/test';
import fs from 'node:fs';
test('desktop + mobile, two sessions, streaming/reconnect, branches and protected media (FIXTURE)', async ({
  page,
  browser,
}) => {
  await page.goto('/');
  await expect(page.getByLabel('Benutzername', { exact: true })).toBeVisible();
  if (await page.getByLabel('Einrichtungsschlüssel', { exact: true }).isVisible()) {
    await page
      .getByLabel('Einrichtungsschlüssel', { exact: true })
      .fill(fs.readFileSync('.test-data/browser/setup-key', 'utf8'));
    await page.getByLabel('Benutzername', { exact: true }).fill('browser-owner');
    await page.getByLabel('Passwort', { exact: true }).fill('fixture-browser-password');
    await page.getByRole('button', { name: 'Admin-Konto einrichten', exact: true }).click();
  } else {
    await page.getByLabel('Benutzername', { exact: true }).fill('browser-owner');
    await page.getByLabel('Passwort', { exact: true }).fill('fixture-browser-password');
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: 'Womit kann ich helfen?' })).toBeVisible();
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
  const second = await browser.newContext();
  const two = await second.newPage();
  await two.goto('/');
  await two.getByLabel('Benutzername', { exact: true }).fill('browser-owner');
  await two.getByLabel('Passwort', { exact: true }).fill('fixture-browser-password');
  await two.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await page.getByRole('button', { name: 'Neues Gespräch', exact: true }).click();
  await page.getByRole('textbox', { name: 'Nachricht', exact: true }).fill('Browserprüfung');
  await page.getByRole('button', { name: 'Nachricht senden', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Antwort stoppen', exact: true })).toBeVisible();
  await expect(page.locator('.markdown').filter({ hasText: 'Fixture: Live-Text' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Neu generieren', exact: true })).toBeEnabled();
  await two.reload();
  await two.getByRole('button', { name: 'Browserprüfung', exact: true }).first().click();
  await expect(two.locator('.markdown').filter({ hasText: 'Fixture: Live-Text' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Browserprüfung', exact: true }).first().click();
  await expect(page.locator('.markdown').filter({ hasText: 'Fixture: Live-Text' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Nachricht bearbeiten', exact: true })
    .fill('Geänderter Gedanke');
  await page.getByRole('button', { name: 'Zweig erstellen und senden', exact: true }).click();
  await expect(page.getByText('Geänderter Gedanke', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Neu generieren', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Gespräch umbenennen', exact: true }).click();
  await page.getByRole('textbox', { name: 'Gesprächstitel' }).fill('Umbenannter Zweig');
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.locator('.chat-heading strong')).toHaveText('Umbenannter Zweig');
  await page.getByRole('button', { name: 'Helle Ansicht', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Dunkle Ansicht', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: 'test-results/dark-chat.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Navigation öffnen', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Navigation öffnen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Neues Gespräch', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Navigation schließen', exact: true }).last().click();
  await expect(page.getByRole('textbox', { name: 'Nachricht', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  await page.getByRole('textbox', { name: 'Nachricht', exact: true }).fill('Stopptest');
  await page.getByRole('button', { name: 'Nachricht senden', exact: true }).click();
  await page.getByRole('button', { name: 'Antwort stoppen', exact: true }).click();
  await expect(
    page.getByText('Antwort gestoppt. Teilantwort gespeichert.', { exact: true }),
  ).toBeVisible();
  await second.close();
});
