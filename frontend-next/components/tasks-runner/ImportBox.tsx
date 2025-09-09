'use client';

import React, { useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { en as t } from '@/uiStrings/i18n/en';
import { CONCURRENCY_OPTIONS, DEFAULT_CONCURRENCY } from '@/lib/tasks-runner/constants';

interface ImportBoxProps {
  onAddUrls: (urls: string[]) => void;
  onAddFiles: (files: File[]) => void;
  onConcurrencyChange: (value: number) => void;
  onRunTasks: (urlsFromInput?: string[]) => void;
  onCancelAll: () => void;
  onClearQueue: () => void;
  disabled?: boolean;
  isRunning?: boolean;
  queuedCount?: number;
  runningCount?: number;
}

export function ImportBox({
  onAddUrls,
  onAddFiles,
  onConcurrencyChange,
  onRunTasks,
  onCancelAll,
  onClearQueue,
  disabled = false,
  isRunning = false,
  queuedCount = 0,
  runningCount = 0,
}: ImportBoxProps) {
  const [urls, setUrls] = useState('');
  const [concurrency, setConcurrency] = useState(DEFAULT_CONCURRENCY);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAddUrls = () => {
    const urlList = urls
      .split(/\n|\r/)
      .map(s => s.trim())
      .filter(Boolean);
    
    if (urlList.length > 0) {
      onAddUrls(urlList);
      setUrls('');
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      setPendingFiles(prev => [...prev, ...files]);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    const videoFiles = files.filter(f => f.type.startsWith('video/'));
    if (videoFiles.length > 0) {
      setPendingFiles(prev => [...prev, ...videoFiles]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleRunTasks = () => {
    // One-click Run: Process URLs first if any
    const urlList = urls
      .split(/\n|\r/)
      .map(s => s.trim())
      .filter(Boolean);
    
    // Add files if any
    if (pendingFiles.length > 0) {
      onAddFiles(pendingFiles);
      setPendingFiles([]);
    }
    
    // Run tasks (pass URLs to handle in one go)
    onRunTasks(urlList.length > 0 ? urlList : undefined);
    
    // Clear URL input if processed
    if (urlList.length > 0) {
      setUrls('');
    }
  };

  const removePendingFile = (index: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Import Tasks</span>
          <div className="flex items-center gap-2">
            <label className="text-sm font-normal">
              {t.tasksRunner.importBox.concurrency}:
            </label>
            <select
              value={concurrency}
              onChange={(e) => {
                const value = Number(e.target.value);
                setConcurrency(value);
                onConcurrencyChange(value);
              }}
              disabled={disabled || isRunning}
              className="border rounded px-2 py-1 text-sm"
            >
              {CONCURRENCY_OPTIONS.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
            {isRunning && runningCount > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={onCancelAll}
                disabled={disabled}
              >
                {t.tasksRunner.importBox.cancelAll}
              </Button>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* URL Import */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium">{t.tasksRunner.importBox.urlTitle}</h3>
            <textarea
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
              placeholder={t.tasksRunner.importBox.urlPlaceholder}
              disabled={disabled}
              className="w-full min-h-[160px] border rounded-md p-3 text-sm resize-none"
            />
            {/* Add URLs button removed - use Run button instead */}
          </div>

          {/* File Upload */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium">{t.tasksRunner.importBox.fileTitle}</h3>
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              className="min-h-[160px] border rounded-md p-3 text-center hover:border-gray-400 transition-colors bg-gray-50 flex flex-col justify-center"
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="video/*"
                onChange={handleFileSelect}
                disabled={disabled}
                className="hidden"
                id="file-upload"
              />
              <label
                htmlFor="file-upload"
                className="cursor-pointer text-sm text-gray-600"
              >
                {t.tasksRunner.importBox.dropzoneText}
              </label>
              <p className="text-xs text-gray-500 mt-2">
                {t.tasksRunner.importBox.acceptedFormats}
              </p>
            </div>

            {/* Pending Files */}
            {pendingFiles.length > 0 && (
              <div className="border rounded p-2 space-y-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">
                    {t.tasksRunner.importBox.pendingFiles} ({pendingFiles.length})
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPendingFiles([])}
                  >
                    Clear
                  </Button>
                </div>
                <div className="max-h-32 overflow-auto space-y-1">
                  {pendingFiles.map((file, index) => (
                    <div key={index} className="flex items-center justify-between text-xs">
                      <span className="truncate flex-1">
                        {file.name} ({(file.size / 1024 / 1024).toFixed(1)}MB)
                      </span>
                      <button
                        onClick={() => removePendingFile(index)}
                        className="text-red-600 hover:text-red-800 ml-2"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Control Buttons */}
        <div className="flex items-center justify-between mt-4 pt-4 border-t">
          <div className="flex items-center gap-2">
            <Button
              onClick={handleRunTasks}
              disabled={disabled || (pendingFiles.length === 0 && !urls.trim() && queuedCount === 0)}
              variant={urls.trim() || pendingFiles.length > 0 ? "default" : "secondary"}
            >
              {t.tasksRunner.importBox.runTasks}
            </Button>
            <Button
              variant="secondary"
              onClick={onClearQueue}
              disabled={disabled || queuedCount === 0}
            >
              {t.tasksRunner.importBox.clearQueue}
            </Button>
          </div>
          <div className="text-sm text-gray-600">
            {queuedCount > 0 && <span>Queued: {queuedCount}</span>}
            {runningCount > 0 && <span className="ml-3">Running: {runningCount}</span>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}