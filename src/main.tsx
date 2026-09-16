import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import {
  Plus,
  Search,
  MessageSquare,
  Settings,
  PanelLeftClose,
  Menu,
  ArrowUp,
  Square,
  Paperclip,
  Camera,
  X,
  Copy,
  Check,
  Sun,
  Moon,
  LogOut,
  ShieldCheck,
  ArrowDown,
  RotateCcw,
  Pencil,
  Trash2,
  Download,
  GitBranch,
  Image as ImageIcon,
  Users,
} from 'lucide-react';
import { api, setCsrf, type Chat, type Snapshot, type Message } from './api';
import 'katex/dist/katex.min.css';
import './style.css';
function CopyButton({ text, label = 'Kopieren' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="quiet"
      title={label}
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          alert('Kopieren nicht möglich. Bitte Text markieren.');
        }
      }}
    >
      {copied ? <Check size={15} /> : <Copy size={15} />}
      <span>{copied ? 'Kopiert' : label}</span>
    </button>
  );
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={close}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon" aria-label="Schließen" onClick={close}>
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Login({ configured, done }: { configured: boolean; done: () => void }) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [register, setRegister] = useState(false),
    [notice, setNotice] = useState('');
  return (
    <main className="login">
      <div className="login-card">
        <div className="brand-mark">
          <MessageSquare />
        </div>
        <span className="eyebrow">PRIVATER CHAT</span>
        <h1>Willkommen</h1>
        <p>
          {configured
            ? register
              ? 'Beantrage einen Zugang. Ein Admin muss das Konto anschließend freischalten.'
              : 'Melde dich an, um deine Gespräche fortzusetzen.'
            : 'Richte deinen persönlichen Zugang ein. Nur du kannst dich hier anmelden.'}
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            setNotice('');
            const d = Object.fromEntries(new FormData(e.currentTarget));
            try {
              const action = configured ? (register ? 'register' : 'login') : 'setup';
              const result = await api<any>('/auth/' + action, 'POST', d);
              if (register) {
                setNotice(result.message || 'Antrag gespeichert.');
                setRegister(false);
              } else done();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {!configured && (
            <label>
              Einrichtungsschlüssel
              <input aria-label="Einrichtungsschlüssel" name="key" required autoComplete="off" />
              <small>
                Auf diesem PC: <code>Get-Content .data/setup-key</code>
              </small>
            </label>
          )}
          <label>
            Benutzername
            <input name="username" autoComplete="username" required maxLength={80} />
          </label>
          <label>
            Passwort
            <input
              aria-label="Passwort"
              type="password"
              name="password"
              minLength={12}
              maxLength={128}
              autoComplete={configured && !register ? 'current-password' : 'new-password'}
              required
            />
            <small>Mindestens 12 Zeichen.</small>
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? 'Einen Moment …' : configured ? register ? 'Zugang beantragen' : 'Anmelden' : 'Admin-Konto einrichten'}
            <ArrowUp size={18} />
          </button>
        </form>
        {notice && <p className="success" role="status">{notice}</p>}
        {configured && (
          <button className="quiet login-switch" onClick={() => { setRegister((v) => !v); setError(''); setNotice(''); }}>
            {register ? 'Zur Anmeldung' : 'Neuen Zugang beantragen'}
          </button>
        )}
        <div className="login-note">
          <ShieldCheck size={16} /> Ein eigener Zugang. Ein eigener Gesprächsverlauf.
        </div>
      </div>
    </main>
  );
}
function Preferences({ close, onLogout, isAdmin, isSuperuser, openAdmin, openSuperuser }: { close: () => void; onLogout: () => void; isAdmin: boolean; isSuperuser: boolean; openAdmin: () => void; openSuperuser: () => void }) {
  const [status, setStatus] = useState<any>(null),
    [sessions, setSessions] = useState<any[]>([]),
    [login, setLogin] = useState<any>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try {
      setStatus(await api('/status'));
      setSessions(await api('/sessions'));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const limits = status?.limits?.rateLimitsByLimitId
    ? Object.values(status.limits.rateLimitsByLimitId)
    : status?.limits?.rateLimits
      ? [status.limits.rateLimits]
      : [];
  return (
    <Modal title="Einstellungen" close={close}>
      {isAdmin && <section className="settings-section">
        <h3>ChatGPT-Verbindung</h3>
        <p className="status-line">
          <i className={status?.account ? 'dot good' : 'dot'} />
          {status === null ? 'Verbindungsstatus wird geprüft' : status?.account
            ? `Mit ChatGPT verbunden · ${status.account.planType || 'Konto'}`
            : status?.connected
              ? 'Anmeldung erforderlich'
              : 'Codex nicht verbunden'}
        </p>
        <p className="muted">
          Dein Plus-Konto wird ausschließlich durch Codex genutzt. Keine kostenpflichtige
          API-Alternative.
        </p>
        {status === null ? null : !status.connected ? (
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              action(async () => {
                await api('/codex/connect', 'POST');
              })
            }
          >
            Codex verbinden
          </button>
        ) : !status?.account ? (
          <button
            className="primary"
            disabled={busy}
            onClick={() => action(async () => setLogin(await api('/codex/login', 'POST')))}
          >
            Mit ChatGPT anmelden
          </button>
        ) : (
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              action(async () => {
                await api('/codex/logout', 'POST');
                setLogin(null);
              })
            }
          >
            ChatGPT abmelden
          </button>
        )}
        {login && !status?.account && (
          <div className="device-code">
            <p>Öffne die offizielle Anmeldeseite und gib diesen Code ein:</p>
            <strong>{login.userCode}</strong>
            <a href={login.verificationUrl} target="_blank" rel="noreferrer">
              ChatGPT-Anmeldeseite öffnen ↗
            </a>
          </div>
        )}
        {isAdmin && <>
        <h3>Nutzungslimits</h3>
        {limits.length ? (
          limits.map((l: any, i) => (
            <div key={i} className="limits">
              <b>{l.limitName || l.limitId || 'Codex'}</b>
              {['primary', 'secondary'].map(
                (k) =>
                  l[k] && (
                    <div key={k}>
                      <label>
                        {l[k].windowDurationMins
                          ? `${Math.round(l[k].windowDurationMins / 60)}-Stunden-Fenster`
                          : k === 'primary'
                            ? 'Aktuelles Fenster'
                            : 'Weiteres Fenster'}
                        <span>{l[k].usedPercent}% verbraucht</span>
                      </label>
                      <progress max={100} value={l[k].usedPercent} />
                      {l[k].resetsAt && (
                        <small>
                          Zurücksetzung: {new Date(l[k].resetsAt * 1000).toLocaleString('de-DE')}
                        </small>
                      )}
                    </div>
                  ),
              )}
            </div>
          ))
        ) : (
          <p className="muted">Momentan keine Limitdaten verfügbar.</p>
        )}
        </>}
        <h3>Bildfunktionen</h3>
        <p className="muted">
          {status?.imagesVerified
            ? 'Ein echtes Bild wurde in dieser Installation erfolgreich empfangen. Weitere Bilder unterliegen deinen Kontolimits.'
            : 'Bildeingabe und natives Bildwerkzeug sind angebunden. Erstellung und Bearbeitung sind für dieses Konto noch nicht durch einen erfolgreichen Bildtest bestätigt.'}
        </p>
      </section>}
      {isAdmin && (
        <section className="settings-section">
          <h3>Verwaltung</h3>
          <p className="muted">Konten, App-Nutzung und individuelle Stundenlimits verwalten.</p>
          <button className="secondary" onClick={openAdmin}><Users size={16} /> Admin-Panel</button>
          {isSuperuser && <button className="secondary" onClick={openSuperuser}><ShieldCheck size={16} /> Superuser-Bereich</button>}
        </section>
      )}
      <section className="settings-section">
        <h3>Internetrecherche</h3>
        <p className="muted">
          {status?.webSearchEnabled
            ? status?.webSearchVerified
              ? 'Die integrierte Websuche wurde in dieser Installation erfolgreich verwendet. Quellen erscheinen bei recherchierten Antworten als Links.'
              : 'Die integrierte Websuche ist aktiviert. Sie wird erst nach der ersten erfolgreichen Recherche als bestätigt angezeigt.'
            : 'Die Websuche ist in dieser Installation deaktiviert.'}
        </p>
        <h3>Angemeldete Geräte</h3>
        {sessions.map((s) => (
          <div className="session" key={s.id}>
            <div>
              <strong>{s.current ? 'Dieses Gerät' : 'Weitere Sitzung'}</strong>
              <small>{s.label}</small>
              <small>Seit {new Date(s.created_at).toLocaleDateString('de-DE')}</small>
            </div>
            <button
              className="quiet"
              onClick={() =>
                action(async () => {
                  await api('/sessions/' + s.id, 'DELETE');
                  if (s.current) onLogout();
                })
              }
            >
              Widerrufen
            </button>
          </div>
        ))}
        <button
          className="secondary"
          onClick={() =>
            action(async () => {
              await api('/auth/logout', 'POST');
              onLogout();
            })
          }
        >
          <LogOut size={16} /> Abmelden
        </button>
      </section>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </Modal>
  );
}
function AdminPanel({ close, isSuperuser }: { close: () => void; isSuperuser: boolean }) {
  const [data, setData] = useState<any>(),
    [models, setModels] = useState<any>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const [users, catalog] = await Promise.all([api('/admin/users'), api('/admin/models')]);
      setData(users); setModels(catalog);
    } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  async function change(id: string, body: any) {
    setBusy(true); setError('');
    try { await api('/admin/users/' + id, 'PATCH', body); await refresh(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <Modal title="Admin-Panel" close={close}>
    <section className="admin-summary">
      <span>{data?.users?.length || 0}<small>Konten</small></span>
      <span>{data?.users?.reduce((n: number, u: any) => n + u.turns, 0) || 0}<small>Anfragen</small></span>
      <span>{data?.users?.reduce((n: number, u: any) => n + u.images, 0) || 0}<small>Bilder</small></span>
      <span>{Number(data?.users?.reduce((n: number, u: any) => n + u.tokens, 0) || 0).toLocaleString('de-DE')}<small>Tokens</small></span>
    </section>
    {error && <p className="error" role="alert">{error}</p>}
    <section className="admin-model">
      <h3>Globales Modell</h3>
      <p className="muted">Gilt für alle neuen und fortgesetzten Antworten. Es werden nur Modelle aus deinem aktuellen Codex-Katalog mit Bildeingabe angezeigt.</p>
      <select aria-label="Globales Modell" value={models?.selected || ''} disabled={busy || !models} onChange={(e) => {
        setBusy(true); setError('');
        api('/admin/models', 'PUT', { model: e.target.value || null }).then(refresh).catch((x) => setError(x.message)).finally(() => setBusy(false));
      }}>
        <option value="">Codex-Standard {models?.configured ? '(' + models.configured + ')' : ''}</option>
        {(models?.models || []).map((m: any) => <option key={m.id} value={m.id}>{m.name}{m.isDefault ? ' · empfohlen' : ''}</option>)}
      </select>
    </section>
    <form onSubmit={(e) => {
      e.preventDefault(); const form = new FormData(e.currentTarget); setBusy(true); setError('');
      api('/admin/users', 'POST', { username: form.get('username'), password: form.get('password'), role: form.get('role'), accountGroup: form.get('account-group'), rateLimitPerHour: Number(form.get('limit')), tokenLimitFiveHours: Number(form.get('token-five')), tokenLimitWeek: Number(form.get('token-week')) })
        .then(() => { (e.currentTarget as HTMLFormElement).reset(); return refresh(); })
        .catch((x) => setError(x.message)).finally(() => setBusy(false));
    }} className="admin-create">
      <h3>Konto anlegen</h3>
      <input name="username" aria-label="Neuer Benutzername" placeholder="Benutzername" required maxLength={80} />
      <input name="password" aria-label="Neues Passwort" placeholder="Passwort (mindestens 12 Zeichen)" type="password" required minLength={12} maxLength={128} />
      <select name="role" aria-label="Rolle"><option value="member">Mitglied</option><option value="admin">Admin</option>{isSuperuser && <option value="superuser">Superuser</option>}</select>
      <input name="account-group" aria-label="Kontogruppe" placeholder="Gruppe, z. B. Schule" maxLength={80} />
      <input name="limit" aria-label="Stundenlimit" type="number" min={1} max={10000} defaultValue={60} />
      <label>Tokenlimit 5 Std. <input name="token-five" aria-label="Tokenlimit für fünf Stunden" type="number" min={0} max={1000000000} defaultValue={0} /></label>
      <label>Tokenlimit Woche <input name="token-week" aria-label="Wöchentliches Tokenlimit" type="number" min={0} max={1000000000} defaultValue={0} /></label>
      <button className="primary" disabled={busy}>Konto erstellen</button>
    </form>
    <div className="admin-users">
      {(data?.users || []).map((u: any) => <article key={u.id} className="admin-user">
        <div><strong>{u.username}</strong><small>{u.role === 'superuser' ? 'Superuser' : u.role === 'admin' ? 'Admin' : 'Mitglied'} · {u.account_group || 'ohne Gruppe'} · {u.active ? 'aktiv' : 'deaktiviert'} · {u.sessions} Sitzungen</small></div>
        <p>
          {u.turns} Anfragen · {u.images} Bilder · {u.web_searches} Suchen<br />
          {u.turns_last_hour}/{u.rate_limit_per_hour} Anfragen in der letzten Stunde<br />
          <strong>{Number(u.tokens || 0).toLocaleString('de-DE')} Tokens</strong> gesamt · {Number(u.tokens_five_hours || 0).toLocaleString('de-DE')} in 5 Std. · {Number(u.tokens_week || 0).toLocaleString('de-DE')} diese Woche<br />
          Eingabe: {Number(u.input_tokens || 0).toLocaleString('de-DE')} · Ausgabe inkl. Reasoning: {Number(u.output_tokens || 0).toLocaleString('de-DE')}
        </p>
        <small>Tokenlimit: 5 Std. {u.token_limit_five_hours ? Number(u.token_limit_five_hours).toLocaleString('de-DE') : 'unbegrenzt'} · Woche {u.token_limit_week ? Number(u.token_limit_week).toLocaleString('de-DE') : 'unbegrenzt'} (0 = unbegrenzt)</small>
        <form className="admin-edit" onSubmit={(e) => { e.preventDefault(); const form = new FormData(e.currentTarget); const password = String(form.get('password') || ''); void change(u.id, { username: form.get('username'), accountGroup: form.get('account-group'), rateLimitPerHour: Number(form.get('limit')), tokenLimitFiveHours: Number(form.get('token-five')), tokenLimitWeek: Number(form.get('token-week')), ...(password ? { password } : {}) }); }}>
          <label>Tokenlimit 5 Std. <input name="token-five" aria-label={'Tokenlimit für fünf Stunden für ' + u.username} type="number" min={0} max={1000000000} defaultValue={u.token_limit_five_hours} /></label>
          <label>Tokenlimit Woche <input name="token-week" aria-label={'Wöchentliches Tokenlimit für ' + u.username} type="number" min={0} max={1000000000} defaultValue={u.token_limit_week} /></label>
          <input name="username" aria-label={'Benutzername für ' + u.username} defaultValue={u.username} required maxLength={80} />
          <input name="account-group" aria-label={'Kontogruppe für ' + u.username} defaultValue={u.account_group || ''} placeholder="Gruppe, z. B. Arbeit" maxLength={80} />
          <input name="password" aria-label={'Neues Passwort für ' + u.username} placeholder="Neues Passwort (optional)" type="password" minLength={12} maxLength={128} />
          <label>Stundenlimit <input name="limit" aria-label={'Stundenlimit für ' + u.username} type="number" min={1} max={10000} defaultValue={u.rate_limit_per_hour} /></label>
          <button className="secondary" disabled={busy}>Änderungen speichern</button>
        </form>
        <div className="admin-actions"><button className="quiet" disabled={busy} onClick={() => void change(u.id, { active: !u.active })}>{u.active ? 'Deaktivieren' : 'Freischalten'}</button>{(isSuperuser || u.role !== 'superuser') && <button className="quiet" disabled={busy} onClick={() => void change(u.id, { role: u.role === 'admin' ? 'member' : 'admin' })}>{u.role === 'admin' ? 'Zum Mitglied machen' : 'Zum Admin machen'}</button>}</div>
      </article>)}
    </div>
    <p className="muted">Die Zähler zeigen App-Aktionen und Codex-Tokenwerte, keine privaten Nachrichteninhalte. Tokenwerte und globale Codex-Limits sind nur hier im Admin-Panel sichtbar.</p>
  </Modal>;
}
function SuperuserPanel({ close, openChat }: { close: () => void; openChat: (id: string) => void }) {
  const [data, setData] = useState<any>(), [group, setGroup] = useState(''), [account, setAccount] = useState(''),
    [query, setQuery] = useState(''), [chats, setChats] = useState<any[]>([]), [selected, setSelected] = useState<any>(),
    [days, setDays] = useState(30), [instructions, setInstructions] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try { setData(await api('/superuser/overview' + (account ? '?userId=' + account : group ? '?group=' + encodeURIComponent(group) : ''))); }
    catch (e) { setError((e as Error).message); }
  }, [account, group]);
  const findChats = useCallback(async () => {
    try {
      const p = new URLSearchParams(); if (account) p.set('userId', account); if (group) p.set('group', group); if (query) p.set('q', query);
      setChats(await api('/superuser/chats?' + p));
    } catch (e) { setError((e as Error).message); }
  }, [account, group, query]);
  useEffect(() => { void refresh(); void findChats(); }, [refresh, findChats]);
  const groups: string[] = Array.from(new Set<string>((data?.accounts || []).map((a: any) => String(a.account_group || '')).filter(Boolean)));
  return <Modal title="Superuser-Bereich" close={close}>
    <p className="muted">Dieser Bereich enthält private Inhalte aller Konten. Nutze ihn nur für die von dir verwalteten Konten.</p>
    {error && <p className="error" role="alert">{error}</p>}
    <section className="superuser-filters">
      <select aria-label="Kontogruppe filtern" value={group} onChange={(e) => { setGroup(e.target.value); setAccount(''); }}><option value="">Alle Gruppen</option>{groups.map((g: string) => <option key={g}>{g}</option>)}</select>
      <select aria-label="Konto filtern" value={account} onChange={(e) => { setAccount(e.target.value); setGroup(''); }}><option value="">Alle Konten</option>{(data?.accounts || []).map((a: any) => <option key={a.id} value={a.id}>{a.username}{a.account_group ? ' · ' + a.account_group : ''}</option>)}</select>
    </section>
    <section className="admin-summary">
      <span>{data?.accounts?.length || 0}<small>Konten</small></span><span>{chats.length}<small>Chats</small></span>
      <span>{Number((data?.events || []).reduce((n: number, e: any) => n + e.delta_total_tokens, 0)).toLocaleString('de-DE')}<small>Tokens im Protokoll</small></span>
      <span>{data?.events?.length || 0}<small>Token-Ereignisse</small></span>
    </section>
    <section className="superuser-section"><h3>Token-Protokoll</h3><p className="muted">Zeitpunkt = Empfang des Tokenstands vom Codex App Server; Δ = seit dem vorherigen Stand derselben Antwort neu verbrauchte Tokens.</p>
      <div className="usage-log">{(data?.events || []).slice(0, 80).map((e: any) => <div key={e.id}><time>{new Date(e.observed_at).toLocaleString('de-DE')}</time><b>{e.username}</b><span>{e.account_group || 'ohne Gruppe'}</span><strong>+{Number(e.delta_total_tokens).toLocaleString('de-DE')} Tokens</strong><small>Stand {Number(e.total_tokens).toLocaleString('de-DE')} · Ein {e.delta_input_tokens} · Aus {e.delta_output_tokens + e.delta_reasoning_output_tokens}</small></div>)}</div>
    </section>
    <section className="superuser-section"><h3>Chats durchsuchen</h3><input aria-label="Chats durchsuchen" value={query} placeholder="Titel oder Nachrichteninhalt" onChange={(e) => setQuery(e.target.value)} />
      <div className="superuser-chats">{chats.map((c) => <button key={c.id} className="chat-link" onClick={() => api('/superuser/chats/' + c.id).then(setSelected).catch((e) => setError(e.message))}><span><b>{c.title}</b><small>{c.username} · {c.account_group || 'ohne Gruppe'} · {c.message_count} Nachrichten</small></span><time>{new Date(c.updated_at).toLocaleDateString('de-DE')}</time></button>)}</div>
      {selected && <div className="superuser-preview"><h4>{selected.chat.title}</h4><p className="muted">{selected.messages.length} Nachrichten · schreibgeschützte Ansicht</p>{selected.messages.map((m: Message) => <article className={'message ' + m.role} key={m.id}><RenderMessage m={m} chatId={selected.chat.id} zoom={() => {}} /></article>)}</div>}
    </section>
    <section className="superuser-section"><h3>Zusammenfassung erzeugen</h3><p className="muted">Erstellt einen neuen Chat in deinem Superuserkonto. Verwendet werden Textnachrichten der gewählten Konten bzw. Gruppe aus dem Zeitraum; Bildinhalte werden nicht ausgewertet.</p>
      <label>Zeitraum <input aria-label="Zeitraum in Tagen" type="number" min={1} max={3650} value={days} onChange={(e) => setDays(Number(e.target.value))} /> Tage</label>
      <textarea aria-label="Zusatzvorgabe für Zusammenfassung" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Optional: Worauf soll die Auswertung besonders achten?" />
      <button className="primary" disabled={busy} onClick={() => { setBusy(true); setError(''); api<any>('/superuser/summaries', 'POST', { userIds: account ? [account] : [], accountGroup: group, days, instructions }).then((r) => { close(); openChat(r.chat.id); }).catch((e) => setError(e.message)).finally(() => setBusy(false)); }}>Zusammenfassung starten</button>
    </section>
  </Modal>;
}
function normalizeMath(text: string) {
  return text
    .replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (_, formula) => `\n\n$$\n${formula}\n$$\n\n`)
    .replace(/^\s*\[\s*((?=[^\n]*(?:\\|=|\^|_))[^\n]+?)\s*\]\s*$/gm, (_, formula) => `$$\n${formula}\n$$`);
}
function RenderMessage({ m, zoom, chatId }: { m: Message; zoom: (id: string) => void; chatId: string }) {
  const text = normalizeMath(m.text);
  const workDownload = (href?: string) => {
    if (!href) return null;
    try {
      const parsed = new URL(href, window.location.origin);
      const prefix = '/data/work/' + chatId + '/';
      if (parsed.origin !== window.location.origin || !parsed.pathname.startsWith(prefix)) return null;
      const relative = decodeURIComponent(parsed.pathname.slice(prefix.length));
      if (!relative || relative.includes('\0')) return null;
      return '/api/chats/' + chatId + '/files?path=' + encodeURIComponent(relative);
    } catch { return null; }
  };
  return (
    <>
      <div className="markdown">
        {m.role === 'user' ? (
          <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[[rehypeKatex, { strict: 'ignore', trust: false }]]}>{text}</Markdown>
        ) : (
          <Markdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[[rehypeKatex, { strict: 'ignore', trust: false }]]}
            components={{
              pre: ({ children }) => (
                <div className="code-wrap">
                  <CopyButton
                    label="Code kopieren"
                    text={
                      React.isValidElement<{ children: string }>(children)
                        ? String(children.props.children).replace(/\n$/, '')
                        : ''
                    }
                  />
                  <pre>{children}</pre>
                </div>
              ),
              a: ({ href, children }) => {
                const download = workDownload(href);
                return download ? <a href={download} download>{children}</a> : <a href={href} target="_blank" rel="noreferrer">{children}</a>;
              },
              img: ({ alt }) => (
                <span className="muted">
                  {alt ? '[Bild: ' + alt + ']' : '[Bildverweis]'} – verfügbare Bilder erscheinen als
                  Anhang.
                </span>
              ),
            }}
          >
            {text}
          </Markdown>
        )}
      </div>
      {m.attachments.length > 0 && (
        <div className="message-images">
          {m.attachments.map((id) => (
            <div key={id}>
              <button
                className="image-button"
                onClick={() => zoom(id)}
                aria-label="Bild vergrößern"
              >
                <img
                  src={'/api/files/' + id}
                  alt={m.role === 'user' ? 'Hochgeladenes Bild' : 'Erzeugtes Bild'}
                  loading="lazy"
                />
              </button>
              <a className="quiet" href={'/api/files/' + id + '?download=1'} download>
                <Download size={14} /> Herunterladen
              </a>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
function App() {
  const [auth, setAuth] = useState<any>(),
    [error, setError] = useState(''),
    [list, setList] = useState<Chat[]>([]),
    [search, setSearch] = useState(''),
    [selected, setSelected] = useState<string | null>(null),
    [snap, setSnap] = useState<Snapshot | null>(null),
    [draft, setDraft] = useState(''),
    [attachments, setAttachments] = useState<string[]>([]),
    [uploading, setUploading] = useState(false),
    [sending, setSending] = useState(false),
    [settings, setSettings] = useState(false),
    [admin, setAdmin] = useState(false),
    [superuser, setSuperuser] = useState(false),
    [nav, setNav] = useState(false),
    [notice, setNotice] = useState(''),
    [online, setOnline] = useState(true),
    [zoom, setZoom] = useState<string | null>(null),
    [edit, setEdit] = useState<Message | null>(null),
    [editText, setEditText] = useState(''),
    [rename, setRename] = useState(false),
    [title, setTitle] = useState(''),
    [deleting, setDeleting] = useState(false),
    [follow, setFollow] = useState(true),
    [dark, setDark] = useState(() => localStorage.getItem('theme') !== 'light');
  const scroller = useRef<HTMLDivElement>(null),
    fileInput = useRef<HTMLInputElement>(null),
    cameraInput = useRef<HTMLInputElement>(null),
    textarea = useRef<HTMLTextAreaElement>(null),
    active = useRef<string | null>(null),
    pending = useRef<any>(null),
    pendingBranch = useRef<any>(null);
  const refreshAuth = useCallback(async () => {
    try {
      const a = await api('/auth');
      setCsrf(a.csrf || '');
      setAuth(a);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refreshAuth();
    const out = () => {
      setAuth((a: any) => ({ ...a, authenticated: false }));
      setSnap(null);
      setList([]);
      setDraft('');
      setAttachments([]);
      setSettings(false);
    };
    window.addEventListener('signed-out', out);
    return () => window.removeEventListener('signed-out', out);
  }, [refreshAuth]);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);
  const refreshList = useCallback(async () => {
    if (auth?.authenticated)
      try {
        setList(await api('/chats?q=' + encodeURIComponent(search)));
      } catch (e) {
        setError((e as Error).message);
      }
  }, [auth?.authenticated, search]);
  useEffect(() => {
    const t = setTimeout(refreshList, 150);
    return () => clearTimeout(t);
  }, [refreshList]);
  useEffect(() => {
    active.current = selected;
    setSnap(null);
    setNotice('');
    setFollow(true);
    if (!selected || !auth?.authenticated) return;
    let live = true,
      source: EventSource | undefined,
      loading = false,
      again = false;
    const load = async () => {
      if (loading) {
        again = true;
        return;
      }
      loading = true;
      do {
        again = false;
        try {
          const s = await api<Snapshot>('/chats/' + selected);
          if (live) {
            setSnap(s);
            if (!source) {
              source = new EventSource('/api/chats/' + selected + '/events?after=' + s.eventId);
              source.onopen = () => setOnline(true);
              source.onerror = () => setOnline(false);
              source.onmessage = (e) => {
                const event = JSON.parse(e.data);
                if (event.type === 'notice') setNotice(event.text);
                void load();
              };
            }
          }
        } catch (e) {
          if (live) setError((e as Error).message);
        }
      } while (again && live);
      loading = false;
    };
    void load();
    const poll = setInterval(() => {
      void load();
      void refreshList();
    }, 5000);
    return () => {
      live = false;
      source?.close();
      clearInterval(poll);
    };
  }, [selected, auth?.authenticated]);
  useEffect(() => {
    if (follow && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [snap, follow]);
  useEffect(() => {
    const t = textarea.current;
    if (t) {
      t.style.height = 'auto';
      t.style.height = Math.min(t.scrollHeight, 190) + 'px';
    }
  }, [draft]);
  const running = snap?.turns.some((t) => ['starting', 'running'].includes(t.status)) || false;
  async function act(fn: () => Promise<void>) {
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function newChat() {
    await act(async () => {
      const c = await api<Chat>('/chats', 'POST');
      setSelected(c.id);
      setNav(false);
      setDraft('');
      setAttachments([]);
      pending.current = null;
      await refreshList();
    });
  }
  async function upload(files: FileList | File[] | null) {
    if (!files) return;
    setUploading(true);
    await act(async () => {
      const arr = Array.from(files);
      if (attachments.length + arr.length > 6) throw Error('Maximal sechs Bilder pro Nachricht.');
      for (const file of arr) {
        const prepared = await appleImage(file);
        const body = new FormData();
        body.append('image', prepared);
        const r = await api('/uploads', 'POST', body);
        setAttachments((a) => [...a, r.id]);
      }
    });
    setUploading(false);
  }
  async function appleImage(file: File) {
    if (!/(image\/hei[cf]|\.hei[cf]$)/i.test(file.type + file.name)) return file;
    try {
      const { default: heic2any } = await import('heic2any');
      const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
      const jpeg = Array.isArray(converted) ? converted[0] : converted;
      return new File([jpeg], file.name.replace(/\.hei[cf]$/i, '.jpg'), {
        type: 'image/jpeg',
        lastModified: file.lastModified,
      });
    } catch {
      throw Error('Das HEIC/HEIF-Foto konnte auf diesem Gerät nicht lokal in JPEG konvertiert werden. Bitte es als JPEG teilen oder erneut auswählen.');
    }
  }
  async function send() {
    if (sending || running || uploading || (!draft.trim() && !attachments.length)) return;
    setSending(true);
    await act(async () => {
      let cid = selected;
      if (!cid) {
        const c = await api<Chat>('/chats', 'POST');
        cid = c.id;
        setSelected(cid);
      }
      const body = { text: draft, attachments };
      const signature = JSON.stringify({ cid, ...body });
      if (pending.current?.signature !== signature)
        pending.current = { signature, key: crypto.randomUUID() };
      await api('/chats/' + cid + '/send', 'POST', { ...body, key: pending.current.key });
      pending.current = null;
      setDraft('');
      setAttachments([]);
      setFollow(true);
      setSnap(await api('/chats/' + cid));
      await refreshList();
    });
    setSending(false);
  }
  async function branch(m: Message, text: string) {
    setSending(true);
    await act(async () => {
      const signature = JSON.stringify({ chat: selected, message: m.id, text });
      if (pendingBranch.current?.signature !== signature)
        pendingBranch.current = { signature, key: crypto.randomUUID() };
      const c = await api<Chat>('/chats/' + selected + '/branch', 'POST', {
        messageId: m.id,
        text,
        key: pendingBranch.current.key,
      });
      setSelected(c.id);
      pendingBranch.current = null;
      setEdit(null);
      await refreshList();
    });
    setSending(false);
  }
  if (!auth) return <div className="loading">{error || 'Chat wird geöffnet …'}</div>;
  if (!auth.authenticated) return <Login configured={auth.configured} done={refreshAuth} />;
  return (
    <div className="app">
      {nav && (
        <button
          className="nav-backdrop"
          aria-label="Navigation schließen"
          onClick={() => setNav(false)}
        />
      )}
      <aside className={nav ? 'sidebar open' : 'sidebar'}>
        <div className="brand">
          <span className="brand-mark">
            <MessageSquare size={21} />
          </span>
          <strong>
            Chat<span>Unterhaltungen</span>
          </strong>
          <button
            className="icon mobile"
            aria-label="Navigation schließen"
            onClick={() => setNav(false)}
          >
            <PanelLeftClose size={19} />
          </button>
        </div>
        <button className="new-chat" onClick={newChat}>
          <Plus size={19} /> Neues Gespräch
        </button>
        <label className="search">
          <Search size={17} />
          <input
            aria-label="Gespräche durchsuchen"
            placeholder="Gespräche durchsuchen"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="list-label">
          UNTERHALTUNGEN <span>{list.length}</span>
        </div>
        <nav aria-label="Gespräche" className="chat-list">
          {list.map((c) => (
            <button
              key={c.id}
              className={selected === c.id ? 'chat-link selected' : 'chat-link'}
              onClick={() => {
                setSelected(c.id);
                setNav(false);
              }}
            >
              <MessageSquare size={16} />
              <span>{c.title}</span>
              {c.parent_id && <GitBranch size={13} />}
            </button>
          ))}
          {!list.length && (
            <p className="empty-list">
              {search ? 'Keine passenden Gespräche.' : 'Noch keine Unterhaltung.'}
            </p>
          )}
        </nav>
        <div className="sidebar-footer">
          <button onClick={() => setSettings(true)}>
            <Settings size={18} /> Einstellungen
          </button>
          <div className="private-label">
            <ShieldCheck size={15} /> Nur für dich{' '}
            <button
              className="icon"
              aria-label={dark ? 'Helle Ansicht' : 'Dunkle Ansicht'}
              onClick={() => setDark((d) => !d)}
            >
              {dark ? <Sun size={17} /> : <Moon size={17} />}
            </button>
          </div>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <button
            className="icon mobile"
            aria-label="Navigation öffnen"
            onClick={() => setNav(true)}
          >
            <Menu size={21} />
          </button>
          <div className="chat-heading">
            <strong>{snap?.chat.title || 'Ein neuer Gedanke'}</strong>
            <span>
              <i className={online ? 'dot good' : 'dot'} />
              {running
                ? 'Antwort läuft'
                : online
                  ? 'Verbunden'
                  : 'Verbindung wird wiederhergestellt'}
            </span>
          </div>
          {selected && (
            <div className="header-actions">
              <button
                className="icon"
                aria-label="Gespräch umbenennen"
                onClick={() => {
                  setTitle(snap?.chat.title || '');
                  setRename(true);
                }}
              >
                <Pencil size={17} />
              </button>
              <button
                className="icon"
                aria-label="Gespräch löschen"
                onClick={() => setDeleting(true)}
              >
                <Trash2 size={17} />
              </button>
            </div>
          )}
        </header>
        <div
          className="conversation"
          ref={scroller}
          onScroll={() => {
            const e = scroller.current!;
            setFollow(e.scrollHeight - e.scrollTop - e.clientHeight < 100);
          }}
        >
          {!snap?.messages.length ? (
            <div className="welcome">
              <div className="welcome-symbol">
                <MessageSquare size={34} strokeWidth={1.3} />
                <span />
              </div>
              <span className="eyebrow">NEUE UNTERHALTUNG</span>
              <h1>Womit kann ich helfen?</h1>
              <p>
                Schreibe eine Nachricht, lade ein Bild hoch oder starte eine Recherche.
              </p>
              <div className="suggestions">
                <button
                  onClick={() => {
                    setDraft('Hilf mir bei dieser Aufgabe: ');
                    textarea.current?.focus();
                  }}
                >
                  <MessageSquare size={19} />
                  <span>
                    Aufgabe besprechen<small>Frage stellen oder etwas planen</small>
                  </span>
                </button>
                <button onClick={() => fileInput.current?.click()}>
                  <ImageIcon size={19} />
                  <span>
                    Ein Bild besprechen<small>Hochladen und Fragen stellen</small>
                  </span>
                </button>
              </div>
              <p className="welcome-foot">
                Deine App hat einen eigenen Verlauf, unabhängig von ChatGPT.
              </p>
            </div>
          ) : (
            <div className="messages">
              {snap.messages.map((m, i) => (
                <article className={'message ' + m.role} key={m.id}>
                  <div className="message-label">
                    {m.role === 'user' ? (
                      'DU'
                    ) : (
                      <>
                        <span className="mini-mark">A</span> ASSISTENT
                      </>
                    )}
                  </div>
                  <RenderMessage m={m} zoom={setZoom} chatId={snap.chat.id} />
                  <div className="message-actions">
                    <CopyButton text={m.text} />
                    {m.role === 'user' ? (
                      <button
                        className="quiet"
                        disabled={running || sending}
                        onClick={() => {
                          setEdit(m);
                          setEditText(m.text);
                        }}
                      >
                        <Pencil size={14} /> Bearbeiten
                      </button>
                    ) : (
                      i === snap.messages.length - 1 && (
                        <button
                          className="quiet"
                          disabled={running || sending}
                          onClick={() => {
                            const u = [...snap.messages]
                              .reverse()
                              .find((x) => x.role === 'user' && x.turn_id === m.turn_id);
                            if (u) void branch(u, u.text);
                          }}
                        >
                          <RotateCcw size={14} /> Neu generieren
                        </button>
                      )
                    )}
                  </div>
                </article>
              ))}
              {snap.turns
                .filter((t) => t.error || t.status === 'interrupted')
                .map((t) => (
                  <p className="turn-error" key={t.id} role="status">
                    {t.error || 'Antwort gestoppt. Teilantwort gespeichert.'}
                  </p>
                ))}
              {running && (
                <div className="generating" role="status">
                  <span className="pulse" />
                  {notice || 'Antwort wird erstellt …'}
                </div>
              )}
            </div>
          )}
        </div>
        {!follow && (
          <button className="jump" onClick={() => setFollow(true)}>
            <ArrowDown size={16} /> Zur neuesten Nachricht
          </button>
        )}
        <div className="composer-area">
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button className="icon" aria-label="Fehler schließen" onClick={() => setError('')}>
                <X size={16} />
              </button>
            </div>
          )}
          <div
            className="composer"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void upload(e.dataTransfer.files);
            }}
          >
            {attachments.length > 0 && (
              <div className="attachments">
                {attachments.map((id) => (
                  <div key={id}>
                    <img src={'/api/files/' + id} alt="Anhang-Vorschau" />
                    <button
                      aria-label="Anhang entfernen"
                      onClick={() => setAttachments((a) => a.filter((x) => x !== id))}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <textarea
              ref={textarea}
              aria-label="Nachricht"
              placeholder="Nachricht schreiben …"
              value={draft}
              rows={2}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
              onPaste={(e) => {
                if (e.clipboardData.files.length) {
                  e.preventDefault();
                  void upload(e.clipboardData.files);
                }
              }}
            />
            <div className="composer-tools">
              <div>
                <button
                  className="icon"
                  aria-label="Bilder anhängen"
                  disabled={uploading}
                  onClick={() => fileInput.current?.click()}
                >
                  <Paperclip size={20} />
                </button>
                <button
                  className="icon"
                  aria-label="Foto aufnehmen"
                  disabled={uploading}
                  onClick={() => cameraInput.current?.click()}
                >
                  <Camera size={20} />
                </button>
                <span className="upload-note">
                  {uploading ? 'Bild wird geprüft …' : 'Text & Bilder'}
                </span>
              </div>
              {running ? (
                <button
                  className="send"
                  aria-label="Antwort stoppen"
                  onClick={() =>
                    act(async () => {
                      await api('/chats/' + selected + '/stop', 'POST');
                    })
                  }
                >
                  <Square size={17} fill="currentColor" />
                </button>
              ) : (
                <button
                  className="send"
                  aria-label="Nachricht senden"
                  disabled={sending || uploading || (!draft.trim() && !attachments.length)}
                  onClick={send}
                >
                  <ArrowUp size={22} />
                </button>
              )}
            </div>
          </div>
          <p className="composer-foot">
            {sending
              ? 'Wird gesendet …'
              : 'Enter zum Senden · Umschalt + Enter für eine neue Zeile'}
            <span>Wichtige Antworten bitte prüfen.</span>
          </p>
        </div>
        <input
          hidden
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif"
          multiple
          onChange={(e) => {
            void upload(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          hidden
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => {
            void upload(e.target.files);
            e.target.value = '';
          }}
        />
      </main>
      {settings && <Preferences close={() => setSettings(false)} onLogout={refreshAuth} isAdmin={['admin', 'superuser'].includes(auth.user?.role)} isSuperuser={auth.user?.role === 'superuser'} openAdmin={() => { setSettings(false); setAdmin(true); }} openSuperuser={() => { setSettings(false); setSuperuser(true); }} />}{' '}
      {admin && <AdminPanel close={() => setAdmin(false)} isSuperuser={auth.user?.role === 'superuser'} />}
      {superuser && <SuperuserPanel close={() => setSuperuser(false)} openChat={(chatId) => { setSelected(chatId); setSuperuser(false); }} />}
      {zoom && (
        <Modal title="Bildansicht" close={() => setZoom(null)}>
          <img className="zoom-image" src={'/api/files/' + zoom} alt="Vergrößertes Bild" />
          <a className="secondary" href={'/api/files/' + zoom + '?download=1'} download>
            <Download size={16} /> Bild herunterladen
          </a>
        </Modal>
      )}
      {edit && (
        <Modal title="Als neuen Gesprächszweig fortsetzen" close={() => setEdit(null)}>
          <p className="muted">
            Das ursprüngliche Gespräch bleibt erhalten. Der neue Zweig enthält den Verlauf vor
            dieser Nachricht und deine Änderung.
          </p>
          <textarea
            className="edit-input"
            aria-label="Nachricht bearbeiten"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
          />
          <button
            className="primary"
            disabled={sending || !editText.trim()}
            onClick={() => branch(edit, editText)}
          >
            Zweig erstellen und senden
          </button>
        </Modal>
      )}
      {rename && (
        <Modal title="Gespräch umbenennen" close={() => setRename(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                await api('/chats/' + selected, 'PATCH', { title });
                setSnap(await api('/chats/' + selected));
                setRename(false);
                await refreshList();
              });
            }}
          >
            <input
              aria-label="Gesprächstitel"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={120}
            />
            <button className="primary">Speichern</button>
          </form>
        </Modal>
      )}
      {deleting && (
        <Modal title="Gespräch löschen?" close={() => setDeleting(false)}>
          <p>
            Das Gespräch wird aus deinem App-Verlauf entfernt. Vorhandene Gesprächszweige bleiben
            erhalten. Codex-Protokolle und Bilddateien verbleiben bis zur Datenbereinigung im
            privaten Datenverzeichnis.
          </p>
          <button
            className="danger"
            disabled={running}
            onClick={() =>
              act(async () => {
                await api('/chats/' + selected, 'DELETE');
                setSelected(null);
                setDeleting(false);
                await refreshList();
              })
            }
          >
            {running ? 'Zuerst laufende Antwort stoppen' : 'Aus App-Verlauf löschen'}
          </button>
        </Modal>
      )}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
