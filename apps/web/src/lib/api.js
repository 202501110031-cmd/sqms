const API_BASE = import.meta.env.VITE_API_URL || '';

export function getToken() {
  return localStorage.getItem('sqms_token') || '';
}

export function setToken(token) {
  if (token) localStorage.setItem('sqms_token', token);
  else localStorage.removeItem('sqms_token');
}

export async function api(path, options = {}) {
  const { method = 'GET', body, auth = true, headers = {} } = options;
  const requestHeaders = { ...headers };
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
  const token = getToken();
  if (auth && token) requestHeaders.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: requestHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  if (response.status === 401 && auth && token) {
    setToken('');
    window.dispatchEvent(new Event('sqms:unauthorized'));
  }

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => ({}))
    : await response.text();

  if (!response.ok) {
    const error = new Error(payload?.error || 'Request failed. Please try again.');
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export async function downloadExport(period) {
  const token = getToken();
  const response = await fetch(`${API_BASE}/api/admin/export?period=${encodeURIComponent(period)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error('Unable to export report');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `sqms-${period}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
