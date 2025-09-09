export type ApiError = {
  code: string;
  message: string;
  hint?: string;
  status?: number;
  cause?: unknown;
};

export type FetchJSONOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: any;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number; // total attempts = retries + 1
  backoffMs?: number; // base backoff in ms (exponential)
  signal?: AbortSignal;
  credentials?: RequestCredentials; // 'include', 'same-origin', 'omit'
};

const DEFAULTS = {
  timeoutMs: 15000,
  retries: 1,
  backoffMs: 1000,
};

export async function fetchJSON<T = any>(url: string, opts: FetchJSONOptions = {}): Promise<T> {
  const {
    method = 'GET',
    body,
    headers = {},
    timeoutMs = DEFAULTS.timeoutMs,
    retries = DEFAULTS.retries,
    backoffMs = DEFAULTS.backoffMs,
    signal,
    credentials,
  } = opts;

  let attempt = 0;
  let lastErr: ApiError | undefined;

  while (attempt <= retries) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('Request timeout')), timeoutMs);
    const merged = mergeSignals(controller.signal, signal);
    try {
      const resp = await fetch(url, {
        method,
        headers: {
          ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: body && !(body instanceof FormData) ? JSON.stringify(body) : body,
        signal: merged,
        ...(credentials && { credentials }),
      });
      clearTimeout(timeout);
      if (!resp.ok) {
        const text = await safeText(resp);
        const err: ApiError = mapHttpError(resp.status, extractMessage(text));
        if (shouldRetry(resp.status) && attempt < retries) {
          await backoff(attempt, backoffMs);
          attempt++;
          lastErr = err;
          continue;
        }
        throw err;
      }
      if (resp.status === 204) return undefined as unknown as T;
      const json = (await resp.json()) as T;
      return json;
    } catch (e: any) {
      clearTimeout(timeout);
      const isAbort = e?.name === 'AbortError' || e?.message?.includes?.('aborted') || e?.message?.includes?.('timeout');
      const err: ApiError = {
        code: isAbort ? 'ABORTED' : 'NETWORK_ERROR',
        message: isAbort ? '请求已取消或超时' : '网络错误，请重试',
        hint: isAbort ? '请检查网络或稍后重试' : undefined,
        cause: e,
      };
      if (!isAbort && attempt < retries) {
        await backoff(attempt, backoffMs);
        attempt++;
        lastErr = err;
        continue;
      }
      throw lastErr || err;
    }
  }
  // Should never hit
  throw lastErr || { code: 'UNKNOWN', message: '未知错误' };
}

function shouldRetry(status?: number) {
  if (!status) return true;
  // Retry on 408/429/5xx
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

function suggestHint(status?: number) {
  if (!status) return undefined;
  if (status === 429) return '请求过于频繁，请稍后再试';
  if (status === 503) return '服务暂不可用，稍后重试';
  return undefined;
}

function mapHttpError(status: number, msg?: string): ApiError {
  if (status === 401 || status === 419) {
    return { code: 'AUTH_EXPIRED', message: '登录已过期，请重新登录', status };
  }
  if (status === 429) {
    return { code: 'BUSY', message: msg || '服务繁忙，请稍后重试', status, hint: suggestHint(status) };
  }
  if (status >= 500 && status < 600) {
    return { code: 'SERVER_ERROR', message: msg || `服务器错误（${status}）`, status, hint: suggestHint(status) };
  }
  return { code: 'HTTP_' + status, message: msg || `请求失败（${status}）`, status, hint: suggestHint(status) };
}

async function safeText(resp: Response) {
  try {
    return await resp.text();
  } catch {
    return '';
  }
}

function extractMessage(text: string) {
  try {
    const j = JSON.parse(text);
    return j?.message || j?.error || undefined;
  } catch {
    return text?.slice?.(0, 200);
  }
}

async function backoff(attempt: number, base: number) {
  const delay = Math.max(0, Math.round(base * Math.pow(2, attempt))); // 1x, 2x, 4x ...
  await new Promise((r) => setTimeout(r, delay));
}

function mergeSignals(a: AbortSignal, b?: AbortSignal): AbortSignal {
  if (!b) return a;
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  if (a.aborted || b.aborted) {
    ctl.abort();
    return ctl.signal;
  }
  a.addEventListener('abort', onAbort);
  b.addEventListener('abort', onAbort);
  return ctl.signal;
}
