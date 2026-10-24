// Server-Zugriff. Schreibende Aufrufe tragen den Kopf X-MLZ (Schutz vor fremden Webseiten).
export class ApiError extends Error {
  constructor(msg, status, data) { super(msg); this.status = status; this.data = data; }
}
export async function api(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  let r;
  try {
    r = await fetch(`/api${path}`, {
      method, credentials: 'same-origin',
      headers: { ...(method !== 'GET' ? { 'X-MLZ': '1' } : {}), ...(body !== undefined && !(body instanceof Blob) ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
    });
  } catch (e) {
    throw new ApiError('Keine Verbindung zum Server', 0);
  }
  if (raw) return r;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && path !== '/session') window.dispatchEvent(new Event('mlz-logout'));
    throw new ApiError(data.error || `Fehler ${r.status}`, r.status, data);
  }
  return data;
}
