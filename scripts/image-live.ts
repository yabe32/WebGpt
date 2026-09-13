// One bounded retry after the previously observed usage-limit window changed.
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { configuration } from '../server/config.js';
import { Codex } from '../server/codex.js';
import { createApp } from '../server/app.js';
const base = configuration(),
  cfg = configuration({ ...process.env, DATA_DIR: path.join(base.data, 'live-suite') });
cfg.codexHome = base.codexHome;
const rpc = new Codex(cfg);
await rpc.start();
const s = createApp(cfg, rpc),
  chat = s.store.get('SELECT * FROM chats ORDER BY created_at DESC LIMIT 1');
const report: any = { date: new Date().toISOString(), checks: [] };
async function turn(text: string, attachments: string[]) {
  const before = s.store.snapshot(chat.id).messages.length;
  await s.chats.send(chat.id, randomUUID(), text, attachments);
  const until = Date.now() + 10 * 60000;
  while (Date.now() < until) {
    const snap = s.store.snapshot(chat.id),
      t = snap.turns.at(-1)!;
    if (!['starting', 'running'].includes(t.status)) {
      const outputs = snap.messages
        .slice(before)
        .filter((m) => m.role === 'assistant')
        .flatMap((m) => m.attachments);
      if (t.error || t.status !== 'completed' || !outputs.length)
        throw Error(t.error || 'Kein Bild empfangen');
      return outputs.at(-1)!;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  await s.chats.stop(chat.id);
  throw Error('Zeitlimit');
}
try {
  let generated: string | undefined;
  try {
    generated = await turn(
      'Erstelle mit dem nativen Bildwerkzeug ein kleines Bild eines blauen Kreises auf weißem Hintergrund. Keine Shell und keine externe API verwenden.',
      [],
    );
    console.log('BESTANDEN: Echte Bilderstellung und Import');
    report.checks.push({ name: 'Bilderstellung', passed: true });
  } catch (e) {
    console.log('NICHT BESTANDEN: ' + (e as Error).message);
    report.checks.push({ name: 'Bilderstellung', passed: false, error: (e as Error).message });
  }
  if (generated) {
    try {
      await turn(
        'Bearbeite dieses Bild mit dem nativen Bildwerkzeug: Ändere ausschließlich den blauen Kreis in einen grünen Kreis, der Hintergrund bleibt weiß.',
        [generated],
      );
      console.log('BESTANDEN: Echte Bildbearbeitung im selben Gespräch');
      report.checks.push({ name: 'Bildbearbeitung', passed: true });
    } catch (e) {
      console.log('NICHT BESTANDEN: ' + (e as Error).message);
      report.checks.push({ name: 'Bildbearbeitung', passed: false, error: (e as Error).message });
    }
  } else
    report.checks.push({
      name: 'Bildbearbeitung',
      passed: false,
      error: 'Kein erzeugtes Ausgangsbild',
    });
} finally {
  rpc.close();
  s.store.close();
  await fs.writeFile(
    path.join(base.data, 'image-live-report.json'),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
}
