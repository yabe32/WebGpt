let csrf = '';
export function setCsrf(v: string) {
  csrf = v;
}
export async function api<T = any>(url: string, method = 'GET', body?: any): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch('/api' + url, {
    method,
    credentials: 'same-origin',
    headers: {
      'X-Requested-With': 'PrivateChat',
      'X-CSRF-Token': csrf,
      ...(!isForm && body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  let data: any;
  try {
    data = await res.json();
  } catch {
    throw Error('Server nicht erreichbar. Bitte erneut verbinden.');
  }
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event('signed-out'));
    throw Error(data.error || 'Anfrage fehlgeschlagen.');
  }
  return data;
}
export type Chat = { id: string; title: string; parent_id: string | null; updated_at: number };
export type Message = {
  id: string;
  turn_id: string;
  role: string;
  text: string;
  attachments: string[];
};
export type Turn = { id: string; status: string; error: string | null };
export type Snapshot = { chat: Chat; messages: Message[]; turns: Turn[]; eventId: number };
