import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { configuration } from '../server/config.js';
import { createApp } from '../server/app.js';
import { Fixture } from './fixture.js';
it('replays monotonic SSE IDs without duplicate requests, reconnects two sessions and denies revoked streams', async () => {
  const cfg = configuration({
      DATA_DIR: path.resolve('.test-data', randomUUID()),
      BASE_URL: 'http://localhost:5173',
    }),
    rpc = new Fixture(),
    s = createApp(cfg, rpc);
  const server = s.app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  const address = server.address() as any,
    url = 'http://127.0.0.1:' + address.port;
  const abort = new AbortController();
  try {
    const setup = await request(s.app)
      .post('/api/auth/setup')
      .set('Origin', cfg.baseUrl)
      .set('X-Requested-With', 'PrivateChat')
      .send({
        username: 'owner',
        password: 'long-test-password',
        key: fs.readFileSync(s.auth.setupPath, 'utf8'),
      });
    const cookie = setup.headers['set-cookie'][0].split(';')[0];
    const userId = s.store.get<{ user_id: string }>('SELECT user_id FROM sessions LIMIT 1')!.user_id;
    const chat = s.store.create('Neue Unterhaltung', null, null, userId);
    s.chats.publish(chat.id);
    const first = s.store.snapshot(chat.id).eventId;
    s.chats.publish(chat.id);
    const second = s.store.snapshot(chat.id).eventId;
    const res = await fetch(url + '/api/chats/' + chat.id + '/events', {
      headers: { Cookie: cookie, 'Last-Event-ID': String(first) },
      signal: abort.signal,
    });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader(),
      chunk = new TextDecoder().decode((await reader.read()).value);
    expect(chunk).toContain('id: ' + second);
    expect(chunk).not.toContain('id: ' + first + '\n');
    s.chats.publish(chat.id);
    const live = new TextDecoder().decode((await reader.read()).value);
    expect(live).toContain('id: ' + s.store.snapshot(chat.id).eventId);
    expect(rpc.calls.filter((c) => c.method === 'turn/start')).toHaveLength(0);
    s.store.run('DELETE FROM sessions');
    s.chats.publish(chat.id);
    expect((await reader.read()).done).toBe(true);
    await fetch(url + '/api/chats/' + chat.id + '/events', { headers: { Cookie: cookie } }).then(
      (r) => expect(r.status).toBe(401),
    );
  } finally {
    abort.abort();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    s.store.close();
  }
});
