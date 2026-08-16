"use client";

import { useCallback, useMemo } from "react";
import { useToastStore } from "@/stores/toastStore";
import type { Toast } from "@/stores/toastStore";

export function useToast() {
  const addToast = useToastStore((s) => s.addToast);
  const removeToast = useToastStore((s) => s.removeToast);

  const success = useCallback(
    (title: string, description?: string, duration?: number) =>
      addToast({ type: "success", title, description, duration }),
    [addToast]
  );
  const error = useCallback(
    (title: string, description?: string, duration?: number) =>
      addToast({ type: "error", title, description, duration }),
    [addToast]
  );
  const info = useCallback(
    (title: string, description?: string, duration?: number) =>
      addToast({ type: "info", title, description, duration }),
    [addToast]
  );
  const warning = useCallback(
    (title: string, description?: string, duration?: number) =>
      addToast({ type: "warning", title, description, duration }),
    [addToast]
  );
  const toast = useCallback(
    (t: Omit<Toast, "id">) => addToast(t),
    [addToast]
  );
  const dismiss = useCallback((id: string) => removeToast(id), [removeToast]);

  return useMemo(
    () => ({ success, error, info, warning, toast, dismiss }),
    [success, error, info, warning, toast, dismiss]
  );
}