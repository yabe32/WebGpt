import { configuration } from './config.js';
import { Codex } from './codex.js';
import { createApp } from './app.js';
const cfg = configuration(),
  rpc = new Codex(cfg),
  system = createApp(cfg, rpc);
try {
  await rpc.start();
} catch {
  console.warn('Codex nicht erreichbar. Website bleibt verfügbar; in Einstellungen neu verbinden.');
}
const server = system.app.listen(cfg.port, cfg.host, () => {
  console.log(`Chat Backend: http://${cfg.host}:${cfg.port}`);
  if (!system.auth.configured())
    console.log(
      `Ersteinrichtung: Schlüssel lokal aus ${system.auth.setupPath} lesen. Windows/WSL: npm run wsl:key.`,
    );
});
let closing = false;
function close() {
  if (closing) return;
  closing = true;
  rpc.close();
  server.close();
  server.closeAllConnections();
  system.store.close();
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
