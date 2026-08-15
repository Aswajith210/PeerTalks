"use client";

export const dynamic = "force-dynamic";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { motion, AnimatePresence } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import type { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";
import { useTokens } from "@/hooks/useTokens";
import { startLocalStream, stopLocalStream } from "@/lib/webrtc/peerConnection";
import { MATCHING_TIMEOUT_MS } from "@/lib/constants";

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

function RandomChatContent() {
  const router = useRouter();
  const { refresh, setBalance } = useTokens();
  const [status, setStatus] = useState<"select" | "matching" | "connected">("select");
  const [matchError, setMatchError] = useState<string | null>(null);
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

  const startMatching = useCallback(async (callType: "video" | "text" = "video") => {
    if (matchingRef.current) return;
    matchingRef.current = true;
    attemptGenRef.current++;
    const gen = attemptGenRef.current;
    setStatus("matching");
    setMatchError(null);
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
      fetch("/api/matching/random", {
        method: "DELETE",
        headers: key ? { "x-request-id": key } : {},
      })
        .then(async (res) => {
          const body = (await res.json().catch(() => null)) as { balance?: number } | null;
          if (body && typeof body.balance === "number") setBalance(body.balance);
        })
        .catch(() => {});
      void refresh();
      setMatchError(message);
      setStatus("select");
    };

    try {
      const supabase = supabaseRef.current;
      if (!supabase) {
        setMatchError("Failed to initialize connection");
        setStatus("select");
        matchingRef.current = false;
        return;
      }
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id ?? (await supabase.auth.getSession()).data.session?.user.id;
      if (!userId) {
        setMatchError("Not signed in");
        setStatus("select");
        matchingRef.current = false;
        return;
      }
      console.log("[PeerTalks][AUTH] authenticated: true");
      console.log("[PeerTalks][AUTH] userId:", userId);
      console.log("[PeerTalks][AUTH] random startMatching", { userId, callType });

      // Video chat requires camera/mic BEFORE we ever enter the queue —
      // the user must see the permission prompt now, and any denial must
      // be visible instead of silently waiting forever. Text chat never
      // requests media.
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
          setMatchError(message);
          setStatus("select");
          matchingRef.current = false;
          return;
        }
      } else {
        console.log("[PeerTalks][MEDIA] text chat — no camera/mic requested");
      }

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
              if (attemptGenRef.current !== gen) return;
              console.log("[PeerTalks][MATCH] realtime matched event", { sessionId: newData.session_id });
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
        .subscribe((subStatus) => {
          console.log("[PeerTalks][MATCH] realtime channel status", { userId, status: subStatus });
        });

      subscriptionRef.current = channel;

      // One idempotency key for the whole attempt: re-polling with the same
      // key can never charge the user twice.
      requestKeyRef.current = globalThis.crypto.randomUUID();

      const attemptMatch = async (): Promise<boolean> => {
        const res = await fetch("/api/matching/random", {
          method: "POST",
          headers: {
            "x-call-type": callType,
            "x-request-id": requestKeyRef.current ?? "",
          },
        });
        const data = (await res.json().catch(() => null)) as
          | { error?: string; reason?: string; balance?: number; matched?: boolean; sessionId?: string; queueId?: number }
          | null;
        if (typeof data?.balance === "number") setBalance(data.balance);
        void refresh();

        if (!res.ok || data?.error) {
          console.warn("[PeerTalks][MATCH] POST rejected", {
            userId, status: res.status, error: data?.error, reason: data?.reason,
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
          console.log("[PeerTalks][SESSION] matched via response", { sessionId: data.sessionId });
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

        console.log("[PeerTalks][QUEUE] waiting, no match yet", {
          userId, queueId: data?.queueId ?? null,
        });
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

      // Never leave the user on "Finding someone" indefinitely.
      timeoutTimerRef.current = setTimeout(() => {
        if (!matchingRef.current) return;
        abortWithError(
          "Couldn't find a match this time. Please try again — both users need to be waiting at the same time."
        );
      }, MATCHING_TIMEOUT_MS);
    } catch {
      abortWithError("Something went wrong. Please try again.");
    }
  }, [router, unsubscribeMatching, refresh, setBalance, clearMatchingTimers, releaseLocalMedia]);

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
    const res = await fetch("/api/matching/random", {
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

  useEffect(() => {
    return () => {
      unsubscribeMatching();
      clearMatchingTimers();
      releaseLocalMedia();
      const key = requestKeyRef.current;
      fetch("/api/matching/random", {
        method: "DELETE",
        headers: key ? { "x-request-id": key } : {},
      }).catch(() => {});
    };
  }, [unsubscribeMatching, clearMatchingTimers, releaseLocalMedia]);

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
                <Button size="lg" onClick={() => startMatching("video")}>
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Video Chat (2 tokens)
                </Button>
                <Button variant="secondary" size="lg" onClick={() => startMatching("text")}>
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
