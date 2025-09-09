// Task Runner configuration constants

// API configuration
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '/api';
export const RENDER_BASE_URL = process.env.NEXT_PUBLIC_RENDER_BASE_URL ?? API_BASE;

// File upload configuration
export const BIG_FILE_THRESHOLD_BYTES = 80 * 1024 * 1024; // 80MB
export const XHR_TIMEOUT_MS = 600000; // 10 minutes

// Concurrency configuration
export const DEFAULT_CONCURRENCY = 2;
export const CONCURRENCY_OPTIONS = [2, 5, 10] as const;

// Retry configuration
export const RETRY_DELAYS_MS = [2000, 4000, 8000]; // 2s, 4s, 8s
export const MAX_RETRIES = 3;
export const JITTER_PERCENT = 0.2; // ±20% jitter

// Export configuration
export const EXPORT_SIZE_LIMIT_BYTES = 15 * 1024 * 1024; // 15MB
export const EXPORT_PER_ITEM_MAX = 50;

// Polling configuration
export const POLL_INTERVAL_MS = 5000; // 5 seconds

// Error codes that should NOT be retried
export const NO_RETRY_ERROR_CODES = [400, 401, 403, 404, 413, 415, 422];