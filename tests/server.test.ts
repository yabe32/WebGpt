import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { configuration } from '../server/config.js';
import { createApp } from '../server/app.js';
import { Fixture } from './fixture.js';
const systems: ReturnType<typeof createApp>[] = [];
function setup() {
  const cfg = configuration({
    DATA_DIR: path.resolve('.test-data', randomUUID()),
    BASE_URL: 'http://localhost:5173',
  });
  const rpc = new Fixture(),
    s = createApp(cfg, rpc);
  systems.push(s);
  return { ...s, cfg, rpc, agent: request.agent(s.app) };
}
async function login(s: ReturnType<typeof setup>) {
  await s.agent
    .post('/api/auth/setup')
    .set('Origin', s.cfg.baseUrl)
    .set('X-Requested-With', 'PrivateChat')
    .send({
      username: 'owner',
      password: 'test-password-long',
      key: fs.readFileSync(s.auth.setupPath, 'utf8'),
    })
    .expect(200);
  return (await s.agent.get('/api/auth')).body.csrf;
}
function post(s: ReturnType<typeof setup>, url: string, csrf: string, body: any) {
  return s.agent
    .post('/api' + url)
    .set('Origin', s.cfg.baseUrl)
    .set('X-Requested-With', 'PrivateChat')
    .set('X-CSRF-Token', csrf)
    .send(body);
}
const pause = () => new Promise((r) => setTimeout(r, 40));
afterEach(() => {
  for (const s of systems.splice(0)) {
    s.chats.removeAllListeners();
    s.store.close();
  }
});
describe('Website security (no live model)', () => {
  it('protects chats, streams, uploads and files before login', async () => {
    const s = setup();
    for (const url of [
      '/chats',
      '/chats/' + randomUUID() + '/events',
      '/files/' + randomUUID(),
      '/status',
    ])
      await request(s.app)
        .get('/api' + url)
        .expect(401);
    await request(s.app)
      .post('/api/uploads')
      .set('Origin', s.cfg.baseUrl)
      .set('X-Requested-With', 'PrivateChat')
      .expect(401);
  });
  it('requires setup key, hashes password, blocks CSRF, logs out and revokes session', async () => {
    const s = setup();
    await post(s, '/auth/setup', '', {
      username: 'owner',
      password: 'test-password-long',
      key: 'a'.repeat(64),
    }).expect(403);
    const csrf = await login(s);
    expect(s.store.get('SELECT password_hash FROM owner').password_hash).toMatch(/^\$argon2id\$/);
    await s.agent.post('/api/chats').send({}).expect(403);
    await post(s, '/chats', 'bad', {}).expect(403);
    await post(s, '/chats', csrf, {}).expect(201);
    await post(s, '/auth/setup', csrf, {
      username: 'owner',
      password: 'test-password-long',
      key: 'a'.repeat(64),
    }).expect(409);
    const sess = (await s.agent.get('/api/sessions')).body[0];
    await s.agent
      .delete('/api/sessions/' + sess.id)
      .set('Origin', s.cfg.baseUrl)
      .set('X-Requested-With', 'PrivateChat')
      .set('X-CSRF-Token', csrf)
      .expect(200);
    await s.agent.get('/api/chats').expect(401);
  });
  it('rate limits failed logins', async () => {
    const s = setup();
    const csrf = await login(s);
    for (let i = 0; i < 9; i++)
      await post(s, '/auth/login', csrf, { username: 'owner', password: 'incorrect-password' });
    const r = await post(s, '/auth/login', csrf, {
      username: 'owner',
      password: 'incorrect-password',
    });
    expect(r.status).toBe(429);
  });
  it('validates actual image types and protects output', async () => {
    const s = setup(),
      csrf = await login(s);
    const upload = (b: Buffer, name: string) =>
      s.agent
        .post('/api/uploads')
        .set('Origin', s.cfg.baseUrl)
        .set('X-Requested-With', 'PrivateChat')
        .set('X-CSRF-Token', csrf)
        .attach('image', b, name);
    await upload(Buffer.from('<svg onload="alert(1)"></svg>'), 'fake.png').expect(415);
    const png = await sharp({ create: { width: 3, height: 3, channels: 3, background: '#ff0000' } })
      .png()
      .toBuffer();
    const r = await upload(png, '../../fake.png').expect(201);
    await request(s.app)
      .get('/api/files/' + r.body.id)
      .expect(401);
    const out = await s.agent.get('/api/files/' + r.body.id).expect(200);
    expect(out.headers['content-type']).toContain('image/png');
    expect(out.headers['cache-control']).toBe('no-store');
  });
  it('downloads an explicitly created chat file without exposing work directories', async () => {
    const s = setup(), csrf = await login(s);
    const chat = (await post(s, '/chats', csrf, {})).body;
    fs.mkdirSync(s.chats.work(chat.id), { recursive: true });
    fs.writeFileSync(path.join(s.chats.work(chat.id), 'notizen.md'), '# Privat');
    await request(s.app).get('/api/chats/' + chat.id + '/files').query({ path: 'notizen.md' }).expect(401);
    const file = await s.agent.get('/api/chats/' + chat.id + '/files').query({ path: 'notizen.md' }).expect(200);
    expect(file.headers['content-disposition']).toContain('attachment');
    expect(file.headers['content-type']).toContain('text/markdown');
    await s.agent.get('/api/chats/' + chat.id + '/files').query({ path: '../app.sqlite' }).expect(404);
  });
  it('lets an admin create members while isolating chats and enforcing the member limit', async () => {
    const s = setup(), csrf = await login(s);
    await request(s.app).post('/api/auth/register').set('Origin', s.cfg.baseUrl)
      .set('X-Requested-With', 'PrivateChat')
      .send({ username: 'wartend', password: 'wartendes-passwort' }).expect(202);
    await request(s.app).post('/api/auth/login').set('Origin', s.cfg.baseUrl)
      .set('X-Requested-With', 'PrivateChat')
      .send({ username: 'wartend', password: 'wartendes-passwort' }).expect(403);
    const pending = (await s.agent.get('/api/admin/users')).body.users.find((u: any) => u.username === 'wartend');
    expect(pending.active).toBe(0);
    await s.agent.patch('/api/admin/users/' + pending.id).set('Origin', s.cfg.baseUrl)
      .set('X-Requested-With', 'PrivateChat').set('X-CSRF-Token', csrf).send({ active: true }).expect(200);
    await request(s.app).post('/api/auth/login').set('Origin', s.cfg.baseUrl)
      .set('X-Requested-With', 'PrivateChat')
      .send({ username: 'wartend', password: 'wartendes-passwort' }).expect(200);
    const created = await post(s, '/admin/users', csrf, {
      username: 'member', password: 'member-password-long', role: 'member', rateLimitPerHour: 10, tokenLimitFiveHours: 100, tokenLimitWeek: 200,
    }).expect(201);
    const adminUsers = await s.agent.get('/api/admin/users').expect(200);
    const createdUser = adminUsers.body.users.find((u: any) => u.id === created.body.id);
    expect(createdUser.rate_limit_per_hour).toBe(10);
    expect(createdUser.token_limit_five_hours).toBe(100);
    expect(createdUser.token_limit_week).toBe(200);
    await s.agent.put('/api/admin/models').set('Origin', s.cfg.baseUrl)
      .set('X-Requested-With', 'PrivateChat').set('X-CSRF-Token', csrf).send({ model: 'fixture-image' }).expect(200);
    await s.agent.patch('/api/admin/users/' + created.body.id).set('Origin', s.cfg.baseUrl)
      .set('X-Requested-With', 'PrivateChat').set('X-CSRF-Token', csrf)
      .send({ username: 'member-neu', password: 'member-password-neu', rateLimitPerHour: 10, tokenLimitFiveHours: 100, tokenLimitWeek: 200 }).expect(200);
    const member = request.agent(s.app);
    await member.post('/api/auth/login').set('Origin', s.cfg.baseUrl).set('X-Requested-With', 'PrivateChat')
      .send({ username: 'member-neu', password: 'member-password-neu' }).expect(200);
    const memberCsrf = (await member.get('/api/auth')).body.csrf;
    expect((await member.get('/api/status')).body.limits).toBeNull();
    await member.get('/api/admin/models').expect(403);
    const memberChat = await member.post('/api/chats').set('Origin', s.cfg.baseUrl).set('X-Requested-With', 'PrivateChat').set('X-CSRF-Token', memberCsrf).send({}).expect(201);
    await post(s, '/chats', csrf, {}).expect(201);
    const adminChat = (await s.agent.get('/api/chats')).body[0];
    await member.get('/api/chats/' + adminChat.id).expect(404);
    await member.post('/api/chats/' + memberChat.body.id + '/send').set('Origin', s.cfg.baseUrl).set('X-Requested-With', 'PrivateChat').set('X-CSRF-Token', memberCsrf).send({ key: randomUUID(), text: 'eine', attachments: [] }).expect(202);
    await new Promise((r) => setTimeout(r, 50));
    expect(s.rpc.calls.find((c) => c.method === 'turn/start')?.params.model).toBe('fixture-image');
    const thread = s.store.chat(memberChat.body.id)!.thread_id!;
    s.rpc.tokenUsage(thread, { totalTokens: 100, inputTokens: 50, outputTokens: 50 });
    await new Promise((r) => setTimeout(r, 10));
    const fiveHourLimited = await member.post('/api/chats/' + memberChat.body.id + '/send').set('Origin', s.cfg.baseUrl).set('X-Requested-With', 'PrivateChat').set('X-CSRF-Token', memberCsrf).send({ key: randomUUID(), text: 'zwei', attachments: [] }).expect(429);
    expect(fiveHourLimited.body.error).toMatch(/fünf Stunden/);
    await s.agent.patch('/api/admin/users/' + created.body.id).set('Origin', s.cfg.baseUrl)
      .set('X-Requested-With', 'PrivateChat').set('X-CSRF-Token', csrf)
      .send({ tokenLimitFiveHours: 0, tokenLimitWeek: 100 }).expect(200);
    const weekLimited = await member.post('/api/chats/' + memberChat.body.id + '/send').set('Origin', s.cfg.baseUrl).set('X-Requested-With', 'PrivateChat').set('X-CSRF-Token', memberCsrf).send({ key: randomUUID(), text: 'drei', attachments: [] }).expect(429);
    expect(weekLimited.body.error).toMatch(/Wöchentliches/);
  });
  it('restricts cross-account chat inspection, token events and summaries to a superuser', async () => {
    const s = setup(), csrf = await login(s);
    expect((await s.agent.get('/api/auth')).body.user.role).toBe('superuser');
    const adminId = (await post(s, '/admin/users', csrf, {
      username: 'admin', password: 'admin-password-long', role: 'admin', accountGroup: 'Arbeit', rateLimitPerHour: 60,
    }).expect(201)).body.id;
    const memberId = (await post(s, '/admin/users', csrf, {
      username: 'schule', password: 'schule-password-long', role: 'member', accountGroup: 'Schule', rateLimitPerHour: 60,
    }).expect(201)).body.id;
    const admin = request.agent(s.app);
    await admin.post('/api/auth/login').set('Origin', s.cfg.baseUrl).set('X-Requested-With', 'PrivateChat')
      .send({ username: 'admin', password: 'admin-password-long' }).expect(200);
    const adminCsrf = (await admin.get('/api/auth')).body.csrf;
    await admin.get('/api/superuser/overview').expect(403);
    await admin.post('/api/admin/users').set('Origin', s.cfg.baseUrl).set('X-Requested-With', 'PrivateChat').set('X-CSRF-Token', adminCsrf)
      .send({ username: 'forbidden', password: 'forbidden-password-long', role: 'superuser', rateLimitPerHour: 60 }).expect(403);
    const member = request.agent(s.app);
    await member.post('/api/auth/login').set('Origin', s.cfg.baseUrl).set('X-Requested-With', 'PrivateChat')
      .send({ username: 'schule', password: 'schule-password-long' }).expect(200);
    const memberCsrf = (await member.get('/api/auth')).body.csrf;
    const foreign = await member.post('/api/chats').set('Origin', s.cfg.baseUrl).set('X-Requested-With', 'PrivateChat').set('X-CSRF-Token', memberCsrf).send({}).expect(201);
    await member.post('/api/chats/' + foreign.body.id + '/send').set('Origin', s.cfg.baseUrl).set('X-Requested-With', 'PrivateChat').set('X-CSRF-Token', memberCsrf)
      .send({ key: randomUUID(), text: 'Mathe Hausaufgaben Thema', attachments: [] }).expect(202);
    await pause();
    const thread = s.store.chat(foreign.body.id)!.thread_id!;
    s.rpc.tokenUsage(thread, { totalTokens: 40, inputTokens: 12, outputTokens: 28 });
    await pause();
    s.rpc.tokenUsage(thread, { totalTokens: 65, inputTokens: 20, outputTokens: 45 });
    await pause();
    const overview = await s.agent.get('/api/superuser/overview').query({ group: 'Schule' }).expect(200);
    expect(overview.body.accounts.find((u: any) => u.id === memberId).account_group).toBe('Schule');
    expect(overview.body.events).toHaveLength(2);
    expect(overview.body.events.map((e: any) => e.delta_total_tokens)).toEqual([25, 40]);
    const list = await s.agent.get('/api/superuser/chats').query({ group: 'Schule', q: 'Hausaufgaben' }).expect(200);
    expect(list.body[0]).toMatchObject({ id: foreign.body.id, username: 'schule', account_group: 'Schule' });
    const snapshot = await s.agent.get('/api/superuser/chats/' + foreign.body.id).expect(200);
    expect(snapshot.body.messages[0].text).toBe('Mathe Hausaufgaben Thema');
    const summary = await post(s, '/superuser/summaries', csrf, { accountGroup: 'Schule', days: 30, instructions: 'Nenne Themen.' }).expect(202);
    expect(summary.body.chat.user_id).toBeTruthy();
    expect(s.rpc.calls.filter((c) => c.method === 'turn/start').at(-1)?.params.input[0].text).toContain('Mathe Hausaufgaben Thema');
    expect(adminId).toBeTruthy();
  });
});
describe('Chat persistence and protocol fixtures', () => {
  it('serializes cancelled thread preparation before a replacement send', async () => {
    const s = setup(),
      chat = s.store.create();
    const original = s.rpc.request.bind(s.rpc);
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let entered = false;
    s.rpc.request = async (method, params) => {
      if (method === 'thread/start') {
        entered = true;
        await gate;
      }
      return original(method, params);
    };
    await s.chats.send(chat.id, randomUUID(), 'abbrechen', []);
    while (!entered) await pause();
    await s.chats.stop(chat.id);
    await s.chats.send(chat.id, randomUUID(), 'weiter', []);
    release();
    await pause();
    await pause();
    expect(s.rpc.calls.filter((c) => c.method === 'thread/start')).toHaveLength(1);
    expect(s.rpc.calls.filter((c) => c.method === 'turn/start')).toHaveLength(1);
    expect(s.store.snapshot(chat.id).turns.map((t) => t.status)).toEqual([
      'interrupted',
      'running',
    ]);
  });
  it('accepts real Codex-shaped base64 output without reading the supplied path', async () => {
    const s = setup();
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#0000ff' } })
      .png()
      .toBuffer();
    const artifact = await s.artifacts.generated(
      {
        status: 'completed',
        result: png.toString('base64'),
        savedPath: '/not-readable/generated.png',
        failure: null,
      },
      s.cfg.work,
    );
    expect(fs.existsSync(s.artifacts.file(artifact))).toBe(true);
    await expect(
      s.artifacts.generated({ status: 'failed', result: '', failure: null }, s.cfg.work),
    ).rejects.toThrow(/Bilderstellung fehlgeschlagen/);
    await expect(
      s.artifacts.generated(
        { status: 'failed', result: '', failure: { type: 'usageLimitExceeded' } },
        s.cfg.work,
      ),
    ).rejects.toThrow(/Kontingent/);
  });
  it('deduplicates requests, serializes turns, persists deltas and reconciles final text', async () => {
    const s = setup(),
      csrf = await login(s),
      chat = (await post(s, '/chats', csrf, {})).body;
    const body = { key: randomUUID(), text: 'Hallo', attachments: [] };
    const first = await post(s, '/chats/' + chat.id + '/send', csrf, body).expect(202);
    await pause();
    const again = await post(s, '/chats/' + chat.id + '/send', csrf, body).expect(202);
    expect(first.body.id).toBe(again.body.id);
    await post(s, '/chats/' + chat.id + '/send', csrf, { ...body, text: 'Anders' }).expect(409);
    await post(s, '/chats/' + chat.id + '/send', csrf, { ...body, key: randomUUID() }).expect(409);
    expect(s.rpc.calls.filter((c) => c.method === 'turn/start')).toHaveLength(1);
    const thread = s.store.chat(chat.id)!.thread_id!;
    s.rpc.delta(thread, 'Hal');
    s.rpc.delta(thread, 'lo');
    await pause();
    expect(s.store.snapshot(chat.id).messages.at(-1)?.text).toBe('Hallo');
    s.rpc.complete(thread, 'Hallo!');
    await pause();
    expect(s.store.snapshot(chat.id).messages.at(-1)?.text).toBe('Hallo!');
    expect(s.store.snapshot(chat.id).turns[0].status).toBe('completed');
    expect(s.store.snapshot(chat.id).eventId).toBeGreaterThan(0);
  });
  it('records actual per-turn tokens for the admin panel only', async () => {
    const s = setup(),
      csrf = await login(s),
      chat = (await post(s, '/chats', csrf, {})).body;
    await post(s, '/chats/' + chat.id + '/send', csrf, {
      key: randomUUID(), text: 'Tokens', attachments: [],
    }).expect(202);
    await pause();
    const thread = s.store.chat(chat.id)!.thread_id!;
    s.rpc.tokenUsage(thread, { totalTokens: 120, inputTokens: 30, outputTokens: 40, reasoningOutputTokens: 50 });
    await pause();
    s.rpc.tokenUsage(thread, { totalTokens: 150, inputTokens: 40, outputTokens: 50, reasoningOutputTokens: 60 });
    await pause();
    const owner = (await s.agent.get('/api/admin/users')).body.users.find((u: any) => u.username === 'owner');
    expect(owner).toMatchObject({ tokens: 150, tokens_five_hours: 150, tokens_week: 150, input_tokens: 40, output_tokens: 110 });
    const member = request.agent(s.app);
    await member.post('/api/auth/register').set('Origin', s.cfg.baseUrl).set('X-Requested-With', 'PrivateChat')
      .send({ username: 'tokens-mitglied', password: 'tokens-mitglied-passwort' }).expect(202);
    await member.get('/api/admin/users').expect(401);
  });
  it('marks crash interruption and preserves partial output across store reopening', async () => {
    const s = setup(),
      chat = s.store.create();
    await s.chats.send(chat.id, randomUUID(), 'test', []);
    await pause();
    s.rpc.delta(s.store.chat(chat.id)!.thread_id!, 'Teil');
    await pause();
    s.rpc.close();
    expect(s.store.snapshot(chat.id).turns[0].status).toBe('interrupted');
    const reopened = createApp(s.cfg, new Fixture());
    systems.push(reopened);
    expect(reopened.store.snapshot(chat.id).messages.at(-1)?.text).toBe('Teil');
    expect(reopened.store.snapshot(chat.id).turns[0].status).toBe('interrupted');
  });
  it('stops a turn and uses thread resume after backend restart', async () => {
    const s = setup(),
      chat = s.store.create();
    await s.chats.send(chat.id, randomUUID(), 'test', []);
    await pause();
    await s.chats.stop(chat.id);
    await pause();
    expect(s.store.snapshot(chat.id).turns[0].status).toBe('interrupted');
    const rpc = new Fixture(),
      reopened = createApp(s.cfg, rpc);
    systems.push(reopened);
    await reopened.chats.send(chat.id, randomUUID(), 'weiter', []);
    await pause();
    expect(rpc.calls.some((c) => c.method === 'thread/resume')).toBe(true);
  });
  it('forks exactly before an edited user message and retains source history', async () => {
    const s = setup(),
      chat = s.store.create();
    await s.chats.send(chat.id, randomUUID(), 'eins', []);
    await pause();
    const thread = s.store.chat(chat.id)!.thread_id!;
    s.rpc.complete(thread, 'Antwort eins');
    await pause();
    await s.chats.send(chat.id, randomUUID(), 'zwei', []);
    await pause();
    s.rpc.complete(thread, 'Antwort zwei');
    await pause();
    const before = s.store.snapshot(chat.id),
      m = before.messages.find((m) => m.text === 'zwei')!;
    const branched = await s.chats.branch(chat.id, m.id, 'neu', randomUUID());
    await pause();
    expect(s.store.snapshot(chat.id).messages).toEqual(before.messages);
    expect(s.store.snapshot(branched.id).messages.map((m) => m.text)).toEqual([
      'eins',
      'Antwort eins',
      'neu',
    ]);
    const call = s.rpc.calls.find((c) => c.method === 'thread/fork')!;
    expect(call.params.lastTurnId).toBe(before.turns[0].codex_id);
  });
  it('reports missing login, limits and process failure without retries', async () => {
    const s = setup();
    s.rpc.account = null;
    const a = s.store.create();
    await s.chats.send(a.id, randomUUID(), 'x', []);
    await pause();
    expect(s.store.snapshot(a.id).turns[0].status).toBe('failed');
    s.rpc.account = { type: 'chatgpt' };
    s.rpc.failure = '429 quota exceeded';
    const b = s.store.create();
    await s.chats.send(b.id, randomUUID(), 'x', []);
    await pause();
    expect(s.store.snapshot(b.id).turns[0].error).toMatch(/limit/i);
    expect(s.rpc.calls.filter((c) => c.method === 'turn/start')).toHaveLength(0);
  });
  it('imports generated images only inside the chat directory (protocol fixture)', async () => {
    const s = setup(),
      chat = s.store.create();
    await s.chats.send(chat.id, randomUUID(), 'Bild', []);
    await pause();
    const png = await sharp({ create: { width: 3, height: 3, channels: 3, background: '#00ff00' } })
      .png()
      .toBuffer();
    const file = path.join(s.chats.work(chat.id), 'generated.png');
    fs.writeFileSync(file, png);
    s.rpc.emit('notification', 'item/completed', {
      threadId: s.store.chat(chat.id)!.thread_id,
      item: { type: 'imageGeneration', id: 'image1', result: '', savedPath: file, failure: null },
    });
    await pause();
    expect(s.store.snapshot(chat.id).messages.at(-1)?.attachments).toHaveLength(1);
    await expect(
      s.artifacts.generated(
        { savedPath: path.join(s.cfg.data, 'app.sqlite') },
        s.chats.work(chat.id),
      ),
    ).rejects.toThrow(/außerhalb/);
  });
  it('stops an inactive turn after the configured timeout without waiting for Codex', async () => {
    const s = setup(),
      chat = s.store.create();
    s.cfg.turnIdleMs = 25;
    await s.chats.send(chat.id, randomUUID(), 'warte nicht endlos', []);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const turn = s.store.snapshot(chat.id).turns[0];
    expect(turn.status).toBe('interrupted');
    expect(turn.error).toMatch(/drei Minuten/);
    expect(s.rpc.calls.some((call) => call.method === 'turn/interrupt')).toBe(true);
  });
  it('re-reads a completed image once when its live event has no artifact yet', async () => {
    const s = setup(),
      chat = s.store.create();
    await s.chats.send(chat.id, randomUUID(), 'Bild', []);
    await pause();
    const thread = s.store.chat(chat.id)!.thread_id!;
    const png = await sharp({ create: { width: 3, height: 3, channels: 3, background: '#ff00ff' } })
      .png()
      .toBuffer();
    s.rpc.imageHistory.set(thread, [
      { type: 'imageGeneration', id: 'hydrated-image', status: 'completed', result: png.toString('base64'), failure: null },
    ]);
    s.rpc.emit('notification', 'item/completed', {
      threadId: thread,
      item: { type: 'imageGeneration', id: 'hydrated-image', status: 'completed', result: '', failure: null },
    });
    await pause();
    const snapshot = s.store.snapshot(chat.id);
    expect(snapshot.messages.at(-1)?.attachments).toHaveLength(1);
    expect(snapshot.turns[0].error).toBeNull();
    expect(s.rpc.calls.some((c) => c.method === 'thread/read')).toBe(true);
  });
  it('manages projects, documents, favorites, trash and retention', async () => {
    const s = setup(), csrf = await login(s);
    const project = (await post(s, '/projects', csrf, { name: 'Schule', instructions: 'Kurz antworten.' }).expect(201)).body;
    const chat = (await post(s, '/chats', csrf, {}).expect(201)).body;
    await s.agent.patch('/api/chats/' + chat.id).set('Origin', s.cfg.baseUrl).set('X-Requested-With', 'PrivateChat').set('X-CSRF-Token', csrf).send({ projectId: project.id, favorite: true }).expect(200);
    await post(s, '/projects/' + project.id + '/tasks', csrf, { title: 'Gliederung schreiben' }).expect(201);
    expect((await s.agent.get('/api/projects/' + project.id + '/tasks').expect(200)).body[0].title).toBe('Gliederung schreiben');
    const document = await s.agent.post('/api/documents').set('Origin', s.cfg.baseUrl).set('X-Requested-With', 'PrivateChat').set('X-CSRF-Token', csrf).attach('document', Buffer.from('Hallo Dokument'), 'notiz.txt').expect(201);
    await post(s, '/projects/' + project.id + '/files', csrf, { artifactId: document.body.id }).expect(201);
    expect((await s.agent.get('/api/projects/' + project.id + '/files').expect(200)).body).toHaveLength(1);
    expect((await s.agent.get('/api/chats?favorite=true').expect(200)).body.map((c: any) => c.id)).toContain(chat.id);
    await s.agent.delete('/api/chats/' + chat.id).set('Origin', s.cfg.baseUrl).set('X-Requested-With', 'PrivateChat').set('X-CSRF-Token', csrf).expect(200);
    expect((await s.agent.get('/api/chats?trash=true').expect(200)).body.map((c: any) => c.id)).toContain(chat.id);
    await post(s, '/chats/' + chat.id + '/restore', csrf, {}).expect(200);
    await s.agent.patch('/api/retention').set('Origin', s.cfg.baseUrl).set('X-Requested-With', 'PrivateChat').set('X-CSRF-Token', csrf).send({ days: 14 }).expect(200);
    expect((await s.agent.get('/api/retention').expect(200)).body.days).toBe(14);
  });
});
