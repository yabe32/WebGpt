import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
if (process.platform === 'win32') {
  const r = spawnSync(process.execPath, ['scripts/wsl.mjs', 'stop'], {
    stdio: 'inherit',
    windowsHide: true,
  });
  process.exitCode = r.status || 0;
} else {
  const file = '.runtime/dev.pid';
  if (!fs.existsSync(file)) {
    console.log('Keine verwaltete Entwicklungsinstanz gefunden.');
    process.exit(0);
  }
  const pid = Number(fs.readFileSync(file, 'utf8'));
  if (!Number.isSafeInteger(pid) || pid < 2) throw Error('Ungültige PID');
  try {
    const cwd = fs.realpathSync('/proc/' + pid + '/cwd'),
      cmd = fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8');
    if (cwd !== process.cwd() || !cmd.includes('scripts/dev.mjs'))
      throw Error('PID gehört nicht zum Entwicklungsserver dieses Projekts.');
    process.kill(pid, 'SIGTERM');
    console.log('Entwicklungsserver wird beendet.');
  } catch (e) {
    if (e.code === 'ENOENT') {
      fs.unlinkSync(file);
      console.log('Bereits beendet.');
    } else throw e;
  }
}
