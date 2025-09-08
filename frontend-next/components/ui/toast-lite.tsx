"use client";

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export type ToastOptions = {
  id?: string;
  title?: string;
  description?: string;
  variant?: 'default' | 'success' | 'destructive' | 'warning';
  actionLabel?: string;
  onAction?: () => void;
  durationMs?: number;
};

type ToastCtx = {
  toast: (opts: ToastOptions) => void;
};

const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Required<ToastOptions>[]>([]);

  const toast = useCallback((opts: ToastOptions) => {
    const id = opts.id || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const it: Required<ToastOptions> = {
      id,
      title: opts.title || '',
      description: opts.description || '',
      variant: opts.variant || 'default',
      actionLabel: opts.actionLabel || '',
      onAction: opts.onAction || (() => {}),
      durationMs: opts.durationMs ?? 4000,
    };
    setItems((prev) => [...prev, it]);
    if (it.durationMs > 0) {
      setTimeout(() => dismiss(id), it.durationMs);
    }
  }, []);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={
              `shadow-lg rounded-md border px-4 py-3 bg-white w-80 ${
                t.variant === 'success' ? 'border-green-500' :
                t.variant === 'destructive' ? 'border-red-500' :
                t.variant === 'warning' ? 'border-yellow-500' : 'border-gray-300'
              }`
            }
          >
            {t.title && <div className="font-medium mb-1">{t.title}</div>}
            {t.description && <div className="text-sm text-gray-600">{t.description}</div>}
            {(t.actionLabel || true) && (
              <div className="mt-2 flex justify-end gap-2">
                {t.actionLabel && (
                  <button
                    className="text-sm text-blue-600 hover:underline"
                    onClick={() => {
                      t.onAction?.();
                      dismiss(t.id);
                    }}
                  >
                    {t.actionLabel}
                  </button>
                )}
                <button className="text-sm text-gray-500 hover:underline" onClick={() => dismiss(t.id)}>
                  关闭
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToastLite() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToastLite must be used within <ToastProvider>');
  return ctx;
}

