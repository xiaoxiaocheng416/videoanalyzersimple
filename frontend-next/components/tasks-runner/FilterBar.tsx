'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { en as t } from '@/uiStrings/i18n/en';

export type StatusFilter = '' | 'queued' | 'running' | 'success' | 'failed';
export type SourceFilter = '' | 'url' | 'file';
export type SortBy = 'updatedDesc' | 'createdDesc' | 'status';

interface FilterBarProps {
  statusFilter: StatusFilter;
  sourceFilter: SourceFilter;
  sortBy: SortBy;
  searchQuery: string;
  statusCounts: {
    queued: number;
    running: number;
    success: number;
    failed: number;
  };
  totalCount: number;
  onStatusChange: (status: StatusFilter) => void;
  onSourceChange: (source: SourceFilter) => void;
  onSortChange: (sort: SortBy) => void;
  onSearchChange: (query: string) => void;
  onClearFilters: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  queued: 'bg-gray-100 text-gray-800 hover:bg-gray-200',
  running: 'bg-blue-100 text-blue-800 hover:bg-blue-200',
  success: 'bg-green-100 text-green-800 hover:bg-green-200',
  failed: 'bg-red-100 text-red-800 hover:bg-red-200',
};

export function FilterBar({
  statusFilter,
  sourceFilter,
  sortBy,
  searchQuery,
  statusCounts,
  totalCount,
  onStatusChange,
  onSourceChange,
  onSortChange,
  onSearchChange,
  onClearFilters,
}: FilterBarProps) {
  const hasActiveFilters = statusFilter !== '' || sourceFilter !== '' || searchQuery !== '';

  return (
    <div className="flex flex-wrap items-center gap-3 p-3 border-b bg-gray-50">
      {/* Status Chips */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onStatusChange('')}
          className={`text-xs rounded-full px-3 py-1 border transition-all ${
            statusFilter === '' ? 'ring-2 ring-offset-1 ring-blue-400 bg-white' : 'bg-white hover:bg-gray-100'
          }`}
        >
          {t.tasksRunner.filterBar.allTasks} · {totalCount}
        </button>
        
        {(['queued', 'running', 'success', 'failed'] as const).map(status => (
          <button
            key={status}
            onClick={() => onStatusChange(statusFilter === status ? '' : status)}
            className={`text-xs rounded-full px-3 py-1 border transition-all ${
              STATUS_COLORS[status]
            } ${
              statusFilter === status ? 'ring-2 ring-offset-1 ring-blue-400' : ''
            }`}
          >
            {status} · {statusCounts[status]}
          </button>
        ))}
      </div>

      {/* Source Filter */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-gray-600">{t.tasksRunner.filterBar.source}:</span>
        <select
          value={sourceFilter}
          onChange={(e) => onSourceChange(e.target.value as SourceFilter)}
          className="text-sm border rounded px-2 py-1"
        >
          <option value="">{t.tasksRunner.filterBar.allTasks}</option>
          <option value="url">{t.tasksRunner.filterBar.url}</option>
          <option value="file">{t.tasksRunner.filterBar.file}</option>
        </select>
      </div>

      {/* Sort */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-gray-600">{t.tasksRunner.filterBar.sort}:</span>
        <select
          value={sortBy}
          onChange={(e) => onSortChange(e.target.value as SortBy)}
          className="text-sm border rounded px-2 py-1"
        >
          <option value="updatedDesc">{t.tasksRunner.filterBar.updatedDesc}</option>
          <option value="createdDesc">{t.tasksRunner.filterBar.createdDesc}</option>
          <option value="status">{t.tasksRunner.filterBar.statusSort}</option>
        </select>
      </div>

      {/* Search */}
      <div className="flex-1 max-w-xs">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t.tasksRunner.filterBar.search}
          className="w-full text-sm border rounded px-3 py-1"
        />
      </div>

      {/* Clear Filters */}
      {hasActiveFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearFilters}
        >
          {t.tasksRunner.filterBar.clearFilters}
        </Button>
      )}
    </div>
  );
}