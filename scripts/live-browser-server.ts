// Opt-in real Codex browser acceptance server with an isolated website account.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { configuration } from '../server/config.js';
import { Codex } from '../server/codex.js';
import { createApp } from '../server/app.js';
const base = configuration(),
  cfg = configuration({
    ...process.env,
    DATA_DIR: path.join(base.data, 'live-suite'),
    BASE_URL: 'http://localhost:4183',
  });
cfg.codexHome = base.codexHome;
const rpc = new Codex(cfg);
await rpc.start();
const s = createApp(cfg, rpc);
const password = randomBytes(24).toString('hex');
s.store.run(
  'INSERT OR REPLACE INTO owner VALUES (1,?,?)',
  'live-test',
  await argon2.hash(password),
);
s.store.run('DELETE FROM sessions');
fs.writeFileSync(
  path.join(base.data, 'live-browser-access.json'),
  JSON.stringify({ username: 'live-test', password }),
  { mode: 0o600 },
);
const server = s.app.listen(4183, '127.0.0.1', () =>
  console.log('Echter Abnahmeserver läuft lokal auf Port 4183. Zugang nur im privaten Testprofil.'),
);
function close() {
  rpc.close();
  server.closeAllConnections();
  server.close();
  s.store.close();
}
process.on('SIGTERM', close);
process.on('SIGINT', close);
