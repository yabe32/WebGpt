import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { z, ZodError } from 'zod';
import path from 'node:path';
import fs from 'node:fs';
import type { Config } from './config.js';
import { Store } from './db.js';
import { Auth } from './auth.js';
import { Artifacts } from './artifacts.js';
import { Chats, friendly } from './chat.js';
import type { Rpc } from './codex.js';
const id = z.string().uuid(),
  credentials = z.object({
    username: z.string().trim().min(1).max(80),
    password: z.string().min(12).max(128),
  });
const managedUser = z.object({
  username: z.string().trim().min(1).max(80),
  password: z.string().min(12).max(128),
  role: z.enum(['admin', 'member']).default('member'),
  rateLimitPerHour: z.number().int().min(1).max(10000).default(60),
  tokenLimitFiveHours: z.number().int().min(0).max(1_000_000_000).default(0),
  tokenLimitWeek: z.number().int().min(0).max(1_000_000_000).default(0),
});
export function createApp(cfg: Config, rpc: Rpc) {
  const app = express(),
    store = new Store(cfg),
    auth = new Auth(store, cfg),
    artifacts = new Artifacts(cfg, store),
    chats = new Chats(store, rpc, cfg, artifacts);
  app.disable('x-powered-by');
  if (cfg.trustProxy) app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'blob:'],
          fontSrc: ["'self'"],
          connectSrc: cfg.production
            ? ["'self'"]
            : ["'self'", 'ws://localhost:*', 'ws://127.0.0.1:*'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: cfg.secure ? [] : null,
        },
      },
      strictTransportSecurity: cfg.secure ? undefined : false,
    }),
  );
  app.use(cookieParser());
  app.use('/api', auth.origin, express.json({ limit: '200kb' }));
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Zu viele Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.' },
  });
  const registrationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Zu viele Registrierungsversuche. Bitte in 15 Minuten erneut versuchen.' },
  });
  app.get('/api/auth', (req, res) => {
    const s = auth.session(req);
    res.json({
      configured: auth.configured(),
      authenticated: !!s,
      csrf: s?.csrf,
      user: s ? { username: s.username, role: s.role } : null,
    });
  });
  app.post('/api/auth/setup', limiter, async (req, res) => {
    const v = credentials.extend({ key: z.string().length(64) }).parse(req.body);
    await auth.setup(v.username, v.password, v.key);
    await auth.login(req, res, v.username, v.password);
    res.json({ ok: true });
  });
  app.post('/api/auth/login', limiter, async (req, res) => {
    const v = credentials.parse(req.body);
    await auth.login(req, res, v.username, v.password);
    res.json({ ok: true });
  });
  app.post('/api/auth/register', registrationLimiter, async (req, res) => {
    const v = credentials.parse(req.body);
    await auth.registerPending(v.username, v.password);
    res.status(202).json({ ok: true, message: 'Antrag gespeichert. Ein Admin muss das Konto noch aktivieren.' });
  });
  app.use('/api', auth.require);
  app.post('/api/auth/logout', (req, res) => {
    auth.logout(req, res);
    res.json({ ok: true });
  });
  app.get('/api/sessions', (_req, res) =>
    res.json(
      store
        .all('SELECT id,label,created_at,expires_at FROM sessions WHERE expires_at>? AND user_id=?', Date.now(), res.locals.session.user_id)
        .map((s) => ({ ...s, current: s.id === res.locals.session.id })),
    ),
  );
  app.delete('/api/sessions/:id', (req, res) => {
    store.run('DELETE FROM sessions WHERE id=? AND user_id=?', id.parse(req.params.id), res.locals.session.user_id);
    res.json({ ok: true });
  });
  app.get('/api/admin/users', auth.requireAdmin, async (_req, res) => {
    const now = Date.now(),
      since = now - 3600000,
      fiveHours = now - 5 * 3600000,
      week = now - 7 * 24 * 3600000;
    const users = store.all(
      `SELECT u.id,u.username,u.role,u.active,u.rate_limit_per_hour,u.token_limit_five_hours,u.token_limit_week,u.created_at,u.last_login_at,
        (SELECT COUNT(*) FROM sessions s WHERE s.user_id=u.id AND s.expires_at>?) AS sessions,
        (SELECT COUNT(*) FROM chats c WHERE c.user_id=u.id) AS chats,
        (SELECT COUNT(*) FROM usage_events e WHERE e.user_id=u.id AND e.kind='turn') AS turns,
        (SELECT COUNT(*) FROM usage_events e WHERE e.user_id=u.id AND e.kind='image') AS images,
        (SELECT COUNT(*) FROM usage_events e WHERE e.user_id=u.id AND e.kind='webSearch') AS web_searches,
        (SELECT COUNT(*) FROM usage_events e WHERE e.user_id=u.id AND e.kind='turn' AND e.created_at>=?) AS turns_last_hour,
        COALESCE((SELECT SUM(t.total_tokens) FROM turn_token_usage t WHERE t.user_id=u.id),0) AS tokens,
        COALESCE((SELECT SUM(t.total_tokens) FROM turn_token_usage t WHERE t.user_id=u.id AND t.updated_at>=?),0) AS tokens_five_hours,
        COALESCE((SELECT SUM(t.total_tokens) FROM turn_token_usage t WHERE t.user_id=u.id AND t.updated_at>=?),0) AS tokens_week,
        COALESCE((SELECT SUM(t.input_tokens) FROM turn_token_usage t WHERE t.user_id=u.id),0) AS input_tokens,
        COALESCE((SELECT SUM(t.output_tokens + t.reasoning_output_tokens) FROM turn_token_usage t WHERE t.user_id=u.id),0) AS output_tokens
       FROM users u ORDER BY u.created_at`,
      Date.now(),
      since,
      fiveHours,
      week,
    );
    let codexLimits = null;
    try { codexLimits = (await chats.status()).limits; } catch {}
    res.json({ users, codexLimits });
  });
  app.get('/api/admin/models', auth.requireAdmin, async (_req, res) => {
    const catalog = await rpc.request('model/list', { limit: 100, includeHidden: false });
    const models = (catalog.data || [])
      .filter((m: any) => !m.inputModalities || m.inputModalities.includes('image'))
      .map((m: any) => ({
        id: m.model || m.id,
        name: m.displayName || m.model || m.id,
        isDefault: !!m.isDefault,
        inputModalities: m.inputModalities || ['text', 'image'],
      }));
    res.json({ selected: store.setting('global_model') || null, configured: cfg.model || null, models });
  });
  app.put('/api/admin/models', auth.requireAdmin, async (req, res) => {
    if (store.get("SELECT id FROM turns WHERE status IN ('running','starting')"))
      throw Object.assign(Error('Bitte erst laufende Antworten beenden.'), { status: 409 });
    const model = z.object({ model: z.string().min(1).max(200).nullable() }).parse(req.body).model;
    if (model !== null) {
      const catalog = await rpc.request('model/list', { limit: 100, includeHidden: false });
      const found = (catalog.data || []).some(
        (m: any) => (m.model || m.id) === model && (!m.inputModalities || m.inputModalities.includes('image')),
      );
      if (!found) throw Object.assign(Error('Dieses Modell ist in deinem Codex-Katalog nicht verfügbar.'), { status: 400 });
    }
    store.setSetting('global_model', model);
    res.json({ ok: true, model });
  });
  app.post('/api/admin/users', auth.requireAdmin, async (req, res) => {
    const v = managedUser.parse(req.body);
    const userId = await auth.createUser(v.username, v.password, v.role, v.rateLimitPerHour);
    store.run('UPDATE users SET token_limit_five_hours=?,token_limit_week=? WHERE id=?', v.tokenLimitFiveHours, v.tokenLimitWeek, userId);
    res.status(201).json({ id: userId });
  });
  app.patch('/api/admin/users/:id', auth.requireAdmin, async (req, res) => {
    const userId = id.parse(req.params.id);
    const v = z.object({
      active: z.boolean().optional(),
      role: z.enum(['admin', 'member']).optional(),
      rateLimitPerHour: z.number().int().min(1).max(10000).optional(),
      tokenLimitFiveHours: z.number().int().min(0).max(1_000_000_000).optional(),
      tokenLimitWeek: z.number().int().min(0).max(1_000_000_000).optional(),
      username: z.string().trim().min(1).max(80).optional(),
      password: z.string().min(12).max(128).optional(),
    }).parse(req.body);
    const target = store.get<any>('SELECT * FROM users WHERE id=?', userId);
    if (!target) throw Object.assign(Error('Konto nicht gefunden.'), { status: 404 });
    if (target.id === res.locals.session.user_id && v.active === false)
      throw Object.assign(Error('Das eigene Admin-Konto kann nicht deaktiviert werden.'), { status: 409 });
    if (target.role === 'admin' && (v.active === false || v.role === 'member')) {
      const admins = store.get<{ n: number }>(
        "SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1",
      )!.n;
      if (admins < 2)
        throw Object.assign(Error('Mindestens ein aktives Admin-Konto muss bestehen bleiben.'), { status: 409 });
    }
    if (v.active !== undefined) store.run('UPDATE users SET active=? WHERE id=?', v.active ? 1 : 0, userId);
    if (v.role) store.run('UPDATE users SET role=? WHERE id=?', v.role, userId);
    if (v.rateLimitPerHour) store.run('UPDATE users SET rate_limit_per_hour=? WHERE id=?', v.rateLimitPerHour, userId);
    if (v.tokenLimitFiveHours !== undefined) store.run('UPDATE users SET token_limit_five_hours=? WHERE id=?', v.tokenLimitFiveHours, userId);
    if (v.tokenLimitWeek !== undefined) store.run('UPDATE users SET token_limit_week=? WHERE id=?', v.tokenLimitWeek, userId);
    await auth.updateUser(userId, { username: v.username, password: v.password }, res.locals.session.id);
    if (v.active === false) store.run('DELETE FROM sessions WHERE user_id=?', userId);
    res.json({ ok: true });
  });
  app.get('/api/status', async (_req, res) => {
    const status = await chats.status();
    if (res.locals.session.role !== 'admin') {
      status.limits = null;
      (status as any).globalLimitsHidden = true;
    }
    res.json(status);
  });
  app.post('/api/codex/connect', auth.requireAdmin, async (_req, res) => {
    if ('start' in rpc) await (rpc as any).start();
    res.json({ ok: true });
  });
  app.post('/api/codex/login', auth.requireAdmin, async (_req, res) => {
    const r = await rpc.request('account/login/start', { type: 'chatgptDeviceCode' });
    res.json({ verificationUrl: r.verificationUrl, userCode: r.userCode, loginId: r.loginId });
  });
  app.post('/api/codex/logout', auth.requireAdmin, async (_req, res) => {
    if (store.get("SELECT id FROM turns WHERE status IN ('running','starting')"))
      throw Object.assign(Error('Bitte erst laufende Antworten stoppen.'), { status: 409 });
    await rpc.request('account/logout');
    res.json({ ok: true });
  });
  app.get('/api/chats', (req, res) => {
    const q = String(req.query.q || '').slice(0, 200);
    res.json(
      store.all(
        'SELECT DISTINCT c.* FROM chats c LEFT JOIN messages m ON m.chat_id=c.id WHERE c.user_id=? AND (c.title LIKE ? OR m.text LIKE ?) ORDER BY c.updated_at DESC',
        res.locals.session.user_id,
        '%' + q + '%',
        '%' + q + '%',
      ),
    );
  });
  app.post('/api/chats', (_req, res) => res.status(201).json(store.create('Neue Unterhaltung', null, null, res.locals.session.user_id)));
  app.get('/api/chats/:id', (req, res) => res.json(store.snapshot(id.parse(req.params.id), res.locals.session.user_id)));
  app.patch('/api/chats/:id', (req, res) => {
    const cid = id.parse(req.params.id);
    store.snapshot(cid, res.locals.session.user_id);
    const { title } = z.object({ title: z.string().trim().min(1).max(120) }).parse(req.body);
    store.run('UPDATE chats SET title=? WHERE id=?', title, cid);
    chats.publish(cid);
    res.json({ ok: true });
  });
  app.delete('/api/chats/:id', async (req, res) => {
    const cid = id.parse(req.params.id);
    const c = store.chat(cid, res.locals.session.user_id);
    if (!c) {
      res.json({ ok: true });
      return;
    }
    if (store.get("SELECT id FROM turns WHERE chat_id=? AND status IN ('starting','running')", cid))
      throw Object.assign(Error('Bitte zuerst die Antwort stoppen.'), { status: 409 });
    // thread/delete can delete descendant forks. Keep Codex rollouts for branch safety; documented retention.
    store.run('DELETE FROM chats WHERE id=?', cid);
    chats.emit('deleted', cid);
    res.json({ ok: true });
  });
  app.post('/api/chats/:id/send', async (req, res) => {
    const v = z
      .object({ key: id, text: z.string().max(100000), attachments: z.array(id).max(6) })
      .refine((v) => v.text.trim() || v.attachments.length)
      .parse(req.body);
    for (const f of v.attachments)
      if (!store.get('SELECT id FROM artifacts WHERE id=? AND user_id=?', f, res.locals.session.user_id))
        throw Object.assign(Error('Bild nicht gefunden.'), { status: 404 });
    res.status(202).json(await chats.send(id.parse(req.params.id), v.key, v.text, v.attachments, res.locals.session.user_id));
  });
  app.post('/api/chats/:id/stop', async (req, res) => {
    await chats.stop(id.parse(req.params.id), res.locals.session.user_id);
    res.json({ ok: true });
  });
  app.post('/api/chats/:id/branch', async (req, res) => {
    const v = z
      .object({ messageId: z.string().max(150), text: z.string().min(1).max(100000), key: id })
      .parse(req.body);
    res.json(await chats.branch(id.parse(req.params.id), v.messageId, v.text, v.key, res.locals.session.user_id));
  });
  app.get('/api/chats/:id/events', (req, res) => {
    const cid = id.parse(req.params.id);
    store.snapshot(cid, res.locals.session.user_id);
    const after = Number(req.headers['last-event-id'] || req.query.after || 0);
    if (!Number.isSafeInteger(after) || after < 0) {
      res.status(400).end();
      return;
    }
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    let closed = false;
    const session = res.locals.session;
    const send = (eid: number, data: any) => {
      if (
        !store.get('SELECT id FROM sessions WHERE id=? AND expires_at>?', session.id, Date.now())
      ) {
        res.end();
        return;
      }
      if (!closed && !res.write(`id: ${eid}\ndata: ${JSON.stringify(data)}\n\n`)) res.end();
    };
    // Subscribe before replay; synchronous SQLite operations prevent a replay/live gap.
    const onEvent = (chat: string, eid: number, data: any) => {
      if (chat === cid && eid > after) send(eid, data);
    };
    chats.on('event', onEvent);
    const events = store.all(
      'SELECT id,payload FROM events WHERE chat_id=? AND id>? ORDER BY id LIMIT 1001',
      cid,
      after,
    );
    if (events.length > 1000) {
      send(store.snapshot(cid).eventId, { type: 'reset' });
    } else for (const e of events) send(e.id, JSON.parse(e.payload));
    const heartbeat = setInterval(() => {
      if (
        !store.get('SELECT id FROM sessions WHERE id=? AND expires_at>?', session.id, Date.now())
      ) {
        res.end();
        return;
      }
      if (!store.chat(cid)) {
        res.end();
        return;
      }
      res.write(': heartbeat\n\n');
    }, 10000);
    const onDown = () => {
      if (!closed) send(store.snapshot(cid).eventId, { type: 'changed' });
    };
    chats.on('changed', onDown);
    const deleted = (chat: string) => {
      if (chat === cid) res.end();
    };
    chats.on('deleted', deleted);
    const cleanup = () => {
      closed = true;
      clearInterval(heartbeat);
      chats.off('event', onEvent);
      chats.off('changed', onDown);
      chats.off('deleted', deleted);
    };
    res.on('close', cleanup);
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: cfg.maxUpload, files: 1, fields: 0 },
  });
  app.post('/api/uploads', upload.single('image'), async (req, res) => {
    if (!req.file) throw Object.assign(Error('Bild fehlt.'), { status: 400 });
    res.status(201).json({ id: await artifacts.save(req.file.buffer, res.locals.session.user_id) });
  });
  app.get('/api/files/:id', (req, res) => {
    const fid = id.parse(req.params.id);
    if (!store.get('SELECT id FROM artifacts WHERE id=? AND user_id=?', fid, res.locals.session.user_id)) {
      res.status(404).end();
      return;
    }
    res.set({
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store',
      'Content-Disposition': `${req.query.download ? 'attachment' : 'inline'}; filename="bild-${fid}.png"`,
    });
    res.sendFile(artifacts.file(fid), { dotfiles: 'allow' });
  });
  app.get('/api/chats/:id/files', (req, res) => {
    const chatId = id.parse(req.params.id);
    if (!store.chat(chatId, res.locals.session.user_id)) {
      res.status(404).end();
      return;
    }
    const relative = z.string().min(1).max(240).parse(req.query.path);
    if (relative.includes('\0') || path.isAbsolute(relative)) {
      res.status(404).end();
      return;
    }
    const root = path.resolve(chats.work(chatId));
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep)) {
      res.status(404).end();
      return;
    }
    let stat: fs.Stats;
    try { stat = fs.statSync(file); } catch { res.status(404).end(); return; }
    if (!stat.isFile() || stat.size > cfg.maxUpload * 4) {
      res.status(404).end();
      return;
    }
    const name = path.basename(file);
    const extension = path.extname(name).toLowerCase();
    const type = ({
      '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
      '.json': 'application/json; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
      '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    } as Record<string, string>)[extension] || 'application/octet-stream';
    res.set({
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(name),
    });
    // `file` is already resolved below this chat's private work root; allowing dot
    // directories keeps local `.test-data` and container paths from changing behavior.
    res.sendFile(file, { dotfiles: 'allow' });
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpunkt nicht gefunden.' }));
  const client = path.resolve('dist/client');
  if (fs.existsSync(client)) {
    app.use(express.static(client));
    app.get('/{*path}', (_req, res) => res.sendFile(path.join(client, 'index.html')));
  }
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    const status =
      err instanceof ZodError ? 400 : err instanceof multer.MulterError ? 413 : err.status || 500;
    res
      .status(status)
      .json({
        error:
          err instanceof ZodError
            ? 'Bitte Eingaben prüfen.'
            : err instanceof multer.MulterError
              ? 'Upload zu groß oder zu viele Dateien.'
              : status === 500
                ? friendly(err)
                : err.message,
      });
  });
  return { app, store, chats, auth, artifacts };
}
