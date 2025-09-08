export type TaskItem = {
  id: string;
  title?: string;
  payload?: any;
  url?: string;
  fileRef?: string;
  status: 'queued' | 'running' | 'success' | 'failed' | 'canceled';
  progress?: number;
  source?: 'url' | 'file';
  createdAt?: string;
  updatedAt?: string;
  importTimestamp?: string;
  createdBy?: string;
};

export type TaskListResponse = {
  items: TaskItem[];
  total: number;
  limit: number;
  offset: number;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, '') || '/api';

export async function createUrlTasks(urls: string[], meta: { importTimestamp: string; createdBy: string }) {
  const body = {
    urls,
    importTimestamp: meta.importTimestamp,
    source: 'url',
    createdBy: meta.createdBy,
  } as any;
  const r = await fetch(`${API_BASE}/tasks/url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Create URL tasks failed: ${r.status}`);
  return r.json();
}

export async function uploadFiles(files: File[], meta: { importTimestamp: string; createdBy: string; signal?: AbortSignal }) {
  const fd = new FormData();
  files.forEach((f) => fd.append('files', f));
  fd.append('importTimestamp', meta.importTimestamp);
  fd.append('source', 'file');
  fd.append('createdBy', meta.createdBy);
  const r = await fetch(`${API_BASE}/tasks/upload`, { method: 'POST', body: fd, signal: meta.signal });
  if (!r.ok) throw new Error(`Upload files failed: ${r.status}`);
  return r.json();
}

export async function listTasks(params: {
  status?: string;
  from?: string;
  to?: string;
  source?: string;
  createdBy?: string;
  search?: string;
  limit?: number;
  offset?: number;
  sort?: string;
}) {
  const url = new URL(`${API_BASE}/tasks`, location.origin);
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    url.searchParams.set(k, String(v));
  });
  const r = await fetch(url.toString());
  if (!r.ok) throw new Error(`List tasks failed: ${r.status}`);
  const json = await r.json();
  if (Array.isArray(json)) {
    return { items: json, total: json.length, limit: json.length, offset: 0 } as TaskListResponse;
  }
  return json as TaskListResponse;
}

export async function retryTask(id: string) {
  const r = await fetch(`${API_BASE}/tasks/${id}/retry`, { method: 'POST' });
  if (!r.ok) throw new Error(`Retry failed: ${r.status}`);
  return r.json();
}

export async function cancelTask(id: string) {
  const r = await fetch(`${API_BASE}/tasks/${id}/cancel`, { method: 'POST' });
  if (!r.ok) throw new Error(`Cancel failed: ${r.status}`);
  return r.json();
}

export async function deleteTask(id: string) {
  const r = await fetch(`${API_BASE}/tasks/${id}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`Delete failed: ${r.status}`);
  return r.text();
}

export async function postExport(body: {
  scope: { ids?: string[]; filter?: any };
  format: 'zip' | 'json' | 'csv';
  perItem: boolean;
}) {
  const r = await fetch(`${API_BASE}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Export request failed: ${r.status}`);
  return r.json();
}

export async function getExportStatus(id: string) {
  const r = await fetch(`${API_BASE}/export/${id}`);
  if (!r.ok) throw new Error(`Export status failed: ${r.status}`);
  return r.json();
}

