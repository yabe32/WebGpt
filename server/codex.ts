import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import type { Config } from './config.js';
export interface Rpc extends EventEmitter {
  request(method: string, params?: any): Promise<any>;
  close(): void;
  ready: boolean;
}
export const CODEX_VERSION = '0.153.4';
export class Codex extends EventEmitter implements Rpc {
  ready = false;
  private child?: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private pending = new Map<
    number,
    { resolve: (r: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  private starting?: Promise<void>;
  constructor(private cfg: Config) {
    super();
  }
  async start() {
    if (this.ready) return;
    if (this.starting) return this.starting;
    this.starting = this.boot();
    try {
      await this.starting;
    } finally {
      this.starting = undefined;
    }
  }
  private async boot() {
    // Dedicated home: never inherit personal MCP servers, plugins, API keys or CLI credentials.
    fs.writeFileSync(
      path.join(this.cfg.codexHome, 'config.toml'),
      `forced_login_method = "chatgpt"\ncli_auth_credentials_store = "file"\nweb_search = "${this.cfg.webSearch}"\napproval_policy = "on-request"\ndefault_permissions = "chat"\n[permissions.chat.filesystem]\n":minimal" = "read"\n":workspace_roots" = "write"\n[permissions.chat.network]\nenabled = false\n[features]\nimage_generation = true\nshell_tool = false\nunified_exec = false\napps = false\nplugins = false\nmulti_agent = false\nbrowser_use = false\ncomputer_use = false\nmemories = false\nhooks = false\nunbounded_connection_retries = false\n`,
      { mode: 0o600 },
    );
    const require = createRequire(import.meta.url);
    const triple =
      process.platform === 'win32'
        ? (process.arch === 'arm64' ? 'aarch64' : 'x86_64') + '-pc-windows-msvc'
        : process.platform === 'linux'
          ? (process.arch === 'arm64' ? 'aarch64' : 'x86_64') + '-unknown-linux-musl'
          : (process.arch === 'arm64' ? 'aarch64' : 'x86_64') + '-apple-darwin';
    const pkg = path.dirname(
      require.resolve(`@openai/codex-${process.platform}-${process.arch}/package.json`),
    );
    const executable = path.join(
      pkg,
      'vendor',
      triple,
      'bin',
      process.platform === 'win32' ? 'codex.exe' : 'codex',
    );
    const env: NodeJS.ProcessEnv = {};
    for (const key of [
      'PATH',
      'Path',
      'SystemRoot',
      'WINDIR',
      'COMSPEC',
      'PATHEXT',
      'TEMP',
      'TMP',
      'HOME',
      'USERPROFILE',
      'LANG',
      'LOCALAPPDATA',
      'APPDATA',
    ])
      if (process.env[key]) env[key] = process.env[key];
    // The production image has a read-only root filesystem. Keep every Codex
    // runtime file below the private persistent data directory instead of
    // inheriting /home/node, which is read-only in that deployment.
    fs.mkdirSync(path.join(this.cfg.codexHome, 'cache'), { recursive: true, mode: 0o700 });
    env.HOME = this.cfg.codexHome;
    env.XDG_CONFIG_HOME = this.cfg.codexHome;
    env.XDG_CACHE_HOME = path.join(this.cfg.codexHome, 'cache');
    env.CODEX_HOME = this.cfg.codexHome;
    this.child = spawn(executable, ['app-server', '--listen', 'stdio://'], {
      cwd: this.cfg.work,
      env,
      windowsHide: true,
      stdio: 'pipe',
    });
    this.child.stderr.on('data', () => {}); // Raw diagnostics can contain private data; never log them.
    const child = this.child;
    this.child.on('error', () => {
      if (this.child === child) this.down();
    });
    this.child.on('exit', () => {
      if (this.child === child) this.down();
    });
    createInterface({ input: this.child.stdout, crlfDelay: Infinity }).on('line', (line) => {
      try {
        if (this.child !== child) return;
        this.receive(JSON.parse(line));
      } catch {
        this.emit('protocolWarning', 'Ungültige Protokollnachricht');
      }
    });
    await this.request('initialize', {
      clientInfo: { name: 'private-chat', title: 'Private Chat', version: '0.1.0' },
      capabilities: { experimentalApi: false },
    });
    this.child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    this.ready = true;
  }
  private receive(m: any) {
    if (m.id !== undefined && m.method) {
      // Never auto-approve model actions. Unknown requests fail closed.
      const result =
        m.method === 'item/commandExecution/requestApproval' ||
        m.method === 'item/fileChange/requestApproval'
          ? { decision: 'decline' }
          : m.method === 'item/permissions/requestApproval'
            ? { permissions: {}, scope: 'turn' }
            : null;
      this.child?.stdin.write(
        JSON.stringify(
          result
            ? { id: m.id, result }
            : {
                id: m.id,
                error: { code: -32601, message: 'Werkzeug in dieser Chat-App nicht freigegeben.' },
              },
        ) + '\n',
      );
      this.emit('blockedAction', m.params?.threadId);
      return;
    }
    if (m.id !== undefined) {
      const p = this.pending.get(m.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(m.id);
      m.error
        ? p.reject(new Error(m.error.message || 'Codex-Protokollfehler'))
        : p.resolve(m.result);
    } else if (m.method) this.emit('notification', m.method, m.params);
  }
  request(method: string, params: any = {}) {
    return new Promise<any>((resolve, reject) => {
      if (!this.child || this.child.killed) {
        reject(Error('Codex ist nicht verbunden.'));
        return;
      }
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          Error(
            'Codex antwortet nicht. Ausgang der Anfrage unbekannt; nicht automatisch erneut senden.',
          ),
        );
        this.close();
      }, 60000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  private down() {
    const was = this.ready;
    this.ready = false;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(Error('Codex-Prozess wurde beendet.'));
    }
    this.pending.clear();
    if (was) this.emit('down');
  }
  close() {
    this.child?.stdin.end();
    this.child?.kill();
    this.down();
  }
}
