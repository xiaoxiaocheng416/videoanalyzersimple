// Task Runner API client (Phase 2 - XHR implementation)

import type { TaskItem, TaskListResponse, CreateTasksResponse } from './types';
import { 
  API_BASE, 
  RENDER_BASE_URL, 
  BIG_FILE_THRESHOLD_BYTES,
  XHR_TIMEOUT_MS,
  NO_RETRY_ERROR_CODES 
} from './constants';

// Helper to handle API errors
function handleApiError(response: Response | XMLHttpRequest, body?: any): never {
  let status: number;
  let statusText: string;
  let retryAfter: string | null = null;
  
  if (response instanceof XMLHttpRequest) {
    status = response.status;
    statusText = response.statusText;
    retryAfter = response.getResponseHeader('Retry-After');
  } else {
    status = response.status;
    statusText = response.statusText;
    retryAfter = response.headers.get('Retry-After');
  }
  
  const error: any = new Error(`HTTP ${status}: ${statusText}`);
  error.status = status;
  
  if (retryAfter) {
    error.retryAfter = parseInt(retryAfter, 10);
  }
  
  if (body) {
    error.message = body.error || body.message || error.message;
    error.requestId = body.requestId;
    error.code = body.code;
  }
  
  // Special handling for 413 error
  if (status === 413) {
    error.message = 'File too large. Use server export (M2).';
  }
  
  throw error;
}

// URL task creation (Phase 4 will wire this up)
export async function createUrlTasks(
  urls: string[],
  options: {
    importTimestamp: string;
    source: 'url';
    createdBy: string;
    idempotencyKey?: string;
  }
): Promise<CreateTasksResponse> {
  const response = await fetch(`${API_BASE}/tasks/url`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {})
    },
    body: JSON.stringify({
      urls,
      importTimestamp: options.importTimestamp,
      source: options.source,
      createdBy: options.createdBy
    })
  });
  
  const body = await response.json().catch(() => null);
  
  if (!response.ok) {
    handleApiError(response, body);
  }
  
  return body;
}

// File upload with XHR for progress tracking
export async function uploadFiles(
  files: File[],
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: number) => void;
  } = {}
): Promise<CreateTasksResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    
    // Determine upload URL based on total file size
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    const uploadUrl = totalSize > BIG_FILE_THRESHOLD_BYTES
      ? `${RENDER_BASE_URL}/tasks/upload`
      : `${API_BASE}/tasks/upload`;
    
    // Setup abort
    if (options.signal) {
      options.signal.addEventListener('abort', () => {
        xhr.abort();
        reject(new Error('Aborted'));
      });
    }
    
    // Setup progress
    if (options.onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const progress = Math.round((e.loaded / e.total) * 100);
          options.onProgress!(progress);
        }
      };
    }
    
    // Setup completion
    xhr.onload = () => {
      let body: any;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }
      
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body);
      } else {
        handleApiError(xhr, body);
      }
    };
    
    // Setup error handlers
    xhr.onerror = () => {
      reject(new Error('Network error'));
    };
    
    xhr.ontimeout = () => {
      reject(new Error('Request timeout'));
    };
    
    // Create form data
    const formData = new FormData();
    for (const file of files) {
      formData.append('files', file);
    }
    
    // Add metadata
    formData.append('importTimestamp', new Date().toISOString());
    formData.append('source', 'file');
    formData.append('createdBy', 'web');
    
    // Open and send
    xhr.open('POST', uploadUrl);
    xhr.withCredentials = true;
    xhr.timeout = XHR_TIMEOUT_MS;
    xhr.send(formData);
  });
}

// List tasks (Phase 4 will wire this up)
export async function listTasks(params?: {
  status?: string;
  source?: string;
  search?: string;
  limit?: number;
  offset?: number;
  sort?: string;
}): Promise<TaskListResponse> {
  const searchParams = new URLSearchParams();
  
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        searchParams.append(key, String(value));
      }
    });
  }
  
  const url = `${API_BASE}/tasks${searchParams.toString() ? `?${searchParams}` : ''}`;
  
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include'
  });
  
  const body = await response.json().catch(() => null);
  
  if (!response.ok) {
    handleApiError(response, body);
  }
  
  return body;
}

// Delete task (Phase 4 will wire this up)
export async function deleteTask(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/tasks/${id}`, {
    method: 'DELETE',
    credentials: 'include'
  });
  
  if (!response.ok && response.status !== 404) {
    const body = await response.json().catch(() => null);
    handleApiError(response, body);
  }
}

// Retry task (Phase 4 will wire this up)
export async function retryTask(id: string): Promise<TaskItem> {
  const response = await fetch(`${API_BASE}/tasks/${id}/retry`, {
    method: 'POST',
    credentials: 'include'
  });
  
  const body = await response.json().catch(() => null);
  
  if (!response.ok) {
    handleApiError(response, body);
  }
  
  return body;
}