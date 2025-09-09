// Task Runner types

export type RowStatus = 'queued' | 'running' | 'success' | 'failed';

export type TaskSource = 'url' | 'file';

export interface RowState {
  id: string; // local ID
  status: RowStatus;
  progress?: number;
  error?: {
    code: string;
    message: string;
    requestId?: string;
  };
  updatedAt?: string;
  source: TaskSource;
  title?: string;
  url?: string;
  fileName?: string;
  sizeBytes?: number;
  controller?: AbortController;
  remoteId?: string; // server-side ID after creation
  retryCount?: number;
  retryAfter?: number; // from Retry-After header
}

export interface EnqueueItem {
  kind: 'url' | 'file';
  url?: string;
  file?: File;
  metadata?: {
    importTimestamp?: string;
    createdBy?: string;
  };
}

export interface TaskItem {
  id: string;
  title?: string;
  url?: string;
  fileRef?: string;
  status: RowStatus;
  progress?: number;
  source?: TaskSource;
  createdAt?: string;
  updatedAt?: string;
  importTimestamp?: string;
  createdBy?: string;
  error?: {
    code: string;
    message: string;
    requestId?: string;
  };
}

export interface TaskListResponse {
  items: TaskItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface CreateTasksResponse {
  created: TaskItem[];
  duplicates?: string[];
}