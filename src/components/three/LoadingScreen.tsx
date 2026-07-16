"use client";

import { motion } from "framer-motion";

export function LoadingScreen() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      <motion.div
        className="flex flex-col items-center gap-6"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="relative w-20 h-20">
          <div className="absolute inset-0 rounded-2xl glass-strong" />
          <motion.div
            className="absolute inset-0 rounded-2xl"
            animate={{
              boxShadow: [
                "0 0 0 0 rgba(229, 229, 234, 0.08)",
                "0 0 0 8px rgba(229, 229, 234, 0.04)",
                "0 0 0 16px rgba(229, 229, 234, 0)",
              ],
            }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <svg className="w-7 h-7 text-white/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
        </div>
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm text-muted font-medium tracking-wider uppercase">PeerTalks</p>
          <div className="flex gap-1.5">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-white/15"
                animate={{
                  opacity: [0.15, 0.6, 0.15],
                  scale: [1, 1.3, 1],
                }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  delay: i * 0.2,
                  ease: "easeInOut",
                }}
              />
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
