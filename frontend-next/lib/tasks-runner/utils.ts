// Task Runner utility functions

import type { RowStatus, RowState, TaskItem } from './types';

/**
 * Map server status to UI status (only allow 4 states)
 * Unknown states default to 'running' with console warning
 */
export function mapServerStatusToRowStatus(serverStatus: string): RowStatus {
  const statusMap: Record<string, RowStatus> = {
    'queued': 'queued',
    'pending': 'queued',
    'waiting': 'queued',
    'running': 'running',
    'processing': 'running',
    'in_progress': 'running',
    'success': 'success',
    'completed': 'success',
    'done': 'success',
    'failed': 'failed',
    'error': 'failed',
    'canceled': 'failed', // Map canceled to failed with message
    'aborted': 'failed',
  };
  
  const mappedStatus = statusMap[serverStatus.toLowerCase()];
  if (!mappedStatus) {
    console.warn(`Unknown server status "${serverStatus}", defaulting to "running"`);
    return 'running';
  }
  
  return mappedStatus;
}

/**
 * Convert server task to row state
 */
export function taskItemToRowState(task: TaskItem): RowState {
  return {
    id: task.id,
    status: mapServerStatusToRowStatus(task.status),
    progress: task.progress,
    error: task.error,
    updatedAt: task.updatedAt,
    source: task.source || 'url',
    title: task.title,
    url: task.url,
    fileName: task.fileRef,
    remoteId: task.id, // Server task id becomes remoteId
  };
}

/**
 * Merge server tasks with local tasks
 * 
 * Merge priority rules:
 * 1. Local 'running' status is never downgraded (prevents status regression)
 * 2. For all other cases, use the version with newer updatedAt timestamp
 * 3. Tasks are keyed by remoteId (if exists) or id for deduplication
 * 
 * @param localTasks - Current local tasks
 * @param serverTasks - Tasks from server
 * @returns Merged task list with duplicates removed
 */
export function mergeTaskLists(localTasks: RowState[], serverTasks: TaskItem[]): RowState[] {
  const taskMap = new Map<string, RowState>();
  
  // First add all local tasks
  for (const task of localTasks) {
    const key = task.remoteId || task.id;
    taskMap.set(key, task);
  }
  
  // Then merge server tasks
  for (const serverTask of serverTasks) {
    const key = serverTask.id;
    const existingTask = taskMap.get(key);
    const serverRowState = taskItemToRowState(serverTask);
    
    if (!existingTask) {
      // New task from server
      taskMap.set(key, serverRowState);
    } else {
      // Merge based on updatedAt
      const existingTime = existingTask.updatedAt ? Date.parse(existingTask.updatedAt) : 0;
      const serverTime = serverTask.updatedAt ? Date.parse(serverTask.updatedAt) : 0;
      
      // Priority rule 1: Keep local running state to avoid status downgrade
      if (existingTask.status === 'running' && serverRowState.status !== 'running') {
        continue; // Keep local version
      }
      
      // Priority rule 2: Otherwise use newer version based on updatedAt
      if (serverTime > existingTime) {
        taskMap.set(key, serverRowState);
      }
    }
  }
  
  return Array.from(taskMap.values());
}

/**
 * Format error message with request ID if available
 */
export function formatErrorMessage(error: any): string {
  if (!error) return 'Unknown error';
  
  let message = error.message || 'Unknown error';
  
  if (error.requestId) {
    message += ` (Request ID: ${error.requestId})`;
  }
  
  return message;
}