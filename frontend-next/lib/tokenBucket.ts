// Lightweight client-side token bucket for mutation (POST/PUT/DELETE) rate limiting
// Defaults: RPM=5 -> ~1 mutation per 12s on average

const RPM = Number(process.env.NEXT_PUBLIC_MUTATION_RPM ?? 5) || 5;
const REFILL_MS = 60_000;

type MutationFn<T> = () => Promise<T>;

let tokens = Math.max(0, RPM - 1); // initial burst protection: hold back one token
let queue: Array<() => void> = [];
let stats = {
  enqueued: 0,
  served: 0,
  retried: 0,
  rateLimited: 0,
  dropped: 0,
  lastRefillAt: Date.now(),
};

function drain() {
  while (tokens > 0 && queue.length) {
    tokens--;
    const fn = queue.shift()!;
    console.debug('[mut] dequeue', { tokens, queued: queue.length });
    fn();
  }
}

setInterval(() => {
  tokens = RPM;
  stats.lastRefillAt = Date.now();
  console.debug('[mut] refill', { tokens, queued: queue.length, rpm: RPM });
  drain();
}, REFILL_MS);

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function shouldRetry(e: any): boolean {
  const status = e?.status || e?.code;
  if (typeof status === 'number') {
    return status === 429 || status === 503 || (status >= 500 && status < 600);
  }
  // ApiClient NETWORK_ERROR, timeouts, generic network failure
  const code = String(status || '').toUpperCase();
  return code.includes('NETWORK') || code.includes('TIMEOUT');
}

const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 10000];

async function attemptWithRetry<T>(fn: MutationFn<T>): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < BACKOFF_MS.length; i++) {
    try {
      const out = await fn();
      return out;
    } catch (e: any) {
      lastErr = e;
      if (!shouldRetry(e)) break;
      stats.retried++;
      console.debug('[mut] retry', { attempt: i + 1, waitMs: BACKOFF_MS[i], reason: e?.status || e?.code || e?.message });
      await delay(BACKOFF_MS[i]);
    }
  }
  stats.dropped++;
  console.debug('[mut] drop', { reason: lastErr?.status || lastErr?.code || lastErr?.message });
  throw lastErr;
}

export async function scheduleMutation<T>(fn: MutationFn<T>): Promise<T> {
  stats.enqueued++;
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      attemptWithRetry(fn)
        .then((res) => {
          stats.served++;
          resolve(res);
        })
        .catch(reject);
    };
    if (tokens > 0) {
      tokens--;
      console.debug('[mut] serve-immediate', { tokens, queued: queue.length });
      run();
    } else {
      stats.rateLimited++;
      queue.push(run);
      console.debug('[mut] enqueue', { queued: queue.length });
    }
  });
}

export function getMutationStats() {
  return {
    ...stats,
    queued: queue.length,
    tokens,
    rpm: RPM,
    refillMs: REFILL_MS,
  };
}

