'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { ImportBox } from './ImportBox';
import { FilterBar, StatusFilter, SourceFilter, SortBy } from './FilterBar';
import { TaskTable } from './TaskTable';
import { ExportBar, ExportScope, ExportFormat } from './ExportBar';
import { ConcurrencyPool, UploadTask } from '@/lib/tasks-runner/uploader';
import { createUrlTasks, listTasks, deleteTask, retryTask } from '@/lib/tasks-runner/api-batch-compat';
import type { RowState, CreateTasksResponse, TaskItem } from '@/lib/tasks-runner/types';
import { mergeTaskLists, taskItemToRowState } from '@/lib/tasks-runner/utils';
import { en as t } from '@/uiStrings/i18n/en';
import { DEFAULT_CONCURRENCY, POLL_INTERVAL_MS } from '@/lib/tasks-runner/constants';

export default function TaskRunner() {
  // State
  const [tasks, setTasks] = useState<RowState[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('');
  const [sortBy, setSortBy] = useState<SortBy>('updatedDesc');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editMode, setEditMode] = useState(false);
  const [taskLimit, setTaskLimit] = useState(100);
  
  // Button states to prevent double-clicks
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [loadingTasks, setLoadingTasks] = useState(false);
  
  // Concurrency pool
  const poolRef = useRef<ConcurrencyPool | null>(null);
  const [concurrency, setConcurrency] = useState(DEFAULT_CONCURRENCY);
  
  // URL deduplication
  const processedUrlsRef = useRef<Set<string>>(new Set());
  
  // Polling management
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isPollingActiveRef = useRef(true);
  
  // Start polling
  const startPolling = useCallback(() => {
    // Clear any existing interval first
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    
    // Only start if should be polling
    if (isPollingActiveRef.current) {
      intervalRef.current = setInterval(loadTasks, POLL_INTERVAL_MS);
    }
  }, []);
  
  // Stop polling
  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);
  
  // Handle visibility change for polling management
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab is hidden, pause polling
        isPollingActiveRef.current = false;
        stopPolling();
      } else {
        // Tab is visible, resume polling
        isPollingActiveRef.current = true;
        loadTasks(); // Immediate refresh
        startPolling();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [startPolling, stopPolling]);
  
  // Initialize pool and start polling
  useEffect(() => {
    poolRef.current = new ConcurrencyPool(concurrency);
    loadTasks(); // Initial load
    startPolling(); // Start polling
    
    return () => {
      poolRef.current?.cancelAll();
      stopPolling();
    };
  }, [startPolling, stopPolling]);
  
  // Update pool capacity
  const handleConcurrencyChange = useCallback((value: number) => {
    setConcurrency(value);
    poolRef.current?.setCapacity(value);
  }, []);
  
  // Normalize URL for deduplication
  const normalizeUrl = (url: string): string => {
    try {
      const u = new URL(url.trim());
      u.hash = '';
      // Remove tracking params
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(k => 
        u.searchParams.delete(k)
      );
      return u.toString().replace(/\/$/, '');
    } catch {
      return url.trim();
    }
  };
  
  // Validate URL
  const isValidUrl = (url: string): boolean => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  };
  
  // Add URLs to queue
  const handleAddUrls = useCallback(async (urls: string[]) => {
    const validUrls: string[] = [];
    const errors: string[] = [];
    
    for (const url of urls) {
      const normalized = normalizeUrl(url);
      
      if (!isValidUrl(normalized)) {
        errors.push(`${url}: ${t.tasksRunner.validation.invalidUrl}`);
        continue;
      }
      
      if (processedUrlsRef.current.has(normalized)) {
        errors.push(`${url}: ${t.tasksRunner.validation.duplicateUrl}`);
        continue;
      }
      
      validUrls.push(normalized);
      processedUrlsRef.current.add(normalized);
    }
    
    if (errors.length > 0) {
      alert(errors.join('\n'));
    }
    
    if (validUrls.length === 0) {
      if (urls.length > 0) {
        alert(t.tasksRunner.validation.noUrls);
      }
      return;
    }
    
    // Create local tasks
    const newTasks: RowState[] = validUrls.map(url => ({
      id: `local_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      status: 'queued',
      source: 'url',
      url,
      updatedAt: new Date().toISOString(),
    }));
    
    setTasks(prev => [...prev, ...newTasks]);
    
    // Add to pool for processing
    for (const task of newTasks) {
      const uploadTask: UploadTask = {
        id: task.id,
        url: task.url,
        retryCount: 0,
        status: 'queued',
        onProgress: (progress) => {
          setTasks(prev => prev.map(t => 
            t.id === task.id ? { ...t, progress } : t
          ));
        },
        onComplete: (response: CreateTasksResponse) => {
          // Update with remote ID - keep status as queued
          const remoteId = response.created?.[0]?.id;
          setTasks(prev => prev.map(t => 
            t.id === task.id 
              ? { ...t, status: 'queued', progress: 0, remoteId, updatedAt: new Date().toISOString() }
              : t
          ));
          // Immediately trigger a status update from server
          setTimeout(() => loadTasks(), 500);
        },
        onError: (error) => {
          setTasks(prev => prev.map(t => 
            t.id === task.id 
              ? { ...t, status: 'failed', error: { code: 'UPLOAD_ERROR', message: error.message }, updatedAt: new Date().toISOString() }
              : t
          ));
        },
      };
      
      await poolRef.current?.addTask(uploadTask);
    }
  }, []);
  
  // Add files to queue
  const handleAddFiles = useCallback(async (files: File[]) => {
    const newTasks: RowState[] = files.map(file => ({
      id: `local_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      status: 'queued',
      source: 'file',
      fileName: file.name,
      sizeBytes: file.size,
      updatedAt: new Date().toISOString(),
    }));
    
    setTasks(prev => [...prev, ...newTasks]);
    
    // Check for large files
    for (const file of files) {
      if (file.size > 80 * 1024 * 1024) {
        console.log(`File ${file.name}: ${t.tasksRunner.validation.fileTooLarge}`);
      }
    }
    
    // Add to pool
    for (let i = 0; i < files.length; i++) {
      const task = newTasks[i];
      const file = files[i];
      
      const uploadTask: UploadTask = {
        id: task.id,
        file,
        retryCount: 0,
        status: 'queued',
        onProgress: (progress) => {
          setTasks(prev => prev.map(t => 
            t.id === task.id 
              ? { ...t, status: 'running', progress, updatedAt: new Date().toISOString() }
              : t
          ));
        },
        onComplete: (response: CreateTasksResponse) => {
          const remoteId = response.created?.[0]?.id;
          setTasks(prev => prev.map(t => 
            t.id === task.id 
              ? { ...t, status: 'queued', progress: 0, remoteId, updatedAt: new Date().toISOString() }
              : t
          ));
          // Immediately trigger a status update from server
          setTimeout(() => loadTasks(), 500);
        },
        onError: (error) => {
          setTasks(prev => prev.map(t => 
            t.id === task.id 
              ? { 
                  ...t, 
                  status: 'failed', 
                  error: { 
                    code: error.message === 'Aborted' ? 'ABORTED' : 'UPLOAD_ERROR', 
                    message: error.message 
                  },
                  updatedAt: new Date().toISOString()
                }
              : t
          ));
        },
      };
      
      await poolRef.current?.addTask(uploadTask);
    }
  }, []);
  
  // Run tasks (one-click Run)
  const handleRunTasks = useCallback(async (urlsFromInput?: string[]) => {
    // If URLs provided, add them first
    if (urlsFromInput && urlsFromInput.length > 0) {
      await handleAddUrls(urlsFromInput);
    }
    
    // Tasks are automatically run when added to pool
    // Force immediate refresh
    setTimeout(() => loadTasks(), 500);
  }, [handleAddUrls]);
  
  // Cancel all
  const handleCancelAll = useCallback(() => {
    poolRef.current?.cancelAll();
    setTasks(prev => prev.map(t => 
      (t.status === 'queued' || t.status === 'running')
        ? { 
            ...t, 
            status: 'failed', 
            error: { code: 'ABORTED', message: 'Aborted' },
            updatedAt: new Date().toISOString()
          }
        : t
    ));
  }, []);
  
  // Clear queue
  const handleClearQueue = useCallback(() => {
    const queuedIds = tasks.filter(t => t.status === 'queued').map(t => t.id);
    queuedIds.forEach(id => poolRef.current?.cancelTask(id));
    setTasks(prev => prev.filter(t => t.status !== 'queued'));
  }, [tasks]);
  
  // Cancel single task
  const handleCancel = useCallback((taskId: string) => {
    poolRef.current?.cancelTask(taskId);
    setTasks(prev => prev.map(t => 
      t.id === taskId 
        ? { 
            ...t, 
            status: 'failed', 
            error: { code: 'ABORTED', message: 'Aborted' },
            updatedAt: new Date().toISOString()
          }
        : t
    ));
  }, []);
  
  // Load tasks from server
  const loadTasks = useCallback(async () => {
    if (loadingTasks) return;
    
    try {
      setLoadingTasks(true);
      const response = await listTasks({ limit: 1000 });
      
      // Transform tasks to match our format
      const transformedTasks: RowState[] = response.tasks.map(task => ({
        id: task.id,
        remoteId: task.id,
        status: task.status as 'queued' | 'running' | 'success' | 'failed',
        source: task.kind as 'url' | 'file',
        url: task.kind === 'url' ? task.payload?.url : undefined,
        fileName: task.kind === 'file' ? (task.payload?.localPath || '').split('/').pop() : undefined,
        progress: task.progress || 0,
        updatedAt: task.updatedAt || new Date().toISOString(),
        result: task.result
      }));
      
      // Merge server tasks with local tasks
      setTasks(prev => mergeTaskLists(prev, transformedTasks));
    } catch (error) {
      console.error('Failed to load tasks:', error);
    } finally {
      setLoadingTasks(false);
    }
  }, [loadingTasks]);
  
  // Retry task
  const handleRetry = useCallback(async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || retryingIds.has(taskId)) return;
    
    // Add to retrying set
    setRetryingIds(prev => new Set(prev).add(taskId));
    
    try {
      // Different behavior for URL vs File
      if (task.source === 'url' && task.remoteId) {
        // URL: Call retry API
        const response = await retryTask(task.remoteId);
        
        // Update task with new state from server
        setTasks(prev => prev.map(t => 
          t.id === taskId 
            ? taskItemToRowState(response)
            : t
        ));
      } else if (task.source === 'file') {
        // File: Show message
        alert(t.tasksRunner.validation.fileRetryNotSupported || 'File tasks cannot be retried. Please re-upload the file.');
      } else if (task.source === 'url' && !task.remoteId) {
        // URL task without remoteId - re-add to pool
        setTasks(prev => prev.map(t => 
          t.id === taskId 
            ? { ...t, status: 'queued', progress: 0, error: undefined, updatedAt: new Date().toISOString() }
            : t
        ));
        
        const uploadTask: UploadTask = {
          id: task.id,
          url: task.url,
          retryCount: 0,
          status: 'queued',
          onProgress: (progress) => {
            setTasks(prev => prev.map(t => 
              t.id === taskId 
                ? { ...t, status: 'running', progress, updatedAt: new Date().toISOString() }
                : t
            ));
          },
          onComplete: (response: CreateTasksResponse) => {
            const remoteId = response.created?.[0]?.id;
            setTasks(prev => prev.map(t => 
              t.id === taskId 
                ? { ...t, status: 'queued', progress: 0, remoteId, updatedAt: new Date().toISOString() }
                : t
            ));
            // Immediately trigger a status update from server  
            setTimeout(() => loadTasks(), 500);
          },
          onError: (error) => {
            setTasks(prev => prev.map(t => 
              t.id === taskId 
                ? { ...t, status: 'failed', error: { code: 'RETRY_FAILED', message: error.message }, updatedAt: new Date().toISOString() }
                : t
            ));
          },
        };
        
        await poolRef.current?.addTask(uploadTask);
      }
    } catch (error: any) {
      console.error('Retry failed:', error);
      alert(`Failed to retry task: ${error.message}`);
    } finally {
      // Remove from retrying set
      setRetryingIds(prev => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }
  }, [tasks, retryingIds]);
  
  // Delete tasks
  const handleDelete = useCallback(async (taskIds: string[]) => {
    // Check if any tasks are being deleted
    const alreadyDeleting = taskIds.some(id => deletingIds.has(id));
    if (alreadyDeleting) return;
    
    // Add to deleting set
    setDeletingIds(prev => {
      const next = new Set(prev);
      taskIds.forEach(id => next.add(id));
      return next;
    });
    
    try {
      // Cancel if running
      taskIds.forEach(id => {
        const task = tasks.find(t => t.id === id);
        if (task?.status === 'running') {
          poolRef.current?.cancelTask(id);
        }
      });
      
      // Call delete API for remote tasks (using remoteId or id)
      const deletePromises = taskIds.map(async id => {
        const task = tasks.find(t => t.id === id);
        const idToDelete = task?.remoteId || id;
        
        if (task?.remoteId) {
          try {
            await deleteTask(idToDelete);
          } catch (error: any) {
            // 404 means already deleted remotely, which is fine
            if (error.status === 404) {
              console.log(`Task ${idToDelete} already removed remotely`);
            } else {
              console.error(`Failed to delete remote task ${idToDelete}:`, error);
            }
          }
        }
      });
      
      await Promise.all(deletePromises);
      
      // Remove from state
      setTasks(prev => prev.filter(t => !taskIds.includes(t.id)));
      setSelectedIds(new Set());
      setEditMode(false);
    } finally {
      // Remove from deleting set
      setDeletingIds(prev => {
        const next = new Set(prev);
        taskIds.forEach(id => next.delete(id));
        return next;
      });
    }
  }, [tasks, deletingIds]);
  
  // Export handler - simplified since logic moved to ExportBar
  const handleExport = useCallback((scope: ExportScope, format: ExportFormat, perItem: boolean) => {
    // This is now just a placeholder - actual export logic is in ExportBar
    console.log('Export triggered:', { scope, format, perItem });
  }, []);
  
  // Filter and sort tasks
  const getFilteredTasks = useCallback(() => {
    let filtered = [...tasks];
    
    // Status filter
    if (statusFilter) {
      filtered = filtered.filter(t => t.status === statusFilter);
    }
    
    // Source filter
    if (sourceFilter) {
      filtered = filtered.filter(t => t.source === sourceFilter);
    }
    
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(t => {
        const title = t.title?.toLowerCase() || '';
        const url = t.url?.toLowerCase() || '';
        const fileName = t.fileName?.toLowerCase() || '';
        const id = t.id.toLowerCase();
        return title.includes(query) || url.includes(query) || fileName.includes(query) || id.includes(query);
      });
    }
    
    // Sort
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'updatedDesc':
          return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
        case 'createdDesc':
          // Use ID as proxy for creation time
          return b.id.localeCompare(a.id);
        case 'status':
          const order: Record<string, number> = { running: 1, queued: 2, failed: 3, success: 4 };
          return (order[a.status] || 99) - (order[b.status] || 99);
        default:
          return 0;
      }
    });
    
    return filtered;
  }, [tasks, statusFilter, sourceFilter, searchQuery, sortBy]);
  
  // Get status counts
  const getStatusCounts = useCallback(() => {
    const counts = {
      queued: 0,
      running: 0,
      success: 0,
      failed: 0,
    };
    
    tasks.forEach(t => {
      if (t.status in counts) {
        counts[t.status as keyof typeof counts]++;
      }
    });
    
    return counts;
  }, [tasks]);
  
  const filteredTasks = getFilteredTasks();
  const statusCounts = getStatusCounts();
  const queuedCount = tasks.filter(t => t.status === 'queued').length;
  const runningCount = tasks.filter(t => t.status === 'running').length;
  
  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t.tasksRunner.title}</h1>
        <button
          className={`px-3 py-1 text-sm border rounded ${editMode ? 'bg-gray-100' : ''}`}
          onClick={() => setEditMode(!editMode)}
        >
          {editMode ? 'Done' : 'Edit'}
        </button>
      </div>
      
      <ImportBox
        onAddUrls={handleAddUrls}
        onAddFiles={handleAddFiles}
        onConcurrencyChange={handleConcurrencyChange}
        onRunTasks={handleRunTasks}
        onCancelAll={handleCancelAll}
        onClearQueue={handleClearQueue}
        disabled={loading}
        isRunning={runningCount > 0}
        queuedCount={queuedCount}
        runningCount={runningCount}
      />
      
      <FilterBar
        statusFilter={statusFilter}
        sourceFilter={sourceFilter}
        sortBy={sortBy}
        searchQuery={searchQuery}
        statusCounts={statusCounts}
        totalCount={tasks.length}
        onStatusChange={setStatusFilter}
        onSourceChange={setSourceFilter}
        onSortChange={setSortBy}
        onSearchChange={setSearchQuery}
        onClearFilters={() => {
          setStatusFilter('');
          setSourceFilter('');
          setSearchQuery('');
        }}
      />
      
      <TaskTable
        tasks={filteredTasks.slice(0, taskLimit)}
        loading={loading || loadingTasks}
        onRetry={handleRetry}
        onCancel={handleCancel}
        onDelete={handleDelete}
        onLoadMore={() => setTaskLimit(prev => prev + 100)}
        hasMore={filteredTasks.length > taskLimit}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        editMode={editMode}
        retryingIds={retryingIds}
        deletingIds={deletingIds}
      />
      
      <ExportBar
        tasks={tasks}
        filteredTasks={filteredTasks}
        selectedIds={selectedIds}
        onExport={handleExport}
      />
    </div>
  );
}