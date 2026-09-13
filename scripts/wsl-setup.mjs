// One-time Windows bootstrap; does not alter the distribution's default user.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
if (process.platform !== 'win32')
  throw Error('Dieses Setup wird einmalig in Windows PowerShell ausgeführt.');
const distro = process.env.WSL_DISTRO || 'Ubuntu',
  user = process.env.WSL_USER || 'privatraum';
if (!/^[a-z_][a-z0-9_-]{0,30}$/.test(user) || user === 'root')
  throw Error('WSL_USER muss ein eigener Benutzer ohne Root-Rechte sein.');
function wsl(args, who = user, allowFail = false) {
  const r = spawnSync('wsl.exe', ['-d', distro, '-u', who, '--exec', ...args], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (r.status && !allowFail) throw Error(r.stderr || r.stdout || 'WSL-Befehl fehlgeschlagen');
  return r;
}
if (wsl(['id', user], 'root', true).status !== 0)
  wsl(['useradd', '--create-home', '--shell', '/bin/bash', user], 'root');
const home = wsl(['getent', 'passwd', user]).stdout.trim().split(':')[5];
if (!home.startsWith('/home/')) throw Error('Eigener Benutzer unter /home erforderlich.');
const runtime = home + '/.local/privatraum-node',
  work = home + '/privatraum';
wsl(['mkdir', '-p', runtime, work]);
fs.mkdirSync('.runtime/downloads', { recursive: true });
const arch = wsl(['uname', '-m']).stdout.trim() === 'aarch64' ? 'arm64' : 'x64';
const hashes = await (await fetch('https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt')).text();
const row = hashes.split('\n').find((l) => l.trim().endsWith('-linux-' + arch + '.tar.xz'));
if (!row) throw Error('Keine passende offizielle Node-Distribution.');
const [hash, name] = row.trim().split(/\s+/);
const target = path.resolve('.runtime/downloads', name);
if (!fs.existsSync(target))
  fs.writeFileSync(
    target,
    Buffer.from(await (await fetch('https://nodejs.org/dist/latest-v22.x/' + name)).arrayBuffer()),
  );
if (createHash('sha256').update(fs.readFileSync(target)).digest('hex') !== hash)
  throw Error('Node-Prüfsumme stimmt nicht.');
const linuxArchive = wsl(['wslpath', '-a', target.replaceAll('\\', '/')]).stdout.trim();
wsl(['tar', '-xJf', linuxArchive, '--strip-components=1', '-C', runtime]);
const info = { distro, user, home, runtime, work, nodeArchive: name };
fs.writeFileSync('.runtime/wsl.json', JSON.stringify(info, null, 2));
console.log('WSL2 vorbereitet: ' + user + ' · ' + name + ' · ' + work);
const r = spawnSync(process.execPath, ['scripts/wsl.mjs', 'install'], {
  stdio: 'inherit',
  windowsHide: true,
});
process.exitCode = r.status || 0;
