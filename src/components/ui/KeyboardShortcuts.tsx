"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";

interface Shortcut {
  key: string;
  description: string;
  action?: () => void;
}

export function KeyboardShortcuts() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const shortcuts: Shortcut[] = useMemo(
    () => [
      { key: "?", description: "Show keyboard shortcuts" },
      { key: "g r", description: "Go to Random Chat", action: () => router.push("/chat/random") },
      { key: "g i", description: "Go to Interest Chat", action: () => router.push("/chat/interest") },
      { key: "g p", description: "Go to Private Room", action: () => router.push("/chat/room/new") },
      { key: "g d", description: "Go to Dashboard", action: () => router.push("/dashboard") },
      { key: "Escape", description: "Close dialog / Cancel" },
    ],
    [router]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

      if (e.key === "?" && !e.shiftKey) {
        setOpen((prev) => !prev);
        return;
      }

      if (e.key === "Escape" && open) {
        setOpen(false);
        return;
      }

      if (e.key === "g" && open) return;

      if (e.key === "g") {
        const handler = (e2: KeyboardEvent) => {
          const key = e2.key.toLowerCase();
          const shortcut = shortcuts.find((s) => s.key === `g ${key}`);
          if (shortcut?.action) {
            shortcut.action();
            setOpen(false);
          }
          window.removeEventListener("keydown", handler);
        };
        window.addEventListener("keydown", handler);
      }
    },
    [open, shortcuts]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-[90]"
            onClick={() => setOpen(false)}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[91] w-full max-w-sm"
          >
            <div className="glass-strong rounded-2xl p-6 shadow-premium-lg">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-sm font-semibold text-white/90">Keyboard Shortcuts</h2>
                <button
                  onClick={() => setOpen(false)}
                  className="w-6 h-6 rounded-lg hover:bg-white/5 flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                  aria-label="Close"
                >
                  <svg className="w-3.5 h-3.5 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="space-y-1">
                {shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.key}
                    className="flex items-center justify-between py-2 px-2.5 rounded-lg hover:bg-white/[0.02] transition-colors"
                  >
                    <span className="text-sm text-white/50">{shortcut.description}</span>
                    <kbd className="inline-flex items-center h-6 px-2 rounded-md bg-white/[0.04] border border-white/[0.08] text-[10px] text-muted font-mono">
                      {shortcut.key}
                    </kbd>
                  </div>
                ))}
              </div>
              <p className="text-xs text-white/20 text-center mt-5">
                Press <kbd className="inline-flex items-center h-5 px-1.5 rounded bg-white/[0.04] border border-white/[0.08] text-[10px] text-white/25 font-mono">?</kbd> to toggle
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
