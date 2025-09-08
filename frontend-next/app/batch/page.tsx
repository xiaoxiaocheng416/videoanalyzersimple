'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusChips } from '@/components/ui/status-chips';
import { ToastProvider, useToastLite } from '@/components/ui/toast-lite';
import { fetchJSON } from '@/lib/apiClient';
import { UploadManager } from '@/lib/uploadManager';
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { en as t } from '../../uiStrings/i18n/en';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, '') || '/api';

// Feature flags
const FEATURES = {
  FAST_REFRESH: process.env.NEXT_PUBLIC_FAST_REFRESH !== '0',
  RESTORE_SCROLL: process.env.NEXT_PUBLIC_RESTORE_SCROLL !== '0',
};

const MAX_FILE_SIZE_MB = Number(process.env.NEXT_PUBLIC_MAX_FILE_MB || 500);
const ACTIVE_WINDOW_HOURS = Number(process.env.NEXT_PUBLIC_BATCH_ACTIVE_WINDOW_HOURS || 24);
const ACCEPT_VIDEO = ['video/', '.mp4', '.mov', '.webm', '.mkv'];

type Batch = { id: string; title?: string; createdAt: string; status: string; counts: any };
type Task = {
  id: string;
  batchId: string;
  kind: 'url' | 'file';
  payload: any;
  status: string;
  progress?: number;
  updatedAt?: string;
  result?: any;
  // local-only fields for optimistic UI
  ephemeral?: boolean;
  clientToken?: string;
  ephemeralAt?: number; // epoch ms
};

export default function BatchPage() {
  return (
    <ToastProvider>
      <BatchPageInner />
    </ToastProvider>
  );
}

// Inline components for delete flows
function DeleteCellButton({ id, confirmMap, setConfirmMap, onDelete }: { id: string; confirmMap: Record<string, number>; setConfirmMap: React.Dispatch<React.SetStateAction<Record<string, number>>>; onDelete: () => void }) {
  const now = Date.now();
  const active = (confirmMap[id] || 0) > now;
  const label = active ? 'Confirm' : 'Delete';
  const onClick = () => {
    if (!active) {
      const expiry = Date.now() + 3000;
      setConfirmMap((m) => ({ ...m, [id]: expiry }));
      setTimeout(() => setConfirmMap((m) => {
        if (m[id] !== expiry) return m;
        const nm = { ...m } as Record<string, number>;
        delete nm[id];
        return nm;
      }), 3000);
    } else {
      onDelete();
      setConfirmMap((m) => {
        const n = { ...m };
        delete n[id];
        return n;
      });
    }
  };
  return (
    <button
      className={`text-xs ${active ? 'text-red-600' : 'text-gray-700'} underline`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onClick();
      }}
    >
      {label}
    </button>
  );
}

function InlineBatchDelete({ selected, onConfirm, onUndo }: { selected: Set<string>; onConfirm: () => void; onUndo: () => void }) {
  const [confirming, setConfirming] = React.useState(false);
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(t);
  }, [confirming]);
  const count = selected.size;
  if (count === 0) return null;
  return (
    <div className="flex items-center gap-2">
      {!confirming ? (
        <Button variant="destructive" size="sm" onClick={() => setConfirming(true)}>
          Delete selected ({count})
        </Button>
      ) : (
        <Button variant="destructive" size="sm" onClick={onConfirm}>
          Confirm ({count})
        </Button>
      )}
    </div>
  );
}

// Helpers
function normalizeUrl(u: string) {
  try {
    const url = new URL(u.trim());
    url.hash = '';
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach((k) =>
      url.searchParams.delete(k),
    );
    return url.toString().replace(/\/$/, '');
  } catch {
    return u.trim();
  }
}

function validateAndDedupFiles(files: File[]) {
  const seen = new Set<string>();
  const reasons: string[] = [];
  const valid: File[] = [];
  const maxBytes = MAX_FILE_SIZE_MB * 1024 * 1024;
  for (const f of files) {
    const key = `${f.name}_${f.size}`;
    const isVideo = ACCEPT_VIDEO.some((t) => f.type.startsWith('video/') || f.name.toLowerCase().endsWith(t));
    if (!isVideo) {
      reasons.push(t.validation.nonVideo(f.name));
      continue;
    }
    if (f.size > maxBytes) {
      reasons.push(t.validation.tooLarge(f.name, MAX_FILE_SIZE_MB));
      continue;
    }
    if (seen.has(key)) {
      reasons.push(t.validation.duplicateFile(f.name));
      continue;
    }
    seen.add(key);
    valid.push(f);
  }
  return { valid, rejected: files.length - valid.length, reasons };
}

function mergeTasksById(prev: Task[], incoming: Task[]): Task[] {
  const map = new Map<string, Task>();
  for (const it of prev) map.set(it.id, it);
  for (const it of incoming) map.set(it.id, { ...(map.get(it.id) || {}), ...it });
  const ordered: Task[] = [];
  const seen = new Set<string>();
  for (const it of incoming) {
    ordered.push(map.get(it.id)!);
    seen.add(it.id);
  }
  for (const it of prev) {
    if (!seen.has(it.id)) ordered.push(map.get(it.id)!);
  }
  return ordered;
}

function aggregateCounts(list: Task[]) {
  const counts: Record<string, number> = { queued: 0, running: 0, success: 0, failed: 0, canceled: 0 };
  for (const t of list) counts[t.status] = (counts[t.status] || 0) + 1;
  return counts;
}

function mergeDisplayTasksById(existing: Task[], incoming: Task[]): Task[] {
  const map = new Map<string, Task>();
  for (const it of existing) map.set(it.id, it);
  for (const it of incoming) {
    const prev = map.get(it.id);
    if (!prev) map.set(it.id, it);
    else {
      const prevTs = new Date(prev.updatedAt || 0).getTime();
      const curTs = new Date(it.updatedAt || 0).getTime();
      map.set(it.id, curTs >= prevTs ? it : prev);
    }
  }
  return Array.from(map.values());
}


