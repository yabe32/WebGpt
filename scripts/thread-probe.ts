import { configuration } from '../server/config.js';
import { Codex } from '../server/codex.js';
const cfg = configuration(),
  rpc = new Codex(cfg);
try {
  await rpc.start();
  const r = await rpc.request('thread/start', {
    cwd: cfg.work,
    approvalPolicy: 'on-request',
    developerInstructions: 'Nur Protokollprüfung; keine Modellanfrage.',
  });
  console.log(
    JSON.stringify(
      {
        threadCreated: !!r.thread.id,
        model: r.model,
        approvalPolicy: r.approvalPolicy,
        sandbox: r.sandbox,
      },
      null,
      2,
    ),
  );
} finally {
  rpc.close();
}
