"use client";

export const dynamic = "force-dynamic";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { motion, AnimatePresence } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import type { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";

function MatchingAnimation() {
  return (
    <div className="flex flex-col items-center gap-6">
      <div className="relative w-24 h-24">
        <motion.div
          className="absolute inset-0 rounded-full border border-white/10"
          animate={{ scale: [1, 1.2, 1], opacity: [1, 0.3, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        />
        <div className="absolute inset-4 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
          <svg className="w-6 h-6 text-white/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
        </div>
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-white/80">Finding someone for you</p>
        <p className="text-xs text-white/40 mt-1">This usually takes just a moment</p>
      </div>
    </div>
  );
}

function RandomChatContent() {
  const router = useRouter();
  const [status, setStatus] = useState<"select" | "matching" | "connected">("select");
  const [matchError, setMatchError] = useState<string | null>(null);
  const supabaseRef = useRef<SupabaseClient | null>(null);
  const subscriptionRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    createClient().then((client) => {
      supabaseRef.current = client as unknown as SupabaseClient | null;
    });
  }, []);

  const unsubscribeMatching = useCallback(() => {
    if (subscriptionRef.current && supabaseRef.current) {
      supabaseRef.current.removeChannel(subscriptionRef.current);
      subscriptionRef.current = null;
    }
  }, []);

  const startMatching = useCallback(async () => {
    setStatus("matching");
    setMatchError(null);
    unsubscribeMatching();

    try {
      const res = await fetch("/api/matching/random", { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        setMatchError(data.error || "Failed to start matching");
        setStatus("select");
        return;
      }

      if (data.matched && data.sessionId) {
        setStatus("connected");
        setTimeout(() => router.push(`/chat/room/${data.sessionId}`), 800);
        return;
      }

      const supabase = supabaseRef.current;
      if (!supabase) {
        setMatchError("Failed to initialize connection");
        setStatus("select");
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user.id;
      if (!userId) return;

      const channel = supabase
        .channel(`matching_update_${userId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "matching_queue",
            filter: `user_id=eq.${userId}`,
          },
          (payload: { new: Record<string, unknown> }) => {
            const newData = payload.new as Record<string, unknown>;
            if (newData && newData.status === "matched" && newData.session_id) {
              setStatus("connected");
              setTimeout(() => router.push(`/chat/room/${newData.session_id}`), 500);
            }
          }
        )
        .subscribe();

      subscriptionRef.current = channel;
    } catch {
      setMatchError("Something went wrong. Please try again.");
      setStatus("select");
    }
  }, [router, unsubscribeMatching]);

  const cancelMatching = useCallback(async () => {
    unsubscribeMatching();
    await fetch("/api/matching/random", { method: "DELETE" }).catch(() => {});
    setStatus("select");
  }, [unsubscribeMatching]);

  useEffect(() => {
    return () => {
      unsubscribeMatching();
      fetch("/api/matching/random", { method: "DELETE" }).catch(() => {});
    };
  }, [unsubscribeMatching]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4 pt-16">
      <AnimatePresence mode="wait">
        {status === "select" && (
          <motion.div
            key="select"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="w-full max-w-sm"
          >
            <div className="glass-card rounded-2xl p-8 text-center">
              <h1 className="text-xl font-semibold text-white/90 mb-2">Random Chat</h1>
                <p className="text-sm text-muted mb-6">
                  Instantly connect with a random person.
                </p>
              <div className="flex flex-col gap-2">
                <Button size="lg" onClick={() => startMatching()}>
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Video Chat (2 tokens)
                </Button>
                <Button variant="secondary" size="lg" onClick={() => startMatching()}>
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  Text Chat (2 tokens)
                </Button>
              </div>
              {matchError && (
                <p className="text-xs text-red-400/80 mt-4">{matchError}</p>
              )}
            </div>
          </motion.div>
        )}

        {status === "matching" && (
          <motion.div
            key="matching"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            role="status" aria-live="polite"
          >
            <div className="glass-card rounded-3xl p-10 text-center">
              <MatchingAnimation />
              <button
                onClick={cancelMatching}
                className="mt-6 text-xs text-white/30 hover:text-white/60 transition-colors"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        )}

        {status === "connected" && (
          <motion.div
            key="connected"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <div className="glass-card rounded-3xl p-10 text-center">
              <div className="w-12 h-12 mx-auto rounded-full bg-success-soft border border-success/20 flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-green-400" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-white/80">Match found!</p>
              <p className="text-xs text-white/40 mt-1">Connecting you now...</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function RandomChatPage() {
  return (
    <AuthGuard>
      <RandomChatContent />
    </AuthGuard>
  );
}
