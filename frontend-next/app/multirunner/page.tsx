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

// Unified task key - MUST use this everywhere for React keys, Map keys, deduplication, everything
const taskKey = (t: Task) => t.remoteId ?? t.id ?? t.tempId;

// Cookie utilities
function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(';').shift() || null;
  return null;
}

function writeCookie(name: string, value: string, days: number = 365): void {
  if (typeof document === 'undefined') return;
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `${name}=${value}; expires=${expires}; path=/; SameSite=Lax`;
}

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
  tempId?: string;
  remoteId?: string;
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

export default function MultirunnerPage() {
  return (
    <ToastProvider>
      <MultirunnerPageInner />
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
  const reasons: string[] = [];
  const valid: File[] = [];
  const maxBytes = MAX_FILE_SIZE_MB * 1024 * 1024;
  for (const f of files) {
    const isVideo = ACCEPT_VIDEO.some((t) => f.type.startsWith('video/') || f.name.toLowerCase().endsWith(t));
    if (!isVideo) {
      reasons.push(t.validation.nonVideo(f.name));
      continue;
    }
    if (f.size > maxBytes) {
      reasons.push(t.validation.tooLarge(f.name, MAX_FILE_SIZE_MB));
      continue;
    }
    // Allow duplicates - don't check for seen files
    valid.push(f);
  }
  return { valid, rejected: files.length - valid.length, reasons };
}

function mergeTasksById(local: Task[], server: Task[]): Task[] {
  const map = new Map<string, Task>();
  
  // Build map with taskKey
  for (const t of local) {
    const key = taskKey(t);
    map.set(key, t);
    console.debug('[mr] merge local key=%s id=%s remoteId=%s', key, t.id, t.remoteId);
  }
  
  // Merge server data
  for (const s of server) {
    const key = taskKey(s);
    const existing = map.get(key);
    
    if (existing) {
      // Preserve running status and progress
      if (existing.status === 'running' && s.status === 'queued') {
        // Keep local running state
        map.set(key, { ...s, status: existing.status, progress: existing.progress });
      } else {
        // Update with server data
        map.set(key, { ...existing, ...s });
      }
    } else {
      map.set(key, s);
    }
  }
  
  // Return sorted by updatedAt
  const result = Array.from(map.values()).sort((a, b) => 
    new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
  );
  console.debug('[mr] mergeTasksById result count=%d', result.length);
  return result;
}

function aggregateCounts(list: Task[]) {
  const counts: Record<string, number> = { queued: 0, running: 0, success: 0, failed: 0, canceled: 0 };
  for (const t of list) counts[t.status] = (counts[t.status] || 0) + 1;
  return counts;
}

function mergeDisplayTasksById(existing: Task[], incoming: Task[]): Task[] {
  const map = new Map<string, Task>();
  
  for (const it of existing) {
    const key = taskKey(it);
    map.set(key, it);
    console.debug('[mr] mergeDisplay existing key=%s id=%s remoteId=%s', key, it.id, it.remoteId);
  }
  for (const it of incoming) {
    const key = taskKey(it);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, it);
      console.debug('[mr] mergeDisplay new key=%s id=%s remoteId=%s', key, it.id, it.remoteId);
    } else {
      const prevTs = new Date(prev.updatedAt || 0).getTime();
      const curTs = new Date(it.updatedAt || 0).getTime();
      map.set(key, curTs >= prevTs ? it : prev);
      console.debug('[mr] mergeDisplay update key=%s id=%s remoteId=%s', key, it.id, it.remoteId);
    }
  }
  const result = Array.from(map.values());
  console.debug('[mr] mergeDisplayTasksById result count=%d', result.length);
  return result;
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

