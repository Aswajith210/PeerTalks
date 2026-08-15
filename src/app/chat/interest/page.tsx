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
import { useTokens } from "@/hooks/useTokens";
import { startLocalStream, stopLocalStream } from "@/lib/webrtc/peerConnection";
import { MATCHING_TIMEOUT_MS } from "@/lib/constants";

const SUGGESTED_INTERESTS = [
  "Music", "Gaming", "Art", "Technology",
  "Sports", "Travel", "Movies", "Books",
  "Cooking", "Photography", "Fitness", "Science",
  "Anime", "Fashion", "Nature", "Philosophy",
];

const MEDIA_ERROR_MESSAGES: Record<string, string> = {
  NotAllowedError:
    "Camera and microphone access was denied. Please allow camera and microphone for this site, then try again.",
  NotFoundError: "No camera or microphone was found on this device.",
  NotReadableError:
    "Your camera or microphone is in use by another application. Close it and try again.",
  OverconstrainedError:
    "Your camera could not start with the required settings. Try again.",
  SecurityError:
    "Camera and microphone access is only available over a secure (HTTPS) connection.",
};

function mediaErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : (error as { name?: string })?.name;
  if (name && MEDIA_ERROR_MESSAGES[name]) return MEDIA_ERROR_MESSAGES[name];
  return "Camera and microphone access is required for video chat.";
}

