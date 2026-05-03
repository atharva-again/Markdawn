import { IconCheck, IconInfoCircle, IconX } from '@tabler/icons-react';
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

let toastId = 0;
const listeners: Set<() => void> = new Set();
const toasts: Toast[] = [];

function emit() {
  for (const fn of listeners) {
    fn();
  }
}

function addToast(message: string, type: ToastType, duration: number) {
  const id = ++toastId;
  toasts.push({ id, message, type });
  emit();
  setTimeout(() => {
    const idx = toasts.findIndex((t) => t.id === id);
    if (idx !== -1) {
      toasts.splice(idx, 1);
      emit();
    }
  }, duration);
}

export function showSuccessToast(message: string) {
  addToast(message, 'success', 4000);
}

export function showErrorToast(message: string) {
  addToast(message, 'error', 5000);
}

export function showInfoToast(message: string) {
  addToast(message, 'info', 4000);
}

export function ToastContainer() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const listener = () => setTick((t) => t + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  if (toasts.length === 0) return null;

  return createPortal(
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[70] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => {
        const icon =
          toast.type === 'success' ? (
            <IconCheck size={16} />
          ) : toast.type === 'error' ? (
            <IconX size={16} />
          ) : (
            <IconInfoCircle size={16} />
          );
        return (
          <div
            key={toast.id}
            className="pointer-events-auto flex items-center gap-2 px-4 py-3 rounded-lg border shadow-lg animate-slide-down bg-[var(--color-surface-elevated)] border-[var(--color-border)] text-[var(--color-text)] min-w-[240px] max-w-[420px] w-fit mx-auto"
          >
            <span className="text-zinc-500 dark:text-zinc-400 shrink-0">{icon}</span>
            <span className="text-sm">{toast.message}</span>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
