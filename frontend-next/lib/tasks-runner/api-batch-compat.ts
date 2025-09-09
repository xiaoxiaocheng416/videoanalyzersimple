// Batch-compatible API client for Task Runner
// Uses the exact same endpoints as /batch page

const API_BASE = process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, '') || '/api';

// Get or create batch ID from cookie
function getBatchIdFromCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/taskRunnerBatchId=([^;]+)/);
  return match ? match[1] : null;
}

// Create a new batch and store in cookie
async function ensureBatchId(): Promise<string> {
  let batchId = getBatchIdFromCookie();
  
  if (batchId) {
    // Verify batch exists
    try {
      const resp = await fetch(`${API_BASE}/batches/${batchId}`, {
        credentials: 'include'
      });
      if (resp.ok) {
        return batchId;
      }
    } catch {
      // Batch doesn't exist, create new one
    }
  }
  
  // Create new batch
  const resp = await fetch(`${API_BASE}/batches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ 
      title: 'Task Runner ' + new Date().toLocaleString(),
      createdBy: 'task_runner',
      source: 'tasks_page'
    })
  });
  
  const batch = await resp.json();
  batchId = batch.id;
  
  // Store in cookie
  document.cookie = `taskRunnerBatchId=${batchId}; path=/; max-age=${30 * 24 * 60 * 60}`;
  
  return batchId;
}

// Create URL tasks - uses /batches/:id/tasks/url endpoint
export async function createUrlTasks(urls: string[]): Promise<{ created: string[] }> {
  const batchId = await ensureBatchId();
  
  const resp = await fetch(`${API_BASE}/batches/${batchId}/tasks/url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ urls })
  });
  
  if (!resp.ok) {
    throw new Error(`Failed to create URL tasks: ${resp.status}`);
  }
  
  const data = await resp.json();
  return { created: data.created || [] };
}

// Upload files with XHR for progress tracking - uses /batches/:id/tasks/upload
export async function uploadFileXHR(
  file: File,
  onProgress?: (progress: number) => void
): Promise<{ id: string }> {
  const batchId = await ensureBatchId();
  
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('files', file);
    
    // Setup progress
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const progress = Math.round((e.loaded / e.total) * 100);
          onProgress(progress);
        }
      };
    }
    
    // Setup completion
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const resp = JSON.parse(xhr.responseText);
          const taskId = resp.created?.[0] || resp.ok ? 'task_' + Date.now() : null;
          if (taskId) {
            resolve({ id: taskId });
          } else {
            reject(new Error('No task ID returned'));
          }
        } catch (e) {
          reject(e);
        }
      } else {
        reject(new Error(`Upload failed: ${xhr.status}`));
      }
    };
    
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.ontimeout = () => reject(new Error('Upload timeout'));
    
    // Open and send with credentials
    xhr.open('POST', `${API_BASE}/batches/${batchId}/tasks/upload`);
    xhr.withCredentials = true;
    xhr.timeout = 600000; // 10 minutes
    xhr.send(formData);
  });
}

// List tasks - uses /batches/:id/tasks endpoint
export async function listTasks(params?: {
  status?: string;
  limit?: number;
  cursor?: string;
}): Promise<{ 
  tasks: Array<{
    id: string;
    kind: 'url' | 'file';
    payload: any;
    status: string;
    progress?: number;
    updatedAt?: string;
    result?: any;
  }>;
  nextCursor?: string;
}> {
  const batchId = getBatchIdFromCookie();
  if (!batchId) {
    return { tasks: [] };
  }
  
  const url = new URL(`${API_BASE}/batches/${batchId}/tasks`, window.location.origin);
  if (params?.status) url.searchParams.set('status', params.status);
  if (params?.limit) url.searchParams.set('limit', String(params.limit));
  if (params?.cursor) url.searchParams.set('cursor', params.cursor);
  
  const resp = await fetch(url.toString(), {
    credentials: 'include'
  });
  
  if (!resp.ok) {
    console.warn('Failed to list tasks:', resp.status);
    return { tasks: [] };
  }
  
  const data = await resp.json();
  return {
    tasks: data.tasks || [],
    nextCursor: data.nextCursor
  };
}

// Delete task - uses /tasks/:id endpoint
export async function deleteTask(taskId: string): Promise<void> {
  await fetch(`${API_BASE}/tasks/${taskId}`, {
    method: 'DELETE',
    credentials: 'include'
  });
  // Idempotent - ignore errors
}

// Retry task - uses /tasks/:id/retry endpoint
export async function retryTask(taskId: string): Promise<void> {
  await fetch(`${API_BASE}/tasks/${taskId}/retry`, {
    method: 'POST',
    credentials: 'include'
  });
}

// Bulk delete tasks
export async function bulkDeleteTasks(ids: string[]): Promise<void> {
  try {
    await fetch(`${API_BASE}/tasks/bulk-delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ ids })
    });
  } catch {
    // Fallback to individual deletes
    await Promise.all(ids.map(id => deleteTask(id)));
  }
}

// Get batch info
export async function getBatchInfo(): Promise<{
  id: string;
  title?: string;
  createdAt: string;
  counts: Record<string, number>;
} | null> {
  const batchId = getBatchIdFromCookie();
  if (!batchId) return null;
  
  try {
    const resp = await fetch(`${API_BASE}/batches/${batchId}`, {
      credentials: 'include'
    });
    if (resp.ok) {
      return await resp.json();
    }
  } catch {
    // Ignore
  }
  return null;
}