function InterestChatContent() {
  const router = useRouter();
  const { refresh, setBalance } = useTokens();
  const [interests, setInterests] = useState<string[]>([]);
  const [customInterest, setCustomInterest] = useState("");
  const [status, setStatus] = useState<"select" | "matching" | "connected">("select");
  const [callType, setCallType] = useState<"video" | "text">("video");
  const [error, setError] = useState<string | null>(null);
  const supabaseRef = useRef<SupabaseClient | null>(null);
  const subscriptionRef = useRef<RealtimeChannel | null>(null);
  const matchingRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const requestKeyRef = useRef<string | null>(null);
  // Attempt generation: bumped on start/cancel/abort so a stale in-flight
  // poll response (or its pending navigation timer) can never push the user
  // into a room after they cancelled.
  const attemptGenRef = useRef(0);

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

  const clearMatchingTimers = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
  }, []);

  const releaseLocalMedia = useCallback(() => {
    stopLocalStream(localStreamRef.current);
    localStreamRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      unsubscribeMatching();
      clearMatchingTimers();
      releaseLocalMedia();
      const key = requestKeyRef.current;
      fetch("/api/matching/interest", {
        method: "DELETE",
        headers: key ? { "x-request-id": key } : {},
      }).catch(() => {});
    };
  }, [unsubscribeMatching, clearMatchingTimers, releaseLocalMedia]);

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
    if (matchingRef.current) return;
    matchingRef.current = true;
    attemptGenRef.current++;
    const gen = attemptGenRef.current;

    setStatus("matching");
    setError(null);
    unsubscribeMatching();
    clearMatchingTimers();

    const abortWithError = (message: string) => {
      console.error("[PeerTalks][MATCH] aborting with error", { message });
      matchingRef.current = false;
      attemptGenRef.current++;
      clearMatchingTimers();
      unsubscribeMatching();
      releaseLocalMedia();
      // Send the attempt's idempotency key so the server refund is keyed
      // (a duplicate DELETE can never refund the same charge twice).
      const key = requestKeyRef.current;
      requestKeyRef.current = null;
      // Remove any waiting queue row (and refund when one was removed) so
      // a timed-out/failed attempt never strands tokens or queue entries.
      fetch("/api/matching/interest", {
        method: "DELETE",
        headers: key ? { "x-request-id": key } : {},
      })
        .then(async (res) => {
          const body = (await res.json().catch(() => null)) as { balance?: number } | null;
          if (body && typeof body.balance === "number") setBalance(body.balance);
        })
        .catch(() => {});
      void refresh();
      setError(message);
      setStatus("select");
    };

    try {
      const supabase = supabaseRef.current;
      if (!supabase) {
        setError("Failed to initialize connection");
        setStatus("select");
        matchingRef.current = false;
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id ?? (await supabase.auth.getSession()).data.session?.user.id;
      if (!userId) {
        setError("Not signed in");
        setStatus("select");
        matchingRef.current = false;
        return;
      }
      console.log("[PeerTalks][AUTH] interest startMatching", { userId, callType });

      // Video chat requests camera/mic BEFORE entering the queue — the
      // user must see the permission prompt now, and any denial must be
      // visible instead of silently waiting forever. Text never requests
      // media.
      if (callType === "video") {
        try {
          // startLocalStream() defaults carry the 720p caps — unconstrained
          // getUserMedia would pick the camera's maximum (4K on phones).
          const stream = await startLocalStream();
          localStreamRef.current = stream;
          console.log("[PeerTalks][MEDIA] local stream acquired", {
            videoTracks: stream.getVideoTracks().length,
            audioTracks: stream.getAudioTracks().length,
          });
        } catch (mediaError) {
          const message = mediaErrorMessage(mediaError);
          console.error("[PeerTalks][MEDIA] getUserMedia failed", {
            name: mediaError instanceof DOMException ? mediaError.name : String(mediaError),
          });
          setError(message);
          setStatus("select");
          matchingRef.current = false;
          return;
        }
      } else {
        console.log("[PeerTalks][MEDIA] text chat — no camera/mic requested");
      }

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
              if (attemptGenRef.current !== gen) return;
              console.log("[PeerTalks][Realtime] matched event", { sessionId: newData.session_id });
              matchingRef.current = false;
              setStatus("connected");
              clearMatchingTimers();
              releaseLocalMedia();
              setTimeout(() => {
                if (attemptGenRef.current === gen) {
                  router.push(`/chat/room/${newData.session_id}`);
                }
              }, 500);
            }
          }
        )
        .subscribe((status) => {
          console.log("[PeerTalks][Realtime] channel status", { status });
        });

      subscriptionRef.current = channel;

      // One idempotency key for the whole attempt: re-polling with the same
      // key can never charge the user twice.
      requestKeyRef.current = globalThis.crypto.randomUUID();

      const attemptMatch = async (): Promise<boolean> => {
        const res = await fetch("/api/matching/interest", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-call-type": callType,
            "x-request-id": requestKeyRef.current ?? "",
          },
          body: JSON.stringify({ interests }),
        });
        const data = await res.json().catch(() => null);
        if (typeof data?.balance === "number") setBalance(data.balance);
        void refresh();

        if (!res.ok || data?.error) {
          console.warn("[PeerTalks][Match RPC] POST rejected", {
            userId, status: res.status, body: data,
          });
          if (data?.reason === "matchmaking_unavailable") {
            abortWithError(
              data.error ??
                "Matchmaking isn't ready yet. Check the database setup and try again in a moment."
            );
          } else if (data?.reason === "queue_insert_failed") {
            abortWithError(data.error ?? "Could not join the matching queue. Please try again.");
          } else if (res.status === 429) {
            abortWithError("Too many requests. Wait a moment and try again.");
          } else if (res.status === 400) {
            abortWithError(data?.error ?? "You don't have enough tokens for this chat.");
          } else {
            abortWithError(data?.error ?? "Could not start matchmaking. Please try again.");
          }
          return false;
        }

        if (data?.matched && data.sessionId) {
          if (attemptGenRef.current !== gen) return false;
          console.log("[PeerTalks][Session] matched via response", { sessionId: data.sessionId });
          matchingRef.current = false;
          setStatus("connected");
          clearMatchingTimers();
          releaseLocalMedia();
          setTimeout(() => {
            if (attemptGenRef.current === gen) {
              router.push(`/chat/room/${data.sessionId}`);
            }
          }, 800);
          return true;
        }

        console.log("[PeerTalks][Queue] waiting, no match yet", { userId });
        return false;
      };

      const matchedNow = await attemptMatch();
      if (matchedNow) return;

      // The RPC only pairs users when it runs, so two people who join at the
      // same moment would otherwise wait forever. Poll with the same key
      // (idempotent — no double charge) until matched, cancelled or timeout.
      pollTimerRef.current = setInterval(async () => {
        if (!matchingRef.current) {
          clearMatchingTimers();
          return;
        }
        const hit = await attemptMatch();
        if (hit) clearMatchingTimers();
      }, 4000);

      // Never leave the user on "Looking for someone" indefinitely.
      timeoutTimerRef.current = setTimeout(() => {
        if (!matchingRef.current) return;
        abortWithError(
          "Couldn't find a match this time. Please try again — both users need to be waiting at the same time."
        );
      }, MATCHING_TIMEOUT_MS);
    } catch {
      abortWithError("Something went wrong. Please try again.");
    }
  }, [interests, callType, router, unsubscribeMatching, refresh, setBalance, clearMatchingTimers, releaseLocalMedia]);

  const cancelMatching = useCallback(async () => {
    // Bump the attempt generation: an in-flight poll response (or its
    // pending navigation timer) must never push us into a room after the
    // user already pressed Cancel.
    attemptGenRef.current++;
    matchingRef.current = false;
    clearMatchingTimers();
    unsubscribeMatching();
    releaseLocalMedia();
    const key = requestKeyRef.current;
    requestKeyRef.current = null;
    const res = await fetch("/api/matching/interest", {
      method: "DELETE",
      headers: key ? { "x-request-id": key } : {},
      body: JSON.stringify({ cleanupMatched: true }),
    }).catch(() => null);
    if (res) {
      const body = (await res.json().catch(() => null)) as { balance?: number } | null;
      if (body && typeof body.balance === "number") setBalance(body.balance);
    }
    await refresh();
    setStatus("select");
  }, [unsubscribeMatching, refresh, setBalance, clearMatchingTimers, releaseLocalMedia]);

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

              <div className="flex rounded-lg bg-white/5 border border-white/10 p-0.5 mb-6">
                <button
                  onClick={() => setCallType("video")}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
                    callType === "video"
                      ? "bg-white/10 text-white border border-white/10"
                      : "text-white/40 hover:text-white/60"
                  } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20`}
                >
                  Video
                </button>
                <button
                  onClick={() => setCallType("text")}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
                    callType === "text"
                      ? "bg-white/10 text-white border border-white/10"
                      : "text-white/40 hover:text-white/60"
                  } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20`}
                >
                  Text
                </button>
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
                Find a {callType === "video" ? "video" : "text"} match (2 tokens)
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
