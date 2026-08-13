"use client";

export const dynamic = "force-dynamic";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Message } from "@/types/database";
import type { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";
import { VideoCard, FloatingPreview, CallControls, JoinScreen, ReactionOverlay, useReactions } from "@/components/video";
import Icons from "@/components/icons/icons";
import { startLocalStream, stopLocalStream, toggleTrack } from "@/lib/webrtc/peerConnection";
import { useToast } from "@/hooks/useToast";

const EMOJI_OPTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥", "🎉", "👏"];

function ChatRoomContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [connectionState, setConnectionState] = useState<string>("new");
  const [showChat, setShowChat] = useState(false);
  const [joined, setJoined] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [callType, setCallType] = useState<"video" | "text">("video");
  const [callLoaded, setCallLoaded] = useState(false);
  const [peerLeft, setPeerLeft] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [clientReady, setClientReady] = useState(false);
  const [reactions, setReactions] = useState<Record<number, Record<string, { count: number; mine: boolean }>>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const supabaseRef = useRef<SupabaseClient | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const msgChannelRef = useRef<RealtimeChannel | null>(null);
  const signalingChannelRef = useRef<RealtimeChannel | null>(null);
  const userIdRef = useRef<string | null>(null);
  const peerIdRef = useRef<string | null>(null);
  const offerTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const typingSentAtRef = useRef(0);
  const typingClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { reactionsRef, addReaction } = useReactions();
  const [overlayReactions, setOverlayReactions] = useState<{ id: string; icon: import("@/components/icons/icons").IconName }[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    createClient().then(async (client) => {
      supabaseRef.current = client as unknown as SupabaseClient | null;
      if (client) {
        const { data: { session } } = await (client as unknown as SupabaseClient).auth.getSession();
        userIdRef.current = session?.user?.id ?? null;
        setMyUserId(session?.user?.id ?? null);
      }
      setClientReady(true);
    });
  }, []);

  const getSupabase = () => supabaseRef.current;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Load chat session info (call type, peer id)
  useEffect(() => {
    let cancelled = false;

    const setupTextChannel = async () => {
      const supabase = getSupabase();
      if (!supabase || cancelled) return;
      if (signalingChannelRef.current) {
        supabase.removeChannel(signalingChannelRef.current);
        signalingChannelRef.current = null;
      }
      const channel = supabase.channel(`textsync:${id}`);
      channel
        .on("broadcast", { event: "typing" }, (payload) => {
          const { userId: fromId } = payload.payload as { userId: string };
          if (fromId === userIdRef.current) return;
          setPeerTyping(true);
          if (typingClearTimerRef.current) clearTimeout(typingClearTimerRef.current);
          typingClearTimerRef.current = setTimeout(() => setPeerTyping(false), 2500);
        })
        .on("broadcast", { event: "peerleft" }, (payload) => {
          const { userId: fromId } = payload.payload as { userId: string };
          if (fromId === userIdRef.current) return;
          setPeerLeft(true);
        })
        .subscribe();
      signalingChannelRef.current = channel;
    };

    const loadSession = async () => {
      const supabase = supabaseRef.current;
      if (!supabase) {
        if (clientReady && !cancelled) {
          setMediaError("Unable to connect. Please check your network and reload.");
          setCallLoaded(true);
        }
        return;
      }
      const { data } = await supabase
        .from("chat_sessions")
        .select("call_type, user1_id, user2_id, status")
        .eq("id", id)
        .maybeSingle();
      if (!cancelled) {
        if (data) {
          setCallType(data.call_type ?? "video");
          const myId = userIdRef.current;
          if (myId) {
            peerIdRef.current = data.user1_id === myId ? data.user2_id : data.user1_id;
          }
          if (data.call_type === "text") {
            setJoined(true);
            setupTextChannel();
          }
        } else {
          toast.error("Conversation not found");
          router.replace("/dashboard");
        }
        setCallLoaded(true);
      }
    };
    loadSession();
    return () => { cancelled = true; };
  }, [id, clientReady, router, toast]);

  // Message history + realtime
  useEffect(() => {
    if (!joined) return;
    let cancelled = false;

    const init = async () => {
      const supabase = getSupabase();
      if (!supabase) return;

      const { data: msgs } = await supabase
        .from("messages")
        .select("*")
        .eq("session_id", id)
        .order("created_at", { ascending: true });
      if (!cancelled) setMessages(msgs ?? []);

      // Load reactions for existing messages
      if (msgs && msgs.length > 0) {
        const ids = msgs.map((m) => m.id);
        const { data: reactionRows } = await supabase
          .from("message_reactions")
          .select("message_id, user_id, reaction")
          .in("message_id", ids);
        if (!cancelled && reactionRows) {
          const map: Record<number, Record<string, { count: number; mine: boolean }>> = {};
          for (const r of reactionRows) {
            map[r.message_id] ??= {};
            const e = map[r.message_id][r.reaction] ?? { count: 0, mine: false };
            e.count += 1;
            if (r.user_id === userIdRef.current) e.mine = true;
            map[r.message_id][r.reaction] = e;
          }
          setReactions(map);
        }
      }
    };
    init();

    const setupRealtime = async () => {
      const supabase = getSupabase();
      if (!supabase || cancelled) return;

      const channel = supabase
        .channel(`messages:${id}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: `session_id=eq.${id}`,
          },
          (payload) => {
            setMessages((prev) => [...prev, payload.new as Message]);
          }
        )
        .subscribe();

      if (!cancelled) {
        msgChannelRef.current = channel;
      } else {
        supabase.removeChannel(channel);
      }
    };

    setupRealtime();

    return () => {
      cancelled = true;
      if (msgChannelRef.current && supabaseRef.current) {
        supabaseRef.current.removeChannel(msgChannelRef.current);
        msgChannelRef.current = null;
      }
    };
  }, [id, joined]);

  // Local media
  useEffect(() => {
    let cancelled = false;

    const startMedia = async () => {
      try {
        const stream = await startLocalStream({ video: true, audio: true });
        if (!cancelled) {
          setLocalStream(stream);
          localStreamRef.current = stream;
          setMediaError(null);
        }
      } catch {
        // Camera denied — try audio only
        try {
          const stream = await startLocalStream({ video: false, audio: true });
          if (!cancelled) {
            setLocalStream(stream);
            localStreamRef.current = stream;
            setVideoEnabled(false);
            setMediaError(null);
          }
        } catch {
          if (!cancelled) {
            setMediaError("Camera and microphone access denied. Please allow permissions in your browser and try again.");
          }
        }
      }
    };

    if (callType === "video") startMedia();

    return () => {
      cancelled = true;
      if (signalingChannelRef.current && supabaseRef.current) {
        supabaseRef.current.removeChannel(signalingChannelRef.current);
        signalingChannelRef.current = null;
      }
      if (offerTimerRef.current) {
        clearInterval(offerTimerRef.current);
        offerTimerRef.current = null;
      }
      stopLocalStream(localStreamRef.current);
      pcRef.current?.close();
      pcRef.current = null;
    };
  }, [callType]);

  const handlePeerLeft = useCallback(() => {
    setPeerLeft(true);
  }, []);

  const initiateSignaling = useCallback(async (pc: RTCPeerConnection, isOfferer: boolean) => {
    const supabase = getSupabase();
    if (!supabase) return;

    const channelName = `signaling:${id}`;
    if (signalingChannelRef.current) {
      supabase.removeChannel(signalingChannelRef.current);
    }

    const channel = supabase.channel(channelName);

    channel.on("broadcast", { event: "reaction" }, (payload) => {
      const { type } = payload.payload as { type: string };
      if (type) {
        addReaction(type);
        setOverlayReactions([...reactionsRef.current]);
        setTimeout(() => {
          setOverlayReactions([...reactionsRef.current]);
        }, 100);
      }
    });

    channel.on("broadcast", { event: "typing" }, (payload) => {
      const { userId: fromId } = payload.payload as { userId: string };
      if (fromId === userIdRef.current) return;
      setPeerTyping(true);
      if (typingClearTimerRef.current) clearTimeout(typingClearTimerRef.current);
      typingClearTimerRef.current = setTimeout(() => setPeerTyping(false), 2500);
    });

    channel.on("broadcast", { event: "peerleft" }, (payload) => {
      const { userId: fromId } = payload.payload as { userId: string };
      if (fromId === userIdRef.current) return;
      handlePeerLeft();
    });

    channel.on("broadcast", { event: "signal" }, async (payload) => {
      const signal = payload.payload as { type: string; sdp?: string; candidate?: RTCIceCandidateInit };
      if (signal.type === "offer") {
        try {
          if (pc.signalingState !== "have-local-offer") {
            await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: signal.sdp! }));
          } else {
            // Glare — we made an offer first; treat ours as invalid
            pc.setLocalDescription({ type: "rollback" }).catch(() => {});
            await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: signal.sdp! }));
          }
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await channel.send({
            type: "broadcast",
            event: "signal",
            payload: { type: "answer", sdp: answer.sdp! },
          });
        } catch (e) {
          console.error("[signaling] Failed to handle offer:", e);
        }
      } else if (signal.type === "answer") {
        try {
          if (pc.signalingState !== "stable") {
            await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: signal.sdp! }));
          }
        } catch (e) {
          console.error("[signaling] Failed to handle answer:", e);
        }
      } else if (signal.type === "ice-candidate") {
        try {
          if (signal.candidate) {
            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
          }
        } catch (e) {
          console.error("[signaling] Failed to add ICE candidate:", e);
        }
      }
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && channel.state === "subscribed" as string) {
        channel.send({
          type: "broadcast",
          event: "signal",
          payload: { type: "ice-candidate", candidate: event.candidate.toJSON() },
        }).catch(() => {});
      }
    };

    await channel.subscribe();
    signalingChannelRef.current = channel;

    if (isOfferer) {
      // Retry the offer until we get an answer (handles peers joining late)
      const sendOffer = async () => {
        if (pc.connectionState === "connected") {
          if (offerTimerRef.current) {
            clearInterval(offerTimerRef.current);
            offerTimerRef.current = null;
          }
          return;
        }
        try {
          if (pc.signalingState !== "have-local-offer") {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            await channel.send({
              type: "broadcast",
              event: "signal",
              payload: { type: "offer", sdp: offer.sdp! },
            });
          }
        } catch (e) {
          console.error("[signaling] Failed to create/send offer:", e);
        }
      };

      await new Promise((r) => setTimeout(r, 800));
      await sendOffer();
      offerTimerRef.current = setInterval(sendOffer, 2500);
    }
  }, [id, addReaction, reactionsRef, handlePeerLeft]);

  const handleJoin = useCallback(async () => {
    setIsJoining(true);
    try {
      if (callType === "text") {
        setJoined(true);
        return;
      }

      const stream = localStreamRef.current;
      if (!stream) return;

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      });

      pc.ontrack = (event) => {
        if (event.streams[0]) setRemoteStream(event.streams[0]);
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === "disconnected") {
          // Try to re-establish
          try {
            pc.restartIce();
          } catch {}
        }
      };

      pc.onconnectionstatechange = () => {
        setConnectionState(pc.connectionState);
        if (pc.connectionState === "connected") {
          setPeerLeft(false);
          if (offerTimerRef.current) {
            clearInterval(offerTimerRef.current);
            offerTimerRef.current = null;
          }
        } else if (pc.connectionState === "failed") {
          handlePeerLeft();
        } else if (pc.connectionState === "disconnected") {
          // Give ICE restart a chance before declaring peer left
          setTimeout(() => {
            if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
              handlePeerLeft();
            }
          }, 6000);
        }
      };

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      pcRef.current = pc;
      setJoined(true);

      const supabase = getSupabase();
      if (!supabase) return;

      const peerId = peerIdRef.current;
      const isOfferer = peerId ? (userIdRef.current ?? "") > peerId : true;

      initiateSignaling(pc, isOfferer);
    } finally {
      setIsJoining(false);
    }
  }, [callType, initiateSignaling, handlePeerLeft]);

  const cleanupChannels = useCallback(() => {
    const supabase = getSupabase();
    if (supabase) {
      if (signalingChannelRef.current) {
        supabase.removeChannel(signalingChannelRef.current);
        signalingChannelRef.current = null;
      }
      if (msgChannelRef.current) {
        supabase.removeChannel(msgChannelRef.current);
        msgChannelRef.current = null;
      }
    }
    if (offerTimerRef.current) {
      clearInterval(offerTimerRef.current);
      offerTimerRef.current = null;
    }
  }, []);

  const endChat = useCallback(async (goTo: string = "/dashboard") => {
    if (signalingChannelRef.current) {
      signalingChannelRef.current.send({
        type: "broadcast",
        event: "peerleft",
        payload: { userId: userIdRef.current },
      }).catch(() => {});
      setTimeout(() => cleanupChannels(), 300);
    } else {
      cleanupChannels();
    }
    await fetch("/api/chat/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: id }),
    }).catch(() => {});
    stopLocalStream(localStreamRef.current);
    pcRef.current?.close();
    pcRef.current = null;
    router.push(goTo);
  }, [id, router, cleanupChannels]);

  const nextUser = useCallback(() => {
    endChat("/chat/random");
  }, [endChat]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      (document.documentElement).requestFullscreen().catch(() => {});
    }
  }, []);

  const sendMessage = async () => {
    if (!newMessage.trim()) return;
    const content = newMessage.trim();
    setNewMessage("");

    const s = getSupabase();
    if (!s) return;
    await s.from("messages").insert({
      session_id: id,
      sender_id: (await s.auth.getSession()).data.session?.user.id,
      content,
    });
  };

  const notifyTyping = () => {
    const now = Date.now();
    if (now - typingSentAtRef.current < 1500) return;
    typingSentAtRef.current = now;
    if (signalingChannelRef.current) {
      signalingChannelRef.current.send({
        type: "broadcast",
        event: "typing",
        payload: { userId: userIdRef.current },
      }).catch(() => {});
    }
  };

  const toggleAudio = () => {
    toggleTrack(localStreamRef.current, "audio", !audioEnabled);
    setAudioEnabled(!audioEnabled);
  };

  const toggleVideo = () => {
    toggleTrack(localStreamRef.current, "video", !videoEnabled);
    setVideoEnabled(!videoEnabled);
  };

  const handleReaction = (type: string) => {
    addReaction(type);
    setOverlayReactions([...reactionsRef.current]);
    setTimeout(() => {
      setOverlayReactions([...reactionsRef.current]);
    }, 100);
    if (signalingChannelRef.current) {
      signalingChannelRef.current.send({
        type: "broadcast",
        event: "reaction",
        payload: { type },
      }).catch(() => {});
    }
  };

  const toggleMessageReaction = async (messageId: number, emoji: string) => {
    const supabase = getSupabase();
    if (!supabase) return;

    const current = reactions[messageId]?.[emoji];
    const mine = current?.mine ?? false;

    // Optimistic update
    setReactions((prev) => {
      const next = structuredClone(prev);
      const entries = next[messageId] ?? {};
      if (mine) {
        entries[emoji].count -= 1;
        entries[emoji].mine = false;
        if (entries[emoji].count <= 0) delete entries[emoji];
      } else {
        entries[emoji] = { count: (entries[emoji]?.count ?? 0) + 1, mine: true };
      }
      if (Object.keys(entries).length === 0) delete next[messageId];
      return next;
    });

    const res = await fetch("/api/messages/reactions", {
      method: mine ? "DELETE" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId, reaction: emoji }),
    });
    if (!res.ok) {
      toast.error("Failed to update reaction");
    }
  };

  const submitReport = async () => {
    if (!reportReason.trim()) return;
    if (!peerIdRef.current) return;
    setReportSubmitting(true);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportedUserId: peerIdRef.current,
          sessionId: id,
          reason: reportReason.trim(),
        }),
      });
      if (res.ok) {
        toast.success("Report submitted", "Our team will review this conversation.");
        setShowReport(false);
        setReportReason("");
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to submit report");
      }
    } catch {
      toast.error("Failed to submit report");
    } finally {
      setReportSubmitting(false);
    }
  };

  const confirmBlock = async () => {
    if (!peerIdRef.current) return;
    try {
      const res = await fetch("/api/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blockedUserId: peerIdRef.current }),
      });
      if (res.ok) {
        toast.success("User blocked", "You won't be matched with this user again.");
        setShowBlockConfirm(false);
        endChat("/dashboard");
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to block user");
        setShowBlockConfirm(false);
      }
    } catch {
      toast.error("Failed to block user");
      setShowBlockConfirm(false);
    }
  };

  // Show loading while session info loads
  if (!callLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
      </div>
    );
  }

  // Text chat mode — full chat UI with no video
  if (callType === "text") {
    return (
      <div className="fixed inset-0 z-30 flex flex-col bg-background sm:static">
        <div className="flex items-center justify-between p-4 border-b border-white/[0.04]">
          <span className="text-sm text-white/60 font-medium">Text Chat</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowChat(false)}
              className="w-8 h-8 rounded-xl hover:bg-white/[0.04] flex items-center justify-center transition-all duration-200"
              aria-label="Close chat"
            >
              <Icons.Close size={14} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-hide overscroll-contain">
          {messages.length === 0 && (
            <p className="text-sm text-white/20 text-center py-8 font-light">
              No messages yet. Say hello!
            </p>
          )}
          {messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              mine={msg.sender_id === myUserId}
              reactions={reactions[msg.id]}
              onReact={(emoji) => toggleMessageReaction(msg.id, emoji)}
            />
          ))}
          {peerTyping && (
            <div className="flex items-center gap-1.5 px-1 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-white/30 animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-white/30 animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-white/30 animate-bounce" style={{ animationDelay: "300ms" }} />
              <span className="text-[10px] text-white/25 ml-1">typing…</span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
        <div className="p-3 border-t border-white/[0.04]">
          {emojiPickerOpen && <EmojiPicker onPick={(e) => setNewMessage((v) => v + e)} />}
          <div className="flex gap-2">
            <button
              onClick={() => setEmojiPickerOpen((v) => !v)}
              className="w-11 h-11 rounded-xl glass-strong flex items-center justify-center hover:bg-white/[0.08] transition-all duration-200 shrink-0"
              aria-label="Emoji picker"
            >
              <span className="text-lg leading-none">😊</span>
            </button>
            <input
              ref={inputRef}
              placeholder="Type a message..."
              value={newMessage}
              onChange={(e) => {
                setNewMessage(e.target.value);
                notifyTyping();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") sendMessage();
              }}
              className="flex-1 h-11 px-4 rounded-xl glass-input text-sm text-white/80 placeholder:text-white/20 transition-all duration-200 focus:outline-none"
            />
            <button
              onClick={sendMessage}
              disabled={!newMessage.trim()}
              className="w-11 h-11 rounded-xl glass-strong flex items-center justify-center disabled:opacity-30 hover:bg-white/[0.08] transition-all duration-200 shrink-0"
              aria-label="Send message"
            >
              <Icons.Send size={14} />
            </button>
          </div>
        </div>
        <div className="flex items-center justify-center p-3 border-t border-white/[0.04] gap-2">
          <button
            onClick={nextUser}
            className="h-10 px-4 rounded-xl glass-strong text-xs text-white/70 hover:bg-white/[0.08] transition-all duration-200"
          >
            Next User
          </button>
          <button
            onClick={toggleFullscreen}
            className="h-10 px-4 rounded-xl glass-strong text-xs text-white/70 hover:bg-white/[0.08] transition-all duration-200"
          >
            Fullscreen
          </button>
          <button
            onClick={() => setShowReport(true)}
            className="h-10 px-4 rounded-xl glass-strong text-xs text-white/70 hover:bg-white/[0.08] transition-all duration-200"
          >
            Report
          </button>
          <button
            onClick={() => setShowBlockConfirm(true)}
            className="h-10 px-4 rounded-xl glass-strong text-xs text-error/70 hover:bg-error/[0.15] transition-all duration-200"
          >
            Block
          </button>
          <button
            onClick={() => endChat("/dashboard")}
            className="h-10 px-4 rounded-xl bg-error-soft text-error text-xs hover:bg-error/[0.2] transition-all duration-200"
          >
            End Chat
          </button>
        </div>
        <ReportDialog open={showReport} value={reportReason} onChange={setReportReason} onClose={() => setShowReport(false)} onSubmit={submitReport} submitting={reportSubmitting} />
        {showBlockConfirm && (
          <ConfirmDialog
            title="Block this user?"
            description="You won't be matched with this person again. This ends the current chat."
            onCancel={() => setShowBlockConfirm(false)}
            onConfirm={confirmBlock}
          />
        )}
      </div>
    );
  }

  if (!joined) {
    return (
      <JoinScreen
        stream={localStream}
        roomId={id}
        audioEnabled={audioEnabled}
        videoEnabled={videoEnabled}
        onToggleAudio={toggleAudio}
        onToggleVideo={toggleVideo}
        onJoin={handleJoin}
        isJoining={isJoining}
        mediaError={mediaError}
      />
    );
  }

  return (
    <div ref={containerRef} className="flex flex-col h-screen bg-background">
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 relative">
          <VideoCard
            stream={remoteStream}
            connectionState={connectionState}
            isLoading={connectionState === "connecting"}
          />
          <ReactionOverlay reactions={overlayReactions} />
          <FloatingPreview
            stream={localStream}
            audioEnabled={audioEnabled}
            videoEnabled={videoEnabled}
          />
          {!showChat && (
            <button
              onClick={() => setShowChat(true)}
              className="absolute top-4 right-4 z-40 w-11 h-11 rounded-xl glass-strong flex items-center justify-center hover:bg-white/[0.08] active:bg-white/[0.06] transition-all duration-200"
              aria-label="Open chat"
            >
              <Icons.Chat size={18} />
            </button>
          )}
        </div>

        {showChat && (
          <div className="fixed inset-0 z-30 sm:static sm:inset-auto sm:w-80 border-l border-white/5 bg-black/40 backdrop-blur-xl flex flex-col sm:relative">
            <div className="flex items-center justify-between p-4 border-b border-white/[0.04]">
              <span className="text-sm text-white/60 font-medium">Chat</span>
              <button
                onClick={() => setShowChat(false)}
                className="w-8 h-8 rounded-xl hover:bg-white/[0.04] flex items-center justify-center transition-all duration-200"
                aria-label="Close chat"
              >
                <Icons.Close size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-hide overscroll-contain">
              {messages.length === 0 && (
                <p className="text-sm text-white/20 text-center py-8 font-light">
                  No messages yet. Say hello!
                </p>
              )}
              {messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  mine={msg.sender_id === myUserId}
                  reactions={reactions[msg.id]}
                  onReact={(emoji) => toggleMessageReaction(msg.id, emoji)}
                />
              ))}
              {peerTyping && (
                <div className="flex items-center gap-1.5 px-1 py-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-white/30 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-white/30 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-white/30 animate-bounce" style={{ animationDelay: "300ms" }} />
                  <span className="text-[10px] text-white/25 ml-1">typing…</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            <div className="p-3 border-t border-white/[0.04]">
              {emojiPickerOpen && <EmojiPicker onPick={(e) => setNewMessage((v) => v + e)} />}
              <div className="flex gap-2">
                <button
                  onClick={() => setEmojiPickerOpen((v) => !v)}
                  className="w-11 h-11 rounded-xl glass-strong flex items-center justify-center hover:bg-white/[0.08] transition-all duration-200 shrink-0"
                  aria-label="Emoji picker"
                >
                  <span className="text-lg leading-none">😊</span>
                </button>
                <input
                  ref={inputRef}
                  placeholder="Type a message..."
                  value={newMessage}
                  onChange={(e) => {
                    setNewMessage(e.target.value);
                    notifyTyping();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") sendMessage();
                  }}
                  className="flex-1 h-11 px-4 rounded-xl glass-input text-sm text-white/80 placeholder:text-white/20 transition-all duration-200 focus:outline-none"
                />
                <button
                  onClick={sendMessage}
                  disabled={!newMessage.trim()}
                  className="w-11 h-11 rounded-xl glass-strong flex items-center justify-center disabled:opacity-30 hover:bg-white/[0.08] transition-all duration-200 shrink-0"
                  aria-label="Send message"
                >
                  <Icons.Send size={14} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {peerLeft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card rounded-3xl p-8 text-center max-w-sm mx-4">
            <div className="w-12 h-12 mx-auto rounded-full bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-white/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-white/90 mb-2">Your partner left</h2>
            <p className="text-sm text-muted mb-6">Find someone new to continue the conversation.</p>
            <div className="flex flex-col gap-2">
              <button
                onClick={nextUser}
                className="h-11 rounded-xl bg-white text-graphite-950 text-sm font-medium hover:bg-white/90 transition-all duration-200"
              >
                Next User
              </button>
              <button
                onClick={() => endChat("/dashboard")}
                className="h-11 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white/70 text-sm font-medium hover:bg-white/[0.06] transition-all duration-200"
              >
                Back to Dashboard
              </button>
            </div>
          </div>
        </div>
      )}

      <CallControls
        audioEnabled={audioEnabled}
        videoEnabled={videoEnabled}
        onToggleAudio={toggleAudio}
        onToggleVideo={toggleVideo}
        onEndCall={() => endChat("/dashboard")}
        onToggleChat={() => setShowChat((v) => !v)}
        onReaction={handleReaction}
        onNext={nextUser}
        onFullscreen={toggleFullscreen}
        onReport={() => setShowReport(true)}
        onBlock={() => setShowBlockConfirm(true)}
        showChat={showChat}
      />

      <ReportDialog open={showReport} value={reportReason} onChange={setReportReason} onClose={() => setShowReport(false)} onSubmit={submitReport} submitting={reportSubmitting} />
      {showBlockConfirm && (
        <ConfirmDialog
          title="Block this user?"
          description="You won't be matched with this person again. This ends the current chat."
          onCancel={() => setShowBlockConfirm(false)}
          onConfirm={confirmBlock}
        />
      )}
    </div>
  );
}

function MessageBubble({ msg, mine, reactions, onReact }: {
  msg: Message;
  mine: boolean;
  reactions?: Record<string, { count: number; mine: boolean }>;
  onReact: (emoji: string) => void;
}) {
  return (
    <div className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
      <div className={`max-w-[85%] px-4 py-2.5 rounded-2xl backdrop-blur-xl text-sm text-white/80 ${mine ? "bg-white/15" : "bg-white/10"}`}>
        {msg.content}
      </div>
      <div className="flex items-center gap-1.5 mt-1">
        <span className="text-[10px] text-white/20">
          {new Date(msg.created_at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        <div className="flex items-center gap-0.5">
          {reactions &&
            Object.entries(reactions).map(([emoji, data]) => (
              <button
                key={emoji}
                onClick={() => onReact(emoji)}
                className={`px-1.5 py-0.5 rounded-full text-[11px] leading-none border ${
                  data.mine
                    ? "bg-white/20 border-white/30"
                    : "bg-white/[0.06] border-white/10 hover:bg-white/10"
                }`}
                aria-label={`React ${emoji}`}
              >
                {emoji} {data.count > 1 ? data.count : ""}
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}

function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  return (
    <div className="mb-2 p-2 rounded-xl glass-strong border border-white/[0.06] grid grid-cols-8 gap-1">
      {EMOJI_OPTIONS.map((emoji) => (
        <button
          key={emoji}
          onClick={() => onPick(emoji)}
          className="w-8 h-8 rounded-lg hover:bg-white/[0.08] flex items-center justify-center text-base transition-all duration-150"
          aria-label={`Emoji ${emoji}`}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

function ReportDialog({ open, value, onChange, onClose, onSubmit, submitting }: {
  open: boolean;
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  if (!open) return null;
  const reasons = [
    "Inappropriate behavior",
    "Harassment or bullying",
    "Explicit content",
    "Spam or scams",
    "Underage user",
    "Other",
  ];
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="glass-card rounded-3xl p-6 w-full max-w-sm">
        <h2 className="text-lg font-semibold text-white/90 mb-1">Report this user</h2>
        <p className="text-xs text-muted mb-5">Our team will review this report. Your identity stays anonymous.</p>
        <div className="flex flex-wrap gap-1.5 mb-4">
          {reasons.map((r) => (
            <button
              key={r}
              onClick={() => onChange(r)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-200 ${
                value === r
                  ? "bg-white/15 text-white border border-white/20"
                  : "bg-white/5 text-white/40 border border-white/10 hover:border-white/20 hover:text-white/60"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <textarea
          placeholder="Add details (optional)..."
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          maxLength={500}
          className="w-full px-4 py-3 rounded-xl glass-input text-sm text-white/80 placeholder:text-white/20 transition-all duration-200 focus:outline-none resize-none mb-5"
        />
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 h-11 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white/70 text-sm font-medium hover:bg-white/[0.06] transition-all duration-200"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={!value.trim() || submitting}
            className="flex-1 h-11 rounded-xl bg-error-soft text-error text-sm font-medium hover:bg-error/[0.2] transition-all duration-200 disabled:opacity-40 disabled:pointer-events-none"
          >
            {submitting ? "Submitting..." : "Submit report"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDialog({ title, description, onCancel, onConfirm }: {
  title: string;
  description: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="glass-card rounded-3xl p-6 w-full max-w-sm text-center">
        <h2 className="text-lg font-semibold text-white/90 mb-2">{title}</h2>
        <p className="text-sm text-muted mb-6">{description}</p>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 h-11 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white/70 text-sm font-medium hover:bg-white/[0.06] transition-all duration-200"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 h-11 rounded-xl bg-error-soft text-error text-sm font-medium hover:bg-error/[0.2] transition-all duration-200"
          >
            Block user
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ChatRoomPage() {
  return (
    <AuthGuard>
      <ChatRoomContent />
    </AuthGuard>
  );
}