"use client";

import React from 'react';
import { Badge } from '@/components/ui/badge';

export type StatusCounts = Partial<Record<'queued' | 'running' | 'success' | 'failed' | 'canceled', number>>;

const COLORS: Record<string, string> = {
  success: 'bg-green-100 text-green-800 hover:bg-green-100',
  failed: 'bg-red-100 text-red-800 hover:bg-red-100',
  running: 'bg-blue-100 text-blue-800 hover:bg-blue-100',
  queued: 'bg-gray-100 text-gray-800 hover:bg-gray-100',
  canceled: 'bg-zinc-100 text-zinc-800 hover:bg-zinc-100',
};

export function StatusChips({
  counts,
  active,
  onSelect,
}: {
  counts: StatusCounts;
  active: string;
  onSelect: (status: string) => void;
}) {
  const entries = (['queued', 'running', 'success', 'failed', 'canceled'] as const).map((k) => [k, counts[k] || 0] as const);
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {entries.map(([k, n]) => (
        <button
          key={k}
          onClick={() => onSelect(active === k ? '' : k)}
          className={`text-xs rounded-full px-2 py-1 border ${COLORS[k]} ${active === k ? 'ring-2 ring-offset-1 ring-blue-400' : ''}`}
        >
          {k} {n > 0 ? `· ${n}` : ''}
        </button>
      ))}
    </div>
  );
}

