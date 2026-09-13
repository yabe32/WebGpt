// Import the already generated acceptance image, then test one real edit (no new generation).
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
const report: any = { date: new Date().toISOString(), generationImported: false, edit: false };
try {
  const history = await rpc.request('thread/read', {
    threadId: chat.thread_id,
    includeTurns: true,
  });
  const turn = [...history.thread.turns]
    .reverse()
    .find((t: any) =>
      t.items.some((i: any) => i.type === 'imageGeneration' && i.status === 'completed'),
    );
  if (!turn) throw Error('Kein erzeugtes Testbild vorhanden');
  const item = turn.items.find(
    (i: any) => i.type === 'imageGeneration' && i.status === 'completed',
  );
  const artifact = await s.artifacts.generated(item, s.chats.work(chat.id), chat.thread_id);
  const appTurn = s.store.get('SELECT * FROM turns WHERE codex_id=?', turn.id);
  const ordinal = s.store.get(
    'SELECT COALESCE(MAX(ordinal),0)+1 n FROM messages WHERE chat_id=?',
    chat.id,
  ).n;
  s.store.run(
    'INSERT OR REPLACE INTO messages VALUES (?,?,?,?,?,?,?)',
    appTurn.id + ':' + item.id,
    chat.id,
    appTurn.id,
    'assistant',
    '',
    JSON.stringify([artifact]),
    ordinal,
  );
  s.store.run('UPDATE turns SET error=NULL WHERE id=?', appTurn.id);
  s.store.run("INSERT OR REPLACE INTO capabilities VALUES ('imageGeneration',?)", Date.now());
  report.generationImported = true;
  console.log('BESTANDEN: Vorhandenes echtes Bild sicher importiert');
  const before = s.store.snapshot(chat.id).messages.length;
  await s.chats.send(
    chat.id,
    randomUUID(),
    'Bearbeite das gerade erzeugte Bild mit dem nativen Bildwerkzeug. Ändere den blauen Kreis in einen grünen Kreis und erhalte den weißen Hintergrund.',
    [artifact],
  );
  const until = Date.now() + 10 * 60000;
  while (Date.now() < until) {
    const snap = s.store.snapshot(chat.id),
      last = snap.turns.at(-1)!;
    if (!['starting', 'running'].includes(last.status)) {
      if (
        last.error ||
        last.status !== 'completed' ||
        !snap.messages.slice(before).some((m) => m.role === 'assistant' && m.attachments.length)
      )
        throw Error(last.error || 'Kein bearbeitetes Bild erhalten');
      report.edit = true;
      console.log('BESTANDEN: Echte Bildbearbeitung und Artefaktimport im selben Gespräch');
      break;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!report.edit) throw Error('Zeitlimit');
} catch (e) {
  report.error = (e as Error).message;
  console.log('NICHT BESTANDEN: ' + report.error);
  process.exitCode = 1;
} finally {
  rpc.close();
  s.store.close();
  await fs.writeFile(
    path.join(base.data, 'image-final-report.json'),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
}
