# Daily Cleanup Cron — Archive/Delete Strategy

## Env

- `BATCH_TTL_DAYS` (default 7)
- `BATCH_KEEP_RECENT` (default 20) — keep most recent active batches regardless of TTL

## Rules

1) Delete empty batches
- No tasks AND `created_at < now - 24h`
- Double-check no tasks in a transaction before delete.

2) Archive expired batches
- `archived=false`
- No running tasks AND `created_at < now - BATCH_TTL_DAYS`
- Set `archived=true`, `archived_at=now`
- Never archive batches with running tasks.
- Always keep last `BATCH_KEEP_RECENT` active batches.

## Logging

- Counts: archived, deleted
- Examples: up to 10 batch ids per action
- Top sources/creators (group by `source`, `created_by`)

## Purge (hard delete) — later phase

- Endpoint: `DELETE /batches/:id?purge=1`
- Transactionally delete DB rows (tasks first, then batch) and FS directories
- On failure: write tombstone record
  - Fields: `batch_id`, `deleted_at`, `path`, `node`, `reason`, `purge_id`, `attempts`
- Retry purges with backoff

