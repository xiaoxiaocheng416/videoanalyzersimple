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
    const body = await req.json().catch(() => ({}));
    const urls: string[] = Array.isArray(body?.urls) ? body.urls : [];
    if (urls.length === 0) return NextResponse.json({ created: [], duplicates: [] });

    const jar = cookies();
    let batchId = jar.get('taskRunnerBatchId')?.value;

    if (backend && !batchId) {
      // create hidden/reused batch
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
      const r2 = await fetch(`${backend}/batches/${batchId}/tasks/url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls }),
      });
      const j2 = await r2.json().catch(() => ({}));
      return NextResponse.json(j2, { status: r2.status });
    }
    // Fallback shim: succeed without backend
    return NextResponse.json({ created: urls.map((u) => ({ id: `tmp_${Math.random().toString(36).slice(2, 10)}`, url: u })), duplicates: [] });
  } catch (e) {
    return NextResponse.json({ error: 'shim-error' }, { status: 500 });
  }
}