function MultirunnerPageInner() {
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
  const [batchInitialLoading, setBatchInitialLoading] = useState(true);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [forceFull, setForceFull] = useState(false);
  const [lastCreateTime, setLastCreateTime] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [tasksLimit, setTasksLimit] = useState<number>(100);
  const [loadingMore, setLoadingMore] = useState(false);
  const uploadMgrRef = useRef<UploadManager | null>(null);
  const [uploadStats, setUploadStats] = useState<{ active: number; queued: number; done: number; total: number } | null>(null);
  const [activeUploads, setActiveUploads] = useState<Array<{ id: string; name: string }>>([]);
  const [sortBy, setSortBy] = useState<'updatedAtDesc' | 'createdAtDesc' | 'status'>('updatedAtDesc');
  const refreshThrottleRef = useRef<NodeJS.Timeout | null>(null);
  const [authExpired, setAuthExpired] = useState(false);
  const [isAddingUrls, setIsAddingUrls] = useState(false);
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
  const [showResetButton, setShowResetButton] = useState(false);

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

  // Persistent batch management
  const ensurePersistentBatch = useCallback(async (): Promise<Batch | null> => {
    try {
      // Check localStorage first
      let batchId = localStorage.getItem('taskRunnerBatchId');
      
      // Fallback to cookie
      if (!batchId) {
        batchId = readCookie('taskRunnerBatchId');
      }
      
      // Validate existing batch
      if (batchId) {
        try {
          const existingBatch = await fetchJSON(`${API_BASE}/batches/${batchId}`, { 
            retries: 1, 
            backoffMs: 500 
          });
          if (existingBatch && existingBatch.id) {
            // Store in both places
            localStorage.setItem('taskRunnerBatchId', batchId);
            writeCookie('taskRunnerBatchId', batchId, 365);
            return existingBatch;
          }
        } catch (e) {
          console.warn('[batch] existing batch validation failed:', e);
        }
      }
      
      // Create new batch
      const newBatch = await fetchJSON(`${API_BASE}/batches`, {
        method: 'POST',
        body: { 
          title: 'Multirunner ' + new Date().toLocaleString(), 
          createdBy: getUserKey(), 
          source: 'multirunner_page' 
        },
      });
      
      if (newBatch && newBatch.id) {
        // Store in both places
        localStorage.setItem('taskRunnerBatchId', newBatch.id);
        writeCookie('taskRunnerBatchId', newBatch.id, 365);
        return newBatch;
      }
      
      return null;
    } catch (e) {
      console.error('[batch] ensurePersistentBatch failed:', e);
      return null;
    }
  }, [getUserKey]);

  const resetMultirunner = useCallback(async () => {
    try {
      // Clear stored batch ID
      localStorage.removeItem('taskRunnerBatchId');
      writeCookie('taskRunnerBatchId', '', -1); // Delete cookie
      
      // Create new batch
      const newBatch = await ensurePersistentBatch();
      if (newBatch) {
        setBatch(newBatch);
        setServerTasks([]);
        setInitialLoading(true);
        toast({ variant: 'success', title: 'Multirunner reset', description: 'Created new multirunner session' });
      }
    } catch (e) {
      console.error('[batch] reset failed:', e);
      toast({ variant: 'destructive', title: 'Reset failed', description: 'Could not reset multirunner' });
    }
  }, [ensurePersistentBatch, toast]);

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
        const key = taskKey(t);
        const exp = tombstonesRef.current.get(key);
        return !exp || exp <= Date.now();
      }),
    [tombstoneVer],
  );


  const getLastBatchKey = useCallback(() => {
    const uk = getUserKey();
    return `taskRunnerBatchId:${uk}`;
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

  // Initial load: ensure persistent batch
  useEffect(() => {
    (async () => {
      setBatchInitialLoading(true);
      try {
        const persistentBatch = await ensurePersistentBatch();
        if (persistentBatch) {
          setBatch(persistentBatch);
          restoreContext();
        } else {
          console.error('[batch] Could not create or find persistent batch');
        }
      } catch (e) {
        console.error('[batch] Initial batch setup failed:', e);
      } finally {
        setBatchInitialLoading(false);
      }
    })();
  }, [ensurePersistentBatch, restoreContext]);

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
        url.searchParams.set('limit', '100');
        
        // Force full polling based on flags
        const shouldForceFull = forceFull || (Date.now() - lastCreateTime < 10000);
        if (!shouldForceFull && lastSyncedAt) {
          url.searchParams.set('updatedSince', lastSyncedAt.toISOString());
        }
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
          console.debug('[mr] listTasks -> items=%d total=%d sampleIds=%o',
            json.items?.length || json.tasks?.length, json.total,
            (json.items || json.tasks)?.slice(0,5).map(x => ({id:x.id, remoteId:x.remoteId, url:x.url, file:x.fileName, status:x.status}))
          );
          console.debug('[mr] before-merge local=%d server=%d', serverTasks.length, incoming.length);
          if (replaceNextRefreshRef.current) {
            setServerTasks(incoming);
            replaceNextRefreshRef.current = false;
          } else {
            setServerTasks((prev) => {
              const merged = mergeTasksById(prev, incoming);
              console.debug('[mr] after merge count=%d', merged.length, merged.map(t=>taskKey(t)));
              return merged;
            });
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
        if (!hasError) {
          setLastSyncedAt(new Date());
          setForceFull(false);
        }
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
    const list = ev.currentTarget.files; // Get files BEFORE resetting
    ev.currentTarget.value = ''; // Reset input to allow re-selecting same files
    if (!list || list.length === 0) return;
    const files = Array.from(list);
    // Allow duplicates - don't filter based on existing files
    const { valid, rejected, reasons } = validateAndDedupFiles(files);
    if (rejected > 0) {
      const msg = reasons.join('; ').slice(0, 200);
      toast({ variant: 'warning', title: t.validation.filteredTitle, description: msg });
    }
    // Allow duplicates - add all valid files
    if (valid.length > 0) {
      console.debug('[mr] select files:', valid.length);
      setPendingFiles((prev) => [...prev, ...valid]);
    }
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

  // Start upload with optimistic tasks - Show All N Items Immediately
  const startUpload = async () => {
    if (!batch || pendingFiles.length === 0) return;
    console.debug('[upload]', { batchIdUsed: batch.id, files: pendingFiles.length });
    setIsUploading(true);
    const url = `${API_BASE}/batches/${batch.id}/tasks/upload`;
    
    // Create optimistic tasks first
    const optimisticTasks = pendingFiles.map((file) => {
      const tempId = crypto.randomUUID();
      const clientToken = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      console.debug('[mr] CREATE local temp', tempId, file.name);
      return {
        id: tempId,
        tempId: tempId,
        batchId: batch.id,
        kind: 'file' as const,
        payload: { localPath: file.name },
        status: 'running', // Files start as running
        progress: 0,
        ephemeral: true,
        clientToken,
        updatedAt: new Date().toISOString()
      };
    });
    
    console.debug('[mr] optimistic add:', optimisticTasks.map(t => t.tempId));
    
    // Add optimistic tasks to UI immediately
    setServerTasks((prev) => [...prev, ...optimisticTasks]);
    setLastCreateTime(Date.now());
    
    const items = pendingFiles.map((file, index) => {
      const optimisticTask = optimisticTasks[index];
      return { id: optimisticTask.clientToken!, file, clientToken: optimisticTask.clientToken!, tempId: optimisticTask.tempId };
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
          console.debug('[mr] upload complete: succeeded=%d failed=%d', succeeded, failed);
          // Single force refresh after all uploads complete
          setForceFull(true);
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
    if (isAddingUrls) return; // prevent double submit
    const raw = urls
      .split(/\n|\r/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (raw.length === 0) return;
    // Allow duplicates - don't dedupe URLs
    const newOnes = raw.map(normalizeUrl).filter(u => u);
    if (newOnes.length === 0) {
      toast({ variant: 'warning', title: t.validation.noNewLinks });
      return;
    }
    
    // Create optimistic URL tasks with tempId
    const optimisticTasks = newOnes.map((url) => {
      const tempId = crypto.randomUUID();
      console.debug('[mr] CREATE local temp', tempId, url);
      return {
        id: tempId,
        tempId,
        batchId: batch.id,
        kind: 'url' as const,
        payload: { url },
        status: 'queued', // URLs start as queued
        progress: 0,
        ephemeral: true,
        updatedAt: new Date().toISOString()
      };
    });
    
    console.debug('[mr] optimistic add:', optimisticTasks.map(t => t.tempId));
    
    // Add optimistic tasks to UI immediately
    setServerTasks((prev) => [...prev, ...optimisticTasks]);
    setLastCreateTime(Date.now());
    
    try {
      setIsAddingUrls(true);
      const created = await fetchJSON(`${API_BASE}/batches/${batch.id}/tasks/url`, {
        method: 'POST',
        body: { urls: newOnes },
        retries: 1,
        backoffMs: 500,
      });
      console.debug('[mr] server created:', created?.created || created);
      setUrls('');
      // success: low-noise
      // toast({ variant: 'success', title: 'Added', description: t.validation.addedUrls(newOnes.length) });
    } catch (e: any) {
      // Remove optimistic tasks on error
      setServerTasks((prev) => prev.filter((t) => !optimisticTasks.some((ot) => ot.tempId === t.tempId)));
      toast({ variant: 'destructive', title: t.validation.addFailed, description: e?.message || 'Please try again later' });
    } finally {
      setIsAddingUrls(false);
    }
    setForceFull(true);
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


  // Removed createBatch and selectBatch functions - no longer needed

  // Show skeleton while loading batch, never show empty state
  if (batchLoading || batchInitialLoading || !batch) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="mb-6">
          <Skeleton className="h-8 w-48 mb-2" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="h-80">
            <Skeleton className="h-full w-full" />
          </div>
          <div className="h-80">
            <Skeleton className="h-full w-full" />
          </div>
        </div>
        <div className="space-y-4">
          <Skeleton className="h-12 w-full" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Multirunner</h1>
          <p className="text-sm text-muted-foreground">
            Multirunner ID: {batch.id} · Created: {new Date(batch.createdAt).toLocaleString()}
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
          {/* Hidden reset feature - triple click to show */}
          <div 
            onClick={(e) => {
              if (e.detail === 3) {
                setShowResetButton(true);
                setTimeout(() => setShowResetButton(false), 10000);
              }
            }}
            className="w-2 h-2 cursor-pointer"
          />
          {showResetButton && (
            <Button 
              variant="destructive" 
              size="sm"
              onClick={resetMultirunner}
            >
              Reset Multirunner
            </Button>
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

      <div className="grid grid-cols-2 gap-6 mb-8">
        {/* URLs */}
        <div className="min-h-[160px] border rounded-xl p-4">
          <h3 className="font-medium mb-3">Import from URLs</h3>
          <textarea
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            rows={4}
            className="h-[120px] w-full border rounded-md p-2 text-sm resize-none"
            placeholder="Paste TikTok URLs, one per line"
            disabled={!!uploadStats || authExpired}
          />
          <button 
            type="button" 
            onClick={addUrls} 
            disabled={!urls.trim() || !!uploadStats || authExpired || isAddingUrls}
            className="mt-3 w-full bg-blue-600 text-white px-4 py-2 rounded-md text-sm hover:bg-blue-700 disabled:bg-gray-300"
          >
            Add URL Tasks
          </button>
        </div>

        {/* Files - Text Dropzone */}
        <label className="min-h-[160px] border-2 border-dashed rounded-xl p-4
                         flex flex-col items-center justify-center text-slate-500
                         hover:bg-slate-50 cursor-pointer relative">
          <div className="text-center">
            <div className="text-base mb-2">Drop files here or click to browse</div>
            <div className="text-xs">Accepts video files</div>
          </div>
          <input 
            id="filePicker"
            type="file" 
            multiple 
            accept="video/*,.mp4,.mov,.webm" 
            onChange={handleFileSelect} 
            disabled={isUploading || authExpired}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
          
          {pendingFiles.length > 0 && (
            <div className="absolute bottom-2 left-2 right-2 bg-white border rounded p-2 text-xs pointer-events-none">
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium">{pendingFiles.length} files pending</span>
                <div className="space-x-1 pointer-events-auto">
                  <button 
                    type="button"
                    className="text-gray-500 hover:text-gray-700"
                    disabled={isUploading || authExpired} 
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPendingFiles([]); }}
                  >
                    Clear
                  </button>
                  <button 
                    type="button"
                    className="bg-blue-600 text-white px-2 py-1 rounded text-xs hover:bg-blue-700"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); startUpload(); }} 
                    disabled={isUploading || authExpired || pendingFiles.length === 0}
                  >
                    Upload
                  </button>
                </div>
              </div>
              <div className="max-h-16 overflow-auto text-xs text-gray-600">
                {pendingFiles.slice(0, 3).map((f) => (
                  <div key={`${f.name}_${f.size}`}>{f.name}</div>
                ))}
                {pendingFiles.length > 3 && <div>...and {pendingFiles.length - 3} more</div>}
              </div>
            </div>
          )}
          
          {isUploading && (
            <div className="absolute bottom-2 left-2 right-2 bg-yellow-50 border border-yellow-200 rounded p-2 text-xs text-yellow-800">
              Uploading files...
            </div>
          )}
        </label>
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>{t.tasks.title}</CardTitle>
          <div className="flex items-center gap-2">
            {/* Status chips: queued | running | success | failed | canceled */}
            <button
              className={`text-xs rounded-full px-2 py-1 border ${statusFilter === '' ? 'bg-blue-100 border-blue-300' : 'border-gray-300'}`}
              onClick={() => setStatusFilter('')}
            >
              All {getDisplayTasks(filterTombstones(serverTasks), sortBy, '').length}
            </button>
            <StatusChips counts={aggregateCounts(getDisplayTasks(filterTombstones(serverTasks), sortBy, ''))} active={statusFilter} onSelect={(s) => setStatusFilter(s)} />
            
            {/* Sort dropdown - hide in edit mode */}
            {!editMode && (
              <select
                className="border rounded px-2 py-1 text-sm"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
              >
                <option value="updatedAtDesc">{t.header.sortUpdated}</option>
                <option value="status">{t.header.sortStatus}</option>
                <option value="createdAtDesc">{t.header.sortCreated}</option>
              </select>
            )}
            
            {/* Search input - hide in edit mode */}
            {!editMode && (
              <input
                type="text"
                placeholder="Search tasks..."
                className="border rounded px-2 py-1 text-sm w-32"
                value={batchSearch}
                onChange={(e) => setBatchSearch(e.target.value)}
              />
            )}
            
            {/* Clear button - hide in edit mode */}
            {!editMode && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setStatusFilter('');
                  setBatchSearch('');
                }}
              >
                Clear
              </Button>
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
                    const tombstoneKeys: string[] = [];
                    setServerTasks((prev) => {
                      const map = new Map(prev.map((i) => [i.id, i] as const));
                      ids.forEach((id) => {
                        const it = map.get(id);
                        if (it) {
                          removed.push(it);
                          tombstoneKeys.push(taskKey(it));
                        }
                        map.delete(id);
                      });
                      return Array.from(map.values());
                    });
                    setSelectedIds(new Set());
                    addTombstones(tombstoneKeys);
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
                  {batchDeleteConfirm ? `Confirm (${selectedIds.size})` : `Delete Selected (${selectedIds.size})`}
                </Button>
                <Button variant="secondary" onClick={() => setEditMode(false)}>Done</Button>
              </>
            ) : (
              <Button variant="secondary" onClick={() => setEditMode(true)}>Edit</Button>
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
                        <th className="p-2">Title/URL</th>
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
                        <th className="p-2">Status</th>
                        <th className="p-2">Progress</th>
                        <th className="p-2">Updated</th>
                        <th className="p-2">Source</th>
                        {!editMode && <th className="p-2">Actions</th>}
                    </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const visibleRows = getDisplayTasks(filterTombstones(serverTasks), sortBy, statusFilter);
                        console.debug('[mr] render keys', visibleRows.map(r => taskKey(r)));
                        return visibleRows.map((tRow) => (
                    <tr key={taskKey(tRow)} className="border-t hover:bg-muted/40">
                      <td className="p-2 truncate max-w-[260px]">
                        {tRow.status === 'success' ? (
                          <button
                            className="text-left underline cursor-pointer"
                            onClick={() => {
                              saveContext();
                              if (!tRow.ephemeral) location.href = `/task/${tRow.id}?batch=${batch.id}`;
                            }}
                            title={tRow.kind === 'url' ? tRow.payload?.url : tRow.payload?.localPath}
                          >
                            {tRow.kind === 'url' ? tRow.payload?.url : (tRow.payload?.localPath || '').split('/').pop()}
                          </button>
                        ) : (
                          <span
                            title={tRow.kind === 'url' ? tRow.payload?.url : tRow.payload?.localPath}
                          >
                            {tRow.kind === 'url' ? tRow.payload?.url : (tRow.payload?.localPath || '').split('/').pop()}
                          </span>
                        )}
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
                      <td className="p-2">
                        <span
                          className={`inline-flex items-center px-2 py-1 rounded-full text-xs ${
                            tRow.status === 'success'
                              ? 'bg-green-100 text-green-800'
                              : tRow.status === 'failed'
                                ? 'bg-red-100 text-red-800'
                                : tRow.status === 'running'
                                  ? 'bg-blue-100 text-blue-800'
                                  : tRow.status === 'queued'
                                    ? 'bg-gray-100 text-gray-800'
                                    : 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          {tRow.status}
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
                      <td className="p-2">{tRow.kind}</td>
                      {!editMode && (
                        <td className="p-2 text-right">
                          <div className="flex items-center gap-2 justify-end">
                            {tRow.status === 'failed' && !tRow.ephemeral && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-xs"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  retrySingleTask(tRow.id);
                                }}
                              >
                                Retry
                              </Button>
                            )}
                            {tRow.status === 'running' && !tRow.ephemeral && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-xs"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // Cancel task logic would go here
                                }}
                              >
                                Cancel
                              </Button>
                            )}
                            {!tRow.ephemeral && (
                              <DeleteCellButton
                                id={tRow.id}
                                confirmMap={confirmMap}
                                setConfirmMap={setConfirmMap}
                                onDelete={async () => {
                                  const removed = serverTasks.find((x) => x.id === tRow.id);
                                  if (removed) setUndoBuffer((u) => [...u, removed]);
                                  setServerTasks((prev) => prev.filter((x) => x.id !== tRow.id));
                                  addTombstones([taskKey(tRow)]);
                                  console.debug('[delete]', { ids: [tRow.id], addTombstones: true });
                                  setInlineBanner({ kind: 'deleted', count: 1 });
                                  setTimeout(() => setInlineBanner(null), 5000);
                                  // Single delete - idempotent, ignore errors
                                  await fetchJSON(`${API_BASE}/tasks/${tRow.id}`, { method: 'DELETE' })
                                    .catch((err) => {
                                      // Ignore errors as DELETE is now idempotent (always returns 204)
                                      console.debug(`[delete] single delete ${tRow.id} error (ignored):`, err);
                                      return null;
                                    });
                                  replaceNextRefreshRef.current = true;
                                  await refresh(true, true);
                                }}
                              />
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ));
                        })()}
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
