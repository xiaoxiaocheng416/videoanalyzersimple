# DB Spike (1–2 days) — Repo Abstraction + SQLite Read Path

## Goals

- Abstract data access via `BatchRepo`/`TaskRepo` interfaces
- Implement SQLite (Drizzle/Prisma) minimal schema for batches/tasks
- Build a read-only `/batches` list path using SQLite and compare with FS output
- Keep FS as feature flag fallback; large files remain on FS/obj storage

## Repo Interfaces (TypeScript pseudo)

```ts
interface BatchRepo {
  findBatches(params: {
    limit: number; offset: number;
    status: 'active' | 'all'; archived: boolean; days: number;
    search?: string; sort: 'updatedAt_desc'|'updatedAt_asc'|'createdAt_desc'|'createdAt_asc';
  }): Promise<{ items: Batch[]; total: number }>;
  createBatch(input: { title?: string; createdBy: string; source: string }): Promise<Batch>;
  archiveBatch(id: string): Promise<void>;
  purgeBatch(id: string): Promise<void>;
}

interface TaskRepo {
  findTasks(batchId: string, params: { limit: number; offset: number; status?: string }): Promise<{ items: Task[]; total: number }>;
}
```

## SQLite Schema (Drizzle/Prisma)

- `batches(id TEXT PK, title TEXT, archived BOOLEAN, created_by TEXT, source TEXT, created_at DATETIME, updated_at DATETIME, archived_at DATETIME NULL, counts_json TEXT)`
- `tasks(id TEXT PK, batch_id TEXT, kind TEXT, payload_json TEXT, status TEXT, progress INTEGER, created_at DATETIME, updated_at DATETIME, error_text TEXT)`
- Indexes: `batches(archived, updated_at DESC)`, `batches(created_at DESC)`, `tasks(batch_id, updated_at)`

## Plan

- Implement SQLite repo + seed small dataset
- Wire `/batches` to use Repo behind a flag (default FS, flag=sqlite)
- Compare outputs (length/order/id-unique/fields) under various filters
- Measure latency with 10k rows

## Risks

- Write concurrency — keep single-writer or a queue; Spike covers read path only
- Counts computation — denormalize counts on write or update via lightweight job

## Deliverables

- Repo interfaces + SQLite schema/migration scripts
- Benchmarks & comparison results
- Switch plan & rollback path

