import { configuration } from '../server/config.js';
import { Codex, CODEX_VERSION } from '../server/codex.js';
const rpc = new Codex(configuration());
try {
  await rpc.start();
  const a = await rpc.request('account/read');
  const m = await rpc.request('model/list', {});
  const capabilities = await rpc.request('modelProvider/capabilities/read', {});
  console.log(
    JSON.stringify(
      {
        version: CODEX_VERSION,
        stdio: true,
        accountType: a.account?.type || null,
        capabilities,
        models: m.data.map((x: any) => ({
          model: x.model,
          isDefault: x.isDefault,
          inputModalities: x.inputModalities,
        })),
      },
      null,
      2,
    ),
  );
} finally {
  rpc.close();
}
