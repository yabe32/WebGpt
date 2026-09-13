import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
if (!fs.existsSync('.runtime/wsl.json')) throw Error('Zuerst npm run setup:wsl ausführen.');
const cfg = JSON.parse(fs.readFileSync('.runtime/wsl.json', 'utf8'));
const command = process.argv[2] || 'dev';
if (cfg.user === 'root' || !cfg.home.startsWith('/home/') || cfg.work !== cfg.home + '/privatraum')
  throw Error('Unsicheres WSL-Arbeitsverzeichnis. Setup erneut prüfen.');
function run(args, capture = false) {
  const r = spawnSync('wsl.exe', ['-d', cfg.distro, '-u', cfg.user, '--exec', ...args], {
    encoding: 'utf8',
    windowsHide: true,
    stdio: capture ? 'pipe' : 'inherit',
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw Error(capture ? r.stderr : 'WSL-Aufruf fehlgeschlagen');
  return r.stdout?.trim();
}
if (command === 'setup-key') {
  const key = run(['cat', cfg.work + '/.data/setup-key'], true);
  if (!key) throw Error('Kein Einrichtungsschlüssel vorhanden. Zuerst npm run dev starten.');
  console.log('\nDein Einrichtungsschlüssel (nur lokal verwenden):\n\n' + key + '\n');
  console.log('Öffne http://localhost:5173 und trage den Schlüssel bei der Ersteinrichtung ein.');
  process.exit(0);
}
const source = run(['wslpath', '-a', process.cwd().replaceAll('\\', '/')], true);
function sync() {
  // Only source directories go into the dedicated WSL checkout. No credentials or user data.
  for (const dir of ['src', 'server', 'scripts', 'tests']) {
    run(['mkdir', '-p', cfg.work + '/' + dir]);
    run(['rsync', '-rt', '--delete', source + '/' + dir + '/', cfg.work + '/' + dir + '/']);
  }
  for (const file of [
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'tsconfig.server.json',
    'vite.config.ts',
    'vitest.config.ts',
    'playwright.config.ts',
    'index.html',
    '.env.example',
  ])
    run(['cp', source + '/' + file, cfg.work + '/' + file]);
}
sync();
const node = cfg.runtime + '/bin/node',
  env = ['env', 'PATH=' + cfg.runtime + '/bin:/usr/local/bin:/usr/bin:/bin'];
const args =
  command === 'stop'
    ? ['scripts/dev-stop.mjs']
    : command === 'start'
      ? ['scripts/start.mjs']
      : command === 'dev'
        ? ['scripts/dev.mjs']
        : command === 'install'
          ? [cfg.runtime + '/lib/node_modules/npm/bin/npm-cli.js', 'ci']
          : ['build', 'test', 'typecheck'].includes(command)
            ? [cfg.runtime + '/lib/node_modules/npm/bin/npm-cli.js', 'run', command]
            : [
                'node_modules/tsx/dist/cli.mjs',
                command === 'probe'
                  ? 'scripts/thread-probe.ts'
                  : command === 'login'
                    ? 'scripts/login.ts'
                    : command === 'live'
                      ? 'scripts/live.ts'
                      : command === 'web-search'
                        ? 'scripts/web-search-live.ts'
                      : command === 'setup'
                        ? 'scripts/setup.ts'
                        : command,
              ];
const child = spawn(
  'wsl.exe',
  ['-d', cfg.distro, '-u', cfg.user, '--cd', cfg.work, '--exec', ...env, node, ...args],
  { stdio: 'inherit', windowsHide: true },
);
const watchers = [];
let timer;
if (command === 'dev') {
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        sync();
      } catch (e) {
        console.error(e.message);
      }
    }, 300);
  };
  for (const dir of ['src', 'server', 'scripts'])
    watchers.push(fs.watch(dir, { recursive: true }, schedule));
  watchers.push(
    fs.watch('.', { recursive: false }, (_event, file) => {
      if (
        file &&
        ['package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json'].includes(
          String(file),
        )
      )
        schedule();
    }),
  );
  console.log(
    'Windows-Dateien werden automatisch in die lokale WSL2-Laufzeit übernommen. .env und Daten liegen nur in ' +
      cfg.work +
      '.',
  );
}
function stop() {
  for (const w of watchers) w.close();
  clearTimeout(timer);
  child.kill();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => {
  for (const w of watchers) w.close();
  clearTimeout(timer);
  process.exitCode = code || 0;
});
