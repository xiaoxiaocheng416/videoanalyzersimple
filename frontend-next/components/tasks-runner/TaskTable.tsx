'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { en as t } from '@/uiStrings/i18n/en';
import type { RowState } from '@/lib/tasks-runner/types';

interface TaskTableProps {
  tasks: RowState[];
  loading?: boolean;
  onRetry: (taskId: string) => void;
  onCancel: (taskId: string) => void;
  onDelete: (taskIds: string[]) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  editMode?: boolean;
}

export function TaskTable({
  tasks,
  loading = false,
  onRetry,
  onCancel,
  onDelete,
  onLoadMore,
  hasMore = false,
  selectedIds = new Set(),
  onSelectionChange,
  editMode = false,
}: TaskTableProps) {
  const [confirmDelete, setConfirmDelete] = useState<Record<string, number>>({});

  const handleSelectAll = (checked: boolean) => {
    if (!onSelectionChange) return;
    
    if (checked) {
      const allIds = new Set(tasks.map(t => t.id));
      onSelectionChange(allIds);
    } else {
      onSelectionChange(new Set());
    }
  };

  const handleSelectOne = (taskId: string, checked: boolean) => {
    if (!onSelectionChange) return;
    
    const newSelection = new Set(selectedIds);
    if (checked) {
      newSelection.add(taskId);
    } else {
      newSelection.delete(taskId);
    }
    onSelectionChange(newSelection);
  };

  const handleDelete = (taskId: string) => {
    const now = Date.now();
    const confirmUntil = confirmDelete[taskId] || 0;
    
    if (confirmUntil > now) {
      // Confirmed, do delete
      onDelete([taskId]);
      setConfirmDelete(prev => {
        const next = { ...prev };
        delete next[taskId];
        return next;
      });
    } else {
      // First click, show confirm
      setConfirmDelete(prev => ({
        ...prev,
        [taskId]: now + 3000
      }));
      
      // Auto-cancel after 3 seconds
      setTimeout(() => {
        setConfirmDelete(prev => {
          const next = { ...prev };
          if (next[taskId] && next[taskId] <= Date.now()) {
            delete next[taskId];
          }
          return next;
        });
      }, 3000);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'queued': return 'text-gray-600';
      case 'running': return 'text-blue-600';
      case 'success': return 'text-green-600';
      case 'failed': return 'text-red-600';
      default: return 'text-gray-500';
    }
  };

  const formatTime = (date?: string) => {
    if (!date) return '';
    return new Date(date).toLocaleTimeString('en-US', { hour12: false });
  };

  const getTitleOrUrl = (task: RowState) => {
    if (task.title) return task.title;
    if (task.url) {
      try {
        const url = new URL(task.url);
        return url.hostname + url.pathname;
      } catch {
        return task.url;
      }
    }
    if (task.fileName) return task.fileName;
    return task.id.slice(0, 8);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>{t.tasksRunner.title} Tasks</span>
          {editMode && selectedIds.size > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => onDelete(Array.from(selectedIds))}
              disabled={Array.from(selectedIds).some(id => deletingIds.has(id))}
            >
              {Array.from(selectedIds).some(id => deletingIds.has(id))
                ? 'Deleting...'
                : `Delete Selected (${selectedIds.size})`}
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading && tasks.length === 0 ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : tasks.length === 0 ? (
          <div className="text-sm text-gray-500 text-center py-8">
            {t.tasksRunner.table.noTasks}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    {editMode && (
                      <th className="p-2">
                        <input
                          type="checkbox"
                          checked={tasks.length > 0 && tasks.every(t => selectedIds.has(t.id))}
                          onChange={(e) => handleSelectAll(e.target.checked)}
                        />
                      </th>
                    )}
                    <th className="p-2">{t.tasksRunner.table.columns.title}</th>
                    <th className="p-2">{t.tasksRunner.table.columns.status}</th>
                    <th className="p-2 min-w-[120px]">{t.tasksRunner.table.columns.progress}</th>
                    <th className="p-2">{t.tasksRunner.table.columns.updated}</th>
                    <th className="p-2">{t.tasksRunner.table.columns.source}</th>
                    {!editMode && <th className="p-2">{t.tasksRunner.table.columns.actions}</th>}
                  </tr>
                </thead>
                <tbody>
                  {tasks.map(task => {
                    const isConfirming = confirmDelete[task.id] && confirmDelete[task.id] > Date.now();
                    
                    return (
                      <tr key={task.id} className="border-t hover:bg-muted/40">
                        {editMode && (
                          <td className="p-2">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(task.id)}
                              onChange={(e) => handleSelectOne(task.id, e.target.checked)}
                            />
                          </td>
                        )}
                        <td className="p-2 truncate max-w-[300px]" title={getTitleOrUrl(task)}>
                          {task.remoteId && task.status === 'success' ? (
                            <Link 
                              href={`/video/${task.remoteId}`}
                              className="text-blue-600 hover:underline"
                            >
                              {getTitleOrUrl(task)}
                            </Link>
                          ) : (
                            <span>{getTitleOrUrl(task)}</span>
                          )}
                        </td>
                        <td className="p-2">
                          <span className={getStatusColor(task.status)}>
                            {task.status}
                          </span>
                        </td>
                        <td className="p-2">
                          {task.status === 'running' ? (
                            <Progress value={task.progress || 0} className="h-2" />
                          ) : (
                            <span className="text-xs text-gray-600">
                              {task.progress || 0}%
                            </span>
                          )}
                        </td>
                        <td className="p-2 text-xs text-gray-600">
                          {formatTime(task.updatedAt)}
                        </td>
                        <td className="p-2 text-xs">
                          {task.source}
                        </td>
                        {!editMode && (
                          <td className="p-2">
                            <div className="flex items-center gap-2">
                              {task.status === 'failed' && (
                                <button
                                  onClick={() => onRetry(task.id)}
                                  className="text-xs text-blue-600 hover:text-blue-800 underline"
                                >
                                  {t.tasksRunner.table.actions.retry}
                                </button>
                              )}
                              {task.status === 'running' && (
                                <button
                                  onClick={() => onCancel(task.id)}
                                  className="text-xs text-orange-600 hover:text-orange-800 underline"
                                >
                                  {t.tasksRunner.table.actions.cancel}
                                </button>
                              )}
                              <button
                                onClick={() => handleDelete(task.id)}
                                className={`text-xs underline ${
                                  isConfirming ? 'text-red-600' : 'text-gray-700'
                                }`}
                              >
                                {isConfirming ? t.tasksRunner.table.actions.confirm : t.tasksRunner.table.actions.delete}
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            
            {hasMore && onLoadMore && (
              <div className="mt-4 flex justify-center">
                <Button
                  variant="secondary"
                  onClick={onLoadMore}
                  disabled={loading}
                >
                  {loading ? 'Loading...' : t.tasksRunner.table.loadMore}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}