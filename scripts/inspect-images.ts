// Read-only diagnostics for the canned live acceptance conversation. No tokens or full image data.
import fs from 'node:fs';
import path from 'node:path';
import { configuration } from '../server/config.js';
import { Store } from '../server/db.js';
import { Codex } from '../server/codex.js';
const base = configuration(),
  cfg = configuration({ ...process.env, DATA_DIR: path.join(base.data, 'live-suite') });
const s = new Store(cfg);
const chat = s.get('SELECT * FROM chats ORDER BY created_at DESC LIMIT 1');
const rpc = new Codex(base);
try {
  await rpc.start();
  const r = await rpc.request('thread/read', { threadId: chat.thread_id, includeTurns: true });
  for (const t of r.thread.turns) {
    for (const item of t.items || []) {
      if (/image|tool|function/i.test(item.type)) {
        console.log(
          JSON.stringify(
            {
              type: item.type,
              keys: Object.keys(item),
              status: item.status,
              failure: item.failure,
              savedPath: item.savedPath,
              resultType: typeof item.result,
              resultLength: item.result?.length,
              resultPrefix: typeof item.result === 'string' ? item.result.slice(0, 180) : undefined,
            },
            null,
            2,
          ),
        );
      }
      if (item.type === 'agentMessage' && t.items.some((i: any) => i.type === 'imageGeneration'))
        console.log('BILDTEST-ANTWORT', item.text.slice(0, 1200));
    }
  }
  console.log('TEST TURN STATES', s.all('SELECT status,error FROM turns'));
} finally {
  rpc.close();
  s.close();
}
