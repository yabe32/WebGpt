// Opt-in REAL acceptance test for the built-in Codex web search. It uses the
// signed-in ChatGPT account and writes only a private, redacted report.
import fs from 'node:fs/promises';
import path from 'node:path';
import { configuration } from '../server/config.js';
import { Codex, CODEX_VERSION } from '../server/codex.js';

const base = configuration();
const cfg = configuration({
  ...process.env,
  DATA_DIR: path.join(base.data, 'web-search-live'),
  WEB_SEARCH: 'live',
});
cfg.codexHome = base.codexHome;
const rpc = new Codex(cfg);
const report: { date: string; codex: string; authentication: boolean; webSearch: boolean; completed: boolean; error?: string } = {
  date: new Date().toISOString(),
  codex: CODEX_VERSION,
  authentication: false,
  webSearch: false,
  completed: false,
};

try {
  await rpc.start();
  const account = await rpc.request('account/read', { refreshToken: true });
  if (account.account?.type !== 'chatgpt') throw Error('ChatGPT-Anmeldung fehlt.');
  report.authentication = true;
  const thread = await rpc.request('thread/start', {
    cwd: cfg.work,
    approvalPolicy: 'on-request',
    developerInstructions:
      'Führe für diese kurze Abnahme zwingend die integrierte Websuche aus. Suche nach der offiziellen OpenAI-Dokumentation zum Codex App Server. Antworte danach in einem kurzen deutschen Satz mit einem Markdown-Link zur Quelle. Nutze keine Shell und keine anderen Werkzeuge.',
  });
  const done = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Zeitlimit nach 3 Minuten')), 180000);
    const listener = (method: string, params: any) => {
      if (params?.threadId !== thread.thread.id) return;
      if (method === 'item/started' && params.item?.type === 'webSearch') report.webSearch = true;
      if (method === 'turn/completed') {
        clearTimeout(timeout);
        rpc.off('notification', listener);
        params.turn?.status === 'completed'
          ? resolve()
          : reject(Error(params.turn?.error?.message || params.turn?.status || 'Turn fehlgeschlagen'));
      }
    };
    rpc.on('notification', listener);
  });
  await rpc.request('turn/start', {
    threadId: thread.thread.id,
    input: [{ type: 'text', text: 'Bitte beginne jetzt mit der Recherche.', text_elements: [] }],
  });
  await done;
  if (!report.webSearch) throw Error('Kein Websuche-Ereignis empfangen.');
  report.completed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : 'Unbekannter Fehler';
} finally {
  rpc.close();
}

await fs.writeFile(
  path.join(base.data, 'web-search-report.json'),
  JSON.stringify(report, null, 2),
  { mode: 0o600 },
);
console.log(report.completed ? 'BESTANDEN: integrierte Websuche' : 'NICHT BESTANDEN: ' + report.error);
if (!report.completed) process.exitCode = 1;
