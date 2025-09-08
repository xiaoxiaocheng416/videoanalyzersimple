'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useDropzone } from 'react-dropzone';
import { en as t } from '../../uiStrings/i18n/en';
import {
  TaskItem,
  createUrlTasks,
  uploadFiles as apiUploadFiles,
  listTasks,
  retryTask,
  cancelTask,
  deleteTask,
} from '@/lib/taskClient';

type StatusFilter = '' | 'queued' | 'running' | 'success' | 'failed' | 'canceled';
type SourceFilter = '' | 'url' | 'file';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, '') || '/api';

function useUserKey() {
  return useMemo(() => {
    try {
      let k = localStorage.getItem('userKey');
      if (!k) {
        k = 'u_' + Math.random().toString(36).slice(2, 10);
        localStorage.setItem('userKey', k);
      }
      return k;
    } catch {
      return 'anon';
    }
  }, []);
}

export default function TaskRunnerPage() {
  const userKey = useUserKey();
  // Header
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'retrying'>('idle');

  // Concurrency pool for file uploads
  const [concurrency, setConcurrency] = useState<number>(2);
  const [fileQueue, setFileQueue] = useState<File[]>([]);
  const inflightMap = useRef<Map<string, AbortController>>(new Map());
  const [inflightCount, setInflightCount] = useState(0);
  const pumpRef = useRef(false);

  // Import: URLs
  const [urlText, setUrlText] = useState('');
  const [importInfo, setImportInfo] = useState<string>('');

  // Filters / list
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('');
  const [sortBy, setSortBy] = useState<'updatedAt_desc' | 'updatedAt_asc' | 'createdAt_desc' | 'createdAt_asc'>('updatedAt_desc');
  const [search, setSearch] = useState('');
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [total, setTotal] = useState<number | null>(null);
  const [limit] = useState(20);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dropzone
  const onDrop = useCallback((accepted: File[]) => {
    if (!accepted?.length) return;
    // Simple dedup by name+size
    setFileQueue((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}_${f.size}`));
      const next = [...prev];
      for (const f of accepted) {
        const key = `${f.name}_${f.size}`;
        if (!seen.has(key)) {
          next.push(f);
          seen.add(key);
        }
      }
      return next;
    });
  }, []);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept: { 'video/*': [] } });

  // Concurrency pump
  const pump = useCallback(async () => {
    if (pumpRef.current) return;
    pumpRef.current = true;
    try {
      while (inflightCount < concurrency && fileQueue.length > 0) {
        const file = fileQueue[0];
        setFileQueue((q) => q.slice(1));
        const ctl = new AbortController();
        inflightMap.current.set(`${file.name}_${file.size}_${Date.now()}`, ctl);
        setInflightCount((n) => n + 1);
        // Start single-file upload
        apiUploadFiles([file], { importTimestamp: new Date().toISOString(), createdBy: userKey, signal: ctl.signal })
          .catch(() => {})
          .finally(() => {
            // Remove one controller entry (any key with same file name+size)
            for (const [k] of inflightMap.current) {
              if (k.startsWith(`${file.name}_${file.size}`)) {
                inflightMap.current.delete(k);
                break;
              }
            }
            setInflightCount((n) => Math.max(0, n - 1));
            // Kick next
            pumpRef.current = false;
            pump();
            // Refresh listing lazily
            refresh(true);
          });
      }
    } finally {
      pumpRef.current = false;
    }
  }, [concurrency, fileQueue, inflightCount, userKey]);

  useEffect(() => {
    // Trigger pump when queue or concurrency changes
    if (fileQueue.length > 0) pump();
  }, [fileQueue, concurrency, pump]);

  const cancelAll = useCallback(() => {
    for (const [, ctl] of inflightMap.current) ctl.abort();
    inflightMap.current.clear();
    setFileQueue([]);
    setInflightCount(0);
  }, []);

  // List tasks
  const refresh = useCallback(
    async (force = false) => {
      setSyncStatus('syncing');
      setLoading(true);
      try {
        const resp = await listTasks({
          status: statusFilter || undefined,
          source: sourceFilter || undefined,
          search: search || undefined,
          limit,
          offset: force ? 0 : offset,
          sort: sortBy,
        });
        const { items, total } = resp;
        setTasks(force ? items : offset === 0 ? items : [...tasks, ...items]);
        setTotal(total);
        if (force) setOffset(0);
        setError(null);
        setLastSyncedAt(new Date());
        setSyncStatus('idle');
      } catch (e: any) {
        setError(e?.message || 'Failed to load tasks');
        setSyncStatus('retrying');
      } finally {
        setLoading(false);
      }
    },
    [statusFilter, sourceFilter, search, limit, offset, sortBy, tasks],
  );

  useEffect(() => {
    refresh(true);
    const tmr = setInterval(() => refresh(true), 5000);
    return () => clearInterval(tmr);
  }, [statusFilter, sourceFilter, sortBy, search]);

  // URL run
  const normalizeUrl = (u: string) => {
    try {
      const url = new URL(u.trim());
      url.hash = '';
      return url.toString();
    } catch {
      return '';
    }
  };
  const runUrls = async () => {
    const lines = urlText
      .split(/\r|\n/)
      .map((x) => x.trim())
      .filter(Boolean)
      .map(normalizeUrl)
      .filter(Boolean);
    const unique = Array.from(new Set(lines));
    if (unique.length === 0) return;
    const importTimestamp = new Date().toISOString();
    try {
      await createUrlTasks(unique, { importTimestamp, createdBy: userKey });
      setImportInfo(`Enqueued ${unique.length} URL task(s)`);
      setUrlText('');
      refresh(true);
    } catch (e: any) {
      setImportInfo(`Failed to enqueue: ${e?.message || 'error'}`);
    }
  };

  const loadedCount = tasks.length;

  // Export (V1 fallback)
  const [exportScope, setExportScope] = useState<'filter' | 'selected' | 'time'>('filter');
  const [exportFormat, setExportFormat] = useState<'json' | 'csv'>('json');
  const [exportPerItem, setExportPerItem] = useState<boolean>(false);
  const [timeFrom, setTimeFrom] = useState<string>('');
  const [timeTo, setTimeTo] = useState<string>('');

  const getExportCandidates = (): TaskItem[] => {
    let base = tasks.slice();
    if (exportScope === 'selected') {
      base = base.filter((t) => selectedIds.has(t.id));
    } else if (exportScope === 'time') {
      const fromMs = timeFrom ? new Date(timeFrom).getTime() : Number.NEGATIVE_INFINITY;
      const toMs = timeTo ? new Date(timeTo).getTime() : Number.POSITIVE_INFINITY;
      base = base.filter((t) => {
        const ms = new Date(t.updatedAt || t.createdAt || '').getTime();
        return ms >= fromMs && ms <= toMs;
      });
    }
    return base;
  };

  const fmtCSV = (rows: TaskItem[]): string => {
    const header = ['id', 'title', 'url', 'fileRef', 'status', 'progress', 'updatedAt', 'createdAt', 'importTimestamp', 'source', 'createdBy'];
    const lines = [header.join(',')];
    for (const r of rows) {
      const vals = [
        r.id,
        (r.title || ''),
        (r.url || ''),
        (r.fileRef || ''),
        r.status,
        String(r.progress ?? ''),
        r.updatedAt || '',
        r.createdAt || '',
        r.importTimestamp || '',
        r.source || '',
        r.createdBy || '',
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`);
      lines.push(vals.join(','));
    }
    return lines.join('\n');
  };

  const downloadBlob = (data: BlobPart, name: string, mime: string) => {
    const blob = new Blob([data], { type: mime });
    const sizeMB = blob.size / (1024 * 1024);
    if (sizeMB > 15) {
      alert(`Export too large (~${sizeMB.toFixed(1)}MB). Please use server export.`);
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onExport = () => {
    const items = getExportCandidates();
    if (items.length === 0) {
      alert('No items to export');
      return;
    }
    const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    if (!exportPerItem) {
      if (exportFormat === 'json') {
        downloadBlob(JSON.stringify(items, null, 2), `export_${ts}.json`, 'application/json');
      } else {
        downloadBlob(fmtCSV(items), `export_${ts}.csv`, 'text/csv');
      }
    } else {
      // Multiple downloads (no ZIP in V1). Guard to avoid spamming too many files.
      if (items.length > 50) {
        alert('Too many files for per-item export (limit 50). Please use server export.');
        return;
      }
      let idx = 0;
      const step = () => {
        if (idx >= items.length) return;
        const it = items[idx++];
        const base = it.id;
        if (exportFormat === 'json') {
          downloadBlob(JSON.stringify(it, null, 2), `${base}.json`, 'application/json');
        } else {
          downloadBlob(fmtCSV([it]), `${base}.csv`, 'text/csv');
        }
        setTimeout(step, 150);
      };
      step();
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t.taskRunner.title}</h1>
          <p className="text-sm text-muted-foreground">
            {t.taskRunner.lastSynced} {lastSyncedAt ? lastSyncedAt.toLocaleTimeString('en-US', { hour12: false }) : '—'} ·{' '}
            {syncStatus === 'syncing' ? 'Syncing…' : syncStatus === 'retrying' ? 'Retrying…' : 'Idle'}
            <span className="ml-3 text-xs text-gray-500">{t.taskRunner.queue}: {inflightCount}/{fileQueue.length}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">Concurrency:</span>
          <select
            className="border rounded px-2 py-1 text-sm"
            value={concurrency}
            onChange={(e) => setConcurrency(Number(e.target.value))}
          >
            {[2, 5, 10].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <Button variant="secondary" onClick={() => refresh(true)}>
            Refresh
          </Button>
        </div>
      </div>

      {/* Import Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <Card>
          <CardHeader>
            <CardTitle>{t.taskRunner.pasteUrls}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <textarea
              className="w-full border rounded-md p-2 text-sm min-h-[160px]"
              placeholder={t.taskRunner.pasteUrls}
              value={urlText}
              onChange={(e) => setUrlText(e.target.value)}
            />
            <div className="flex items-center gap-2">
              <Button onClick={runUrls} disabled={!urlText.trim()}>{t.actions.run}</Button>
              {!!importInfo && <span className="text-xs text-gray-500">{importInfo}</span>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.taskRunner.uploadFiles}</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-md p-6 text-sm text-center cursor-pointer ${isDragActive ? 'bg-blue-50 border-blue-300' : 'bg-white'}`}
            >
              <input {...getInputProps()} />
              <p>Drag and drop files here, or click to select</p>
              <p className="text-xs text-gray-500 mt-2">{t.taskRunner.typeSizeHint}</p>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={cancelAll} disabled={inflightCount === 0 && fileQueue.length === 0}>
                {t.actions.cancelAll}
              </Button>
              <span className="text-xs text-gray-500">Queued: {fileQueue.length} · Inflight: {inflightCount}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">{t.filters.status}:</span>
          <select className="border rounded px-2 py-1 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
            <option value="">All</option>
            <option value="queued">Queued</option>
            <option value="running">Running</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
            <option value="canceled">Canceled</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">{t.filters.source}:</span>
          <select className="border rounded px-2 py-1 text-sm" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as SourceFilter)}>
            <option value="">All</option>
            <option value="url">URL</option>
            <option value="file">File</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">{t.filters.sort}:</span>
          <select className="border rounded px-2 py-1 text-sm" value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}>
            <option value="updatedAt_desc">Updated time (desc)</option>
            <option value="updatedAt_asc">Updated time (asc)</option>
            <option value="createdAt_desc">Created time (desc)</option>
            <option value="createdAt_asc">Created time (asc)</option>
          </select>
        </div>
        <input
          className="border rounded px-2 py-1 text-sm min-w-[240px]"
          placeholder={t.taskRunner.searchTasks}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button variant="secondary" size="sm" onClick={() => { setStatusFilter(''); setSourceFilter(''); setSearch(''); setSortBy('updatedAt_desc'); }}>Clear Filters</Button>
      </div>

      {/* Tasks table */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Tasks</CardTitle>
          <div className="text-xs text-gray-500">{t.taskRunner.loaded} {loadedCount} {t.taskRunner.of} {total ?? '—'}</div>
        </CardHeader>
        <CardContent>
          {loading && tasks.length === 0 ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : tasks.length === 0 ? (
            <div className="text-sm text-gray-500">{t.tips.noTasks}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left">
                    <th className="p-2 w-8">
                      <input
                        type="checkbox"
                        checked={tasks.length > 0 && tasks.every((x) => selectedIds.has(x.id))}
                        onChange={(e) => {
                          const next = new Set<string>(selectedIds);
                          if (e.target.checked) tasks.forEach((x) => next.add(x.id));
                          else tasks.forEach((x) => next.delete(x.id));
                          setSelectedIds(next);
                        }}
                      />
                    </th>
                    <th className="p-2">Title/URL</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Progress</th>
                    <th className="p-2">Updated</th>
                    <th className="p-2">Source</th>
                    <th className="p-2" />
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((it) => (
                    <tr key={it.id} className="border-t hover:bg-muted/40">
                      <td className="p-2 w-8">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(it.id)}
                          onChange={(e) => {
                            const next = new Set<string>(selectedIds);
                            if (e.target.checked) next.add(it.id);
                            else next.delete(it.id);
                            setSelectedIds(next);
                          }}
                        />
                      </td>
                      <td className="p-2 truncate max-w-[380px]" title={(it.url || it.title || it.fileRef || it.id)}>
                        {it.url || it.title || it.fileRef || it.id}
                      </td>
                      <td className="p-2">
                        <span
                          className={`inline-flex items-center gap-1 ${
                            it.status === 'success' ? 'text-green-600' : it.status === 'failed' ? 'text-red-600' : it.status === 'running' ? 'text-blue-600' : it.status === 'queued' ? 'text-gray-600' : 'text-gray-500'
                          }`}
                        >
                          {it.status}
                        </span>
                      </td>
                      <td className="p-2 min-w-[120px]">
                        {it.status === 'running' ? <Progress value={it.progress ?? 0} /> : <span>{it.progress ?? 0}%</span>}
                      </td>
                      <td className="p-2">{it.updatedAt ? new Date(it.updatedAt).toLocaleTimeString('en-US', { hour12: false }) : ''}</td>
                      <td className="p-2">{it.source || ''}</td>
                      <td className="p-2">
                        <div className="flex items-center gap-1">
                          {it.status === 'failed' && (
                            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => retryTask(it.id).then(() => refresh(true))}>
                              Retry
                            </Button>
                          )}
                          {it.status === 'running' && (
                            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => cancelTask(it.id).then(() => refresh(true))}>
                              Cancel
                            </Button>
                          )}
                          <DeleteInline id={it.id} onDeleted={() => refresh(true)} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="mt-3 flex items-center justify-between">
                {!!error && <span className="text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded px-2 py-1">{error}</span>}
                <div className="ml-auto">
                  <Button
                    variant="secondary"
                    disabled={loading || (total !== null && tasks.length >= (total || 0))}
                    onClick={() => {
                      setOffset((o) => o + limit);
                      listTasks({ status: statusFilter || undefined, source: sourceFilter || undefined, search: search || undefined, limit, offset: offset + limit, sort: sortBy })
                        .then((resp) => {
                          setTasks((prev) => {
                            const map = new Map(prev.map((x) => [x.id, x] as const));
                            for (const it of resp.items) map.set(it.id, it);
                            return Array.from(map.values());
                          });
                          setTotal(resp.total);
                        })
                        .catch(() => setError('Failed to load more'));
                    }}
                  >
                    {loading ? 'Loading…' : 'Load more'}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Export Bar (V1 fallback) */}
      <div className="mt-6 border rounded-md p-3 text-sm flex flex-wrap items-center gap-3">
        <span className="text-gray-700">{t.exportBar.scope}:</span>
        <select className="border rounded px-2 py-1 text-sm" value={exportScope} onChange={(e) => setExportScope(e.target.value as any)}>
          <option value="filter">{t.exportBar.currentFilter}</option>
          <option value="selected">{t.exportBar.selected}</option>
          <option value="time">{t.exportBar.timeRange}</option>
        </select>
        {exportScope === 'time' && (
          <>
            <input type="datetime-local" className="border rounded px-2 py-1 text-sm" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} />
            <input type="datetime-local" className="border rounded px-2 py-1 text-sm" value={timeTo} onChange={(e) => setTimeTo(e.target.value)} />
          </>
        )}
        <span className="text-gray-700">{t.exportBar.format}:</span>
        <select className="border rounded px-2 py-1 text-sm" value={exportFormat} onChange={(e) => setExportFormat(e.target.value as any)}>
          <option value="json">{t.exportBar.json}</option>
          <option value="csv">{t.exportBar.csv}</option>
        </select>
        <label className="inline-flex items-center gap-2 text-xs text-gray-700">
          <input type="checkbox" checked={exportPerItem} onChange={(e) => setExportPerItem(e.target.checked)} /> {t.exportBar.perItem}
        </label>
        <Button size="sm" onClick={onExport}>{t.exportBar.export}</Button>
      </div>
    </div>
  );
}

function DeleteInline({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const [confirmUntil, setConfirmUntil] = useState<number>(0);
  const onClick = async () => {
    const now = Date.now();
    if (confirmUntil > now) {
      await deleteTask(id).catch(() => {});
      onDeleted();
      setConfirmUntil(0);
    } else {
      const expiry = now + 3000;
      setConfirmUntil(expiry);
      setTimeout(() => setConfirmUntil((v) => (v === expiry ? 0 : v)), 3000);
    }
  };
  return (
    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-red-600" onClick={onClick}>
      {confirmUntil > Date.now() ? 'Confirm' : 'Delete'}
    </Button>
  );
}