function getDisplayTasks(server: Task[], sortBy: 'updatedAtDesc' | 'createdAtDesc' | 'status', statusFilter: string) {
  const mergedServer = mergeDisplayTasksById([], server || []);
  const filtered = statusFilter ? mergedServer.filter((t) => t.status === statusFilter) : mergedServer;
  const sorted = sortTasks(filtered, sortBy);
  return sorted;
}

function sortTasks(list: Task[], sortBy: 'updatedAtDesc' | 'createdAtDesc' | 'status') {
  const arr = list.slice();
  if (sortBy === 'status') {
    const order: Record<string, number> = { running: 1, queued: 2, failed: 3, success: 4, canceled: 5 } as any;
    return arr.sort((a, b) => (order[a.status] || 99) - (order[b.status] || 99));
  }
  if (sortBy === 'createdAtDesc') {
    // Fallback to updatedAt when createdAt not available
    return arr.sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
  }
  // Default: updatedAt desc
  return arr.sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
}

// Reconcile handled in getDisplayTasks()

function BatchPageInner() {
  const { toast } = useToastLite();
  const [batch, setBatch] = useState<Batch | null>(null);
  const [urls, setUrls] = useState('');
  const [serverTasks, setServerTasks] = useState<Task[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [isUploading, setIsUploading] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [allBatches, setAllBatches] = useState<Batch[]>([]); // fallback/local cache
  const [batchSearch, setBatchSearch] = useState('');
  const [batchList, setBatchList] = useState<Batch[]>([]);
  const [batchTotal, setBatchTotal] = useState<number | null>(null);
  const [batchLimit, setBatchLimit] = useState<number>(20);
  const [batchOffset, setBatchOffset] = useState<number>(0);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'error' | 'retrying'>('idle');
  const refreshCtlRef = useRef<AbortController | null>(null);
  const latestReq = React.useRef(0);
  const refreshDebounceRef = useRef<NodeJS.Timeout>();
  const [initialLoading, setInitialLoading] = useState(true);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [tasksLimit, setTasksLimit] = useState<number>(100);
  const [loadingMore, setLoadingMore] = useState(false);
  const uploadMgrRef = useRef<UploadManager | null>(null);
  const [uploadStats, setUploadStats] = useState<{ active: number; queued: number; done: number; total: number } | null>(null);
  const [activeUploads, setActiveUploads] = useState<Array<{ id: string; name: string }>>([]);
  const [sortBy, setSortBy] = useState<'updatedAtDesc' | 'createdAtDesc' | 'status'>('updatedAtDesc');
  const refreshThrottleRef = useRef<NodeJS.Timeout | null>(null);
  const [authExpired, setAuthExpired] = useState(false);
  const lastInteractionAtRef = useRef<number>(Date.now());
  const [editMode, setEditMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmMap, setConfirmMap] = useState<Record<string, number>>({});
  const [undoBuffer, setUndoBuffer] = useState<Task[]>([]);
  const [inlineBanner, setInlineBanner] = useState<{ kind: 'deleted' | 'restored'; count: number } | null>(null);
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState(false);
  const tombstonesRef = useRef<Map<string, number>>(new Map());
  const [tombstoneVer, setTombstoneVer] = useState(0);
  const replaceNextRefreshRef = useRef(false);

  const addTombstones = useCallback((ids: string[], ttlMs = 60000) => {
    const until = Date.now() + ttlMs;
    ids.forEach((id) => tombstonesRef.current.set(id, until));
    setTombstoneVer((v) => v + 1);
    console.debug('[tombstones]', { size: tombstonesRef.current.size });
  }, []);

  const clearTombstones = useCallback((ids: string[]) => {
    let changed = false;
    ids.forEach((id) => {
      if (tombstonesRef.current.delete(id)) changed = true;
    });
    if (changed) setTombstoneVer((v) => v + 1);
  }, []);

  const filterTombstones = useCallback(
    (arr: Task[]) =>
      arr.filter((t) => {
        const exp = tombstonesRef.current.get(t.id);
        return !exp || exp <= Date.now();
      }),
    [tombstoneVer],
  );

  // Helper: per-user localStorage key
  const getUserKey = useCallback(() => {
    try {
      const k = localStorage.getItem('userKey');
      if (k) return k;
      const nk = 'u_' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem('userKey', nk);
      return nk;
    } catch {
      return 'anon';
    }
  }, []);

  const getLastBatchKey = useCallback(() => {
    const uk = getUserKey();
    return `lastBatchId:${uk}`;
  }, [getUserKey]);

  const pickRecentActiveBatch = useCallback((list: any[]) => {
    const now = Date.now();
    const windowMs = ACTIVE_WINDOW_HOURS * 60 * 60 * 1000;
    const isActive = (b: any) => {
      const counts = b?.counts || {};
      const running = Number(counts.running || 0);
      const queued = Number(counts.queued || 0);
      const success = Number(counts.success || 0);
      const failed = Number(counts.failed || 0);
      const archived = Boolean(b?.archived);
      const ts = new Date((b?.updatedAt as string) || b?.createdAt).getTime();
      return !archived && (running > 0 || queued > 0 || ((success + failed) > 0 && now - ts <= windowMs));
    };
    const sorted = [...(list || [])]
      .filter((b) => b && b.id)
      .sort((a, b) => new Date((b?.updatedAt || b?.createdAt) as string).getTime() - new Date((a?.updatedAt || a?.createdAt) as string).getTime());
    return sorted.find(isActive) || null;
  }, []);

  // Restore context on mount
  const restoreContext = useCallback(() => {
    if (!FEATURES.RESTORE_SCROLL) return;
    try {
      const saved = sessionStorage.getItem('batchContext');
      if (saved) {
        const context = JSON.parse(saved);
        if (context.statusFilter !== undefined) {
          setStatusFilter(context.statusFilter);
        }
        // Restore scroll position after DOM is ready
        if (context.scrollTop !== undefined) {
          setTimeout(() => {
            window.scrollTo({ top: context.scrollTop, behavior: 'instant' });
          }, 100);
        }
      }
    } catch (e) {
      console.warn('[batch] restore context failed', e);
    }
  }, []);

  // Save context before navigating away
  const saveContext = useCallback(() => {
    if (!FEATURES.RESTORE_SCROLL) return;
    try {
      sessionStorage.setItem(
        'batchContext',
        JSON.stringify({
          batchId: batch?.id,
          statusFilter,
          scrollTop: window.scrollY,
        }),
      );
    } catch (e) {
      console.warn('[batch] save context failed', e);
    }
  }, [batch?.id, statusFilter]);

  // Initial load: try ?batch= or per-user lastBatchId; otherwise pick recent active; else show create button
  useEffect(() => {
    (async () => {
      // load list for selector
      try {
        const listUrl = new URL(`${API_BASE}/batches`, location.origin);
        listUrl.searchParams.set('limit', '50');
        listUrl.searchParams.set('status', 'active');
        listUrl.searchParams.set('archived', 'false');
        listUrl.searchParams.set('sort', 'updatedAt_desc');
        const resp = await fetchJSON(listUrl.toString(), { retries: 1, backoffMs: 500 });
        // Support both P0(array) and P1(object with items/total)
        const items = Array.isArray(resp) ? resp : (resp?.items || []);
        const total = Array.isArray(resp) ? (resp?.length || null) : (typeof resp?.total === 'number' ? resp.total : null);
        setAllBatches(items || []);
        setBatchList(items || []);
        setBatchTotal(total);
        setBatchOffset(0);
        setBatchError(null);
      } catch {}
      const params = new URLSearchParams(location.search);
      const fromQuery = params.get('batch');
      const lastKey = getLastBatchKey();
      const last = typeof localStorage !== 'undefined' ? localStorage.getItem(lastKey) : null;
      const id = fromQuery || last;
      if (id) {
        try {
          const data = await fetchJSON(`${API_BASE}/batches/${id}`, { retries: 1, backoffMs: 500 }).catch(() =>
            null,
          );
          if (data && data.id) {
            setBatch(data);
            // Update localStorage and URL
            try {
              localStorage.setItem(lastKey, id);
            } catch {}
            const params = new URLSearchParams(location.search);
            params.set('batch', id);
            history.replaceState(null, '', `${location.pathname}?${params.toString()}`);
            // Restore context after batch is set
            restoreContext();
            return;
          }
        } catch {}
      }
      // No id: try pick recent active batch
      try {
        const listUrl2 = new URL(`${API_BASE}/batches`, location.origin);
        listUrl2.searchParams.set('limit', '50');
        listUrl2.searchParams.set('status', 'active');
        listUrl2.searchParams.set('archived', 'false');
        listUrl2.searchParams.set('sort', 'updatedAt_desc');
        const resp2 = await fetchJSON(listUrl2.toString(), { retries: 1, backoffMs: 500 }).catch(() => [] as any[]);
        const arr2 = Array.isArray(resp2) ? resp2 : (resp2?.items || []);
        const pick = pickRecentActiveBatch(arr2 || []);
        if (pick && pick.id) {
          setBatch(pick);
          try { localStorage.setItem(getLastBatchKey(), pick.id); } catch {}
          const sp = new URLSearchParams(location.search);
          sp.set('batch', pick.id);
          history.replaceState(null, '', `${location.pathname}?${sp.toString()}`);
          restoreContext();
          return;
        }
      } catch {}
      setBatch(null);
    })();
  }, [restoreContext, getLastBatchKey, pickRecentActiveBatch]);

  // Fetch batches page (P1): server pagination/search
  const fetchBatchesPage = useCallback(
    async (nextOffset: number, q: string) => {
      setBatchLoading(true);
      setBatchError(null);
      try {
        const url = new URL(`${API_BASE}/batches`, location.origin);
        url.searchParams.set('limit', String(batchLimit));
        url.searchParams.set('offset', String(nextOffset));
        url.searchParams.set('status', 'active');
        url.searchParams.set('archived', 'false');
        url.searchParams.set('sort', 'updatedAt_desc');
        if (q.trim()) url.searchParams.set('search', q.trim());
        const resp = await fetchJSON(url.toString(), { retries: 1, backoffMs: 300 });
        const items = Array.isArray(resp) ? resp : (resp?.items || []);
        const total = Array.isArray(resp) ? null : (typeof resp?.total === 'number' ? resp.total : null);
        setBatchList((prev) => {
          if (nextOffset === 0) return items || [];
          // append with id-dedupe
          const map = new Map<string, Batch>();
          for (const it of prev) map.set(it.id, it);
          for (const it of items || []) map.set(it.id, it);
          return Array.from(map.values());
        });
        setBatchTotal(total);
        setBatchOffset(nextOffset);
        setBatchError(null);
      } catch (e: any) {
        setBatchError(e?.message || 'Failed to load batches');
        // fallback: keep existing list
      } finally {
        setBatchLoading(false);
      }
    },
    [API_BASE, batchLimit],
  );

  // Debounced search: P1 server search, fallback to client if server not ready
  useEffect(() => {
    const t = setTimeout(() => {
      fetchBatchesPage(0, batchSearch);
    }, 300);
    return () => clearTimeout(t);
  }, [batchSearch, fetchBatchesPage]);

  const recentBatches = useMemo(() => {
    const q = batchSearch.trim().toLowerCase();
    const filtered = (allBatches || [])
      .filter((b) => b && b.id)
      .filter((b) => {
        if (!q) return true;
        const title = (b.title || '').toLowerCase();
        const id = (b.id || '').toLowerCase();
        return title.includes(q) || id.includes(q);
      })
      .sort((a, b) => new Date((b as any).updatedAt || b.createdAt).getTime() - new Date((a as any).updatedAt || a.createdAt).getTime())
      .slice(0, 20);
    return filtered;
  }, [allBatches, batchSearch]);

  // Unified refresh function with requestId guard and enhanced error handling
  const refresh = React.useCallback(
    async (immediate = false, force = false) => {
      if (!batch) return;

      // Debounce immediate refreshes to prevent request storms
      if (immediate && FEATURES.FAST_REFRESH && !force) {
        if (refreshDebounceRef.current) {
          clearTimeout(refreshDebounceRef.current);
        }
        refreshDebounceRef.current = setTimeout(() => {
          refresh(false, false);
        }, 100);
        return;
      }

      const rid = ++latestReq.current;
      const replace = replaceNextRefreshRef.current;
      console.debug('[refresh]', { rid, force, replace });
      setSyncStatus('syncing');
      if (force) {
        try { refreshCtlRef.current?.abort(); } catch {}
        refreshCtlRef.current = new AbortController();
      }

      try {
        // tasks
        const url = new URL(`${API_BASE}/batches/${batch.id}/tasks`, location.origin);
        if (statusFilter) url.searchParams.set('status', statusFilter);
        url.searchParams.set('limit', String(tasksLimit));
        const signal = refreshCtlRef.current?.signal;
        const [tasksResp, batchResp, listResp] = await Promise.all([
          fetchJSON(url.toString(), { retries: 1, backoffMs: 500, signal }).catch((e) => { if (e?.code==='AUTH_EXPIRED') setAuthExpired(true); return null; }),
          fetchJSON(`${API_BASE}/batches/${batch.id}`, { retries: 1, backoffMs: 500, signal }).catch((e) => { if (e?.code==='AUTH_EXPIRED') setAuthExpired(true); return null; }),
          fetchJSON(`${API_BASE}/batches`, { retries: 1, backoffMs: 500, signal }).catch((e) => { if (e?.code==='AUTH_EXPIRED') setAuthExpired(true); return null; }),
        ]);
        if (rid !== latestReq.current) return; // ignore stale

        let hasError = false;

        if (tasksResp && (tasksResp as any).tasks) {
          const json = tasksResp as any;
          const incoming = json.tasks || [];
          if (replaceNextRefreshRef.current) {
            setServerTasks(incoming);
            replaceNextRefreshRef.current = false;
          } else {
            setServerTasks((prev) => mergeDisplayTasksById(prev, incoming));
          }
          setInitialLoading(false);
          setLastError(null);
          setAuthExpired(false);
        } else {
          console.warn('[batch] tasks refresh failed - keeping existing data');
          hasError = true;
          if (initialLoading) setInitialLoading(false);
          setLastError(t.banners.syncFailedKeepLocal);
          // IMPORTANT: Do not clear tasks on failure
        }
        if (rid !== latestReq.current) return;

        if (batchResp && (batchResp as any).id) {
          const b = batchResp as any;
          setBatch(b);
        } else {
          console.warn('[batch] batch overview refresh failed - keeping existing data');
          hasError = true;
          // IMPORTANT: Do not clear batch on failure
        }
        if (rid !== latestReq.current) return;

        if (listResp && Array.isArray(listResp)) {
          const list = listResp as any[];
          setAllBatches(list || []);
        }

        setSyncStatus(hasError ? 'retrying' : 'idle');
        if (!hasError) setLastSyncedAt(new Date());
      } catch (e) {
        console.warn('[batch] refresh error - auto-retrying', e);
        setSyncStatus('retrying');
        if (initialLoading) setInitialLoading(false);
        setLastError(t.banners.syncFailedKeepLocal);
        // IMPORTANT: Never clear existing state on error
        // Auto-retry after 2 seconds on error
        if (rid === latestReq.current) {
          setTimeout(() => refresh(false, false), 2000);
        }
      }
    },
    [batch, statusFilter, tasksLimit, initialLoading],
  );

  // Poll tasks (5s) - always active as fallback
  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden) refresh(false, false);
    }, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  // Cleanup expired tombstones
  useEffect(() => {
    const interval = setInterval(() => {
      const tsNow = Date.now();
      let changed = false;
      tombstonesRef.current.forEach((exp, id) => {
        if (exp <= tsNow) {
          tombstonesRef.current.delete(id);
          changed = true;
        }
      });
      if (changed) setTombstoneVer((v) => v + 1);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Immediate fetch when batch or filter changes
  useEffect(() => {
    if (FEATURES.FAST_REFRESH) {
      refresh(true, false); // Immediate refresh
    } else {
      refresh(false, false);
    }
  }, [batch?.id, statusFilter, tasksLimit]);

  // Refresh on tab focus/visibility change
  useEffect(() => {
    const onFocus = () => {
      if (FEATURES.FAST_REFRESH) {
        refresh(true, true); // Immediate refresh on focus
      }
    };
    const onVisible = () => {
      if (!document.hidden && FEATURES.FAST_REFRESH) {
        refresh(true, true); // Immediate refresh on visible
      }
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  // Idle Recovery: force full refresh after idle/outdated
  useEffect(() => {
    const IDLE_MS = 90_000;
    const touch = () => (lastInteractionAtRef.current = Date.now());
    const onVisible = () => {
      if (!document.hidden) {
        const idle = Date.now() - lastInteractionAtRef.current;
        const outdated = lastSyncedAt ? Date.now() - lastSyncedAt.getTime() > 30_000 : true;
        if (idle > IDLE_MS || outdated) refresh(true, true);
      }
    };
    window.addEventListener('click', touch);
    window.addEventListener('keydown', touch);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      window.removeEventListener('click', touch);
      window.removeEventListener('keydown', touch);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [refresh, lastSyncedAt]);

  // File selection: only queue, do not upload
  const handleFileSelect = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const list = ev.target.files;
    if (!list || list.length === 0) return;
    const files = Array.from(list);
    const { valid, rejected, reasons } = validateAndDedupFiles(
      // Dedup with existing pendingFiles by name+size
      files.filter((f) => !pendingFiles.some((pf) => pf.name === f.name && pf.size === f.size)),
    );
    if (rejected > 0) {
      const msg = reasons.join('; ').slice(0, 200);
      toast({ variant: 'warning', title: t.validation.filteredTitle, description: msg });
    }
    // Avoid duplicates with existing tasks (same name)
    const existingNames = new Set(
      getDisplayTasks(serverTasks, sortBy, '').filter((t) => t.kind === 'file').map((t) => (t.payload?.localPath || '').split('/').pop() || ''),
    );
    const deduped = valid.filter((f) => !existingNames.has(f.name));
    if (deduped.length < valid.length) {
      toast({ variant: 'warning', title: t.validation.filteredTitle, description: t.validation.dedupTip(valid.length - deduped.length) });
    }
    if (deduped.length > 0) setPendingFiles((prev) => [...prev, ...deduped]);
    ev.target.value = '';
  };

  const removePending = (name: string, size: number) => {
    setPendingFiles((prev) => prev.filter((f) => !(f.name === name && f.size === size)));
  };

  const clearPending = () => setPendingFiles([]);

  const scheduleRefresh = () => {
    if (refreshThrottleRef.current) return;
    refreshThrottleRef.current = setTimeout(() => {
      refresh(true, true);
      if (refreshThrottleRef.current) clearTimeout(refreshThrottleRef.current);
      refreshThrottleRef.current = null;
    }, 350);
  };

  // Start upload with optimistic tasks
  const startUpload = async () => {
    if (!batch || pendingFiles.length === 0) return;
    console.debug('[upload]', { batchIdUsed: batch.id, files: pendingFiles.length });
    setIsUploading(true);
    const url = `${API_BASE}/batches/${batch.id}/tasks/upload`;
    const items = pendingFiles.map((file) => {
      const clientToken = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      return { id: clientToken, file, clientToken };
    });

    const mgr = new UploadManager({
      url,
      concurrency: 3,
      events: {
        onStart: (total) => {
          setUploadStats({ active: 0, queued: total, done: 0, total });
          setActiveUploads([]);
        },
        onQueueChange: ({ active, queued, done, total }) => setUploadStats({ active, queued, done, total }),
        onUpdate: (active, queued, done) => setUploadStats((s) => ({ active, queued, done, total: s?.total || active + queued + done })),
        onItemStart: (item) => {
          setActiveUploads((prev) => [...prev.filter((x) => x.id !== item.id), { id: item.id, name: item.file.name }]);
        },
        onItemComplete: (item, ok) => {
          setActiveUploads((prev) => prev.filter((x) => x.id !== item.id));
          // Don't refresh on each item, wait for complete
        },
        onComplete: ({ total, succeeded, failed }) => {
          setIsUploading(false);
          setUploadStats(null);
          if (failed > 0) {
            toast({ variant: 'warning', title: 'Upload finished', description: `${succeeded} succeeded, ${failed} failed` });
          }
          // Single force refresh after all uploads complete
          refresh(true, true);
        },
      },
    });
    uploadMgrRef.current = mgr;
    mgr.enqueue(items);
    await mgr.start();
    setPendingFiles([]);
  };

  const addUrls = async () => {
    if (!batch) return;
    const raw = urls
      .split(/\n|\r/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (raw.length === 0) return;
    const normed = Array.from(new Set(raw.map(normalizeUrl)));
    const existing = new Set(
      getDisplayTasks(serverTasks, sortBy, '').filter((t) => t.kind === 'url').map((t) => normalizeUrl(t.payload?.url || '')),
    );
    const newOnes = normed.filter((u) => u && !existing.has(u));
    const dupCount = normed.length - newOnes.length;
    if (dupCount > 0) {
      toast({ variant: 'warning', title: t.validation.filteredTitle, description: t.validation.dedupTip(dupCount) });
    }
    if (newOnes.length === 0) {
      toast({ variant: 'warning', title: t.validation.noNewLinks });
      return;
    }
    try {
      await fetchJSON(`${API_BASE}/batches/${batch.id}/tasks/url`, {
        method: 'POST',
        body: { urls: newOnes },
        retries: 1,
        backoffMs: 500,
      });
      setUrls('');
      // success: low-noise
      // toast({ variant: 'success', title: 'Added', description: t.validation.addedUrls(newOnes.length) });
    } catch (e: any) {
      toast({ variant: 'destructive', title: t.validation.addFailed, description: e?.message || 'Please try again later' });
    }
    await refresh(true, true);
  };

  // removed legacy uploadFiles: replaced by handleFileSelect + startUpload

  const retryFailed = async () => {
    const all = getDisplayTasks(serverTasks, sortBy, statusFilter);
    const failed = all.filter((t) => t.status === 'failed');
    for (const t of failed) {
      await fetchJSON(`${API_BASE}/tasks/${t.id}/retry`, { method: 'POST', retries: 1, backoffMs: 500 }).catch(() => null);
    }
    // Force immediate refresh after retry
    await refresh(true, true);
  };

  // Single task retry
  const retrySingleTask = async (taskId: string) => {
    await fetchJSON(`${API_BASE}/tasks/${taskId}/retry`, { method: 'POST' }).catch(() => null);
    // Force immediate refresh after retry
    await refresh(true, true);
  };

  // Enhanced export with success-only filter
  const exportData = async (format: 'csv' | 'json') => {
    if (!batch) return;

    // Filter only succeeded tasks for export
    const succeeded = serverTasks.filter((t) => t.status === 'success');
    if (succeeded.length === 0) {
      toast({ variant: 'warning', title: t.validation.noExportData });
      return;
    }

    // Export via API (backend will handle the filtering)
    const endpoint = format === 'csv' ? 'export.csv' : 'export.json';
    const resp = await fetch(`${API_BASE}/batches/${batch.id}/${endpoint}`);
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${batch.id}_${new Date().toISOString().slice(0, 10)}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
    // IMPORTANT: Do not refresh after export to avoid UI flicker
  };

  const createBatch = async () => {
    const json = await fetchJSON(`${API_BASE}/batches`, {
      method: 'POST',
      body: { title: 'Batch ' + new Date().toLocaleString(), createdBy: getUserKey(), source: 'batch_page' },
    });
    setBatch(json);
    try {
      localStorage.setItem(getLastBatchKey(), json.id);
    } catch {}
    // Update URL to include batch ID
    const params = new URLSearchParams(location.search);
    params.set('batch', json.id);
    history.replaceState(null, '', `${location.pathname}?${params.toString()}`);
  };

  const selectBatch = async (id: string) => {
    if (!id) return;
    const data = await fetchJSON(`${API_BASE}/batches/${id}`);
    setBatch(data);
    try {
      localStorage.setItem(getLastBatchKey(), id);
    } catch {}

    // Keep filter when switching batches (inherit filter)
    // Only clear tasks temporarily to show loading state
    setServerTasks([]);
    setTasksLimit(100);
    setInitialLoading(true);

    const params = new URLSearchParams(location.search);
    params.set('batch', id);
    history.replaceState(null, '', `${location.pathname}?${params.toString()}`);

    // Immediate refresh after batch switch
    await refresh(true, true);
  };

  if (!batch) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-3xl space-y-4">
        <h1 className="text-2xl font-semibold">Batch Processing</h1>
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            No batch selected. You can create a new batch or pick one from history.
          </p>
          <div className="flex items-center gap-3">
            <Button onClick={createBatch}>Create Batch</Button>
            <select
              className="border rounded px-2 py-1 text-sm"
              onChange={(e) => selectBatch(e.target.value)}
              defaultValue=""
            >
              <option value="" disabled>
                Select existing batch…
              </option>
              {allBatches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title || b.id} · {new Date(b.createdAt).toLocaleString()}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t.batch.title}</h1>
          <p className="text-sm text-muted-foreground">
            Batch ID: {batch.id} · Created: {new Date(batch.createdAt).toLocaleString()}
            {/* header info */}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">
            {t.header.lastSynced} {lastSyncedAt ? lastSyncedAt.toLocaleTimeString('en-US', { hour12: false }) : '—'}
          </span>
          <span className="text-xs text-gray-500">
            {syncStatus === 'syncing' ? t.header.syncing : syncStatus === 'retrying' ? t.header.retrying : t.header.idle}
          </span>
          <Button variant="secondary" onClick={() => refresh(true, true)}>{t.header.refresh}</Button>
          <input
            className="border rounded px-2 py-1 text-sm"
            placeholder="Search batches…"
            value={batchSearch}
            onChange={(e) => setBatchSearch(e.target.value)}
          />
          <select
            className="border rounded px-2 py-1 text-sm"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
          >
            <option value="updatedAtDesc">{t.header.sortUpdated}</option>
            <option value="status">{t.header.sortStatus}</option>
            <option value="createdAtDesc">{t.header.sortCreated}</option>
          </select>
          <select
            className="border rounded px-2 py-1 text-sm"
            onChange={(e) => selectBatch(e.target.value)}
            value={batch.id}
          >
            {batchList.length === 0 && <option value={batch.id}>{batch.title || batch.id}</option>}
            {batchList.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title || b.id} · {new Date(b.createdAt).toLocaleString()}
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            disabled={batchLoading || (batchTotal !== null && batchList.length >= (batchTotal || 0))}
            onClick={() => fetchBatchesPage(batchOffset + batchLimit, batchSearch)}
          >
            {batchLoading ? 'Loading…' : 'Load more batches'}
          </Button>
          {!!batchError && (
            <span className="text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded px-2 py-1">
              {batchError}
            </span>
          )}
          {batchTotal !== null && (
            <span className="text-xs text-gray-500">{batchList.length}/{batchTotal}</span>
          )}
        </div>
      </div>

      {/* Upload banner */}
      {uploadStats && (
        <div className="mb-4 rounded-md border bg-yellow-50 text-yellow-900 px-4 py-2 text-sm flex items-center justify-between">
          <div>
            {t.upload.banner.replace('{total}', String(uploadStats.total)).replace('{active}', String(uploadStats.active)).replace('{queued}', String(uploadStats.queued))}
            {activeUploads.length > 0 && (
              <div className="mt-1 text-xs text-yellow-800 space-x-2">
                {activeUploads.slice(0, 3).map((it) => (
                  <button key={it.id} className="underline" onClick={() => { uploadMgrRef.current?.cancelItem(it.id); }}>
                    {t.actions.cancel} {it.name}
                  </button>
                ))}
                {activeUploads.length > 3 && <span>…</span>}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                uploadMgrRef.current?.cancelAll();
                setIsUploading(false);
                setUploadStats(null);
              }}
            >
              {t.actions.cancelAll}
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <Card>
          <CardHeader>
            <CardTitle>Import URLs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <textarea
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
              rows={6}
              className="w-full border rounded-md p-2 text-sm"
              placeholder="Paste TikTok URLs, one per line"
              disabled={!!uploadStats || authExpired}
            />
            <Button onClick={addUrls} disabled={!urls.trim() || !!uploadStats || authExpired}>
              Add URL Tasks
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Upload Files</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <input type="file" multiple accept="video/*,.mp4,.mov,.webm" onChange={handleFileSelect} disabled={isUploading || authExpired} />
            {pendingFiles.length > 0 && (
              <div className="rounded border p-2 text-sm">
                <div className="mb-2 flex items-center justify-between">
                  <span>{t.upload.pendingTitle.replace('{count}', String(pendingFiles.length))}</span>
                  <div className="space-x-2">
                    <Button size="sm" variant="secondary" disabled={isUploading || authExpired} onClick={() => setPendingFiles([])}>{t.actions.clear}</Button>
                    <Button size="sm" onClick={startUpload} disabled={isUploading || authExpired || pendingFiles.length === 0}>{t.actions.startUpload}</Button>
                  </div>
                </div>
                <ul className="max-h-40 overflow-auto space-y-1">
                  {pendingFiles.map((f) => (
                    <li key={`${f.name}_${f.size}`} className="flex items-center justify-between">
                      <span className="truncate mr-2">{f.name} <span className="text-xs text-gray-500">({(f.size/1024/1024).toFixed(1)} MB)</span></span>
                      <button className="text-xs text-red-600" disabled={isUploading} onClick={() => removePending(f.name, f.size)}>{t.actions.delete}</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {isUploading && <p className="text-sm text-muted-foreground">{t.upload.uploading}</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>{t.tasks.title}</CardTitle>
          <div className="flex items-center gap-2">
            <button
              className={`text-xs rounded-full px-2 py-1 border ${statusFilter === '' ? 'ring-2 ring-offset-1 ring-blue-400' : ''}`}
              onClick={() => setStatusFilter('')}
            >
              {t.tasks.all} {getDisplayTasks(filterTombstones(serverTasks), sortBy, '').length}
            </button>
            <StatusChips counts={aggregateCounts(getDisplayTasks(filterTombstones(serverTasks), sortBy, ''))} active={statusFilter} onSelect={(s) => setStatusFilter(s)} />
            {!editMode && (
              <>
                <Button
                  variant="secondary"
                  onClick={retryFailed}
                  disabled={!getDisplayTasks(filterTombstones(serverTasks), sortBy, statusFilter).some((t) => t.status === 'failed')}
                >
                  {t.actions.retryFailed}
                </Button>
                <Button variant="secondary" onClick={() => exportData('csv')}>{t.actions.exportCSV}</Button>
                <Button variant="secondary" onClick={() => exportData('json')}>{t.actions.exportJSON}</Button>
              </>
            )}
            {editMode ? (
              <>
                <Button
                  variant="destructive"
                  disabled={selectedIds.size === 0}
                  onClick={async () => {
                    if (selectedIds.size === 0) return;
                    if (!batchDeleteConfirm) {
                      setBatchDeleteConfirm(true);
                      setTimeout(() => setBatchDeleteConfirm(false), 3000);
                      return;
                    }
                    const ids = Array.from(selectedIds);
                    const removed: Task[] = [];
                    setServerTasks((prev) => {
                      const map = new Map(prev.map((i) => [i.id, i] as const));
                      ids.forEach((id) => {
                        const it = map.get(id);
                        if (it) removed.push(it);
                        map.delete(id);
                      });
                      return Array.from(map.values());
                    });
                    setSelectedIds(new Set());
                    addTombstones(ids);
                    console.debug('[delete]', { ids, addTombstones: true });
                    setInlineBanner({ kind: 'deleted', count: ids.length });
                    setUndoBuffer(removed);
                    
                    // Use bulk delete API for better performance and idempotency
                    try {
                      const response = await fetchJSON(`${API_BASE}/tasks/bulk-delete`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ids })
                      });
                      console.log('[bulk-delete] result:', response);
                    } catch (e) {
                      console.warn('[bulk-delete] failed, falling back to individual deletes:', e);
                      // Fallback to individual deletes with Promise.allSettled to ignore 404s
                      const deletePromises = ids.map((id) => 
                        fetchJSON(`${API_BASE}/tasks/${id}`, { method: 'DELETE' })
                          .catch((err) => {
                            // Ignore errors (especially 404s) as DELETE should be idempotent
                            console.debug(`[delete] ${id} failed (ignored):`, err);
                            return null;
                          })
                      );
                      await Promise.allSettled(deletePromises);
                    }
                    
                    setTimeout(() => setInlineBanner(null), 5000);
                    replaceNextRefreshRef.current = true;
                    await refresh(true, true);
                    setBatchDeleteConfirm(false);
                  }}
                >
                  {batchDeleteConfirm ? `${t.actions.confirm} (${selectedIds.size})` : `${t.actions.deleteSelected} (${selectedIds.size})`}
                </Button>
                <Button variant="secondary" onClick={() => setEditMode(false)}>{t.actions.done}</Button>
              </>
            ) : (
              <Button variant="secondary" onClick={() => setEditMode(true)}>{t.actions.edit}</Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {initialLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              {!!authExpired && (
                <div className="mb-2 rounded border border-red-200 bg-red-50 text-red-700 px-3 py-2 text-sm flex items-center justify-between">
                  <span>{t.banners.loginExpired}</span>
                  <Button size="sm" variant="secondary" onClick={() => location.reload()}>{t.actions.reloadPage}</Button>
                </div>
              )}
              {!!lastError && (
                <div className="mb-2 rounded border border-yellow-200 bg-yellow-50 text-yellow-800 px-3 py-2 text-xs">
                  {t.banners.syncFailedKeepLocal}
                </div>
              )}
              {getDisplayTasks(filterTombstones(serverTasks), sortBy, statusFilter).length === 0 ? (
                <div className="text-sm text-gray-500">{t.tips.noTasks}</div>
              ) : (
                <>
                  {/* Filter hint when optimistic/running items are hidden by filter */}
                  {statusFilter && !['queued', 'running'].includes(statusFilter) &&
                    getDisplayTasks(filterTombstones(serverTasks), sortBy, '').some(
                      (t) => t.status === 'queued' || t.status === 'running',
                    ) && (
                      <div className="mb-2 text-xs text-gray-600 flex items-center gap-2">
                        <span>{t.tips.filterHidden}</span>
                        <button className="underline" onClick={() => setStatusFilter('')}>{t.actions.clearFilter}</button>
                      </div>
                    )}
                  {/* Sort indicator */}
                  <div className="mb-2 text-xs text-gray-500">{t.header.sort} {sortBy === 'updatedAtDesc' ? t.header.sortUpdated : sortBy === 'createdAtDesc' ? t.header.sortCreated : t.header.sortStatus}</div>
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-left">
                        <th className="p-2">{t.tasks.columns.id}</th>
                        {editMode && (
                          <th className="p-2">
                            <input
                              type="checkbox"
                              onChange={(e) => {
                                const ids = getDisplayTasks(filterTombstones(serverTasks), sortBy, statusFilter)
                                  .map((x) => x.id);
                                const next = new Set(selectedIds);
                                if (e.target.checked) ids.forEach((id) => next.add(id));
                                else ids.forEach((id) => next.delete(id));
                                setSelectedIds(next);
                              }}
                            />
                          </th>
                        )}
                        <th className="p-2">{t.tasks.columns.kind}</th>
                        <th className="p-2">{t.tasks.columns.source}</th>
                        <th className="p-2">{t.tasks.columns.status}</th>
                        <th className="p-2">{t.tasks.columns.progress}</th>
                        <th className="p-2">{t.tasks.columns.updated}</th>
                        {!editMode && <th className="p-2" />}
                    </tr>
                    </thead>
                    <tbody>
                      {getDisplayTasks(filterTombstones(serverTasks), sortBy, statusFilter).map((tRow) => (
                    <tr key={tRow.id} className="border-t hover:bg-muted/40">
                      <td
                        className="p-2 font-mono cursor-pointer"
                        onClick={() => {
                          saveContext();
                          if (!tRow.ephemeral) location.href = `/task/${tRow.id}?batch=${batch.id}`;
                        }}
                      >
                        {tRow.id.slice(0, 8)}
                      </td>
                      {editMode && (
                        <td className="p-2">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(tRow.id)}
                            onChange={(e) => {
                              const next = new Set(selectedIds);
                              if (e.target.checked) next.add(tRow.id);
                              else next.delete(tRow.id);
                              setSelectedIds(next);
                            }}
                          />
                        </td>
                      )}
                      <td className="p-2">{tRow.kind}</td>
                      <td
                        className="p-2 truncate max-w-[260px] cursor-pointer"
                        title={tRow.kind === 'url' ? tRow.payload?.url : tRow.payload?.localPath}
                        onClick={() => {
                          saveContext();
                          if (!tRow.ephemeral) location.href = `/task/${tRow.id}?batch=${batch.id}`;
                        }}
                      >
                        {tRow.kind === 'url' ? tRow.payload?.url : (tRow.payload?.localPath || '').split('/').pop()}
                      </td>
                      <td className="p-2">
                        <span
                          className={`inline-flex items-center gap-1 ${
                            tRow.status === 'success'
                              ? 'text-green-600'
                              : tRow.status === 'failed'
                                ? 'text-red-600'
                                : tRow.status === 'running'
                                  ? 'text-blue-600'
                                  : tRow.status === 'queued'
                                    ? 'text-gray-600'
                                    : 'text-gray-500'
                          }`}
                        >
                          {tRow.status}
                          {tRow.status === 'failed' && !tRow.ephemeral && !editMode && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 px-1 text-xs"
                              onClick={(e) => {
                                e.stopPropagation();
                                retrySingleTask(tRow.id);
                              }}
                            >
                              {t.actions.retry}
                            </Button>
                          )}
                        </span>
                      </td>
                      <td className="p-2 min-w-[120px]">
                        {tRow.status === 'running' ? (
                          <Progress value={tRow.progress ?? 0} />
                        ) : (
                          <span>{tRow.progress ?? 0}%</span>
                        )}
                      </td>
                      <td className="p-2">
                        {tRow.updatedAt ? new Date(tRow.updatedAt).toLocaleTimeString('en-US', { hour12: false }) : ''}
                      </td>
                      {!editMode && (
                        <td className="p-2 text-right">
                          {!tRow.ephemeral && (
                            <DeleteCellButton
                              id={tRow.id}
                              confirmMap={confirmMap}
                              setConfirmMap={setConfirmMap}
                              onDelete={async () => {
                                const removed = serverTasks.find((x) => x.id === tRow.id);
                                if (removed) setUndoBuffer((u) => [...u, removed]);
                                setServerTasks((prev) => prev.filter((x) => x.id !== tRow.id));
                                addTombstones([tRow.id]);
                                console.debug('[delete]', { ids: [tRow.id], addTombstones: true });
                                setInlineBanner({ kind: 'deleted', count: 1 });
                                setTimeout(() => setInlineBanner(null), 5000);
                                // Single delete - idempotent, ignore errors
                                await fetchJSON(`${API_BASE}/tasks/${tRow.id}`, { method: 'DELETE' })
                                  .catch((err) => {
                                    // Ignore errors as DELETE is now idempotent (always returns 204)
                                    console.debug(`[delete] single delete ${tRow.id} error (ignored):`, err);
                                  });
                                replaceNextRefreshRef.current = true;
                                await refresh(true, true);
                              }}
                            />
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                    </tbody>
                  </table>
                  <div className="mt-3 flex justify-center">
                    <Button
                      variant="secondary"
                      onClick={async () => {
                        setLoadingMore(true);
                        setTasksLimit((n) => n + 100);
                        await refresh(true, true);
                        setLoadingMore(false);
                      }}
                    >
                      {loadingMore ? 'Loading…' : 'Load more'}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
