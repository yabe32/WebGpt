import Database from 'better-sqlite3';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Config } from './config.js';
export type Chat = {
  id: string;
  title: string;
  thread_id: string | null;
  parent_id: string | null;
  created_at: number;
  updated_at: number;
  user_id?: string | null;
};
export type User = {
  id: string;
  username: string;
  role: 'admin' | 'member';
  access_level: 'superuser' | 'admin' | 'member';
  account_group: string;
  active: number;
  rate_limit_per_hour: number;
  token_limit_five_hours: number;
  token_limit_week: number;
  created_at: number;
  last_login_at: number | null;
};
export type Turn = {
  id: string;
  chat_id: string;
  request_key: string;
  request_hash: string;
  codex_id: string | null;
  status: string;
  error: string | null;
  created_at: number;
};
export type Message = {
  id: string;
  chat_id: string;
  turn_id: string;
  role: string;
  text: string;
  attachments: string;
  ordinal: number;
};
// Append migrations; never change a released migration.
const migrations = [
  `
CREATE TABLE owner(id INTEGER PRIMARY KEY CHECK(id=1),username TEXT NOT NULL,password_hash TEXT NOT NULL);
CREATE TABLE sessions(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,csrf TEXT NOT NULL,label TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE chats(id TEXT PRIMARY KEY,title TEXT NOT NULL,thread_id TEXT,parent_id TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE turns(id TEXT PRIMARY KEY,chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,request_key TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,codex_id TEXT,status TEXT NOT NULL,error TEXT,created_at INTEGER NOT NULL);
CREATE UNIQUE INDEX one_running_turn ON turns(chat_id) WHERE status IN ('starting','running');
CREATE TABLE messages(id TEXT PRIMARY KEY,chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,role TEXT NOT NULL,text TEXT NOT NULL DEFAULT '',attachments TEXT NOT NULL DEFAULT '[]',ordinal INTEGER NOT NULL);
CREATE INDEX messages_chat ON messages(chat_id,ordinal);
CREATE TABLE artifacts(id TEXT PRIMARY KEY,mime TEXT NOT NULL,bytes INTEGER NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE events(id INTEGER PRIMARY KEY AUTOINCREMENT,chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,payload TEXT NOT NULL);
CREATE TABLE capabilities(name TEXT PRIMARY KEY,verified_at INTEGER NOT NULL);
`,
  `CREATE TABLE operations(id TEXT PRIMARY KEY,signature TEXT NOT NULL,chat_id TEXT NOT NULL,status TEXT NOT NULL);`,
  `
CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','member')),active INTEGER NOT NULL DEFAULT 1,rate_limit_per_hour INTEGER NOT NULL DEFAULT 60 CHECK(rate_limit_per_hour BETWEEN 1 AND 10000),created_at INTEGER NOT NULL,last_login_at INTEGER);
ALTER TABLE sessions ADD COLUMN user_id TEXT REFERENCES users(id);
ALTER TABLE chats ADD COLUMN user_id TEXT REFERENCES users(id);
INSERT INTO users(id,username,password_hash,role,created_at)
  SELECT 'legacy-admin',username,password_hash,'admin',strftime('%s','now') * 1000 FROM owner;
UPDATE sessions SET user_id='legacy-admin' WHERE user_id IS NULL;
UPDATE chats SET user_id='legacy-admin' WHERE user_id IS NULL;
CREATE INDEX chats_user ON chats(user_id,updated_at);
CREATE INDEX sessions_user ON sessions(user_id,expires_at);
CREATE TABLE usage_events(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL CHECK(kind IN ('turn','image','webSearch')),created_at INTEGER NOT NULL);
CREATE INDEX usage_user_time ON usage_events(user_id,created_at);
ALTER TABLE artifacts ADD COLUMN user_id TEXT REFERENCES users(id);
UPDATE artifacts SET user_id='legacy-admin' WHERE user_id IS NULL;
CREATE INDEX artifacts_user ON artifacts(user_id);
`,
  `CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);`,
  `
CREATE TABLE turn_token_usage(
  turn_id TEXT PRIMARY KEY REFERENCES turns(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  input_tokens INTEGER NOT NULL,
  cached_input_tokens INTEGER NOT NULL,
  cache_write_input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  reasoning_output_tokens INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX turn_tokens_user_time ON turn_token_usage(user_id,updated_at);
`,
  `
ALTER TABLE users ADD COLUMN token_limit_five_hours INTEGER NOT NULL DEFAULT 0 CHECK(token_limit_five_hours BETWEEN 0 AND 1000000000);
ALTER TABLE users ADD COLUMN token_limit_week INTEGER NOT NULL DEFAULT 0 CHECK(token_limit_week BETWEEN 0 AND 1000000000);
`,
  `
ALTER TABLE users ADD COLUMN access_level TEXT NOT NULL DEFAULT 'member' CHECK(access_level IN ('superuser','admin','member'));
ALTER TABLE users ADD COLUMN account_group TEXT NOT NULL DEFAULT '';
UPDATE users SET access_level=CASE
  WHEN username=(SELECT username FROM owner WHERE id=1) THEN 'superuser'
  WHEN role='admin' THEN 'admin'
  ELSE 'member'
END;
CREATE INDEX users_access_level ON users(access_level);
CREATE INDEX users_account_group ON users(account_group);
CREATE TABLE token_usage_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  observed_at INTEGER NOT NULL,
  input_tokens INTEGER NOT NULL,
  cached_input_tokens INTEGER NOT NULL,
  cache_write_input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  reasoning_output_tokens INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  delta_input_tokens INTEGER NOT NULL,
  delta_cached_input_tokens INTEGER NOT NULL,
  delta_cache_write_input_tokens INTEGER NOT NULL,
  delta_output_tokens INTEGER NOT NULL,
  delta_reasoning_output_tokens INTEGER NOT NULL,
  delta_total_tokens INTEGER NOT NULL
);
CREATE INDEX token_usage_events_user_time ON token_usage_events(user_id,observed_at DESC);
CREATE INDEX token_usage_events_turn_time ON token_usage_events(turn_id,observed_at);
`,
  `
ALTER TABLE users ADD COLUMN image_limit_per_hour INTEGER NOT NULL DEFAULT 0 CHECK(image_limit_per_hour BETWEEN 0 AND 100000);
ALTER TABLE users ADD COLUMN web_search_limit_per_hour INTEGER NOT NULL DEFAULT 0 CHECK(web_search_limit_per_hour BETWEEN 0 AND 100000);
ALTER TABLE users ADD COLUMN upload_limit_mb INTEGER NOT NULL DEFAULT 0 CHECK(upload_limit_mb BETWEEN 0 AND 1024);
ALTER TABLE users ADD COLUMN parallel_turn_limit INTEGER NOT NULL DEFAULT 1 CHECK(parallel_turn_limit BETWEEN 1 AND 100);
CREATE TABLE projects(
  id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, instructions TEXT NOT NULL DEFAULT '', archived_at INTEGER,
  created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL
);
CREATE INDEX projects_user_updated ON projects(user_id,updated_at DESC);
ALTER TABLE chats ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE chats ADD COLUMN archived_at INTEGER;
CREATE INDEX chats_project_updated ON chats(project_id,updated_at DESC);
CREATE TABLE tags(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(user_id,name));
CREATE TABLE chat_tags(chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,PRIMARY KEY(chat_id,tag_id));
CREATE TABLE chat_topics(id TEXT PRIMARY KEY,chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,name TEXT NOT NULL,source TEXT NOT NULL CHECK(source IN ('manual','suggested')),created_at INTEGER NOT NULL,UNIQUE(chat_id,name));
CREATE TABLE audit_events(id INTEGER PRIMARY KEY AUTOINCREMENT,actor_user_id TEXT REFERENCES users(id),target_user_id TEXT REFERENCES users(id),kind TEXT NOT NULL,details TEXT NOT NULL DEFAULT '{}',created_at INTEGER NOT NULL);
CREATE INDEX audit_events_time ON audit_events(created_at DESC);
CREATE INDEX audit_events_actor_time ON audit_events(actor_user_id,created_at DESC);
ALTER TABLE artifacts ADD COLUMN original_name TEXT;
ALTER TABLE artifacts ADD COLUMN parent_artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL;
ALTER TABLE artifacts ADD COLUMN chat_id TEXT REFERENCES chats(id) ON DELETE SET NULL;
`,
  `
ALTER TABLE chats ADD COLUMN favorited_at INTEGER;
ALTER TABLE chats ADD COLUMN deleted_at INTEGER;
ALTER TABLE chats ADD COLUMN delete_after INTEGER;
CREATE INDEX chats_user_deleted ON chats(user_id,deleted_at,updated_at DESC);
CREATE TABLE project_files(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,name TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(project_id,artifact_id));
CREATE TABLE project_tasks(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,title TEXT NOT NULL,completed_at INTEGER,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE INDEX project_tasks_project ON project_tasks(project_id,completed_at,updated_at DESC);
CREATE TABLE backups(id TEXT PRIMARY KEY,path TEXT NOT NULL,created_at INTEGER NOT NULL,status TEXT NOT NULL,error TEXT);
INSERT OR IGNORE INTO settings(key,value) VALUES ('retention_days','30');
`,
];
export class Store {
  db: Database.Database;
  open = true;
  constructor(cfg: Config) {
    this.db = new Database(path.join(cfg.data, 'app.sqlite'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec('CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY)');
    const v = (this.db.prepare('SELECT MAX(version) v FROM migrations').get() as any).v || 0;
    for (let i = v; i < migrations.length; i++)
      this.db.transaction(() => {
        this.db.exec(migrations[i]);
        this.db.prepare('INSERT INTO migrations VALUES (?)').run(i + 1);
      })();
  }
  get<T = any>(sql: string, ...p: any[]): T | undefined {
    return this.db.prepare(sql).get(...p) as T | undefined;
  }
  all<T = any>(sql: string, ...p: any[]): T[] {
    return this.db.prepare(sql).all(...p) as T[];
  }
  run(sql: string, ...p: any[]) {
    return this.db.prepare(sql).run(...p);
  }
  setting(key: string) {
    return this.get<{ value: string }>('SELECT value FROM settings WHERE key=?', key)?.value;
  }
  setSetting(key: string, value: string | null) {
    if (value === null) this.run('DELETE FROM settings WHERE key=?', key);
    else this.run('INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)', key, value);
  }
  audit(actorUserId: string | null, kind: string, targetUserId: string | null = null, details: Record<string, unknown> = {}) {
    this.run('INSERT INTO audit_events(actor_user_id,target_user_id,kind,details,created_at) VALUES (?,?,?,?,?)', actorUserId, targetUserId, kind, JSON.stringify(details), Date.now());
  }
  chat(id: string, userId?: string) {
    return userId
      ? this.get<Chat>('SELECT * FROM chats WHERE id=? AND user_id=?', id, userId)
      : this.get<Chat>('SELECT * FROM chats WHERE id=?', id);
  }
  create(
    title = 'Neue Unterhaltung',
    thread: string | null = null,
    parent: string | null = null,
    userId?: string,
  ) {
    const id = randomUUID(),
      now = Date.now();
    this.run(
      'INSERT INTO chats(id,title,thread_id,parent_id,created_at,updated_at,user_id) VALUES (?,?,?,?,?,?,?)',
      id,
      title,
      thread,
      parent,
      now,
      now,
      userId || null,
    );
    return this.chat(id)!;
  }
  snapshot(id: string, userId?: string) {
    const chat = this.chat(id, userId);
    if (!chat) throw Object.assign(Error('Gespräch nicht gefunden.'), { status: 404 });
    return {
      chat,
      messages: this.all<Message>(
        'SELECT * FROM messages WHERE chat_id=? ORDER BY ordinal',
        id,
      ).map((m) => ({ ...m, attachments: JSON.parse(m.attachments) })),
      turns: this.all<Turn>('SELECT * FROM turns WHERE chat_id=? ORDER BY created_at', id),
      eventId: this.get<{ id: number }>(
        'SELECT COALESCE(MAX(id),0) id FROM events WHERE chat_id=?',
        id,
      )!.id,
    };
  }
  event(id: string, payload: any) {
    return Number(
      this.run('INSERT INTO events(chat_id,payload) VALUES (?,?)', id, JSON.stringify(payload))
        .lastInsertRowid,
    );
  }
  interrupt() {
    for (const t of this.all<Turn>("SELECT * FROM turns WHERE status IN ('starting','running')")) {
      this.run(
        "UPDATE turns SET status='interrupted',error=? WHERE id=?",
        'Backend oder Codex wurde beendet. Die Teilantwort bleibt erhalten; Fortsetzung nicht automatisch gestartet.',
        t.id,
      );
      this.event(t.chat_id, { type: 'changed' });
    }
  }
  close() {
    this.open = false;
    this.db.close();
  }
}
