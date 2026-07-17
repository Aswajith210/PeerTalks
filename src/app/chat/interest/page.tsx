"use client";

export const dynamic = "force-dynamic";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { motion, AnimatePresence } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import type { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";

const SUGGESTED_INTERESTS = [
  "Music", "Gaming", "Art", "Technology",
  "Sports", "Travel", "Movies", "Books",
  "Cooking", "Photography", "Fitness", "Science",
  "Anime", "Fashion", "Nature", "Philosophy",
];

function InterestChatContent() {
  const router = useRouter();
  const [interests, setInterests] = useState<string[]>([]);
  const [customInterest, setCustomInterest] = useState("");
  const [status, setStatus] = useState<"select" | "matching" | "connected">("select");
  const [error, setError] = useState<string | null>(null);
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

  useEffect(() => {
    return () => {
      unsubscribeMatching();
      fetch("/api/matching/interest", { method: "DELETE" }).catch(() => {});
    };
  }, [unsubscribeMatching]);

  const toggleInterest = (interest: string) => {
    setInterests((prev) =>
      prev.includes(interest)
        ? prev.filter((i) => i !== interest)
        : [...prev, interest]
    );
  };

  const addCustomInterest = () => {
    const trimmed = customInterest.trim();
    if (trimmed && !interests.includes(trimmed) && interests.length < 10) {
      setInterests((prev) => [...prev, trimmed]);
      setCustomInterest("");
    }
  };

  const startMatching = useCallback(async () => {
    if (interests.length === 0) {
      setError("Please select at least one interest");
      return;
    }

    setStatus("matching");
    setError(null);
    unsubscribeMatching();

    try {
      const supabase = supabaseRef.current;
      if (!supabase) return;

      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user.id;
      if (!userId) return;

      const channel = supabase
        .channel(`interest_matching_${userId}`)
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

      const res = await fetch("/api/matching/interest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interests }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to start matching");
        setStatus("select");
        return;
      }

      if (data.matched && data.sessionId) {
        setStatus("connected");
        setTimeout(() => router.push(`/chat/room/${data.sessionId}`), 800);
        return;
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setStatus("select");
    }
  }, [interests, router, unsubscribeMatching]);

  const cancelMatching = useCallback(async () => {
    unsubscribeMatching();
    await fetch("/api/matching/interest", { method: "DELETE" }).catch(() => {});
    setStatus("select");
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
            className="w-full max-w-lg"
          >
            <div className="glass-card rounded-2xl p-8">
              <div className="text-center mb-6">
                <h1 className="text-xl font-semibold text-white/90 mb-2">Interest Chat</h1>
                <p className="text-sm text-muted">Select your interests to find people who share your passions.</p>
              </div>

              <div className="mb-6">
                <p className="text-xs font-medium text-white/50 mb-2">Suggested interests</p>
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTED_INTERESTS.map((interest) => (
                    <button
                      key={interest}
                      onClick={() => toggleInterest(interest)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
                        interests.includes(interest)
                          ? "bg-white/15 text-white border border-white/20"
                          : "bg-white/5 text-white/40 border border-white/10 hover:border-white/20 hover:text-white/60"
                      }`}
                    >
                      {interest}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 mb-6">
                <Input
                  placeholder="Add custom interest..."
                  value={customInterest}
                  onChange={(e) => setCustomInterest(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addCustomInterest();
                  }}
                />
                <Button variant="secondary" onClick={addCustomInterest}>
                  Add
                </Button>
              </div>

              {interests.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-6">
                  {interests.map((interest) => (
                    <span
                      key={interest}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-white/10 text-white/70 border border-white/20"
                    >
                      {interest}
                      <button
                        onClick={() => toggleInterest(interest)}
                        className="text-white/40 hover:text-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 rounded"
                        aria-label={`Remove ${interest}`}
                      >
                        &times;
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {error && <p className="text-xs text-red-400/80 mb-4 text-center">{error}</p>}

              <Button
                size="lg"
                className="w-full"
                onClick={startMatching}
                disabled={interests.length === 0}
              >
                Find a match (2 tokens)
              </Button>
            </div>
          </motion.div>
        )}

        {status === "matching" && (
          <motion.div
            key="matching"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
          >
            <div className="glass-card rounded-3xl p-10 text-center">
              <div className="relative w-24 h-24 mx-auto mb-6">
                <motion.div
                  className="absolute inset-0 rounded-full border border-white/10"
                  animate={{ scale: [1, 1.2, 1], opacity: [1, 0.3, 1] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                />
                <div className="absolute inset-4 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
                  <svg className="w-6 h-6 text-white/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    <path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                  </svg>
                </div>
              </div>
              <p className="text-sm font-medium text-white/80 mb-3">Looking for someone who shares your interests</p>
              <div className="flex flex-wrap justify-center gap-1.5 mb-6">
                {interests.map((i) => (
                  <span key={i} className="px-2.5 py-1 rounded-full text-xs font-medium bg-white/10 text-white/70 border border-white/20">{i}</span>
                ))}
              </div>
              <button
                onClick={cancelMatching}
                className="text-xs text-white/30 hover:text-white/60 transition-colors"
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

export default function InterestChatPage() {
  return (
    <AuthGuard>
      <InterestChatContent />
    </AuthGuard>
  );
}
