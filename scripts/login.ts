import { configuration } from '../server/config.js';
import { Codex } from '../server/codex.js';
const rpc = new Codex(configuration());
await rpc.start();
rpc.on('notification', (method, p) => {
  if (method === 'account/login/completed') {
    console.log(
      p.success
        ? 'ChatGPT-Anmeldung erfolgreich.'
        : 'Anmeldung fehlgeschlagen. Gerätecode-Anmeldung in ChatGPT prüfen.',
    );
    rpc.close();
  }
});
const r = await rpc.request('account/login/start', { type: 'chatgptDeviceCode' });
console.log('Öffne: ' + r.verificationUrl + '\nEinmaliger Gerätecode: ' + r.userCode);
setTimeout(() => rpc.close(), 15 * 60 * 1000).unref();
