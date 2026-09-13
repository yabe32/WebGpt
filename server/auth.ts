import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import argon2 from 'argon2';
import type { Request, Response, NextFunction } from 'express';
import type { Store } from './db.js';
import type { Config } from './config.js';
export const digest = (s: string) => createHash('sha256').update(s).digest('hex');
export const equal = (a: string, b: string) =>
  Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export class Auth {
  setupPath: string;
  constructor(
    private store: Store,
    private cfg: Config,
  ) {
    this.setupPath = path.join(cfg.data, 'setup-key');
    if (!store.get('SELECT id FROM owner') && !fs.existsSync(this.setupPath))
      fs.writeFileSync(this.setupPath, randomBytes(32).toString('hex'), {
        mode: 0o600,
        flag: 'wx',
      });
  }
  configured() {
    return !!this.store.get('SELECT id FROM owner');
  }
  session(req: Request) {
    const token = req.cookies?.session;
    if (typeof token !== 'string') return;
    return this.store.get(
      'SELECT s.*,u.username,u.role,u.active,u.rate_limit_per_hour FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1',
      digest(token),
      Date.now(),
    );
  }
  require = (req: Request, res: Response, next: NextFunction) => {
    const session = this.session(req);
    if (!session) {
      res.status(401).json({ error: 'Bitte anmelden.' });
      return;
    }
    res.locals.session = session;
    next();
  };
  origin = (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (
        req.headers.origin !== this.cfg.baseUrl ||
        req.headers['x-requested-with'] !== 'PrivateChat'
      ) {
        res.status(403).json({ error: 'Ungültiger Ursprung der Anfrage.' });
        return;
      }
      const session = this.session(req);
      if (session && !equal(String(req.headers['x-csrf-token'] || ''), session.csrf)) {
        res.status(403).json({ error: 'Sitzungsschutz ungültig. Bitte Seite neu laden.' });
        return;
      }
    }
    next();
  };
  async setup(username: string, password: string, key: string) {
    if (this.configured()) throw Object.assign(Error('Bereits eingerichtet.'), { status: 409 });
    if (!equal(fs.readFileSync(this.setupPath, 'utf8').trim(), key))
      throw Object.assign(Error('Einrichtungsschlüssel ungültig.'), { status: 403 });
    const hash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
    });
    if (this.configured()) throw Object.assign(Error('Bereits eingerichtet.'), { status: 409 });
    const userId = randomUUID();
    this.store.db.transaction(() => {
      this.store.run('INSERT INTO owner VALUES (1,?,?)', username, hash);
      this.store.run(
        "INSERT INTO users(id,username,password_hash,role,active,rate_limit_per_hour,created_at) VALUES (?,?,?,'admin',1,240,?)",
        userId,
        username,
        hash,
        Date.now(),
      );
    })();
    fs.unlinkSync(this.setupPath);
  }
  async login(req: Request, res: Response, username: string, password: string) {
    const user = this.store.get<any>('SELECT * FROM users WHERE username=?', username);
    const valid = user && (await argon2.verify(user.password_hash, password));
    if (!valid)
      throw Object.assign(Error('Anmeldedaten stimmen nicht.'), { status: 401 });
    if (!user.active)
      throw Object.assign(Error('Dieses Konto wartet noch auf die Freischaltung durch einen Admin.'), { status: 403 });
    const old = this.session(req);
    if (old) this.store.run('DELETE FROM sessions WHERE id=?', old.id);
    const token = randomBytes(32).toString('hex');
    this.store.run(
      'INSERT INTO sessions(id,token_hash,csrf,label,created_at,expires_at,user_id) VALUES (?,?,?,?,?,?,?)',
      randomUUID(),
      digest(token),
      randomBytes(32).toString('hex'),
      String(req.headers['user-agent'] || 'Gerät').slice(0, 160),
      Date.now(),
      Date.now() + 30 * 86400000,
      user.id,
    );
    this.store.run('UPDATE users SET last_login_at=? WHERE id=?', Date.now(), user.id);
    res.cookie('session', token, {
      httpOnly: true,
      secure: this.cfg.secure,
      sameSite: 'strict',
      maxAge: 30 * 86400000,
      path: '/',
    });
  }
  requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    this.require(req, res, () => {
      if (res.locals.session.role !== 'admin') {
        res.status(403).json({ error: 'Adminzugang erforderlich.' });
        return;
      }
      next();
    });
  };
  async createUser(username: string, password: string, role: 'admin' | 'member', limit: number) {
    const existing = this.store.get('SELECT id FROM users WHERE username=?', username);
    if (existing) throw Object.assign(Error('Dieser Benutzername ist bereits vergeben.'), { status: 409 });
    const hash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
    });
    const id = randomUUID();
    this.store.run(
      'INSERT INTO users(id,username,password_hash,role,active,rate_limit_per_hour,created_at) VALUES (?,?,?,?,1,?,?)',
      id,
      username,
      hash,
      role,
      limit,
      Date.now(),
    );
    return id;
  }
  async registerPending(username: string, password: string) {
    if (this.store.get('SELECT id FROM users WHERE username=?', username)) return false;
    const hash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
    });
    this.store.run(
      "INSERT INTO users(id,username,password_hash,role,active,rate_limit_per_hour,created_at) VALUES (?,?,?,'member',0,60,?)",
      randomUUID(),
      username,
      hash,
      Date.now(),
    );
    return true;
  }
  async updateUser(
    id: string,
    values: { username?: string; password?: string },
    keepSessionId?: string,
  ) {
    const user = this.store.get<any>('SELECT * FROM users WHERE id=?', id);
    if (!user) throw Object.assign(Error('Konto nicht gefunden.'), { status: 404 });
    if (values.username && values.username !== user.username) {
      if (this.store.get('SELECT id FROM users WHERE username=? AND id<>?', values.username, id))
        throw Object.assign(Error('Dieser Benutzername ist bereits vergeben.'), { status: 409 });
      this.store.run('UPDATE users SET username=? WHERE id=?', values.username, id);
    }
    if (values.password) {
      const hash = await argon2.hash(values.password, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 1,
      });
      this.store.db.transaction(() => {
        this.store.run('UPDATE users SET password_hash=? WHERE id=?', hash, id);
        if (keepSessionId)
          this.store.run('DELETE FROM sessions WHERE user_id=? AND id<>?', id, keepSessionId);
        else this.store.run('DELETE FROM sessions WHERE user_id=?', id);
      })();
    }
  }
  logout(req: Request, res: Response) {
    const s = this.session(req);
    if (s) this.store.run('DELETE FROM sessions WHERE id=?', s.id);
    res.clearCookie('session', {
      httpOnly: true,
      secure: this.cfg.secure,
      sameSite: 'strict',
      path: '/',
    });
  }
}
