// Isolated browser-test harness with explicit protocol fixtures; never run by npm dev/start.
import { configuration } from '../server/config.js';
import { createApp } from '../server/app.js';
import { Fixture } from './fixture.js';
const cfg = configuration({
    DATA_DIR: '.test-data/browser',
    BASE_URL: 'http://localhost:4173',
    PORT: '4173',
  }),
  rpc = new Fixture(),
  s = createApp(cfg, rpc);
const request = rpc.request.bind(rpc);
rpc.request = async (method, params) => {
  const result = await request(method, params);
  if (method === 'turn/start') {
    setTimeout(() => rpc.delta(params.threadId, 'Fixture: '), 200);
    setTimeout(() => rpc.delta(params.threadId, 'Live-Text'), 500);
    setTimeout(
      () =>
        rpc.complete(
          params.threadId,
          'Fixture: Live-Text\n\n```js\nconst answer = 42;\n```\n\nFormel: $x^2$',
        ),
      1200,
    );
  }
  return result;
};
s.app.listen(4173, '127.0.0.1', () => console.log('FIXTURE browser server localhost:4173'));
