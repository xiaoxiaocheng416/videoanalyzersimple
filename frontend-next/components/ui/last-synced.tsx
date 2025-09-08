"use client";

import React from 'react';

export function LastSynced({ at }: { at: Date | null }) {
  if (!at) return <span className="text-sm text-gray-500">尚未同步</span>;
  const hh = at.getHours().toString().padStart(2, '0');
  const mm = at.getMinutes().toString().padStart(2, '0');
  const ss = at.getSeconds().toString().padStart(2, '0');
  return <span className="text-sm text-gray-500">上次同步 {`${hh}:${mm}:${ss}`}</span>;
}

