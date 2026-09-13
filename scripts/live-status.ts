import path from 'node:path';
import { configuration } from '../server/config.js';
import { Store } from '../server/db.js';
const base = configuration();
const s = new Store(
  configuration({ ...process.env, DATA_DIR: path.join(base.data, 'live-suite') }),
);
console.log(s.all('SELECT status,error,created_at FROM turns ORDER BY created_at DESC LIMIT 3'));
console.log(s.all("SELECT text FROM messages WHERE role='assistant' ORDER BY rowid DESC LIMIT 1"));
s.close();
