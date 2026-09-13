import { spawn } from 'node:child_process';
const args = process.platform === 'win32' ? ['scripts/wsl.mjs', 'start'] : ['dist/server/index.js'];
const child = spawn(process.execPath, args, { stdio: 'inherit', windowsHide: true });
process.on('SIGINT', () => child.kill());
process.on('SIGTERM', () => child.kill());
child.on('exit', (code) => {
  process.exitCode = code || 0;
});
