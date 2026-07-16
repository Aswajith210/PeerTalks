"use client";

import { useToastStore } from "@/stores/toastStore";
import type { Toast } from "@/stores/toastStore";

export function useToast() {
  const addToast = useToastStore((s) => s.addToast);
  const removeToast = useToastStore((s) => s.removeToast);

  return {
    success: (title: string, description?: string, duration?: number) =>
      addToast({ type: "success", title, description, duration }),
    error: (title: string, description?: string, duration?: number) =>
      addToast({ type: "error", title, description, duration }),
    info: (title: string, description?: string, duration?: number) =>
      addToast({ type: "info", title, description, duration }),
    warning: (title: string, description?: string, duration?: number) =>
      addToast({ type: "warning", title, description, duration }),
    toast: (toast: Omit<Toast, "id">) => addToast(toast),
    dismiss: removeToast,
  };
}
