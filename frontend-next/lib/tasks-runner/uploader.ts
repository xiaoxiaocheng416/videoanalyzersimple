// Task Runner concurrency uploader (Phase 2 implementation)

import { 
  RETRY_DELAYS_MS,
  MAX_RETRIES,
  JITTER_PERCENT,
  NO_RETRY_ERROR_CODES,
  DEFAULT_CONCURRENCY
} from './constants';
import type { RowState, CreateTasksResponse } from './types';
import { createUrlTasks, uploadFileXHR } from './api-batch-compat';

export interface UploadTask {
  id: string;
  file?: File;
  url?: string;
  retryCount: number;
  status: 'queued' | 'uploading' | 'completed' | 'failed';
  onProgress?: (progress: number) => void;
  onComplete?: (response: CreateTasksResponse) => void;
  onError?: (error: Error) => void;
  controller?: AbortController;
  retryAfter?: number;
}

export class ConcurrencyPool {
  private capacity: number;
  private inflight: Map<string, UploadTask> = new Map();
  private queue: UploadTask[] = [];
  private isRunning: boolean = false;
  
  constructor(initialCapacity: number = DEFAULT_CONCURRENCY) {
    this.capacity = initialCapacity;
  }
  
  setCapacity(newCapacity: number): void {
    this.capacity = newCapacity;
    // Immediately pump if we have more capacity
    if (this.inflight.size < this.capacity && this.queue.length > 0) {
      this.pump();
    }
  }
  
  async addTask(task: UploadTask): Promise<void> {
    // Initialize task
    task.retryCount = task.retryCount || 0;
    task.status = 'queued';
    
    // Add to queue
    this.queue.push(task);
    
    // Start pump if not running
    if (!this.isRunning) {
      this.isRunning = true;
      this.pump();
    }
  }
  
  cancelTask(taskId: string): void {
    // Check if task is in flight
    const inflightTask = this.inflight.get(taskId);
    if (inflightTask) {
      // Abort the request
      inflightTask.controller?.abort();
      // Remove from inflight
      this.inflight.delete(taskId);
      // Mark as failed
      inflightTask.status = 'failed';
      inflightTask.onError?.(new Error('Aborted'));
      // Pump next task
      this.pump();
      return;
    }
    
    // Check if task is in queue
    const queueIndex = this.queue.findIndex(t => t.id === taskId);
    if (queueIndex !== -1) {
      const task = this.queue[queueIndex];
      // Remove from queue
      this.queue.splice(queueIndex, 1);
      // Mark as failed
      task.status = 'failed';
      task.onError?.(new Error('Aborted'));
    }
  }
  
  cancelAll(): void {
    // Cancel all inflight tasks
    for (const [taskId, task] of this.inflight) {
      task.controller?.abort();
      task.status = 'failed';
      task.onError?.(new Error('Aborted'));
    }
    this.inflight.clear();
    
    // Clear queue
    for (const task of this.queue) {
      task.status = 'failed';
      task.onError?.(new Error('Aborted'));
    }
    this.queue = [];
    
    // Stop pumping
    this.isRunning = false;
  }
  
  private async pump(): Promise<void> {
    // Check if we can process more tasks
    while (this.inflight.size < this.capacity && this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) break;
      
      // Mark as uploading
      task.status = 'uploading';
      this.inflight.set(task.id, task);
      
      // Process task asynchronously
      this.processTask(task).finally(() => {
        // Release slot
        this.inflight.delete(task.id);
        // Pump next task
        if (this.queue.length > 0) {
          this.pump();
        } else if (this.inflight.size === 0) {
          // No more tasks
          this.isRunning = false;
        }
      });
    }
  }
  
  private async processTask(task: UploadTask): Promise<void> {
    try {
      // Determine if retry is needed
      if (task.retryAfter && task.retryAfter > Date.now()) {
        // Wait for retry-after
        await this.delay(task.retryAfter - Date.now());
      } else if (task.retryCount > 0) {
        // Apply exponential backoff with jitter
        const baseDelay = RETRY_DELAYS_MS[Math.min(task.retryCount - 1, RETRY_DELAYS_MS.length - 1)];
        const jitter = baseDelay * JITTER_PERCENT * (Math.random() * 2 - 1);
        await this.delay(baseDelay + jitter);
      }
      
      // Execute the upload
      const response = await this.executeUpload(task);
      
      // Mark as completed
      task.status = 'completed';
      task.onComplete?.(response);
    } catch (error: any) {
      // Check if we should retry
      const shouldRetry = this.shouldRetry(error, task);
      
      if (shouldRetry && task.retryCount < MAX_RETRIES) {
        // Increment retry count
        task.retryCount++;
        
        // Check for Retry-After header
        if (error.retryAfter) {
          task.retryAfter = Date.now() + error.retryAfter * 1000;
        }
        
        // Re-queue for retry
        task.status = 'queued';
        this.queue.unshift(task); // Add to front of queue
      } else {
        // Mark as failed
        task.status = 'failed';
        task.onError?.(error);
      }
    }
  }
  
  private async executeUpload(task: UploadTask): Promise<CreateTasksResponse> {
    // Create abort controller
    const controller = new AbortController();
    task.controller = controller;
    
    if (task.url) {
      // URL task - use fetch
      return this.executeUrlTask(task, controller.signal);
    } else if (task.file) {
      // File upload - use XHR for progress
      return this.executeFileUpload(task, controller);
    } else {
      throw new Error('Task must have either url or file');
    }
  }
  
  private async executeUrlTask(task: UploadTask, signal: AbortSignal): Promise<CreateTasksResponse> {
    try {
      // Use batch-compatible API
      const result = await createUrlTasks([task.url!]);
      return {
        created: result.created.map(id => ({ id, title: task.url!, source: 'url', status: 'queued' })),
        duplicates: [],
        message: 'URL task created'
      };
    } catch (error: any) {
      // Enhance error with status if available
      if (error.status) {
        error.status = error.status;
      }
      throw error;
    }
  }
  
  private async executeFileUpload(task: UploadTask, controller: AbortController): Promise<CreateTasksResponse> {
    try {
      // Use batch-compatible API with progress tracking
      const result = await uploadFileXHR(task.file!, (progress) => {
        task.onProgress?.(progress);
      });
      
      return {
        created: [{ 
          id: result.id, 
          title: task.file!.name, 
          source: 'file', 
          status: 'queued' 
        }],
        duplicates: [],
        message: 'File uploaded successfully'
      };
    } catch (error: any) {
      // Check if aborted
      if (controller.signal.aborted) {
        throw new Error('Aborted');
      }
      throw error;
    }
  }
  
  private shouldRetry(error: any, task: UploadTask): boolean {
    // Don't retry if aborted
    if (error.message === 'Aborted') {
      return false;
    }
    
    // Don't retry specific HTTP status codes
    if (error.status && NO_RETRY_ERROR_CODES.includes(error.status)) {
      return false;
    }
    
    // Retry on 429, 5xx, or network errors
    if (!error.status || error.status === 429 || error.status >= 500) {
      return true;
    }
    
    // Retry on network errors
    if (error.message === 'Network error' || error.message === 'Request timeout') {
      return true;
    }
    
    return false;
  }
  
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}