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

function ChatRoomContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [connectionState, setConnectionState] = useState<string>("new");
  const [showChat, setShowChat] = useState(false);
  const [joined, setJoined] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const supabaseRef = useRef<SupabaseClient | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const msgChannelRef = useRef<RealtimeChannel | null>(null);
  const signalingChannelRef = useRef<RealtimeChannel | null>(null);
  const userIdRef = useRef<string | null>(null);
  const { reactionsRef, addReaction } = useReactions();
  const [reactions, setReactions] = useState<{ id: string; icon: import("@/components/icons/icons").IconName }[]>([]);

  useEffect(() => {
    createClient().then(async (client) => {
      supabaseRef.current = client as unknown as SupabaseClient | null;
      if (client) {
        const { data: { session } } = await (client as unknown as SupabaseClient).auth.getSession();
        userIdRef.current = session?.user?.id ?? null;
      }
    });
  }, []);

  const getSupabase = () => supabaseRef.current;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

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

  useEffect(() => {
    let cancelled = false;

    const startMedia = async () => {
      try {
        const stream = await startLocalStream({ video: true, audio: true });
        if (!cancelled) {
          setLocalStream(stream);
          localStreamRef.current = stream;
        }
      } catch {}
    };
    startMedia();

    return () => {
      cancelled = true;
      if (signalingChannelRef.current && supabaseRef.current) {
        supabaseRef.current.removeChannel(signalingChannelRef.current);
        signalingChannelRef.current = null;
      }
      stopLocalStream(localStreamRef.current);
      pcRef.current?.close();
      pcRef.current = null;
    };
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
        setReactions([...reactionsRef.current]);
        setTimeout(() => {
          setReactions([...reactionsRef.current]);
        }, 100);
      }
    });

    channel.on("broadcast", { event: "signal" }, async (payload) => {
      const signal = payload.payload;
      if (signal.type === "offer") {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: signal.sdp }));
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
            await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: signal.sdp }));
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
      if (event.candidate) {
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
      await new Promise((r) => setTimeout(r, 500));
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await channel.send({
          type: "broadcast",
          event: "signal",
          payload: { type: "offer", sdp: offer.sdp! },
        });
      } catch (e) {
        console.error("[signaling] Failed to create offer:", e);
      }
    }
  }, [id, addReaction, reactionsRef]);

  const handleJoin = useCallback(async () => {
    setIsJoining(true);
    try {
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
          pc.restartIce();
        }
      };

      pc.onconnectionstatechange = () => {
        setConnectionState(pc.connectionState);
      };

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      pcRef.current = pc;
      setJoined(true);

      const supabase = getSupabase();
      if (!supabase) return;

      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) return;

      const { data: chatSession } = await supabase
        .from("chat_sessions")
        .select("user1_id, user2_id")
        .eq("id", id)
        .single();

      if (!chatSession) return;

      const otherUserId = chatSession.user1_id === userId ? chatSession.user2_id : chatSession.user1_id;
      const isOfferer = otherUserId ? userId > otherUserId : true;

      initiateSignaling(pc, isOfferer);
    } finally {
      setIsJoining(false);
    }
  }, [id, initiateSignaling]);

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

  const endChat = async () => {
    await fetch("/api/chat/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: id }),
    });
    if (signalingChannelRef.current && supabaseRef.current) {
      supabaseRef.current.removeChannel(signalingChannelRef.current);
      signalingChannelRef.current = null;
    }
    if (msgChannelRef.current && supabaseRef.current) {
      supabaseRef.current.removeChannel(msgChannelRef.current);
      msgChannelRef.current = null;
    }
    stopLocalStream(localStreamRef.current);
    pcRef.current?.close();
    pcRef.current = null;
    router.push("/dashboard");
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
    setReactions([...reactionsRef.current]);
    setTimeout(() => {
      setReactions([...reactionsRef.current]);
    }, 100);
    if (signalingChannelRef.current) {
      signalingChannelRef.current.send({
        type: "broadcast",
        event: "reaction",
        payload: { type },
      }).catch(() => {});
    }
  };

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
      />
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 relative">
          <VideoCard
            stream={remoteStream}
            connectionState={connectionState}
            isLoading={connectionState === "connecting"}
          />
          <ReactionOverlay reactions={reactions} />
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
                <div key={msg.id} className="flex flex-col">
                  <div className="max-w-[85%] px-4 py-2.5 rounded-2xl bg-white/10 backdrop-blur-xl text-sm text-white/80">
                    {msg.content}
                  </div>
                  <span className="text-[10px] text-white/20 mt-1 ml-1">
                    {new Date(msg.created_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            <div className="p-3 border-t border-white/[0.04]">
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  placeholder="Type a message..."
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") sendMessage();
                  }}
                  className="flex-1 h-11 px-4 rounded-xl glass-input text-sm text-white/80 placeholder:text-white/20 transition-all duration-200 focus:outline-none"
                />
                <button
                  onClick={sendMessage}
                  disabled={!newMessage.trim()}
                  className="w-11 h-11 rounded-xl glass-strong flex items-center justify-center disabled:opacity-30 hover:bg-white/[0.08] transition-all duration-200"
                  aria-label="Send message"
                >
                  <Icons.Send size={14} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <CallControls
        audioEnabled={audioEnabled}
        videoEnabled={videoEnabled}
        onToggleAudio={toggleAudio}
        onToggleVideo={toggleVideo}
        onEndCall={endChat}
        onToggleChat={() => setShowChat((v) => !v)}
        onReaction={handleReaction}
        showChat={showChat}
      />
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
