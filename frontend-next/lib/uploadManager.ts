import { fetchJSON, ApiError } from '@/lib/apiClient';

export type UploadItem = {
  id: string; // local id, 建议使用 clientToken
  file: File;
  batchId?: string;
  clientToken?: string;
};

export type UploadResult = {
  id: string; // local id
  ok: boolean;
  error?: ApiError | { code: string; message: string };
};

export type UploadEvents = {
  onStart?: (total: number) => void;
  onUpdate?: (active: number, queued: number, done: number) => void;
  onQueueChange?: (meta: { active: number; queued: number; done: number; total: number }) => void;
  onItemStart?: (item: UploadItem) => void;
  onItemComplete?: (item: UploadItem, ok: boolean, error?: ApiError) => void;
  onComplete?: (summary: { total: number; succeeded: number; failed: number; results: UploadResult[] }) => void;
};

type InternalItem = UploadItem & {
  attempt: number;
};

export class UploadManager {
  private queue: InternalItem[] = [];
  private active = new Map<string, AbortController>();
  private results: UploadResult[] = [];
  private running = false;
  private stopped = false;
  private readonly concurrency: number;
  private readonly backoffSchedule = [2000, 4000, 8000];
  private readonly events: UploadEvents;
  private readonly uploadUrl: string;

  constructor(params: { url: string; concurrency?: number; events?: UploadEvents }) {
    this.uploadUrl = params.url;
    this.concurrency = Math.max(1, Math.min(5, params.concurrency || 3));
    this.events = params.events || {};
  }

  get isRunning() {
    return this.running;
  }

  get counts() {
    return {
      active: this.active.size,
      queued: this.queue.length,
      done: this.results.length,
    };
  }

  enqueue(items: UploadItem[] | UploadItem) {
    const arr = Array.isArray(items) ? items : [items];
    const withMeta: InternalItem[] = arr.map((it) => ({ ...it, attempt: 0 }));
    this.queue.push(...withMeta);
    this.emitQueueChange();
    return withMeta.map((i) => i.id);
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.stopped = false;
    this.events.onStart?.(this.queue.length + this.active.size);
    this.tick();
  }

  cancelAll() {
    this.stopped = true;
    for (const ctl of this.active.values()) ctl.abort();
    this.active.clear();
    // Clear queue
    this.queue = [];
    this.update();
  }

  cancelItem(id: string) {
    // queued → 直接移除
    const idx = this.queue.findIndex((q) => q.id === id);
    if (idx >= 0) {
      this.queue.splice(idx, 1);
      this.emitQueueChange();
      this.update();
      return true;
    }
    // active → abort
    const ctl = this.active.get(id);
    if (ctl) {
      ctl.abort();
      this.active.delete(id);
      this.emitQueueChange();
      this.update();
      return true;
    }
    return false;
  }

  private update() {
    this.events.onUpdate?.(this.active.size, this.queue.length, this.results.length);
    this.emitQueueChange();
  }

  private emitQueueChange() {
    const meta = { active: this.active.size, queued: this.queue.length, done: this.results.length, total: this.active.size + this.queue.length + this.results.length };
    this.events.onQueueChange?.(meta);
  }

  private async tick() {
    while (this.running && !this.stopped) {
      while (this.active.size < this.concurrency && this.queue.length > 0) {
        const item = this.queue.shift()!;
        this.runItem(item);
      }
      if (this.active.size === 0 && this.queue.length === 0) {
        this.running = false;
        const total = this.results.length;
        const succeeded = this.results.filter((r) => r.ok).length;
        const failed = total - succeeded;
        this.events.onComplete?.({ total, succeeded, failed, results: this.results.slice() });
        return;
      }
      this.update();
      await sleep(100);
    }
  }

  private async runItem(item: InternalItem) {
    const ctl = new AbortController();
    this.active.set(item.id, ctl);
    this.update();
    try {
      this.events.onItemStart?.(item);
      const ok = await this.tryUploadItem(item, ctl.signal);
      this.results.push({ id: item.id, ok });
      this.events.onItemComplete?.(item, true);
    } catch (e: any) {
      const error = (e && (e as any)) || { code: 'UNKNOWN', message: '未知错误' };
      this.results.push({ id: item.id, ok: false, error });
      this.events.onItemComplete?.(item, false, error as ApiError);
    } finally {
      this.active.delete(item.id);
      this.update();
    }
  }

  private async tryUploadItem(item: InternalItem, signal: AbortSignal) {
    for (let attempt = 0; attempt <= this.backoffSchedule.length; attempt++) {
      try {
        const fd = new FormData();
        fd.append('files', item.file);
        if (item.clientToken) fd.append('clientToken', item.clientToken);
        await fetchJSON(this.uploadUrl, { method: 'POST', body: fd, timeoutMs: 60000, retries: 0, signal });
        return true;
      } catch (e: any) {
        const aborted = signal.aborted || e?.code === 'ABORTED';
        if (aborted) throw e;
        if (attempt < this.backoffSchedule.length) {
          await sleep(this.backoffSchedule[attempt]);
          continue;
        }
        throw e;
      }
    }
    return false;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
