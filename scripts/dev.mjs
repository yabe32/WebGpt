import { spawn } from 'node:child_process';
import {
  existsSync,
  copyFileSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
} from 'node:fs';
if (process.platform === 'win32') {
  const c = spawn(process.execPath, ['scripts/wsl.mjs', 'dev'], {
    stdio: 'inherit',
    windowsHide: true,
  });
  process.on('SIGINT', () => c.kill());
  process.on('SIGTERM', () => c.kill());
  c.on('exit', (code) => process.exit(code || 0));
  await new Promise((resolve) => c.on('exit', resolve));
} else {
  mkdirSync('.runtime', { recursive: true });
  const pidFile = '.runtime/dev.pid';
  if (existsSync(pidFile)) {
    const old = Number(readFileSync(pidFile, 'utf8'));
    try {
      process.kill(old, 0);
      throw Error('Eine Entwicklungsinstanz läuft bereits. Zuerst npm run dev:stop ausführen.');
    } catch (e) {
      if (e.code !== 'ESRCH') throw e;
    }
  }
  writeFileSync(pidFile, String(process.pid));
  process.on('exit', () => {
    try {
      if (readFileSync(pidFile, 'utf8') === String(process.pid)) unlinkSync(pidFile);
    } catch {}
  });
  if (!existsSync('.env')) copyFileSync('.env.example', '.env');
  const children = [
    spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'watch', 'server/index.ts'], {
      stdio: 'inherit',
      windowsHide: true,
    }),
    spawn(process.execPath, ['node_modules/vite/bin/vite.js'], {
      stdio: 'inherit',
      windowsHide: true,
    }),
  ];
  let closing = false;
  function close() {
    if (closing) return;
    closing = true;
    for (const c of children) c.kill();
  }
  for (const c of children)
    c.on('exit', () => {
      if (closing) return;
      close();
      process.exitCode = 1;
    });
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}
