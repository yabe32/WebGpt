import { configuration } from '../server/config.js';
import { Store } from '../server/db.js';
import { Auth } from '../server/auth.js';
const cfg = configuration(),
  store = new Store(cfg),
  auth = new Auth(store, cfg);
console.log(
  auth.configured()
    ? 'Website ist eingerichtet.'
    : `Einrichtungsschlüssel lokal aus ${auth.setupPath} ablesen. Danach Website öffnen.`,
);
store.close();
