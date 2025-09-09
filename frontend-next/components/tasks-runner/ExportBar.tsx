'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { en as t } from '@/uiStrings/i18n/en';
// Phase 5 - Export functionality
import { EXPORT_SIZE_LIMIT_BYTES, EXPORT_PER_ITEM_MAX } from '@/lib/tasks-runner/constants';
import type { RowState } from '@/lib/tasks-runner/types';

export type ExportScope = 'current' | 'selected' | 'time';
export type ExportFormat = 'json' | 'csv';

interface ExportBarProps {
  tasks: RowState[];
  filteredTasks?: RowState[];
  selectedIds: Set<string>;
  onExport: (scope: ExportScope, format: ExportFormat, perItem: boolean) => void;
}

export function ExportBar({
  tasks,
  filteredTasks,
  selectedIds,
  onExport,
}: ExportBarProps) {
  const [scope, setScope] = useState<ExportScope>('current');
  const [format, setFormat] = useState<ExportFormat>('json');
  const [perItem, setPerItem] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const getExportData = () => {
    let dataToExport: RowState[] = [];
    
    switch (scope) {
      case 'current':
        dataToExport = (filteredTasks || tasks).filter(t => t.status === 'success');
        break;
      case 'selected':
        dataToExport = tasks.filter(t => selectedIds.has(t.id) && t.status === 'success');
        break;
      case 'time':
        dataToExport = tasks.filter(t => {
          if (t.status !== 'success') return false;
          if (!t.updatedAt) return false;
          
          const taskDate = new Date(t.updatedAt);
          const from = fromDate ? new Date(fromDate + 'T00:00:00') : null;
          const to = toDate ? new Date(toDate + 'T23:59:59') : null;
          
          if (from && taskDate < from) return false;
          if (to && taskDate > to) return false;
          
          return true;
        });
        break;
    }
    
    return dataToExport;
  };

  const estimateExportSize = () => {
    const data = getExportData();
    // More accurate estimate based on actual data
    const sampleTask = data[0];
    if (!sampleTask) return 0;
    
    // Estimate based on JSON stringification of first item
    const sampleSize = JSON.stringify(sampleTask).length;
    return data.length * sampleSize * 1.2; // Add 20% buffer for formatting
  };

  const handleExport = async () => {
    const dataToExport = getExportData();
    if (dataToExport.length === 0) {
      alert(t.tasksRunner.export.noData);
      return;
    }
    
    const estimatedSize = estimateExportSize();
    
    // Check size limit
    if (estimatedSize > EXPORT_SIZE_LIMIT_BYTES) {
      alert(t.tasksRunner.export.tooLarge);
      return;
    }
    
    // Check per-item limit and warn if truncating
    let actualData = dataToExport;
    if (perItem && dataToExport.length > EXPORT_PER_ITEM_MAX) {
      alert(t.tasksRunner.export.perItemLimit);
      actualData = dataToExport.slice(0, EXPORT_PER_ITEM_MAX);
    }
    
    setExporting(true);
    try {
      // Simulate async export for better UX
      await new Promise(resolve => setTimeout(resolve, 100));
      
      if (perItem) {
        // Export individual files
        actualData.forEach((task, index) => {
          const filename = `task-${index + 1}.${format}`;
          const content = format === 'json' 
            ? JSON.stringify(task, null, 2)
            : convertToCSV([task]);
          downloadFile(content, filename, format);
        });
      } else {
        // Export single file
        const filename = `tasks.${format}`;
        const content = format === 'json'
          ? JSON.stringify(actualData, null, 2)
          : convertToCSV(actualData);
        downloadFile(content, filename, format);
      }
    } finally {
      setExporting(false);
    }
  };
  
  const convertToCSV = (data: RowState[]) => {
    if (data.length === 0) return '';
    
    const headers = ['id', 'status', 'source', 'url', 'fileName', 'title', 'progress', 'updatedAt', 'remoteId', 'sizeBytes'];
    const rows = data.map(task => [
      task.id,
      task.status,
      task.source,
      task.url || '',
      task.fileName || '',
      task.title || '',
      String(task.progress || 0),
      task.updatedAt || '',
      task.remoteId || '',
      String(task.sizeBytes || 0),
    ]);
    
    return [
      headers.join(','),
      ...rows.map(row => row.map(cell => 
        // Escape CSV special characters
        typeof cell === 'string' && (cell.includes(',') || cell.includes('"') || cell.includes('\n'))
          ? `"${cell.replace(/"/g, '""')}"`
          : cell
      ).join(','))
    ].join('\n');
  };
  
  const downloadFile = (content: string, filename: string, type: 'json' | 'csv') => {
    const blob = new Blob([content], { 
      type: type === 'json' ? 'application/json' : 'text/csv' 
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const successCount = (filteredTasks || tasks).filter(t => t.status === 'success').length;
  const selectedSuccessCount = tasks.filter(t => selectedIds.has(t.id) && t.status === 'success').length;

  return (
    <div className="flex flex-wrap items-center gap-4 p-3 border rounded bg-gray-50">
      {/* Scope */}
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">{t.tasksRunner.exportBar.scope}:</label>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as ExportScope)}
          className="text-sm border rounded px-2 py-1"
        >
          <option value="current">
            {t.tasksRunner.exportBar.currentFilter} ({successCount})
          </option>
          <option value="selected" disabled={selectedIds.size === 0}>
            {t.tasksRunner.exportBar.selected} ({selectedSuccessCount})
          </option>
          <option value="time">
            {t.tasksRunner.exportBar.timeRange}
          </option>
        </select>
      </div>

      {/* Format */}
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">{t.tasksRunner.exportBar.format}:</label>
        <select
          value={format}
          onChange={(e) => setFormat(e.target.value as ExportFormat)}
          className="text-sm border rounded px-2 py-1"
        >
          <option value="json">{t.tasksRunner.exportBar.json}</option>
          <option value="csv">{t.tasksRunner.exportBar.csv}</option>
        </select>
      </div>

      {/* Time range inputs - only show when scope is 'time' */}
      {scope === 'time' && (
        <div className="flex items-center gap-2">
          <label className="text-sm">{t.tasksRunner.exportBar.from}:</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="text-sm border rounded px-2 py-1"
          />
          <label className="text-sm">{t.tasksRunner.exportBar.to}:</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="text-sm border rounded px-2 py-1"
          />
        </div>
      )}

      {/* Per-item checkbox */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="per-item"
          checked={perItem}
          onChange={(e) => setPerItem(e.target.checked)}
          disabled={exporting}
          className="rounded"
        />
        <label htmlFor="per-item" className="text-sm">
          {t.tasksRunner.exportBar.perItem}
          {perItem && getExportData().length > EXPORT_PER_ITEM_MAX && 
            ` (max ${EXPORT_PER_ITEM_MAX})`}
        </label>
      </div>

      {/* Export button */}
      <Button
        onClick={handleExport}
        disabled={exporting || getExportData().length === 0}
      >
        {exporting ? t.tasksRunner.exportBar.exporting : t.tasksRunner.exportBar.export}
      </Button>

      {/* Size warning */}
      <div className="text-xs text-gray-600 flex-1 text-right">
        {t.tasksRunner.exportBar.exportLimitWarning}
      </div>
    </div>
  );
}