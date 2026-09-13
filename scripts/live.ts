// Opt-in REAL Codex acceptance test. Consumes the signed-in account's included limits.
// Stop npm run dev first: one App Server must own this profile at a time.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { configuration } from '../server/config.js';
import { Codex, CODEX_VERSION } from '../server/codex.js';
import { createApp } from '../server/app.js';
const base = configuration();
const cfg = configuration({
  ...process.env,
  DATA_DIR: path.join(base.data, 'live-suite'),
  BASE_URL: 'http://localhost:4183',
});
cfg.codexHome = base.codexHome;
let rpc = new Codex(cfg);
await rpc.start();
const account = await rpc.request('account/read');
if (account.account?.type !== 'chatgpt') {
  console.error('NICHT GETESTET: Bitte zuerst npm run codex:login abschließen.');
  rpc.close();
  process.exit(2);
}
let s = createApp(cfg, rpc);
const report: any = {
  date: new Date().toISOString(),
  platform: process.platform,
  codex: CODEX_VERSION,
  authentication: true,
  checks: [],
};
async function wait(chat: string) {
  const until = Date.now() + 10 * 60 * 1000;
  while (Date.now() < until) {
    const snap = s.store.snapshot(chat),
      last = snap.turns.at(-1);
    if (last && !['starting', 'running'].includes(last.status)) {
      if (last.status !== 'completed' || last.error) throw Error(last.error || last.status);
      return snap;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  await s.chats.stop(chat);
  throw Error('Zeitlimit nach 10 Minuten');
}
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    report.checks.push({ name, passed: true });
    console.log('BESTANDEN: ' + name);
  } catch (e) {
    report.checks.push({ name, passed: false, error: (e as Error).message });
    console.log('NICHT BESTANDEN: ' + name + ' – ' + (e as Error).message);
  }
}
const chat = s.store.create('Echter Machbarkeitstest');
await check('Text und Live-Deltas', async () => {
  let deltas = 0;
  const listener = (m: string) => {
    if (m === 'item/agentMessage/delta') deltas++;
  };
  rpc.on('notification', listener);
  await s.chats.send(
    chat.id,
    randomUUID(),
    'Merke dir das Wort Sonnenbogen. Antworte mit einem kurzen deutschen Satz.',
    [],
  );
  const snap = await wait(chat.id);
  rpc.off('notification', listener);
  if (!deltas || !snap.messages.some((m) => m.role === 'assistant' && m.text))
    throw Error('Keine Text-Deltas empfangen');
});
await check('Bildanalyse', async () => {
  const image = await sharp({
    create: { width: 256, height: 256, channels: 3, background: '#ff0000' },
  })
    .png()
    .toBuffer();
  const id = await s.artifacts.save(image);
  await s.chats.send(
    chat.id,
    randomUUID(),
    'Welche Farbe hat dieses Bild? Antworte nur mit der Farbe.',
    [id],
  );
  const snap = await wait(chat.id);
  if (!/rot/i.test(snap.messages.at(-1)!.text)) throw Error('Erwartete Farbe nicht erkannt');
});
let generated: string | undefined;
await check('Bilderstellung und Artefaktimport', async () => {
  await s.chats.send(
    chat.id,
    randomUUID(),
    'Erstelle mit dem nativen Bildwerkzeug ein einfaches kleines Bild: ein blauer Kreis auf weißem Grund. Verwende keine Shell und keine APIs.',
    [],
  );
  const snap = await wait(chat.id);
  generated = snap.messages
    .filter((m) => m.role === 'assistant')
    .flatMap((m) => m.attachments)
    .at(-1);
  if (!generated) throw Error('Kein Bildartefakt empfangen');
});
await check('Bildbearbeitung im selben Thread', async () => {
  if (!generated) throw Error('Bilderstellung zuvor nicht erfolgreich');
  const before = s.store.snapshot(chat.id).messages.length;
  await s.chats.send(
    chat.id,
    randomUUID(),
    'Bearbeite das gerade erzeugte Bild mit dem nativen Bildwerkzeug: Der Kreis soll jetzt grün sein, der Hintergrund bleibt weiß.',
    [generated],
  );
  const snap = await wait(chat.id);
  if (!snap.messages.slice(before).some((m) => m.role === 'assistant' && m.attachments.length))
    throw Error('Kein bearbeitetes Bild empfangen');
});
await check('Fortsetzung nach Prozess- und Datenbankneustart', async () => {
  rpc.close();
  await new Promise((r) => setTimeout(r, 800));
  s.store.close();
  rpc = new Codex(cfg);
  await rpc.start();
  s = createApp(cfg, rpc);
  await s.chats.send(
    chat.id,
    randomUUID(),
    'Welches Wort sollte ich mir am Anfang merken? Antworte nur mit diesem Wort.',
    [],
  );
  const snap = await wait(chat.id);
  if (!/Sonnenbogen/i.test(snap.messages.at(-1)!.text))
    throw Error('Gespeicherter Kontext nicht bestätigt');
});
rpc.close();
s.store.close();
await fs.writeFile(path.join(base.data, 'live-report.json'), JSON.stringify(report, null, 2), {
  mode: 0o600,
});
console.log('Privater Bericht: ' + path.join(base.data, 'live-report.json'));
if (report.checks.some((c: any) => !c.passed)) process.exitCode = 1;
