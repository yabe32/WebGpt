import { pathToFileURL } from 'node:url';
import path from 'node:path';
const { Codex } = await import(pathToFileURL(path.resolve('dist/server/codex.js')));
const { configuration } = await import(pathToFileURL(path.resolve('dist/server/config.js')));
const c = new Codex(configuration());
try {
  await c.start();
  const r = await c.request('thread/start', { cwd: '/data/work', approvalPolicy: 'on-request' });
  console.log(JSON.stringify({ thread: !!r.thread.id, sandbox: r.sandbox }));
} finally {
  c.close();
}
