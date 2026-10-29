"use client";

import { useEffect } from "react";

export interface ToastData {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

/** A small bottom toast with an optional action (used for "Moved to Done · Undo"). */
export function StatusToast({ toast, onDismiss }: { toast: ToastData | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDismiss, 5000);
    return () => clearTimeout(t);
  }, [toast, onDismiss]);

  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      {toast && (
        <div className="pointer-events-auto flex items-center gap-4 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900">
          <span>{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              className="font-semibold text-indigo-300 hover:underline dark:text-indigo-700"
              onClick={() => {
                toast.action?.run();
                onDismiss();
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
