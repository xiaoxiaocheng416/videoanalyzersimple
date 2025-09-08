# P1 — Batches API (Pagination/Search/Filters/Sort/Total)

## Endpoint

GET /batches

## Query Params

- limit: int (1..100), default 20
- offset: int (>=0), default 0
- status: string, default `active`
  - `active`: `archived=false AND (running>0 OR queued>0 OR ((success+failed)>0 AND updated_at >= now - days))`
  - `all`: no additional status filter (still respect `archived` param)
- archived: boolean, default `false`
- days: int (>=1), default 7 (window for `active`)
- search: string, default ''
  - matches `title` or `id` (only). Searching `created_by`/`source` can be added later via explicit params.
- sort: enum, default `updatedAt_desc`
  - `updatedAt_desc|updatedAt_asc|createdAt_desc|createdAt_asc`

## Response

```json
{
  "items": [
    {
      "id": "...",
      "title": "...",
      "archived": false,
      "createdAt": "2024-09-07T12:34:56.000Z",
      "updatedAt": "2024-09-08T09:00:00.000Z",
      "counts": { "queued": 0, "running": 0, "success": 12, "failed": 3 },
      "createdBy": "u_xxx",
      "source": "batch_page"
    }
  ],
  "total": 1234,
  "limit": 20,
  "offset": 0
}
```

## SLO

- p95 < 200ms under 10k batches, with proper indexes.

## Indexing

- `batches (archived, updated_at DESC)`
- `batches (created_at DESC)`
- Optional: partial index for `archived=false`
- Ensure `counts` is available via materialized view or denormalized JSON to avoid aggregations at read time.

## Notes

- Always apply the same filters to `COUNT(*)` used for `total`.
- Deduplicate by `id` at SQL level; frontend still dedupes by `id` as a safeguard.

