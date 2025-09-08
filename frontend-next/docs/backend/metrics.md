# Metrics (Prometheus) & Dashboard

## Metrics

- `app_batches_list_latency_seconds` (histogram)
  - Labels: `status` (http status), `sort`, `statusFilter`, `archived`
- `app_batches_created_total{source}` (counter)
- `app_batches_active_gauge` (gauge) — computed on schedule or from query
- `app_batches_cleanup_archived_total` (counter)
- `app_batches_cleanup_deleted_total` (counter)
- `app_batches_cleanup_errors_total` (counter)

## Dashboard (Grafana)

- GET /batches latency p50/p95 over time
- Active batch count (gauge/time series)
- Created batches by source (stacked bar)
- Cleanup volume/errors (bars/lines)

## Alerts

- GET /batches latency p95 > threshold for sustained period
- Cleanup errors > threshold

