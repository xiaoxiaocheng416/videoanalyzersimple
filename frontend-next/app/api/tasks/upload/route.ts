import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

function getBackendBase() {
  const base = process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, '');
  if (!base || base.startsWith('/')) return null; // avoid recursion
  return base;
}

export async function POST(req: Request) {
  try {
    const backend = getBackendBase();
    const form = await req.formData();
    const files = form.getAll('files').filter(Boolean) as File[];
    const jar = cookies();
    let batchId = jar.get('taskRunnerBatchId')?.value;

    if (backend && !batchId) {
      const r = await fetch(`${backend}/batches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'task_runner' }),
      });
      if (r.ok) {
        const j = await r.json();
        batchId = j?.id;
        if (batchId) jar.set('taskRunnerBatchId', batchId, { path: '/', maxAge: 7 * 24 * 3600 });
      }
    }

    if (backend && batchId) {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      const r2 = await fetch(`${backend}/batches/${batchId}/tasks/upload`, { method: 'POST', body: fd });
      const j2 = await r2.json().catch(() => ({}));
      return NextResponse.json(j2, { status: r2.status });
    }

    // Fallback shim: return created ids
    return NextResponse.json({ created: files.map((f) => ({ id: `tmp_${Math.random().toString(36).slice(2, 10)}`, file: f.name })) });
  } catch (e) {
    return NextResponse.json({ error: 'shim-error' }, { status: 500 });
  }
}

