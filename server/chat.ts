import { EventEmitter } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Store, type Turn, type Message } from './db.js';
import type { Rpc } from './codex.js';
import type { Config } from './config.js';
import { Artifacts } from './artifacts.js';
const fail = (message: string, status = 400) => Object.assign(Error(message), { status });
export class Chats extends EventEmitter {
  private queue = Promise.resolve();
  private starts = new Map<string, Promise<void>>();
  private loaded = new Set<string>();
  private idleTimers = new Map<string, NodeJS.Timeout>();
  constructor(
    public store: Store,
    public rpc: Rpc,
    public cfg: Config,
    public artifacts: Artifacts,
  ) {
    super();
    store.interrupt();
    rpc.on('notification', (m, p) => {
      this.queue = this.queue
        .then(() => this.notification(m, p))
        .catch(() => {
          if (p?.threadId) {
            const chat = store.get('SELECT id FROM chats WHERE thread_id=?', p.threadId);
            if (chat) this.failActive(chat.id, 'Codex-Ereignis konnte nicht gespeichert werden.');
          }
        });
    });
    rpc.on('down', () => {
      this.loaded.clear();
      this.clearIdleTimers();
      store.interrupt();
      this.emit('changed');
    });
    rpc.on('blockedAction', (thread) => {
      const c = store.get('SELECT id FROM chats WHERE thread_id=?', thread);
      if (c)
        this.publish(c.id, {
          type: 'notice',
          text: 'Eine nicht freigegebene Werkzeugaktion wurde abgelehnt.',
        });
    });
  }
  publish(chat: string, data: any = { type: 'changed' }) {
    const id = this.store.event(chat, data);
    this.emit('event', chat, id, data);
  }
  work(id: string) {
    return path.join(this.cfg.work, id);
  }
  private async options(id: string) {
    const cwd = this.work(id);
    await fs.mkdir(cwd, { recursive: true, mode: 0o700 });
    return {
      cwd,
      approvalPolicy: 'on-request',
      sandbox: this.cfg.codexSandboxMode,
      model: this.store.setting('global_model') || this.cfg.model,
      developerInstructions: /*
        'Du bist ein privater deutschsprachiger Chat-Assistent. Antworte direkt und verständlich. Nutze das native Bildwerkzeug für angefragte Bilder und Bearbeitungen. Shell, Websuche, Plugins und externe Dienste sind nicht verfügbar. Erfinde keine erzeugten Bilder. Speichere Bilder ausschließlich im Arbeitsverzeichnis dieses Gesprächs. Keine API-Schlüssel oder kostenpflichtigen Alternativen verwenden.',
      */ `Du bist ein privater deutschsprachiger Chat-Assistent. Antworte direkt und verständlich. Erledige Inhalte grundsätzlich im Chat. Erstelle, ändere oder speichere keine Dateien, Dokumente, Präsentationen oder Tabellen, außer die Person verlangt ausdrücklich eine Datei oder ein bestimmtes Dateiformat. Wenn eine Datei ausdrücklich verlangt wird, speichere sie ausschließlich im Arbeitsverzeichnis dieses Gesprächs und verlinke sie als Markdown-Link mit /data/work/${id}/<Dateiname>. Für aktuelle oder überprüfbare Informationen darfst du die integrierte Websuche verwenden. Wenn du sie verwendest, nenne am Ende eine knappe Liste der wichtigsten Quellen als Markdown-Links und trenne Fakten aus dem Web klar von deiner Einordnung. Nutze das native Bildwerkzeug für angefragte Bilder und Bearbeitungen. Shell, Plugins und andere externe Dienste sind nicht verfügbar. Erfinde keine erzeugten Bilder oder Quellen. Keine API-Schlüssel oder kostenpflichtigen Alternativen verwenden.`,
    };
  }
  async status() {
    if (!this.rpc.ready)
      return { connected: false, account: null, limits: null, imagesVerified: false };
    const a = await this.rpc.request('account/read', { refreshToken: false });
    let limits = null;
    try {
      if (a.account?.type === 'chatgpt') limits = await this.rpc.request('account/rateLimits/read');
    } catch {}
    return {
      connected: true,
      account:
        a.account?.type === 'chatgpt' ? { type: 'chatgpt', planType: a.account.planType } : null,
      limits,
      imagesVerified: !!this.store.get("SELECT * FROM capabilities WHERE name='imageGeneration'"),
      webSearchEnabled: this.cfg.webSearch !== 'disabled',
      webSearchVerified: !!this.store.get("SELECT * FROM capabilities WHERE name='webSearch'"),
      imageNotice:
        'Bildwerkzeug integriert; Kontoverfügbarkeit erst nach erfolgreichem Bildtest bestätigt.',
    };
  }
  async send(
    chatId: string,
    key: string,
    text: string,
    attachments: string[],
    userId?: string,
  ) {
    const hash = createHash('sha256')
      .update(JSON.stringify({ chatId, text, attachments }))
      .digest('hex');
    const old = this.store.get<Turn>('SELECT * FROM turns WHERE request_key=?', key);
    if (old) {
      if (old.request_hash !== hash)
        throw fail('Diese Sende-ID wurde für andere Inhalte benutzt.', 409);
      return old;
    }
    const chat = this.store.chat(chatId, userId);
    if (!chat) throw fail('Gespräch nicht gefunden.', 404);
    if (userId) {
      const user = this.store.get<{ rate_limit_per_hour: number; token_limit_five_hours: number; token_limit_week: number }>(
        'SELECT rate_limit_per_hour,token_limit_five_hours,token_limit_week FROM users WHERE id=? AND active=1',
        userId,
      );
      if (!user) throw fail('Dieses Konto ist deaktiviert.', 403);
      const since = Date.now() - 3600000;
      const used = this.store.get<{ n: number }>(
        "SELECT COUNT(*) n FROM usage_events WHERE user_id=? AND kind='turn' AND created_at>=?",
        userId,
        since,
      )!.n;
      const now = Date.now();
      const tokenUsage = this.store.get<{ fiveHours: number; week: number }>(
        `SELECT COALESCE(SUM(CASE WHEN updated_at>=? THEN total_tokens ELSE 0 END),0) AS fiveHours,
                COALESCE(SUM(CASE WHEN updated_at>=? THEN total_tokens ELSE 0 END),0) AS week
           FROM turn_token_usage WHERE user_id=?`,
        now - 5 * 3600000,
        now - 7 * 24 * 3600000,
        userId,
      )!;
      if (user.token_limit_five_hours > 0 && tokenUsage.fiveHours >= user.token_limit_five_hours)
        throw fail('Tokenlimit für die letzten fünf Stunden ist erreicht. Bitte später erneut versuchen.', 429);
      if (user.token_limit_week > 0 && tokenUsage.week >= user.token_limit_week)
        throw fail('Wöchentliches Tokenlimit ist erreicht. Bitte später erneut versuchen.', 429);
      if (used >= user.rate_limit_per_hour)
        throw fail('Dein Stundenlimit für Modellanfragen ist erreicht. Bitte später erneut versuchen.', 429);
    }
    if (
      this.store.get(
        "SELECT id FROM turns WHERE chat_id=? AND status IN ('starting','running')",
        chatId,
      )
    )
      throw fail('In diesem Gespräch läuft bereits eine Antwort.', 409);
    const id = randomUUID();
    this.store.db.transaction(() => {
      this.store.run(
        'INSERT INTO turns VALUES (?,?,?,?,?,?,?,?)',
        id,
        chatId,
        key,
        hash,
        null,
        'starting',
        null,
        Date.now(),
      );
      // Persist message and request atomically before invoking the remote model.
      const ordinal = this.store.get<{ n: number }>(
        'SELECT COALESCE(MAX(ordinal),0)+1 n FROM messages WHERE chat_id=?',
        chatId,
      )!.n;
      this.store.run(
        'INSERT INTO messages VALUES (?,?,?,?,?,?,?)',
        randomUUID(),
        chatId,
        id,
        'user',
        text,
        JSON.stringify(attachments),
        ordinal,
      );
      if (chat.title === 'Neue Unterhaltung')
        this.store.run(
          'UPDATE chats SET title=? WHERE id=?',
          text.slice(0, 60) || 'Bildgespräch',
          chatId,
        );
      if (userId)
        this.store.run("INSERT INTO usage_events(user_id,kind,created_at) VALUES (?,'turn',?)", userId, Date.now());
    })();
    this.publish(chatId);
    this.watchIdleTurn(id, chatId);
    // A cancelled preparation must finish before a new turn can initialize the same thread.
    const preparation = (this.starts.get(chatId) || Promise.resolve()).then(() =>
      this.start(id, text, attachments),
    );
    this.starts.set(chatId, preparation);
    void preparation.finally(() => {
      if (this.starts.get(chatId) === preparation) this.starts.delete(chatId);
    });
    return this.store.get<Turn>('SELECT * FROM turns WHERE id=?', id)!;
  }
  private async start(id: string, text: string, attachments: string[]) {
    const t = this.store.get<Turn>('SELECT * FROM turns WHERE id=?', id)!;
    try {
      if (!this.rpc.ready)
        throw Error('Codex ist nicht verbunden. In den Einstellungen neu verbinden.');
      const a = await this.rpc.request('account/read', { refreshToken: true });
      if (a.account?.type !== 'chatgpt')
        throw Error('Bitte zuerst in den Einstellungen mit ChatGPT anmelden.');
      const opts = await this.options(t.chat_id);
      let chat = this.store.chat(t.chat_id)!;
      if (!chat.thread_id) {
        const r = await this.rpc.request('thread/start', opts);
        this.store.run('UPDATE chats SET thread_id=? WHERE id=?', r.thread.id, chat.id);
        chat = this.store.chat(chat.id)!;
        this.loaded.add(chat.thread_id!);
      } else if (!this.loaded.has(chat.thread_id)) {
        await this.rpc.request('thread/resume', { threadId: chat.thread_id, ...opts });
        this.loaded.add(chat.thread_id);
      }
      const input: any[] = [{ type: 'text', text, text_elements: [] }];
      for (const f of attachments)
        input.push({ type: 'localImage', path: await this.artifacts.input(f, opts.cwd, chat.user_id || undefined) });
      const state = this.store.get<Turn>('SELECT * FROM turns WHERE id=?', id)!;
      if (state.status !== 'starting') return;
      this.store.run("UPDATE turns SET status='running' WHERE id=?", id);
      const r = await this.rpc.request('turn/start', {
        threadId: chat.thread_id,
        input,
        clientUserMessageId: id,
        model: this.store.setting('global_model') || this.cfg.model,
      });
      this.store.run('UPDATE turns SET codex_id=? WHERE id=?', r.turn.id, id);
      this.publish(chat.id);
    } catch (e) {
      // Tests and orderly shutdown can close SQLite while a cancelled remote
      // preparation is still unwinding. There is no process left to persist to.
      if (!this.store.open) return;
      this.clearIdleTimer(id);
      this.store.run(
        "UPDATE turns SET status='failed',error=? WHERE id=? AND status IN ('starting','running')",
        friendly(e),
        id,
      );
      this.publish(t.chat_id);
    }
  }
  async stop(chat: string, userId?: string) {
    if (!this.store.chat(chat, userId)) throw fail('Gespräch nicht gefunden.', 404);
    const t = this.store.get<Turn>(
      "SELECT * FROM turns WHERE chat_id=? AND status IN ('starting','running')",
      chat,
    );
    if (!t) return;
    this.clearIdleTimer(t.id);
    if (!t.codex_id) {
      if (t.status === 'starting') {
        this.store.run("UPDATE turns SET status='interrupted' WHERE id=?", t.id);
        this.publish(chat);
        return;
      }
      throw fail('Antwort startet gerade. Bitte gleich erneut stoppen.', 409);
    }
    this.store.run(
      "UPDATE turns SET status='interrupted',error=COALESCE(error,'Antwort gestoppt. Teilantwort bleibt gespeichert.') WHERE id=? AND status IN ('starting','running')",
      t.id,
    );
    this.publish(chat);
    void this.rpc.request('turn/interrupt', {
      threadId: this.store.chat(chat)!.thread_id,
      turnId: t.codex_id,
    }).catch(() => {});
  }
  private failActive(chat: string, error: string) {
    const active = this.store.all<Turn>(
      "SELECT * FROM turns WHERE chat_id=? AND status IN ('starting','running')",
      chat,
    );
    for (const turn of active) this.clearIdleTimer(turn.id);
    this.store.run(
      "UPDATE turns SET status='failed',error=? WHERE chat_id=? AND status IN ('starting','running')",
      error,
      chat,
    );
    this.publish(chat);
  }
  private async notification(method: string, p: any) {
    if (!p?.threadId) return;
    const c = this.store.get<{ id: string }>('SELECT id FROM chats WHERE thread_id=?', p.threadId);
    if (!c) return;
    if (method === 'thread/tokenUsage/updated') {
      this.recordTokens(c.id, p);
      return;
    }
    const t = this.store.get<Turn>(
      "SELECT * FROM turns WHERE chat_id=? AND status IN ('starting','running')",
      c.id,
    );
    if (!t) return;
    if (p.turnId && t.codex_id && p.turnId !== t.codex_id) return;
    if (method === 'turn/started') {
      this.store.run('UPDATE turns SET codex_id=? WHERE id=?', p.turn.id, t.id);
    }
    if (method === 'item/agentMessage/delta') {
      this.message(c.id, t.id, p.itemId, p.delta, false);
      if (p.delta) this.touchIdleTurn(t.id, c.id);
    }
    if (method === 'item/completed' && p.item.type === 'agentMessage')
      this.message(c.id, t.id, p.item.id, p.item.text, true);
    if (method === 'item/started' && p.item.type === 'imageGeneration')
      this.publish(c.id, { type: 'notice', text: 'Bild wird erstellt oder bearbeitet …' });
    if (method === 'item/started' && p.item.type === 'webSearch') {
      this.store.run(
        "INSERT OR REPLACE INTO capabilities VALUES ('webSearch',?)",
        Date.now(),
      );
      const owner = this.store.chat(c.id)?.user_id;
      if (owner)
        this.store.run("INSERT INTO usage_events(user_id,kind,created_at) VALUES (?,'webSearch',?)", owner, Date.now());
      this.publish(c.id, { type: 'notice', text: 'Suche im Internet …' });
    }
    if (method === 'item/completed' && p.item.type === 'webSearch')
      this.publish(c.id, { type: 'notice', text: 'Internetquellen werden ausgewertet …' });
    if (method === 'item/completed' && p.item.type === 'imageGeneration')
      await this.importImage(c.id, t.id, p.threadId, p.item);
    if (method === 'item/started' && p.item.type === 'contextCompaction')
      this.publish(c.id, {
        type: 'notice',
        text: 'Langes Gespräch wird von Codex zusammengefasst …',
      });
    if (method === 'turn/completed') {
      this.clearIdleTimer(t.id);
      const status = ['completed', 'interrupted', 'failed'].includes(p.turn.status)
        ? p.turn.status
        : 'failed';
      this.store.run(
        'UPDATE turns SET status=?,error=COALESCE(?,error) WHERE id=?',
        status,
        p.turn.error ? friendly(p.turn.error) : null,
        t.id,
      );
    }
    if (method === 'error' && !p.willRetry) this.failActive(c.id, friendly(p.error));
    if (
      ['item/agentMessage/delta', 'item/completed', 'turn/completed', 'turn/started'].includes(
        method,
      )
    ) {
      this.store.run('UPDATE chats SET updated_at=? WHERE id=?', Date.now(), c.id);
      this.publish(c.id);
    }
  }
  private message(
    chat: string,
    turn: string,
    item: string,
    text: string,
    replace: boolean,
    attachments: string[] = [],
  ) {
    const id = turn + ':' + item;
    const m = this.store.get<Message>('SELECT * FROM messages WHERE id=?', id);
    if (m)
      this.store.run(
        'UPDATE messages SET text=?,attachments=? WHERE id=?',
        replace ? text : m.text + text,
        attachments.length ? JSON.stringify(attachments) : m.attachments,
        id,
      );
    else {
      const n = this.store.get<{ n: number }>(
        'SELECT COALESCE(MAX(ordinal),0)+1 n FROM messages WHERE chat_id=?',
        chat,
      )!.n;
      this.store.run(
        'INSERT INTO messages VALUES (?,?,?,?,?,?,?)',
        id,
        chat,
        turn,
        'assistant',
        text,
        JSON.stringify(attachments),
        n,
      );
    }
  }
  private recordTokens(chatId: string, payload: any) {
    if (!payload.turnId || !payload.tokenUsage?.last) return;
    const turn = this.store.get<Turn>('SELECT * FROM turns WHERE chat_id=? AND codex_id=?', chatId, payload.turnId);
    const userId = this.store.chat(chatId)?.user_id;
    if (!turn || !userId) return;
    const usage = payload.tokenUsage.last;
    const number = (value: unknown) =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
    const next = {
      input: number(usage.inputTokens), cached: number(usage.cachedInputTokens), cacheWrite: number(usage.cacheWriteInputTokens),
      output: number(usage.outputTokens), reasoning: number(usage.reasoningOutputTokens), total: number(usage.totalTokens),
    };
    const previous = this.store.get<any>('SELECT * FROM turn_token_usage WHERE turn_id=?', turn.id);
    const delta = (field: string, value: number) => Math.max(0, value - Number(previous?.[field] || 0));
    const changed = !previous || [
      ['input_tokens', next.input], ['cached_input_tokens', next.cached], ['cache_write_input_tokens', next.cacheWrite],
      ['output_tokens', next.output], ['reasoning_output_tokens', next.reasoning], ['total_tokens', next.total],
    ].some(([field, value]) => Number(previous[field]) !== value);
    const observedAt = Date.now();
    if (changed) this.store.run(
      `INSERT INTO token_usage_events(
        turn_id,user_id,observed_at,input_tokens,cached_input_tokens,cache_write_input_tokens,
        output_tokens,reasoning_output_tokens,total_tokens,delta_input_tokens,delta_cached_input_tokens,
        delta_cache_write_input_tokens,delta_output_tokens,delta_reasoning_output_tokens,delta_total_tokens
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      turn.id, userId, observedAt, next.input, next.cached, next.cacheWrite, next.output, next.reasoning, next.total,
      delta('input_tokens', next.input), delta('cached_input_tokens', next.cached), delta('cache_write_input_tokens', next.cacheWrite),
      delta('output_tokens', next.output), delta('reasoning_output_tokens', next.reasoning), delta('total_tokens', next.total),
    );
    this.store.run(
      `INSERT INTO turn_token_usage(
        turn_id,user_id,input_tokens,cached_input_tokens,cache_write_input_tokens,
        output_tokens,reasoning_output_tokens,total_tokens,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(turn_id) DO UPDATE SET
        input_tokens=excluded.input_tokens,
        cached_input_tokens=excluded.cached_input_tokens,
        cache_write_input_tokens=excluded.cache_write_input_tokens,
        output_tokens=excluded.output_tokens,
        reasoning_output_tokens=excluded.reasoning_output_tokens,
        total_tokens=excluded.total_tokens,
        updated_at=excluded.updated_at`,
      turn.id,
      userId,
      next.input, next.cached, next.cacheWrite, next.output, next.reasoning, next.total, observedAt,
    );
  }
  private async importImage(chatId: string, turnId: string, threadId: string, item: any) {
    const existing = this.store.get<Message>('SELECT * FROM messages WHERE id=?', turnId + ':' + item.id);
    if (existing && JSON.parse(existing.attachments).length) return;
    const chat = this.store.chat(chatId);
    if (!chat) return;
    try {
      const artifact = await this.artifacts.generated(item, this.work(chatId), threadId, chat.user_id || undefined);
      this.saveImportedImage(chatId, turnId, item.id, artifact, chat.user_id || undefined);
    } catch (initial) {
      // Some App-Server versions announce a completed image before its inline data is
      // hydrated. Read the already completed turn once; this never starts another turn.
      try {
        const history = await this.rpc.request('thread/read', { threadId, includeTurns: true });
        const complete = (history.thread?.turns || [])
          .flatMap((turn: any) => turn.items || [])
          .find((candidate: any) => candidate.type === 'imageGeneration' && candidate.id === item.id);
        if (!complete) throw initial;
        const artifact = await this.artifacts.generated(complete, this.work(chatId), threadId, chat.user_id || undefined);
        this.saveImportedImage(chatId, turnId, item.id, artifact, chat.user_id || undefined);
      } catch (recovery) {
        this.store.run('UPDATE turns SET error=? WHERE id=?', friendlyImage(recovery || initial), turnId);
      }
    }
  }
  private saveImportedImage(chatId: string, turnId: string, itemId: string, artifact: string, userId?: string) {
    this.message(chatId, turnId, itemId, '', true, [artifact]);
    this.store.run("INSERT OR REPLACE INTO capabilities VALUES ('imageGeneration',?)", Date.now());
    if (userId)
      this.store.run("INSERT INTO usage_events(user_id,kind,created_at) VALUES (?,'image',?)", userId, Date.now());
    this.touchIdleTurn(turnId, chatId);
  }
  private watchIdleTurn(turnId: string, chatId: string) {
    this.clearIdleTimer(turnId);
    const timer = setTimeout(() => {
      this.idleTimers.delete(turnId);
      const active = this.store.get<Turn>(
        "SELECT * FROM turns WHERE id=? AND chat_id=? AND status IN ('starting','running')",
        turnId,
        chatId,
      );
      if (!active) return;
      this.store.run(
        "UPDATE turns SET status='interrupted',error=? WHERE id=?",
        'Antwort wegen drei Minuten ohne neuen Text oder Bild gestoppt. Teilantwort bleibt gespeichert.',
        turnId,
      );
      this.publish(chatId);
      if (active.codex_id)
        void this.rpc.request('turn/interrupt', {
          threadId: this.store.chat(chatId)?.thread_id,
          turnId: active.codex_id,
        }).catch(() => {});
    }, this.cfg.turnIdleMs);
    timer.unref();
    this.idleTimers.set(turnId, timer);
  }
  private touchIdleTurn(turnId: string, chatId: string) {
    if (this.idleTimers.has(turnId)) this.watchIdleTurn(turnId, chatId);
  }
  private clearIdleTimer(turnId: string) {
    const timer = this.idleTimers.get(turnId);
    if (timer) clearTimeout(timer);
    this.idleTimers.delete(turnId);
  }
  private clearIdleTimers() {
    for (const id of this.idleTimers.keys()) this.clearIdleTimer(id);
  }
  async branch(chatId: string, messageId: string, text: string, key: string, userId?: string) {
    const signature = createHash('sha256')
      .update(JSON.stringify({ chatId, messageId, text }))
      .digest('hex');
    const op = this.store.get('SELECT * FROM operations WHERE id=?', key);
    if (op) {
      if (op.signature !== signature)
        throw fail('Diese Sende-ID gehört zu einer anderen Änderung.', 409);
      if (op.status !== 'completed')
        throw fail(
          'Dieser Zweig wurde bereits angefordert. Ausgang noch offen oder unterbrochen; keine automatische Wiederholung.',
          409,
        );
      const existing = this.store.chat(op.chat_id, userId);
      if (!existing) throw fail('Der Zweig wurde inzwischen gelöscht.', 410);
      return existing;
    }
    const original = this.store.chat(chatId, userId);
    const m = this.store.get<Message>(
      "SELECT * FROM messages WHERE id=? AND chat_id=? AND role='user'",
      messageId,
      chatId,
    );
    if (!original || !m) throw fail('Nachricht nicht gefunden.', 404);
    if (
      this.store.get(
        "SELECT id FROM turns WHERE chat_id=? AND status IN ('running','starting')",
        chatId,
      )
    )
      throw fail('Bitte erst die laufende Antwort stoppen.', 409);
    const prev = this.store.get<Turn>(
      'SELECT t.* FROM turns t JOIN messages m ON m.turn_id=t.id WHERE m.chat_id=? AND m.ordinal<? AND t.codex_id IS NOT NULL ORDER BY m.ordinal DESC LIMIT 1',
      chatId,
      m.ordinal,
    );
    const chat = this.store.create(original.title + ' · Zweig', null, chatId, userId || original.user_id || undefined);
    this.store.run('INSERT INTO operations VALUES (?,?,?,?)', key, signature, chat.id, 'starting');
    try {
      if (prev) {
        const opts = await this.options(chat.id);
        const r = await this.rpc.request('thread/fork', {
          threadId: original.thread_id,
          lastTurnId: prev.codex_id,
          ...opts,
        });
        this.store.run('UPDATE chats SET thread_id=? WHERE id=?', r.thread.id, chat.id);
        this.loaded.add(r.thread.id);
        // Preserve source IDs via a mapping: copied context and visible prefix stay identical.
        const mapping = new Map<string, string>();
        for (const old of this.store.all<Message>(
          'SELECT * FROM messages WHERE chat_id=? AND ordinal<? ORDER BY ordinal',
          chatId,
          m.ordinal,
        )) {
          let tid = mapping.get(old.turn_id);
          if (!tid) {
            const ot = this.store.get<Turn>('SELECT * FROM turns WHERE id=?', old.turn_id)!;
            tid = randomUUID();
            mapping.set(old.turn_id, tid);
            this.store.run(
              'INSERT INTO turns VALUES (?,?,?,?,?,?,?,?)',
              tid,
              chat.id,
              randomUUID(),
              ot.request_hash,
              ot.codex_id,
              ot.status,
              ot.error,
              ot.created_at,
            );
          }
          this.store.run(
            'INSERT INTO messages VALUES (?,?,?,?,?,?,?)',
            randomUUID(),
            chat.id,
            tid,
            old.role,
            old.text,
            old.attachments,
            old.ordinal,
          );
          for (const f of JSON.parse(old.attachments))
            await this.artifacts.input(f, this.work(chat.id), chat.user_id || undefined);
        }
      }
      await this.send(chat.id, key, text, JSON.parse(m.attachments), userId);
      this.store.run("UPDATE operations SET status='completed' WHERE id=?", key);
      return chat;
    } catch (e) {
      this.store.run("UPDATE operations SET status='failed' WHERE id=?", key);
      this.store.run('DELETE FROM chats WHERE id=?', chat.id);
      throw e;
    }
  }
}
export function friendly(e: any) {
  let s = String(e?.message || 'Unbekannter Codex-Fehler');
  // Show the requester a useful startup diagnosis, but never write it to
  // standard logs and remove credential-shaped fragments before persistence.
  s =
    'Codex-Diagnose: ' +
    s
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [entfernt]')
      .replace(/(access[_-]?token|refresh[_-]?token|password)\s*[=:]\s*[^\s,;]+/gi, '$1=[entfernt]')
      .replace(/[\r\n]+/g, ' ')
      .slice(0, 280);
  if (
    /429|quota|usage.?limit|rate.?limit|limit (?:reached|exceeded)|Kontingent.*ausgeschöpft/i.test(
      s,
    )
  )
    return 'Nutzungslimit erreicht. Bitte die Limits in den Einstellungen prüfen und später erneut versuchen.';
  if (/401|auth|token|sign.?in/i.test(s))
    return 'ChatGPT-Anmeldung erforderlich oder abgelaufen. Bitte in den Einstellungen erneut anmelden.';
  if (/Codex|Bild|Backend|Gespräch|verbunden|anmelden/.test(s)) return s.slice(0, 350);
  return 'Die Anfrage ist fehlgeschlagen. Bitte Verbindung und Anmeldung prüfen.';
}
function friendlyImage(e: any) {
  const message = String(e?.message || '');
  if (/quota|usage.?limit|rate.?limit|Kontingent/i.test(message))
    return 'Das Bildkontingent ist derzeit ausgeschöpft. Bitte die Codex-Limits in den Einstellungen prüfen und später erneut versuchen.';
  if (/auth|token|sign.?in|anmeldung/i.test(message))
    return 'Die ChatGPT-Anmeldung für die Bilderstellung ist abgelaufen. Bitte in den Einstellungen erneut anmelden.';
  if (/kein.*Bild|Bild.*fehl|ungültig|zu groß|unsupported|input buffer|außerhalb/i.test(message))
    return 'Codex hat ein Bild erzeugt, aber die App konnte es nicht sicher importieren: ' + message.slice(0, 220);
  return 'Codex hat die Bilderstellung abgeschlossen, aber das Bild konnte nicht importiert werden. Bitte erneut versuchen.';
}
