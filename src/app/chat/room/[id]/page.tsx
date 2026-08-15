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
  const [peerLeftReason, setPeerLeftReason] = useState<string>("Your partner left");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const supabaseRef = useRef<SupabaseClient | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const msgChannelRef = useRef<RealtimeChannel | null>(null);
  const signalingChannelRef = useRef<RealtimeChannel | null>(null);
  const sessionChannelRef = useRef<RealtimeChannel | null>(null);
  const reactionsChannelRef = useRef<RealtimeChannel | null>(null);
  const userIdRef = useRef<string | null>(null);
  const peerIdRef = useRef<string | null>(null);
  const sessionEndedRef = useRef(false);
  const offerTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const answerReceivedRef = useRef(false);
  const typingSentAtRef = useRef(0);
  const typingClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
          if (peerIdRef.current && fromId !== peerIdRef.current) return;
          setPeerTyping(true);
          if (typingClearTimerRef.current) clearTimeout(typingClearTimerRef.current);
          typingClearTimerRef.current = setTimeout(() => setPeerTyping(false), 2500);
        })
        .on("broadcast", { event: "peerleft" }, (payload) => {
          const { userId: fromId } = payload.payload as { userId: string };
          if (fromId === userIdRef.current) return;
          if (peerIdRef.current && fromId !== peerIdRef.current) return;
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
          // A session that is already ended (or whose room host never got a
          // guest and is gone) must not leave the user stranded on the
          // JoinScreen forever — surface it and get them back to the
          // dashboard immediately.
          if (data.status === "ended") {
            toast.error("This conversation has ended");
            router.replace("/dashboard");
            setCallLoaded(true);
            return;
          }
          setCallType(data.call_type ?? "video");
          const myId = userIdRef.current;
          if (myId) {
            // user1 is the room host (private rooms) or the first matched
            // user — used for offerer determination so exactly ONE side
            // creates the offer (no glare).
            if (data.user1_id === myId) {
              peerIdRef.current = data.user2_id;
            } else {
              peerIdRef.current = data.user1_id;
            }
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

  // Live session state: guest assignment on private rooms (peer id becomes
  // known late) and the peer ending the session. Without this the host
  // never learns the guest's id, and an ended session keeps the other
  // client on the call screen indefinitely.
  useEffect(() => {
    if (!callLoaded) return;
    let cancelled = false;

    const init = async () => {
      const supabase = getSupabase();
      if (!supabase || cancelled) return;

      const channel = supabase
        .channel(`chat_session_${id}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "chat_sessions",
            filter: `id=eq.${id}`,
          },
          (payload) => {
            const row = payload.new as {
              status?: string;
              user1_id?: string | null;
              user2_id?: string | null;
            };
            if (row.status === "ended") {
              if (sessionEndedRef.current) return;
              sessionEndedRef.current = true;
              console.log("[PeerTalks][SESSION] peer ended session", { sessionId: id });
              setPeerLeftReason("Your partner ended the chat");
              setPeerLeft(true);
              return;
            }
            // Peer became known after page load (private room host).
            if (row.user2_id && !peerIdRef.current) {
              const myId = userIdRef.current;
              if (myId && row.user2_id !== myId) {
                peerIdRef.current = row.user2_id;
                console.log("[PeerTalks][SESSION] guest assigned, peerId known", {
                  sessionId: id, peerId: row.user2_id,
                });
              }
            }
          }
        )
        .subscribe((status) => {
          console.log("[PeerTalks][REALTIME] chat_sessions channel status", {
            sessionId: id, status,
          });
        });

      if (!cancelled) {
        sessionChannelRef.current = channel;
      } else {
        supabase.removeChannel(channel);
      }
    };

    init();

    return () => {
      cancelled = true;
      if (sessionChannelRef.current && supabaseRef.current) {
        supabaseRef.current.removeChannel(sessionChannelRef.current);
        sessionChannelRef.current = null;
      }
    };
  }, [id, callLoaded]);

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
            const incoming = payload.new as Message;
            // Dedupe by id: an optimistically-appended sent message and the
            // realtime event for the same row must not appear twice.
            setMessages((prev) =>
              prev.some((m) => m.id === incoming.id)
                ? prev.map((m) => (m.id === incoming.id ? incoming : m))
                : [...prev, incoming]
            );
          }
        )
        .subscribe((status) => {
          if (status === "CHANNEL_ERROR" && !cancelled) {
            toast.error("Live message updates failed", "Refresh the page to see new messages");
          }
        });

      // Peer reactions only ever appeared after a reload — subscribe to
      // message_reactions so both clients stay in sync live. No table
      // filter is possible (reactions don't carry a session id); RLS keeps
      // the payloads scoped to this session's participants.
      const reactionsChannel = supabase
        .channel(`message_reactions:${id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "message_reactions",
          },
          (payload) => {
            const row = payload.new as {
              message_id?: number;
              user_id?: string;
              reaction?: string;
            } | null;
            const oldRow = payload.old as {
              message_id?: number;
              user_id?: string;
              reaction?: string;
            } | null;
            const messageId = row?.message_id ?? oldRow?.message_id;
            const reaction = row?.reaction ?? oldRow?.reaction;
            if (messageId == null || !reaction) return;
            const fromMe = (row?.user_id ?? oldRow?.user_id) === userIdRef.current;
            // My own changes are already applied optimistically in
            // toggleMessageReaction — skip them to avoid double counting.
            if (fromMe) return;
            setReactions((prev) => {
              const next = structuredClone(prev);
              const entries = next[messageId] ?? {};
              const cur = entries[reaction];
              if (payload.eventType === "INSERT") {
                entries[reaction] = {
                  count: (cur?.count ?? 0) + 1,
                  mine: cur?.mine ?? false,
                };
              } else if (payload.eventType === "DELETE") {
                if (cur) {
                  cur.count -= 1;
                  if (cur.count <= 0) delete entries[reaction];
                }
              }
              if (Object.keys(entries).length === 0) delete next[messageId];
              return next;
            });
          }
        )
        .subscribe();

      if (!cancelled) {
        msgChannelRef.current = channel;
        reactionsChannelRef.current = reactionsChannel;
      } else {
        supabase.removeChannel(channel);
        supabase.removeChannel(reactionsChannel);
      }
    };

    setupRealtime();

    return () => {
      cancelled = true;
      if (msgChannelRef.current && supabaseRef.current) {
        supabaseRef.current.removeChannel(msgChannelRef.current);
        msgChannelRef.current = null;
      }
      if (reactionsChannelRef.current && supabaseRef.current) {
        supabaseRef.current.removeChannel(reactionsChannelRef.current);
        reactionsChannelRef.current = null;
      }
    };
  }, [id, joined, toast]);

  // Local media
  useEffect(() => {
    let cancelled = false;

    const startMedia = async () => {
      try {
        // startLocalStream() defaults carry the 720p caps — unconstrained
        // getUserMedia would pick the camera's maximum (4K on phones).
        const stream = await startLocalStream();
        if (!cancelled) {
          setLocalStream(stream);
          localStreamRef.current = stream;
          setMediaError(null);
        } else {
          // Unmounted while the camera/mic permission was pending — stop
          // the acquired stream immediately so tracks are not left on.
          stopLocalStream(stream);
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
          } else {
            stopLocalStream(stream);
          }
        } catch {
          if (!cancelled) {
            setMediaError("Camera and microphone access denied. Please allow permissions in your browser and try again.");
          }
        }
      }
    };

    // Gate on callLoaded: callType defaults to "video", so without this the
    // camera briefly powers on even for text chats while the session loads.
    if (callLoaded && callType === "video") startMedia();

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
      if (connectTimerRef.current) {
        clearTimeout(connectTimerRef.current);
        connectTimerRef.current = null;
      }
      if (typingClearTimerRef.current) {
        clearTimeout(typingClearTimerRef.current);
        typingClearTimerRef.current = null;
      }
      if (disconnectTimerRef.current) {
        clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
      }
      stopLocalStream(localStreamRef.current);
      setRemoteStream((prev) => {
        prev?.getTracks().forEach((t) => t.stop());
        return null;
      });
      pcRef.current?.close();
      pcRef.current = null;
    };
  }, [callType, callLoaded]);

  // Pause the app-wide animated background (PremiumBackground rAF loop)
  // while a video call is live — it would otherwise compete with WebRTC
  // video decode on mobile.
  useEffect(() => {
    if (callType === "video" && joined) {
      document.body.dataset.peertalksInChat = "1";
      document.body.dataset.peertalksInCall = "1";
    } else {
      delete document.body.dataset.peertalksInChat;
      delete document.body.dataset.peertalksInCall;
    }
    return () => {
      delete document.body.dataset.peertalksInChat;
      delete document.body.dataset.peertalksInCall;
    };
  }, [callType, joined]);

  const handlePeerLeft = useCallback(() => {
    // Stop the offer retry loop and the connect timer immediately: after a
    // peer-left the loop would otherwise keep broadcasting offers (and the
    // 45s connect timer would later overwrite the accurate "partner left"
    // reason with a misleading "couldn't be reached" message).
    if (offerTimerRef.current) {
      clearInterval(offerTimerRef.current);
      offerTimerRef.current = null;
    }
    if (connectTimerRef.current) {
      clearTimeout(connectTimerRef.current);
      connectTimerRef.current = null;
    }
    setPeerLeft(true);
  }, []);

  const initiateSignaling = useCallback(async (pc: RTCPeerConnection, isOfferer: boolean) => {
    const supabase = getSupabase();
    if (!supabase) return;

    const channelName = `signaling:${id}`;
    if (signalingChannelRef.current) {
      supabase.removeChannel(signalingChannelRef.current);
      signalingChannelRef.current = null;
    }

    const channel = supabase.channel(channelName);

    channel.on("broadcast", { event: "reaction" }, (payload) => {
      const { type, senderId } = payload.payload as { type: string; senderId?: string };
      if (!type) return;
      // Realtime broadcast channels are NOT RLS-filtered — anyone with the
      // session id can subscribe. Only accept events from the actual peer.
      if (senderId && peerIdRef.current && senderId !== peerIdRef.current) return;
      addReaction(type);
      setOverlayReactions([...reactionsRef.current]);
      setTimeout(() => {
        setOverlayReactions([...reactionsRef.current]);
      }, 100);
    });

    channel.on("broadcast", { event: "typing" }, (payload) => {
      const { userId: fromId } = payload.payload as { userId: string };
      if (fromId === userIdRef.current) return;
      // Typing is only meaningful when it comes from the actual peer.
      if (peerIdRef.current && fromId !== peerIdRef.current) return;
      setPeerTyping(true);
      if (typingClearTimerRef.current) clearTimeout(typingClearTimerRef.current);
      typingClearTimerRef.current = setTimeout(() => setPeerTyping(false), 2500);
    });

    channel.on("broadcast", { event: "peerleft" }, (payload) => {
      const { userId: fromId } = payload.payload as { userId: string };
      if (fromId === userIdRef.current) return;
      if (peerIdRef.current && fromId !== peerIdRef.current) return;
      handlePeerLeft();
    });

    channel.on("broadcast", { event: "signal" }, async (payload) => {
      const signal = payload.payload as {
        type: string; sdp?: string; candidate?: RTCIceCandidateInit; senderId?: string;
      };
      // Security: signaling channels are public broadcast channels (no RLS).
      // Never accept offers/answers/ICE from anyone other than the peer —
      // a stranger with the session id could otherwise inject fake answers,
      // candidates (IP leak) or kill the call.
      if (signal.senderId && peerIdRef.current && signal.senderId !== peerIdRef.current) {
        return;
      }
      if (signal.type === "offer") {
        console.log("[PeerTalks][WebRTC] offer received");
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
          console.log("[PeerTalks][WebRTC] answer sent");
          await channel.send({
            type: "broadcast",
            event: "signal",
            payload: { type: "answer", sdp: answer.sdp!, senderId: userIdRef.current },
          });
        } catch (e) {
          console.error("[signaling] Failed to handle offer:", e);
        }
      } else if (signal.type === "answer") {
        try {
          console.log("[PeerTalks][WEBRTC] answer received");
          if (pc.signalingState !== "stable") {
            await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: signal.sdp! }));
          }
          answerReceivedRef.current = true;
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
          payload: { type: "ice-candidate", candidate: event.candidate.toJSON(), senderId: userIdRef.current },
        }).catch(() => {});
      }
    };

    await channel.subscribe();
    // The chat may have ended while the channel was connecting — never
    // register a channel or start the offer loop after cleanup ran.
    if (sessionEndedRef.current) {
      supabase.removeChannel(channel);
      return;
    }
    signalingChannelRef.current = channel;

    if (isOfferer) {
      // Retry the offer until we get an answer (handles peers joining late).
      // The FIRST offer is often broadcast before the peer's channel is
      // subscribed, and broadcast messages are never replayed — so unless we
      // roll back and re-offer, a missed offer leaves both sides stuck at
      // "Connecting..." forever.
      const sendOffer = async () => {
        // The chat may have ended while the pre-offer wait was pending —
        // never resurrect the retry loop on a closed/detached peer connection.
        if (sessionEndedRef.current || pcRef.current !== pc || pc.connectionState === "closed") return;
        if (answerReceivedRef.current || pc.connectionState === "connected") {
          if (offerTimerRef.current) {
            clearInterval(offerTimerRef.current);
            offerTimerRef.current = null;
          }
          return;
        }
        try {
          if (pc.signalingState === "have-local-offer") {
            await pc.setLocalDescription({ type: "rollback" }).catch(() => {});
          }
          if (pc.signalingState !== "have-local-offer") {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            const ready = await channel.send({
              type: "broadcast",
              event: "signal",
              payload: { type: "offer", sdp: offer.sdp!, senderId: userIdRef.current },
            }).then(() => true).catch(() => false);
            console.log("[PeerTalks][WEBRTC] offer sent", { acceptedByRealtime: ready });
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
    // Guard against a double-click / double-invocation: a second
    // RTCPeerConnection would orphan the first (never closed, both send
    // media) and leak its signaling channel.
    if (pcRef.current) return;
    setIsJoining(true);
    try {
      if (callType === "text") {
        setJoined(true);
        return;
      }

      const stream = localStreamRef.current;
      if (!stream) {
        setMediaError(
          "Camera or microphone is unavailable. Allow permissions in your browser and try again."
        );
        return;
      }

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      });

      pc.ontrack = (event) => {
        console.log("[PeerTalks][WEBRTC] remote stream received", {
          streams: event.streams.length, trackKind: event.track?.kind,
        });
        if (event.streams[0]) setRemoteStream(event.streams[0]);
      };

      pc.oniceconnectionstatechange = () => {
        console.log("[PeerTalks][WEBRTC] iceConnectionState:", pc.iceConnectionState);
        if (pc.iceConnectionState === "disconnected") {
          // Try to re-establish
          try {
            pc.restartIce();
          } catch {}
        }
      };

      pc.onconnectionstatechange = () => {
        setConnectionState(pc.connectionState);
        console.log("[PeerTalks][WEBRTC] connectionState:", pc.connectionState);
        if (pc.connectionState === "connected") {
          setPeerLeft(false);
          if (offerTimerRef.current) {
            clearInterval(offerTimerRef.current);
            offerTimerRef.current = null;
          }
          if (connectTimerRef.current) {
            clearTimeout(connectTimerRef.current);
            connectTimerRef.current = null;
          }
        } else if (pc.connectionState === "failed") {
          setPeerLeftReason("The connection to your partner was lost");
          if (offerTimerRef.current) {
            clearInterval(offerTimerRef.current);
            offerTimerRef.current = null;
          }
          handlePeerLeft();
        } else if (pc.connectionState === "disconnected") {
          // Give ICE restart a chance before declaring peer left
          disconnectTimerRef.current = setTimeout(() => {
            disconnectTimerRef.current = null;
            if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
              setPeerLeftReason("The connection to your partner was lost");
              handlePeerLeft();
            }
          }, 6000);
        }
      };

      const tracks = stream.getTracks();
      console.log("[PeerTalks][WEBRTC] local tracks:", tracks.map((t) => `${t.kind}:${t.readyState}`).join(", "));
      tracks.forEach((track) => pc.addTrack(track, stream));

      pcRef.current = pc;
      setJoined(true);

      const supabase = getSupabase();
      if (!supabase) return;

      const session = await supabase
        .from("chat_sessions")
        .select("user1_id")
        .eq("id", id)
        .maybeSingle();
      // Exactly ONE offerer: the session's user1 (room host / first
      // matched). Deriving this from the session — instead of a lexicographic
      // comparison on peer ids — prevents glare when the host's peer id is
      // unknown at join time (private rooms).
      const isOfferer = (session?.data?.user1_id ?? null) === userIdRef.current;
      console.log("[PeerTalks][WEBRTC] role determined", { isOfferer, sessionId: id });

      initiateSignaling(pc, isOfferer);

      // If the peer never joins (e.g. the other user closed the tab), never
      // stay on "Establishing secure connection..." forever.
      connectTimerRef.current = setTimeout(() => {
        if (
          pcRef.current &&
          pcRef.current.connectionState !== "connected" &&
          !sessionEndedRef.current
        ) {
          setPeerLeftReason("Your partner couldn't be reached. They may have left or lost connection.");
          setPeerLeft(true);
        }
      }, 45000);
    } catch (joinError) {
      // Any exception in PC setup / track add / session fetch must be
      // visible to the user, not an unhandled rejection with a half-built
      // connection.
      console.error("[PeerTalks][WEBRTC] join failed", joinError);
      setMediaError("Could not start the call. Please try again.");
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      setRemoteStream((prev) => {
        prev?.getTracks().forEach((t) => t.stop());
        return null;
      });
      if (connectTimerRef.current) {
        clearTimeout(connectTimerRef.current);
        connectTimerRef.current = null;
      }
    } finally {
      setIsJoining(false);
    }
  }, [callType, id, initiateSignaling, handlePeerLeft]);

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
      if (sessionChannelRef.current) {
        supabase.removeChannel(sessionChannelRef.current);
        sessionChannelRef.current = null;
      }
      if (reactionsChannelRef.current) {
        supabase.removeChannel(reactionsChannelRef.current);
        reactionsChannelRef.current = null;
      }
    }
    if (offerTimerRef.current) {
      clearInterval(offerTimerRef.current);
      offerTimerRef.current = null;
    }
    if (connectTimerRef.current) {
      clearTimeout(connectTimerRef.current);
      connectTimerRef.current = null;
    }
    if (typingClearTimerRef.current) {
      clearTimeout(typingClearTimerRef.current);
      typingClearTimerRef.current = null;
    }
    if (disconnectTimerRef.current) {
      clearTimeout(disconnectTimerRef.current);
      disconnectTimerRef.current = null;
    }
  }, []);

  // Purge this user's matching queue rows (waiting AND matched) for both
  // modes — matched rows must never resurrect an old session during the
  // next matching attempt. Only waiting rows ever refund, so this is safe
  // to fire on every leave.
  const purgeQueueRows = useCallback(() => {
    const body = JSON.stringify({ cleanupMatched: true });
    fetch("/api/matching/random", { method: "DELETE", body, headers: { "Content-Type": "application/json" } }).catch(() => {});
    fetch("/api/matching/interest", { method: "DELETE", body, headers: { "Content-Type": "application/json" } }).catch(() => {});
  }, []);

  // Ends the session server-side with ONE retry. A single failed POST
  // previously left the DB row "connected" forever (peer stranded, stale
  // matched queue row resurrecting the dead session) — the unmount path
  // must not swallow that failure silently. keepalive: true lets the
  // request finish even if the tab is closing.
  const endSessionOnServer = useCallback(async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch("/api/chat/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: id }),
          keepalive: true,
        });
        if (res.ok) return;
      } catch {}
    }
  }, [id]);

  const endChat = useCallback(async (goTo: string = "/dashboard") => {
    sessionEndedRef.current = true;
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
    void endSessionOnServer();
    stopLocalStream(localStreamRef.current);
    pcRef.current?.close();
    pcRef.current = null;
    setRemoteStream((prev) => {
      prev?.getTracks().forEach((t) => t.stop());
      return null;
    });
    purgeQueueRows();
    router.push(goTo);
  }, [router, cleanupChannels, purgeQueueRows, endSessionOnServer]);

  // Leaving the page without pressing "End chat" (back button, tab close)
  // must still end the session and purge matching rows — otherwise a stale
  // "connected" session and a matched queue row can resurrect on the next
  // attempt, and the peer stays on the call screen forever.
  useEffect(() => {
    return () => {
      if (sessionEndedRef.current) return;
      sessionEndedRef.current = true;
      if (id) {
        void endSessionOnServer();
        purgeQueueRows();
      }
    };
  }, [id, purgeQueueRows, endSessionOnServer]);

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
    const { data: { user } } = await s.auth.getUser();
    if (!user) return;
    const { data: inserted, error } = await s
      .from("messages")
      .insert({
        session_id: id,
        sender_id: user.id,
        content,
      })
      .select()
      .single();
    if (error) {
      console.error("[PeerTalks][MESSAGES] insert failed", {
        sessionId: id, message: error.message,
      });
      toast.error("Failed to send message");
      setNewMessage(content);
      return;
    }
    // Optimistic append: the sender's bubble must not depend on a realtime
    // event that may be delayed or broken. The realtime INSERT handler
    // dedupes by id, so this cannot double-render.
    if (inserted) {
      setMessages((prev) =>
        prev.some((m) => m.id === inserted.id) ? prev : [...prev, inserted]
      );
    }
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
        payload: { type, senderId: userIdRef.current },
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
    if (!peerIdRef.current) {
      toast.error("Unable to report right now", "Your chat partner is not connected yet.");
      return;
    }
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
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Chat with your partner"
            onKeyDown={(e) => {
              if (e.key === "Escape") setShowChat(false);
            }}
            className="fixed inset-0 z-40 sm:static sm:inset-auto sm:z-auto sm:w-80 border-l border-white/5 bg-black/70 flex flex-col sm:relative"
          >
            <div className="flex items-center justify-between p-4 border-b border-white/[0.04]">
              <span className="text-sm text-white/60 font-medium">Chat</span>
              <button
                onClick={() => setShowChat(false)}
                className="w-11 h-11 rounded-xl hover:bg-white/[0.04] flex items-center justify-center transition-all duration-200"
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
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Conversation ended"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onKeyDown={(e) => {
            if (e.key === "Escape") endChat("/dashboard");
          }}
        >
          <div className="glass-card rounded-3xl p-8 text-center max-w-sm mx-4">
            <div className="w-12 h-12 mx-auto rounded-full bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-white/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-white/90 mb-2">Conversation ended</h2>
            <p className="text-sm text-muted mb-6">{peerLeftReason}</p>
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
      <div className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm text-white/80 ${mine ? "bg-white/20" : "bg-white/10"}`}>
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
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Report this user"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
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
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
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