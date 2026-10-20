"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

interface ToastAction {
  label: string;
  run: () => void | Promise<void>;
}

interface ToastItem {
  id: number;
  message: string;
  action?: ToastAction;
  tone: "info" | "error";
}

interface ToastApi {
  /** Shows a message; an action (usually Undo) stays reachable by keyboard until it fades. */
  notify: (message: string, options?: { action?: ToastAction; tone?: "info" | "error" }) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DURATION_MS = 6000;
const MAX_VISIBLE = 3;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);

  const notify = useCallback<ToastApi["notify"]>(
    (message, options) => {
      const id = nextId.current++;
      const item: ToastItem = { id, message, tone: options?.tone ?? "info", ...(options?.action ? { action: options.action } : {}) };
      setToasts((all) => [...all, item].slice(-MAX_VISIBLE));
      window.setTimeout(() => dismiss(id), DURATION_MS);
    },
    [dismiss],
  );

  const api = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext value={api}>
      {children}
      {/* A polite live region: messages are announced without stealing focus. */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto flex max-w-[480px] items-center gap-4 rounded-md border border-border bg-surface px-4 py-3 text-sm shadow-pop"
          >
            <span className={toast.tone === "error" ? "text-danger" : undefined}>
              {toast.tone === "error" && <span aria-hidden="true">⚠ </span>}
              {toast.message}
            </span>
            {toast.action && (
              <button
                type="button"
                className="font-medium text-accent-strong underline"
                onClick={() => {
                  dismiss(toast.id);
                  void toast.action?.run();
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext>
  );
}

export function useToast(): ToastApi {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used inside a ToastProvider");
  return value;
}
