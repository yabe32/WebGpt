import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
export function configuration(env: NodeJS.ProcessEnv = process.env) {
  const data = path.resolve(env.DATA_DIR || '.data');
  const baseUrl = new URL(env.BASE_URL || 'http://localhost:5173');
  const production = env.NODE_ENV === 'production';
  const webSearch = env.WEB_SEARCH || 'live';
  const codexSandboxMode = env.CODEX_SANDBOX_MODE || 'workspace-write';
  const turnIdleSeconds = Number(env.TURN_IDLE_TIMEOUT_SECONDS || 180);
  if (!['disabled', 'cached', 'indexed', 'live'].includes(webSearch))
    throw Error('WEB_SEARCH muss disabled, cached, indexed oder live sein.');
  if (!['workspace-write', 'danger-full-access'].includes(codexSandboxMode))
    throw Error('CODEX_SANDBOX_MODE muss workspace-write oder danger-full-access sein.');
  if (!Number.isFinite(turnIdleSeconds) || turnIdleSeconds < 30 || turnIdleSeconds > 1800)
    throw Error('TURN_IDLE_TIMEOUT_SECONDS muss zwischen 30 und 1800 liegen.');
  if (
    production &&
    baseUrl.protocol !== 'https:' &&
    !['localhost', '127.0.0.1'].includes(baseUrl.hostname)
  )
    throw Error('Produktion benötigt HTTPS.');
  const cfg = {
    data,
    baseUrl: baseUrl.origin,
    secure: baseUrl.protocol === 'https:',
    production,
    host: env.HOST || '127.0.0.1',
    port: Number(env.PORT || 3001),
    trustProxy: env.TRUST_PROXY === 'true',
    maxUpload: Number(env.MAX_UPLOAD_MB || 15) * 1024 * 1024,
    turnIdleMs: turnIdleSeconds * 1000,
    model: env.MODEL || undefined,
    webSearch: webSearch as 'disabled' | 'cached' | 'indexed' | 'live',
    codexSandboxMode: codexSandboxMode as 'workspace-write' | 'danger-full-access',
    codexHome: path.join(data, 'codex'),
    work: path.join(data, 'work'),
    files: path.join(data, 'files'),
  };
  for (const p of [data, cfg.codexHome, cfg.work, cfg.files])
    fs.mkdirSync(p, { recursive: true, mode: 0o700 });
  return cfg;
}
export type Config = ReturnType<typeof configuration>;
