"use client";

export const dynamic = "force-dynamic";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useRef, useCallback, useMemo, memo } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Message, MessageAttachment } from "@/types/database";
import type { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";
import { VideoCard, FloatingPreview, CallControls, JoinScreen, ReactionOverlay, useReactions } from "@/components/video";
import Icons from "@/components/icons/icons";
import { startLocalStream, stopLocalStream, toggleTrack } from "@/lib/webrtc/peerConnection";
import { useToast } from "@/hooks/useToast";

const EMOJI_OPTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥", "🎉", "👏"];

// Attachment size cap (00012) — client-side guard before any upload.
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

// Lifecycle timing. These are deliberately separate concerns:
// - CONNECT_TIMEOUT_MS bounds how long we wait for the FIRST connection.
// - RECONNECT_GRACE_MS is how long a known connection may stay down before
//   it is treated as a real departure.
// Remote-media delay NEVER ends the conversation on its own — the media
// indicator is driven by stream presence, not by a timer.
const CONNECT_TIMEOUT_MS = 60000;
const RECONNECT_GRACE_MS = 20000;
// A known connection may drop and recover (mobile blips) — but never in an
// unbounded cycle: after MAX_RECONNECT_ATTEMPTS failed recovery windows the
// call is treated as lost instead of looping "Reconnecting…" forever.
const MAX_RECONNECT_ATTEMPTS = 3;

type CallState =
  | "idle"
  | "signaling"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "ended"
  | "failed"
  | "cancelled";

function ChatRoomContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  // Set when the create flow learned the backend can't store capacity
  // (00011 not deployed) — the room silently holds 2 people. Derived from
  // searchParams (not a useState initializer): useSearchParams is empty on
  // the SSR/hydration pass, so capturing it into state would freeze the
  // notice as invisible forever. The dismiss flag is separate so hiding the
  // notice survives param updates.
  const capacityDegraded = searchParams.get("cap") === "degraded";
  const [capNoticeDismissed, setCapNoticeDismissed] = useState(false);
  // The notice must also be visible on the JOIN screen (the host lands there
  // right after creating the room with ?cap=degraded), so it renders above the
  // full-screen JoinScreen (z-50) as a fixed z-[60] overlay until dismissed.
  const capacityBanner =
    capacityDegraded && !capNoticeDismissed ? (
      <div role="status" className="flex items-center justify-between gap-3 px-4 py-2 bg-warning-soft/60 border-b border-warning/20">
        <p className="text-[11px] text-warning">
          Group capacity isn&apos;t available on this server yet — this room holds up to 2 people.
        </p>
        <button
          onClick={() => setCapNoticeDismissed(true)}
          aria-label="Dismiss capacity notice"
          className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-warning/70 hover:bg-warning/10 hover:text-warning transition-colors"
        >
          ✕
        </button>
      </div>
    ) : null;
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [connectionState, setConnectionState] = useState<string>("new");
  // Derived from getStats RTT while connected (Excellent/Good/Weak) —
  // shown as a subtle pill so users can tell a weak link from a dead one.
  const [callQuality, setCallQuality] = useState<"excellent" | "good" | "weak" | null>(null);
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
  const [screenSharing, setScreenSharing] = useState(false);
  const [peerScreenSharing, setPeerScreenSharing] = useState(false);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraVideoTrackRef = useRef<MediaStreamTrack | null>(null);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [clientReady, setClientReady] = useState(false);
  const [reactions, setReactions] = useState<Record<number, Record<string, { count: number; mine: boolean }>>>({});
  const [peerLeftReason, setPeerLeftReason] = useState<string>("Your partner left");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const supabaseRef = useRef<SupabaseClient | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  // The in-flight camera/mic acquisition: "Join call" is clickable before
  // getUserMedia resolves, so handleJoin must WAIT for this promise instead
  // of silently returning (which stranded the peer on "Connecting...").
  const mediaPromiseRef = useRef<Promise<MediaStream | null> | null>(null);
  const joiningRef = useRef(false);
  const sendingRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const msgChannelRef = useRef<RealtimeChannel | null>(null);
  const signalingChannelRef = useRef<RealtimeChannel | null>(null);
  const sessionChannelRef = useRef<RealtimeChannel | null>(null);
  const reactionsChannelRef = useRef<RealtimeChannel | null>(null);
  const msgReadsChannelRef = useRef<RealtimeChannel | null>(null);
  // Seen system (00013): enabled only when the schema actually has the read
  // tables — the migrations are committed-only until applied, so everything
  // must degrade to plain chat without them.
  const [readsEnabled, setReadsEnabled] = useState(false);
  const readsEnabledRef = useRef(false);
  // Message ids the PEER has read (drives "Seen" under my bubbles).
  const [seenByPeer, setSeenByPeer] = useState<ReadonlySet<number>>(new Set());
  const seenByPeerRef = useRef<Set<number>>(new Set());
  // My last-read message id (drives the unread badge).
  const [lastReadId, setLastReadId] = useState<number | null>(null);
  const lastReadIdRef = useRef<number | null>(null);
  const markReadsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Attachments (00012): committed-only migration, so the ledger is probed
  // exactly like message_reads — without it the chat stays plain text.
  const attachmentsEnabledRef = useRef(false);
  const attachmentsRef = useRef<Map<number, MessageAttachment>>(new Map());
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentsChannelRef = useRef<RealtimeChannel | null>(null);
  // Auto-scroll: only follow new messages while the user is near the bottom,
  // so scrolling up to read history is never interrupted.
  const lastCountRef = useRef(0);
  const nearBottomRef = useRef(true);
  const userIdRef = useRef<string | null>(null);
  const peerIdRef = useRef<string | null>(null);
  const sessionEndedRef = useRef(false);
  const offerTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // In-flight attachment upload tracker: prevents duplicate uploads when the
  // user triggers a new send while an earlier upload is still pending.
  const inFlightUploadsRef = useRef<Set<number>>(new Set());
  const answerReceivedRef = useRef(false);
  const typingSentAtRef = useRef(0);
  const typingClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { reactionsRef, addReaction } = useReactions();
  const [overlayReactions, setOverlayReactions] = useState<{ id: string; icon: import("@/components/icons/icons").IconName }[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [callState, setCallState] = useState<CallState>("idle");
  const callStateRef = useRef<CallState>("idle");
  const isOffererRef = useRef(false);
  const startOfferLoopRef = useRef<(() => void) | null>(null);

  // Signaling hardening: Supabase Realtime dispatches incoming broadcast
  // messages CONCURRENTLY, while offer/answer processing is async. A trickle
  // ICE candidate can therefore be handled while remoteDescription is still
  // null — addIceCandidate() THROWS in that state and the candidate is
  // permanently lost (same-network devices gather in ms and hit this window
  // constantly; STUN srflx candidates on cross-network links arrive later
  // and survive — the exact "same Wi-Fi fails more than mobile data" pattern).
  // Fix: serialize signal handling and queue candidates until a remote
  // description exists, flushing them right after it is applied.
  const signalQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const seenCandidatesRef = useRef<Set<string>>(new Set());
  // Candidates gathered while the signaling channel has NOT joined yet.
  // Realtime broadcasts are never replayed, and the first host candidates
  // gather in ms — long before the channel subscribes — so without a buffer
  // they are silently dropped and the answerer never learns our host/IP.
  const pendingOutboundCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  // Recovery budget: counts completed reconnect grace windows. Reset on a
  // successful connect; the session ends after MAX_RECONNECT_ATTEMPTS.
  const reconnectAttemptsRef = useRef(0);
  // One re-acquire attempt per media kind per call (device removal).
  const mediaRetryRef = useRef<{ audio: boolean; video: boolean }>({ audio: false, video: false });
  const screenSharingRef = useRef(false);

  const setCallStateSafe = useCallback((s: CallState) => {
    callStateRef.current = s;
    setCallState(s);
    console.log("[PeerTalks][SESSION] state", { sessionId: id, callState: s });
  }, [id]);

  // Fold the attachment ledger row into message rows by message id. Runs at
  // history load and on every realtime merge so a bubble's chip can never
  // depend on event ordering between the messages and attachments channels.
  const attachTo = (rows: Message[]) =>
    rows.map((m) => {
      const a = attachmentsRef.current.get(m.id);
      return a ? { ...m, attachment: a } : m;
    });

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

  // Latest-value ref so the stable toggleMessageReaction callback never
  // depends on the reactions state object (keeps MessageBubble memoizable).
  const messageReactionsRef = useRef<Record<number, Record<string, { count: number; mine: boolean }>>>({});
  useEffect(() => {
    messageReactionsRef.current = reactions;
  }, [reactions]);

  const triggerOverlay = useCallback(() => {
    setOverlayReactions([...reactionsRef.current]);
    setTimeout(() => {
      setOverlayReactions([...reactionsRef.current]);
    }, 100);
  }, [reactionsRef]);

  // Serialize signal processing per channel: offer → answer → candidates are
  // handled strictly in arrival order, so a candidate can never race the
  // setRemoteDescription() it depends on.
  const enqueueSignal = useCallback((task: () => Promise<void>) => {
    signalQueueRef.current = signalQueueRef.current
      .then(task)
      .catch((e) => {
        console.error(
          "[PeerTalks][SIGNALING] signal handler error",
          e instanceof Error ? e.message : String(e)
        );
      });
  }, []);

  const candidateKey = (c: RTCIceCandidateInit) =>
    `${c.sdpMid ?? ""}|${c.sdpMLineIndex ?? -1}|${c.candidate ?? ""}`;

  // Never lose a candidate to a missing remoteDescription: add immediately
  // when possible, otherwise queue until the offer/answer lands.
  const enqueueCandidate = useCallback((candidate: RTCIceCandidateInit, pc: RTCPeerConnection) => {
    const key = candidateKey(candidate);
    if (seenCandidatesRef.current.has(key)) return;
    seenCandidatesRef.current.add(key);
    if (pc.remoteDescription) {
      pc.addIceCandidate(new RTCIceCandidate(candidate)).catch((e) => {
        console.warn("[PeerTalks][ICE] candidate rejected", {
          reason: e instanceof Error ? e.message : String(e),
        });
      });
      return;
    }
    pendingCandidatesRef.current.push(candidate);
    console.log("[PeerTalks][ICE] candidate queued until remoteDescription is set", {
      queued: pendingCandidatesRef.current.length,
    });
  }, []);

  const flushQueuedCandidates = useCallback((pc: RTCPeerConnection) => {
    if (!pc.remoteDescription) return;
    const queued = pendingCandidatesRef.current;
    if (queued.length === 0) return;
    pendingCandidatesRef.current = [];
    queued.forEach((c) => {
      pc.addIceCandidate(new RTCIceCandidate(c)).catch((e) => {
        console.warn("[PeerTalks][ICE] queued candidate rejected", {
          reason: e instanceof Error ? e.message : String(e),
        });
      });
    });
    console.log("[PeerTalks][ICE] flushed queued candidates", { count: queued.length });
  }, []);

  // A new ICE generation starts when a remote description is applied (or a
  // fresh local offer is created). Old-generation candidates are invalid for
  // it, so drop the queue and the dedupe set before creating a new offer.
  const resetCandidateState = useCallback(() => {
    pendingCandidatesRef.current = [];
    seenCandidatesRef.current.clear();
  }, []);

  // Send every candidate buffered before the channel joined. Called from the
  // SUBSCRIBED callback and defensively before each offer send — idempotent,
  // and the dedupe set on the receiving side keeps resends harmless.
  const flushOutboundCandidates = useCallback(() => {
    const ch = signalingChannelRef.current;
    if (!ch || ch.state !== "joined") return;
    const buffered = pendingOutboundCandidatesRef.current;
    if (buffered.length === 0) return;
    pendingOutboundCandidatesRef.current = [];
    buffered.forEach((candidate) => {
      ch.send({
        type: "broadcast",
        event: "signal",
        payload: { type: "ice-candidate", candidate, senderId: userIdRef.current },
      }).catch(() => {});
    });
    console.log("[PeerTalks][ICE] flushed pre-join candidates", { count: buffered.length });
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Only follow the conversation while the user is near the bottom. A grow in
  // message count triggers the scroll; history merges (same ids) never yank
  // the viewport, and scrolling up to read old messages stays uninterrupted.
  useEffect(() => {
    const count = messages.length;
    if (count > lastCountRef.current && nearBottomRef.current) {
      scrollToBottom();
    }
    lastCountRef.current = count;
  }, [messages]);

  const handleListScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  // Opening the chat panel shows the latest messages, not a stale position.
  useEffect(() => {
    if (!showChat) return;
    const t = setTimeout(scrollToBottom, 60);
    return () => clearTimeout(t);
  }, [showChat]);

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
          setCallStateSafe("ended");
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
  }, [id, clientReady, router, toast, setCallStateSafe]);

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
              setCallStateSafe("ended");
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
  }, [id, callLoaded, setCallStateSafe]);

  // Message history + realtime
  useEffect(() => {
    if (!joined) return;
    let cancelled = false;

    const init = async () => {
      const supabase = getSupabase();
      if (!supabase) return;

      // Newest 200 first (matches idx_messages_created desc), then reverse so
      // the list renders in chronological order. Ascending + limit 200 would
      // keep the OLDEST messages and never load the latest ones in a session
      // longer than 200 messages.
      const { data: msgs } = await supabase
        .from("messages")
        .select("*")
        .eq("session_id", id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (msgs) msgs.reverse();
      // Attachments (00012): same committed-only pattern as the reads probe —
      // verify the ledger exists first; without it, no rows are fetched, no
      // chip ever renders, and the chat behaves exactly as before.
      const attachProbe = await supabase
        .from("message_attachments")
        .select("id", { head: true })
        .limit(1);
      if (!attachProbe.error) {
        attachmentsEnabledRef.current = true;
        const { data: attRows } = await supabase
          .from("message_attachments")
          .select("*")
          .eq("session_id", id);
        if (attRows) {
          for (const a of attRows) attachmentsRef.current.set(a.message_id, a);
        }
      }
      if (!cancelled) setMessages(attachTo(msgs ?? []));

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

      // Seen system probe (00013): the read tables are committed-only until
      // applied, so verify they exist first — if not, the chat works exactly
      // as before (no seen markers, no badge).
      const probe = await supabase
        .from("message_reads")
        .select("message_id", { head: true })
        .limit(1);
      if (!cancelled && !probe.error) {
        readsEnabledRef.current = true;
        setReadsEnabled(true);
        const me = userIdRef.current;
        if (me) {
          const { data: myState } = await supabase
            .from("session_read_state")
            .select("last_read_message_id")
            .eq("session_id", id)
            .eq("user_id", me)
            .maybeSingle();
          if (!cancelled && myState?.last_read_message_id != null) {
            lastReadIdRef.current = myState.last_read_message_id;
            setLastReadId(myState.last_read_message_id);
          }
          if (msgs && msgs.length > 0) {
            const { data: readRows } = await supabase
              .from("message_reads")
              .select("message_id, user_id")
              .in("message_id", msgs.map((m) => m.id));
            if (!cancelled && readRows) {
              const seen = new Set<number>();
              for (const r of readRows) if (r.user_id !== me) seen.add(r.message_id);
              seenByPeerRef.current = seen;
              setSeenByPeer(seen);
            }
          }
        }
      }
    };
    init();

    const setupRealtime = async () => {
      const supabase = getSupabase();
      if (!supabase || cancelled) return;

      // Merge the newest rows from the DB into the live state, deduped by
      // id. Used on channel SUBSCRIBED (close the join loss window) and as a
      // fail-safe re-sync when the tab becomes visible/focused again.
      const syncMessages = async () => {
        if (cancelled) return;
        const { data: msgs } = await supabase
          .from("messages")
          .select("*")
          .eq("session_id", id)
          .order("created_at", { ascending: false })
          .limit(200);
        if (cancelled || !msgs) return;
        setMessages((prev) => {
          const merged = new Map(prev.map((m) => [m.id, m]));
          for (const m of msgs) if (!merged.has(m.id)) merged.set(m.id, m);
          return attachTo(
            [...merged.values()].sort((a, b) =>
              String(a.created_at).localeCompare(String(b.created_at))
            )
          );
        });
      };

      const channel = supabase
        .channel(`messages:${id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "messages",
            filter: `session_id=eq.${id}`,
          },
          (payload) => {
            if (payload.eventType === "INSERT") {
              const incoming = payload.new as Message;
              // Dedupe by id: an optimistically-appended sent message and the
              // realtime event for the same row must not appear twice.
              setMessages((prev) =>
                attachTo(
                  prev.some((m) => m.id === incoming.id)
                    ? prev.map((m) => (m.id === incoming.id ? incoming : m))
                    : [...prev, incoming]
                )
              );
              // Auto-scroll when the user is already near the bottom so the
              // new message becomes visible without an abrupt jump.
              if (nearBottomRef.current) {
                scrollToBottom();
              }
            } else if (payload.eventType === "UPDATE") {
              // Soft-delete tombstones arrive here: replace the row so the
              // peer's open chat shows "Message deleted" without reloading.
              const incoming = payload.new as Message;
              setMessages((prev) =>
                attachTo(
                  prev.some((m) => m.id === incoming.id)
                    ? prev.map((m) => (m.id === incoming.id ? incoming : m))
                    : prev
                )
              );
            } else if (payload.eventType === "DELETE") {
              const oldRow = payload.old as { id?: number } | null;
              if (oldRow?.id != null) {
                setMessages((prev) => prev.filter((m) => m.id !== oldRow.id));
              }
            }
          }
        )
        .subscribe((status) => {
          if (status === "CHANNEL_ERROR" && !cancelled) {
            toast.error("Live message updates failed", "Refresh the page to see new messages");
          }
          // Close the loss window: messages inserted between the history
          // fetch completing and this channel becoming live are never
          // delivered. Re-fetch on SUBSCRIBED and merge by id (deduped).
          if (status === "SUBSCRIBED" && !cancelled) {
            void syncMessages();
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

      // Seen markers: the peer's reads arrive here (gated on the schema
      // probe so a pre-migration DB just stays quiet). No table filter is
      // possible (reads don't carry a session id); RLS scopes the payloads.
      const readsChannel = supabase
        .channel(`message_reads:${id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "message_reads",
          },
          (payload) => {
            if (!readsEnabledRef.current) return;
            const row = payload.new as { message_id?: number; user_id?: string } | null;
            const oldRow = payload.old as { message_id?: number; user_id?: string } | null;
            const messageId = row?.message_id ?? oldRow?.message_id;
            const reader = row?.user_id ?? oldRow?.user_id;
            if (messageId == null || !reader) return;
            // My own reads are already reflected locally — only the peer's
            // markers drive "Seen".
            if (reader === userIdRef.current) return;
            const next = new Set(seenByPeerRef.current);
            if (payload.eventType === "INSERT") next.add(messageId);
            else if (payload.eventType === "DELETE") next.delete(messageId);
            seenByPeerRef.current = next;
            setSeenByPeer(next);
          }
        )
        .subscribe();

      // Attachment ledger rows arrive here so the peer's bubble gets its
      // chip live. No table filter is possible (rows don't carry a session
      // id); RLS scopes the payloads. Gated on the schema probe — a
      // pre-migration DB simply never emits anything.
      const attachmentsChannel = supabase
        .channel(`message_attachments:${id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "message_attachments",
          },
          (payload) => {
            if (!attachmentsEnabledRef.current) return;
            const row = payload.new as MessageAttachment | null;
            const oldRow = payload.old as { message_id?: number } | null;
            const messageId = row?.message_id ?? oldRow?.message_id;
            if (messageId == null) return;
            if (payload.eventType === "INSERT" && row) {
              attachmentsRef.current.set(messageId, row);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === messageId ? { ...m, attachment: row } : m
                )
              );
            } else if (payload.eventType === "DELETE") {
              attachmentsRef.current.delete(messageId);
              setMessages((prev) => prev.map((m) => ({ ...m, attachment: null })));
            }
          }
        )
        .subscribe();

      if (!cancelled) {
        msgChannelRef.current = channel;
        reactionsChannelRef.current = reactionsChannel;
        msgReadsChannelRef.current = readsChannel;
        attachmentsChannelRef.current = attachmentsChannel;
      } else {
        supabase.removeChannel(channel);
        supabase.removeChannel(reactionsChannel);
        supabase.removeChannel(readsChannel);
        supabase.removeChannel(attachmentsChannel);
      }

      // Fail-safe re-sync: renders and realtime events can be delayed while
      // a tab is backgrounded. When the user comes back, merge the newest
      // rows so the list can never stay stale.
      const onVisible = () => {
        if (document.visibilityState === "visible") void syncMessages();
      };
      const onFocus = () => void syncMessages();
      document.addEventListener("visibilitychange", onVisible);
      window.addEventListener("focus", onFocus);
      removeSyncListeners = () => {
        document.removeEventListener("visibilitychange", onVisible);
        window.removeEventListener("focus", onFocus);
      };
    };

    let removeSyncListeners: (() => void) | null = null;
    setupRealtime();

    return () => {
      cancelled = true;
      removeSyncListeners?.();
      if (msgChannelRef.current && supabaseRef.current) {
        supabaseRef.current.removeChannel(msgChannelRef.current);
        msgChannelRef.current = null;
      }
      if (reactionsChannelRef.current && supabaseRef.current) {
        supabaseRef.current.removeChannel(reactionsChannelRef.current);
        reactionsChannelRef.current = null;
      }
      if (msgReadsChannelRef.current && supabaseRef.current) {
        supabaseRef.current.removeChannel(msgReadsChannelRef.current);
        msgReadsChannelRef.current = null;
      }
      if (attachmentsChannelRef.current && supabaseRef.current) {
        supabaseRef.current.removeChannel(attachmentsChannelRef.current);
        attachmentsChannelRef.current = null;
      }
      if (markReadsTimerRef.current) {
        clearTimeout(markReadsTimerRef.current);
        markReadsTimerRef.current = null;
      }
    };
  }, [id, joined, toast]);

  // Mark-read (00013): while the chat is visible, advance my last-read
  // marker to the newest incoming message and record per-message reads so
  // the peer's bubbles show "Seen". Debounced so bursts coalesce into one
  // write; fully skipped when the schema lacks the tables or the chat panel
  // is closed (video mode) — an unread badge then stays honest.
  useEffect(() => {
    if (!joined || !readsEnabled) return;
    const chatVisible = callType === "text" || showChat;
    if (!chatVisible) return;
    const last = messages[messages.length - 1];
    if (!last || last.sender_id === myUserId) return;
    if (lastReadIdRef.current != null && last.id <= lastReadIdRef.current) return;
    const s = supabaseRef.current;
    if (!s) return;
    const startId = lastReadIdRef.current ?? 0;
    const toMark = messages
      .filter((m) => m.id > startId && m.sender_id !== myUserId && !m.deleted_at)
      .map((m) => m.id);
    const targetId = last.id;
    if (markReadsTimerRef.current) clearTimeout(markReadsTimerRef.current);
    markReadsTimerRef.current = setTimeout(async () => {
      const me = userIdRef.current;
      if (!me) return;
      const { error } = await s
        .from("session_read_state")
        .upsert(
          {
            session_id: id,
            user_id: me,
            last_read_message_id: targetId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "session_id,user_id" }
        );
      if (!error && toMark.length > 0) {
        await s
          .from("message_reads")
          .upsert(toMark.map((mid) => ({ message_id: mid, user_id: me })), {
            onConflict: "message_id,user_id",
          });
      }
      // Advance the marker regardless: the badge is best-effort and a stale
      // marker would just re-write the same reads on the next message.
      lastReadIdRef.current = targetId;
      setLastReadId(targetId);
    }, 400);
  }, [messages, joined, callType, showChat, readsEnabled, myUserId, id]);

  // Local media
  useEffect(() => {
    let cancelled = false;

    const startMedia = async (): Promise<MediaStream | null> => {
      try {
        // startLocalStream() defaults carry the 720p caps — unconstrained
        // getUserMedia would pick the camera's maximum (4K on phones).
        const stream = await startLocalStream();
        if (!cancelled) {
          console.log("[PeerTalks][WEBRTC] local media acquired", {
            tracks: stream.getTracks().map((t) => `${t.kind}:${t.readyState}`).join(", "),
          });
          setLocalStream(stream);
          localStreamRef.current = stream;
          setMediaError(null);
          return stream;
        }
        // Unmounted while the camera/mic permission was pending — stop
        // the acquired stream immediately so tracks are not left on.
        stopLocalStream(stream);
        return null;
      } catch {
        // Camera denied — try audio only
        try {
          const stream = await startLocalStream({ video: false, audio: true });
          if (!cancelled) {
            console.log("[PeerTalks][WEBRTC] local media acquired (audio only)", {
              tracks: stream.getTracks().map((t) => `${t.kind}:${t.readyState}`).join(", "),
            });
            setLocalStream(stream);
            localStreamRef.current = stream;
            setVideoEnabled(false);
            setMediaError(null);
            return stream;
          }
          stopLocalStream(stream);
          return null;
        } catch {
          if (!cancelled) {
            setMediaError("Camera and microphone access denied. Please allow permissions in your browser and try again.");
          }
          return null;
        }
      }
    };

    // Gate on callLoaded: callType defaults to "video", so without this the
    // camera briefly powers on even for text chats while the session loads.
    // The promise is kept so a premature "Join call" click can wait for it.
    if (callLoaded && callType === "video") {
      mediaPromiseRef.current = startMedia();
    }

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
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
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
    // Stop the offer retry loop and the connect/reconnect timers
    // immediately: after a peer-left the loop would otherwise keep
    // broadcasting offers (and the 60s connect timer would later overwrite
    // the accurate "partner left" reason with a misleading "couldn't be
    // reached" message).
    if (offerTimerRef.current) {
      clearInterval(offerTimerRef.current);
      offerTimerRef.current = null;
    }
    if (connectTimerRef.current) {
      clearTimeout(connectTimerRef.current);
      connectTimerRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (!sessionEndedRef.current) {
      setCallStateSafe("ended");
    }
    setPeerLeft(true);
  }, [setCallStateSafe]);

  // The peer connection dropping (disconnected/failed) does NOT prove the
  // peer left — on mobile a short network blip, backgrounding or a slow
  // phone looks identical. Enter a reconnecting state: attempt recovery and
  // only surface "Conversation ended" after the grace period expires with no
  // recovery and no authoritative departure evidence.
  const enterReconnecting = useCallback(() => {
    const pc = pcRef.current;
    if (!pc || pc.connectionState === "closed" || sessionEndedRef.current) return;
    if (callStateRef.current === "ended" || callStateRef.current === "reconnecting") return;
    // Bounded recovery: each drop costs one attempt; after the budget is
    // exhausted the call ends instead of re-entering the grace window
    // forever on a flapping network.
    reconnectAttemptsRef.current += 1;
    const attempt = reconnectAttemptsRef.current;
    console.log("[PeerTalks][SESSION] connection lost - reconnecting", {
      attempt,
      maxAttempts: MAX_RECONNECT_ATTEMPTS,
      connectionState: pc.connectionState,
      iceConnectionState: pc.iceConnectionState,
    });
    if (attempt > MAX_RECONNECT_ATTEMPTS) {
      console.log("[PeerTalks][SESSION] reconnect budget exhausted - ending call");
      setPeerLeftReason("The connection to your partner was lost");
      handlePeerLeft();
      return;
    }
    setCallStateSafe("reconnecting");
    // Restart ICE (triggers negotiationneeded) and, on the offerer side,
    // resume the offer retry loop so the recovery offer is actually sent.
    // Only restart when the negotiation state is stable — a restart during
    // an in-flight negotiation is dropped by the browser and would stall the
    // recovery that is already happening.
    if (pc.signalingState === "stable") {
      try {
        pc.restartIce();
      } catch {}
    }
    answerReceivedRef.current = false;
    if (isOffererRef.current) {
      startOfferLoopRef.current?.();
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      const cur = pcRef.current;
      if (!cur || cur.connectionState === "closed" || sessionEndedRef.current) return;
      const down =
        cur.connectionState === "disconnected" ||
        cur.connectionState === "failed" ||
        cur.iceConnectionState === "disconnected" ||
        cur.iceConnectionState === "failed";
      if (down) {
        console.log("[PeerTalks][TIMEOUT] reconnect grace expired", {
          connectionState: cur.connectionState,
          iceConnectionState: cur.iceConnectionState,
        });
        setPeerLeftReason("The connection to your partner was lost");
        handlePeerLeft();
      } else {
        console.log("[PeerTalks][SESSION] reconnected");
        setCallStateSafe("connected");
      }
    }, RECONNECT_GRACE_MS);
  }, [handlePeerLeft, setCallStateSafe]);

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
      triggerOverlay();
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

    channel.on("broadcast", { event: "screenshare" }, (payload) => {
      const { userId: fromId, active } = payload.payload as { userId: string; active: boolean };
      if (fromId === userIdRef.current) return;
      if (peerIdRef.current && fromId !== peerIdRef.current) return;
      setPeerScreenSharing(Boolean(active));
    });

    channel.on("broadcast", { event: "signal" }, (payload) => {
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
      // Serialized: offer/answer/candidate messages are processed strictly in
      // arrival order, so candidates can never race setRemoteDescription().
      enqueueSignal(async () => {
        if (sessionEndedRef.current || pc.connectionState === "closed") return;
        if (signal.type === "offer") {
          console.log("[PeerTalks][WEBRTC] offer received", {
            signalingState: pc.signalingState, hasRemoteDescription: !!pc.remoteDescription,
          });
          try {
            if (pc.signalingState === "have-local-offer") {
              // Glare — we made an offer first; treat ours as invalid
              try {
                await pc.setLocalDescription({ type: "rollback" });
              } catch {}
              await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: signal.sdp! }));
            } else if (pc.signalingState === "have-remote-offer") {
              // A second offer while the first is still being answered can
              // only be a duplicate or replacement (the serialized queue
              // guarantees the first offer was already applied). Applying it
              // directly would throw InvalidStateError and stall the call —
              // roll the in-flight answer back and adopt the NEWER offer.
              console.log("[PeerTalks][SIGNALING] offer received while answering - replacing");
              try {
                await pc.setLocalDescription({ type: "rollback" });
              } catch {}
              await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: signal.sdp! }));
            } else {
              // stable (first offer / renegotiation) or have-local-answer
              // (newer offer after an answer — legal; re-answered below).
              await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: signal.sdp! }));
            }
            // New generation: candidates queued before the offer belong to it.
            flushQueuedCandidates(pc);
            seenCandidatesRef.current.clear();
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            console.log("[PeerTalks][SIGNALING] answer sent", {
              signalingState: pc.signalingState,
            });
            await channel.send({
              type: "broadcast",
              event: "signal",
              payload: { type: "answer", sdp: answer.sdp!, senderId: userIdRef.current },
            });
          } catch (e) {
            console.error("[PeerTalks][SIGNALING] failed to handle offer", e);
          }
        } else if (signal.type === "answer") {
          console.log("[PeerTalks][SIGNALING] answer received", {
            signalingState: pc.signalingState, hasRemoteDescription: !!pc.remoteDescription,
          });
          try {
            if (pc.signalingState !== "stable") {
              await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: signal.sdp! }));
              answerReceivedRef.current = true;
              // Candidates the answerer gathered while its answer was in
              // flight may have arrived here first — apply them now.
              flushQueuedCandidates(pc);
              seenCandidatesRef.current.clear();
            } else if (!pc.remoteDescription) {
              // Our offer was rolled back by the retry loop before this
              // answer landed — it targets a dead offer. Do NOT mark the
              // exchange answered; the loop re-offers and the peer re-answers.
              console.log("[PeerTalks][SIGNALING] answer for rolled-back offer - will re-offer");
              answerReceivedRef.current = false;
            } else {
              // Duplicate answer for an already-applied offer — ignore.
              answerReceivedRef.current = true;
            }
          } catch (e) {
            console.error("[PeerTalks][SIGNALING] failed to handle answer", e);
          }
        } else if (signal.type === "ice-candidate") {
          if (signal.candidate) {
            enqueueCandidate(signal.candidate, pc);
          }
        }
      });
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log("[PeerTalks][WEBRTC] ice candidate gathered", {
          type: event.candidate.type,
          protocol: event.candidate.protocol,
          channelState: channel.state,
        });
      }
      if (!event.candidate) return;
      // Candidates gathered BEFORE the channel joins are otherwise dropped
      // forever (broadcasts aren't replayed) — buffer them for the flush on
      // SUBSCRIBED instead. Same-network host candidates gather in ms and hit
      // this window constantly.
      if (channel.state === "joined") {
        channel.send({
          type: "broadcast",
          event: "signal",
          payload: { type: "ice-candidate", candidate: event.candidate.toJSON(), senderId: userIdRef.current },
        }).catch(() => {});
      } else {
        pendingOutboundCandidatesRef.current.push(event.candidate.toJSON());
        console.log("[PeerTalks][ICE] candidate buffered until channel joins", {
          buffered: pendingOutboundCandidatesRef.current.length,
        });
      }
    };

    await channel.subscribe((status) => {
      console.log("[PeerTalks][SIGNALING] channel status", { sessionId: id, status });
      if (status === "SUBSCRIBED") {
        flushOutboundCandidates();
      }
    });
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
        // Defensive flush: if the SUBSCRIBED callback was missed, candidates
        // buffered pre-join still ride along with the first offer.
        flushOutboundCandidates();
        if (answerReceivedRef.current || pc.connectionState === "connected") {
          if (offerTimerRef.current) {
            clearInterval(offerTimerRef.current);
            offerTimerRef.current = null;
          }
          return;
        }
        try {
          if (pc.signalingState === "have-local-offer") {
            // Re-broadcast the SAME offer instead of rolling back and
            // creating a fresh one: after a rollback Chromium can reorder
            // m-lines, and the answerer's setRemoteDescription throws
            // (InvalidAccessError) on the mismatch — the ICE generation
            // diverges and the call dies. Re-sending identical SDP is
            // idempotent: the answerer re-answers and we converge.
            const pending = pc.localDescription?.sdp;
            if (!pending) return;
            const ready = await channel.send({
              type: "broadcast",
              event: "signal",
              payload: { type: "offer", sdp: pending, senderId: userIdRef.current },
            }).then(() => true).catch(() => false);
            console.log("[PeerTalks][WEBRTC] offer re-sent", { acceptedByRealtime: ready });
            return;
          }
          if (pc.signalingState === "stable" && !pc.remoteDescription) {
            // Nothing on the wire yet (first tick) — create the offer once.
            // New local offer = new ICE generation; old queued/seen
            // candidates are invalid for it.
            resetCandidateState();
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            const ready = await channel.send({
              type: "broadcast",
              event: "signal",
              payload: { type: "offer", sdp: offer.sdp!, senderId: userIdRef.current },
            }).then(() => true).catch(() => false);
            console.log("[PeerTalks][WEBRTC] offer sent", { acceptedByRealtime: ready });
          }
          // Otherwise (glare handled by the offer branch, answer applied,
          // or renegotiation in flight) — skip this tick.
        } catch (e) {
          console.error("[PeerTalks][SIGNALING] failed to create/send offer", e);
        }
      };

      await new Promise((r) => setTimeout(r, 800));
      await sendOffer();
      // Exposed so the reconnecting path can resume offering after a drop.
      startOfferLoopRef.current = () => {
        if (offerTimerRef.current) return;
        offerTimerRef.current = setInterval(sendOffer, 2500);
      };
      startOfferLoopRef.current();
    }
  }, [id, addReaction, handlePeerLeft, enqueueSignal, enqueueCandidate, flushQueuedCandidates, resetCandidateState, flushOutboundCandidates, triggerOverlay]);

  const handleJoin = useCallback(async () => {
    // Guard against a double-click / double-invocation: a second
    // RTCPeerConnection would orphan the first (never closed, both send
    // media) and leak its signaling channel. joiningRef closes the tiny
    // window before pcRef is assigned (media still pending).
    if (pcRef.current || joiningRef.current) return;
    joiningRef.current = true;
    setIsJoining(true);
    try {
      if (callType === "text") {
        setJoined(true);
        return;
      }

      let stream = localStreamRef.current;
      if (!stream) {
        // "Join call" is clickable before the camera preview exists
        // (getUserMedia in flight — or still starting while the session
        // loads). WAIT for the acquisition instead of returning silently: a
        // silent return strands the peer on "Connecting..." with no offer
        // ever sent. Bound the wait: if the permission prompt stays
        // unanswered, surface the error and let the user retry once the
        // stream (if any) is ready.
        const deadline = Date.now() + 20000;
        while (!mediaPromiseRef.current && Date.now() < deadline) {
          await new Promise<void>((r) => setTimeout(r, 100));
        }
        if (mediaPromiseRef.current) {
          stream = await Promise.race([
            mediaPromiseRef.current,
            new Promise<MediaStream | null>((resolve) =>
              setTimeout(() => resolve(null), Math.max(1, deadline - Date.now()))
            ),
          ]);
        }
      }
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
      console.log("[PeerTalks][WEBRTC] pc created", { sessionId: id, userId: userIdRef.current });

      // Recovery path: when restartIce() flags that the connection needs
      // renegotiation, this handler actually broadcasts the new offer.
      // Without it a restarted ICE never leaves this client and the call
      // stays stuck in "disconnected" until the grace timer kills it.
      // Attached IMMEDIATELY (before the channel subscribes) so a restart
      // during subscription can never lose its negotiationneeded event.
      // Gated to the reconnecting phase so it never duplicates the offerer's
      // initial offer loop.
      pc.onnegotiationneeded = async () => {
        if (sessionEndedRef.current || pc.connectionState === "closed") return;
        if (callStateRef.current !== "reconnecting") return;
        if (pc.signalingState !== "stable") return;
        const ch = signalingChannelRef.current;
        if (!ch || ch.state !== "joined") return;
        try {
          resetCandidateState();
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await ch.send({
            type: "broadcast",
            event: "signal",
            payload: { type: "offer", sdp: offer.sdp!, senderId: userIdRef.current },
          });
          console.log("[PeerTalks][SIGNALING] recovery offer sent", {
            signalingState: pc.signalingState,
          });
        } catch (e) {
          console.error("[PeerTalks][SIGNALING] recovery offer failed", e);
        }
      };

      // Tracks the remote media stream across ontrack events. Some browsers
      // (WebKit/Safari) fire ontrack with an empty `streams` array, or
      // deliver audio/video as separate stream objects — merging every track
      // into ONE stream guarantees the remote video element always receives
      // the video track instead of staying black/empty while the connection
      // itself reports "connected".
      let remoteStream: MediaStream | null = null;
      pc.ontrack = (event) => {
        console.log("[PeerTalks][WEBRTC] ontrack fired", {
          trackKind: event.track?.kind,
          trackEnabled: event.track?.enabled,
          trackReadyState: event.track?.readyState,
          streams: event.streams.length,
          hasStream: !!event.streams[0],
        });
        // Build ONE stable remote stream and merge every incoming track into
        // it. Browsers differ wildly here: some give a full stream on the
        // first event, some an empty streams array, some separate streams per
        // track, and renegotiation re-fires ontrack. Never replace a valid
        // stream with null, never drop a track.
        const incoming = event.streams && event.streams[0] ? event.streams[0] : null;
        if (incoming && !remoteStream) {
          remoteStream = incoming;
          setRemoteStream(remoteStream);
          console.log("[PeerTalks][MEDIA] remote stream established", {
            streamId: incoming.id,
            videoTracks: incoming.getVideoTracks().length,
            audioTracks: incoming.getAudioTracks().length,
          });
        } else if (incoming && remoteStream) {
          const track = event.track;
          const alreadyAdded = remoteStream
            .getTracks()
            .some((t) => t.id === (track?.id ?? ""));
          if (track && !alreadyAdded) {
            remoteStream.addTrack(track);
            setRemoteStream(remoteStream);
            console.log("[PeerTalks][MEDIA] merged remote track", {
              trackKind: track.kind,
              streamId: remoteStream.id,
            });
          }
        } else if (event.track && !remoteStream) {
          remoteStream = new MediaStream([event.track]);
          setRemoteStream(remoteStream);
          console.log("[PeerTalks][MEDIA] remote stream built from track", {
            trackKind: event.track.kind,
            streamId: remoteStream.id,
          });
        } else if (event.track && remoteStream) {
          const alreadyAdded = remoteStream
            .getTracks()
            .some((t) => t.id === event.track?.id);
          if (!alreadyAdded) {
            remoteStream.addTrack(event.track);
            setRemoteStream(remoteStream);
            console.log("[PeerTalks][MEDIA] merged remote track (no stream)", {
              trackKind: event.track.kind,
            });
          }
        }
      };

      pc.oniceconnectionstatechange = () => {
        // NO restartIce() here: enterReconnecting() (from
        // onconnectionstatechange) owns the single recovery path. Restarting
        // from BOTH places on every transient "disconnected" churns ICE
        // generations on mobile blips.
        console.log("[PeerTalks][ICE] iceConnectionState:", pc.iceConnectionState);
      };
      pc.onicegatheringstatechange = () => {
        console.log("[PeerTalks][ICE] iceGatheringState:", pc.iceGatheringState);
      };

      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        setConnectionState(st);
        console.log("[PeerTalks][WEBRTC] connectionState:", st);
        if (st === "connected") {
          setPeerLeft(false);
          setCallStateSafe("connected");
          reconnectAttemptsRef.current = 0;
          if (offerTimerRef.current) {
            clearInterval(offerTimerRef.current);
            offerTimerRef.current = null;
          }
          if (connectTimerRef.current) {
            clearTimeout(connectTimerRef.current);
            connectTimerRef.current = null;
          }
          if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
          }
        } else if (st === "connecting") {
          if (callStateRef.current === "signaling") {
            setCallStateSafe("connecting");
          }
        } else if (st === "disconnected" || st === "failed") {
          // Transient on mobile — go through the recovery grace period
          // before ever declaring the conversation ended.
          enterReconnecting();
        }
        // "connecting"/"new" keep the call alive; delayed media is handled
        // by the media-waiting indicator, never by ending the session.
      };

      const tracks = stream.getTracks();
      console.log("[PeerTalks][WEBRTC] local tracks:", tracks.map((t) => `${t.kind}:${t.readyState}`).join(", "));
      tracks.forEach((track) => pc.addTrack(track, stream));
      // Device removal (unplugged camera/mic, disabled device): the track
      // fires 'ended'. Recover ONCE per kind per call by re-acquiring media
      // and replaceTrack()-ing the sender — no renegotiation, the peer never
      // notices. A second failure keeps the call running with a notice.
      tracks.forEach((track) => {
        if (track.kind !== "audio" && track.kind !== "video") return;
        const kind = track.kind as "audio" | "video";
        track.onended = () => {
          if (sessionEndedRef.current || pcRef.current !== pc || pc.connectionState === "closed") return;
          if (kind === "video" && screenSharingRef.current) return;
          if (mediaRetryRef.current[kind]) return;
          mediaRetryRef.current[kind] = true;
          const label = kind === "audio" ? "microphone" : "camera";
          console.log("[PeerTalks][MEDIA] local track ended - re-acquiring", { kind });
          startLocalStream(
            kind === "audio"
              ? { video: false, audio: true }
              : { audio: false, video: { width: { ideal: 1280, max: 1280 }, height: { ideal: 720, max: 720 } } }
          )
            .then(async (newStream) => {
              if (!newStream || sessionEndedRef.current || pcRef.current !== pc) return;
              const newTrack = newStream.getTracks()[0];
              const sender = pc.getSenders().find((s) => s.track?.kind === kind);
              if (!sender || !newTrack) return;
              await sender.replaceTrack(newTrack);
              if (kind === "video") {
                cameraVideoTrackRef.current = newTrack;
              }
              const ls = localStreamRef.current;
              if (ls) {
                ls.getTracks()
                  .filter((t) => t.kind === kind)
                  .forEach((t) => {
                    t.stop();
                    ls.removeTrack(t);
                  });
                ls.addTrack(newTrack);
              }
              console.log("[PeerTalks][MEDIA] track recovered", { kind });
            })
            .catch((e) => {
              console.warn("[PeerTalks][MEDIA] track recovery failed", { kind, error: e });
              toast.error(`Couldn't recover your ${label} — check your devices`);
            });
        };
      });
      // Remember the camera video track so screen share can replaceTrack back
      // to it (the screen track swaps out, never adds a second video track).
      cameraVideoTrackRef.current = stream.getVideoTracks()[0] ?? null;

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
      isOffererRef.current = isOfferer;

      initiateSignaling(pc, isOfferer);
      setCallStateSafe("signaling");

      // If the peer never joins (e.g. the other user closed the tab), never
      // stay on "Establishing secure connection..." forever. This is the ONLY
      // timer that can end the conversation before a connection exists, and
      // it deliberately does NOT fire while reconnecting or once media has
      // arrived — delayed media is never treated as a departure.
      connectTimerRef.current = setTimeout(() => {
        const cur = pcRef.current;
        if (
          cur &&
          cur.connectionState !== "connected" &&
          callStateRef.current !== "reconnecting" &&
          !sessionEndedRef.current
        ) {
          console.log("[PeerTalks][TIMEOUT] connect timeout - peer never connected", {
            connectionState: cur.connectionState,
          });
          setPeerLeftReason("Your partner couldn't be reached. They may have left or lost connection.");
          setPeerLeft(true);
        }
      }, CONNECT_TIMEOUT_MS);
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
      joiningRef.current = false;
    }
  }, [callType, id, initiateSignaling, enterReconnecting, setCallStateSafe, resetCandidateState, toast]);

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
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
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

  // Screen share: replaceTrack() swaps the camera video track on the EXISTING
  // sender for a display track — no renegotiation, no glare, and the remote
  // merged stream keeps exactly one video track, so ontrack logic stays
  // unambiguous. The browser's own "Stop sharing" control fires 'ended' on
  // the screen track; that path cleans up identically.
  const stopScreenShare = useCallback(() => {
    const pc = pcRef.current;
    if (pc && cameraVideoTrackRef.current) {
      const sender = pc.getSenders().find((s) => s.track?.kind === "video");
      if (sender) {
        void sender.replaceTrack(cameraVideoTrackRef.current).catch((e) => {
          console.warn("[PeerTalks][MEDIA] restore camera failed", e);
          toast.error("Couldn't restore your camera — rejoin the call to continue");
        });
      }
    }
    screenStreamRef.current?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    screenStreamRef.current = null;
    setScreenSharing(false);
    screenSharingRef.current = false;
    if (signalingChannelRef.current) {
      signalingChannelRef.current.send({
        type: "broadcast",
        event: "screenshare",
        payload: { userId: userIdRef.current, active: false },
      }).catch(() => {});
    }
  }, [toast]);

  const toggleScreenShare = useCallback(async () => {
    if (screenSharing) {
      stopScreenShare();
      return;
    }
    const pc = pcRef.current;
    if (!pc) {
      toast.error("Join the call before sharing your screen");
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      toast.error("Screen sharing isn't supported in this browser");
      return;
    }
    const sender = pc.getSenders().find((s) => s.track?.kind === "video");
    if (!sender) {
      toast.error("Camera track isn't ready yet");
      return;
    }
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: false,
      });
      const screenTrack = displayStream.getVideoTracks()[0];
      if (!screenTrack) {
        displayStream.getTracks().forEach((t) => t.stop());
        toast.error("Couldn't capture a screen track");
        return;
      }
      await sender.replaceTrack(screenTrack).catch((e) => {
        console.error("[PeerTalks][MEDIA] screen share replaceTrack failed", e);
        displayStream.getTracks().forEach((t) => t.stop());
        toast.error("Couldn't switch your camera to the screen — try again");
        throw e;
      });
      screenStreamRef.current = displayStream;
      // The browser's "Stop sharing" control ends the track — clean up.
      screenTrack.onended = stopScreenShare;
      setScreenSharing(true);
      screenSharingRef.current = true;
      if (signalingChannelRef.current) {
        signalingChannelRef.current.send({
          type: "broadcast",
          event: "screenshare",
          payload: { userId: userIdRef.current, active: true },
        }).catch(() => {});
      }
    } catch {
      // User dismissed the picker — nothing to do.
    }
  }, [screenSharing, stopScreenShare, toast]);

  const endChat = useCallback(async (goTo: string = "/dashboard") => {
    console.log("[PeerTalks][SESSION] cleanup reason: user ended chat", { sessionId: id });
    sessionEndedRef.current = true;
    setCallStateSafe("ended");
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
    stopScreenShare();
    pcRef.current?.close();
    pcRef.current = null;
    setRemoteStream((prev) => {
      prev?.getTracks().forEach((t) => t.stop());
      return null;
    });
    purgeQueueRows();
    router.push(goTo);
  }, [router, cleanupChannels, purgeQueueRows, endSessionOnServer, setCallStateSafe, id, stopScreenShare]);

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
        // Leaving mid-call must never keep a screen capture alive — stop the
        // display stream even if the End chat button was never pressed.
        screenStreamRef.current?.getTracks().forEach((t) => {
          t.onended = null;
          t.stop();
        });
        screenStreamRef.current = null;
      }
    };
  }, [id, purgeQueueRows, endSessionOnServer, stopScreenShare]);

  // Tab close / full-page navigation: React unmount never runs while the
  // browser tears the page down, so the keepalive end-session request and the
  // peerleft broadcast go out here instead — otherwise the peer is stranded
  // on an open call and the session row stays "connected" until the API
  // sidecar notices. Guarded by sessionEndedRef so endChat/unmount win.
  useEffect(() => {
    const onPageHide = () => {
      if (sessionEndedRef.current || !id) return;
      sessionEndedRef.current = true;
      console.log("[PeerTalks][SESSION] page hidden - ending session", { sessionId: id });
      void endSessionOnServer();
      purgeQueueRows();
      if (signalingChannelRef.current) {
        signalingChannelRef.current.send({
          type: "broadcast",
          event: "peerleft",
          payload: { userId: userIdRef.current },
        }).catch(() => {});
      }
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [id, endSessionOnServer, purgeQueueRows]);

  // Call-quality indicator: poll getStats for the succeeded candidate pair's
  // RTT while connected. Sub-150ms = Excellent, sub-400ms = Good, anything
  // slower (or no succeeded pair yet) = Weak. Stops as soon as the call
  // leaves the connected state — no leaked timers. The pill render is gated
  // on callState === "connected", so no synchronous reset is needed here.
  useEffect(() => {
    if (callState !== "connected") return;
    let cancelled = false;
    const poll = async () => {
      const pc = pcRef.current;
      if (!pc || pc.connectionState !== "connected") return;
      try {
        const stats = await pc.getStats();
        let rtt: number | null = null;
        stats.forEach((s) => {
          if (
            s.type === "candidate-pair" &&
            s.state === "succeeded" &&
            typeof s.currentRoundTripTime === "number" &&
            s.currentRoundTripTime > 0
          ) {
            rtt = s.currentRoundTripTime * 1000;
          }
        });
        if (cancelled) return;
        setCallQuality(rtt === null ? "weak" : rtt < 150 ? "excellent" : rtt < 400 ? "good" : "weak");
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [callState]);

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
    // In-flight guard: two clicks/Enter presses in the same frame both read
    // the pre-clear input value and would insert TWO rows (duplicate bubbles
    // on both sides). The ref flips synchronously, before the first await.
    if (sendingRef.current) return;
    const file = pendingFile;
    if (!newMessage.trim() && !file) return;
    // Attachment messages carry the file name as their text content, so the
    // bubble stays meaningful even if the upload/ledger path degrades.
    const content = file ? `📎 ${file.name}` : newMessage.trim();
    sendingRef.current = true;
    setNewMessage("");
    let timer: ReturnType<typeof setTimeout> | null = null;

    try {
      const s = getSupabase();
      if (!s) return;
      const { data: { user } } = await s.auth.getUser();
      if (!user) return;
      // Sends go through the server API route: it re-validates the session
      // membership and content server-side and is covered by the middleware
      // rate limiter. Direct client inserts would bypass both.
      const insertPromise = fetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: id, content }),
      }).then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `send failed (${res.status})`);
        }
        return res.json();
      });
      // A hung insert (network stall) must never swallow the message: race
      // it against a timeout and fall back to the error path (text restored,
      // lock released) so nothing is lost silently.
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("insert timed out")), 10000);
      });
      const inserted = await Promise.race([
        insertPromise,
        timeout,
      ]);
      // Optimistic append: the sender's bubble must not depend on a realtime
      // event that may be delayed or broken. The realtime INSERT handler
      // dedupes by id, so this cannot double-render.
      if (inserted) {
        setMessages((prev) =>
          attachTo(
            prev.some((m) => m.id === inserted.id) ? prev : [...prev, inserted]
          )
        );
      }
      // Attachment upload (00012): message-first ordering — a failing upload
      // or ledger insert can never lose the message; the bubble just stays a
      // plain filename message. Skipped entirely when the migration isn't
      // applied (the schema probe owns that flag).
      if (inserted && file) {
        // Duplicate-prevention: skip upload if one is already in-flight for this message.
        if (inFlightUploadsRef.current.has(inserted.id)) {
          toast.error("Attachment upload already in progress — skipping duplicate.");
          setPendingFile(null);
        } else {
          inFlightUploadsRef.current.add(inserted.id);
          setPendingFile(null);
          if (attachmentsEnabledRef.current) {
            const safeName = file.name.replace(/[/\\]/g, "_");
            const storagePath = `${id}/${inserted.id}/${safeName}`;
            const up = await s.storage
              .from("chat-attachments")
              .upload(storagePath, file, { contentType: file.type || undefined });
            // Remove from in-flight tracker on upload completion (success or error).
            const cleanup = async () => {
              inFlightUploadsRef.current.delete(inserted.id);
            };
            if (up.error) {
              console.error("[PeerTalks][ATTACH] upload failed", {
                sessionId: id, messageId: inserted.id, message: up.error.message,
              });
              toast.error("Attachment couldn't be uploaded — message sent without it");
              await cleanup();
            } else {
              const { data: ledger, error: ledErr } = await s
                .from("message_attachments")
                .insert({
                  message_id: inserted.id,
                  session_id: id,
                  uploader_id: user.id,
                  file_name: file.name,
                  file_size: file.size,
                  mime_type: file.type || null,
                  storage_path: storagePath,
                })
                .select()
                .single();
              if (ledErr || !ledger) {
                console.error("[PeerTalks][ATTACH] ledger insert failed", {
                  sessionId: id,
                  messageId: inserted.id,
                  message: ledErr?.message ?? "no row returned",
                });
                toast.error("Attachment couldn't be saved — message sent without it");
                // Avoid orphaned objects in the bucket.
                s.storage.from("chat-attachments").remove([storagePath]).catch(() => {});
                await cleanup();
              } else {
                attachmentsRef.current.set(inserted.id, ledger);
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === inserted.id ? { ...m, attachment: ledger } : m
                  )
                );
                await cleanup();
              }
            }
          }
        }
      }
    } catch (e) {
      console.error("[PeerTalks][MESSAGES] insert failed", {
        sessionId: id,
        message: e instanceof Error ? e.message : String(e),
      });
      toast.error("Message didn't send — tap send to retry");
    } finally {
      if (timer) clearTimeout(timer);
sendingRef.current = false;
    }
  };

  // Soft-delete (00013): tombstones the sender's own message; the UPDATE
  // propagates to the peer's open chat via the realtime channel, and the
  // bubble renders "Message deleted". If the schema lacks deleted_at the
  // write fails and the toast explains — the chat itself never breaks.
  const deleteMessage = useCallback(async (messageId: number) => {
    const s = getSupabase();
    if (!s) return;
    const nowIso = new Date().toISOString();
    const { error } = await s
      .from("messages")
      .update({ deleted_at: nowIso, deleted_by: userIdRef.current })
      .eq("id", messageId);
    if (error) {
      console.error("[PeerTalks][MESSAGES] soft-delete failed", {
        sessionId: id, messageId, message: error.message,
      });
      toast.error("Couldn't delete message");
      return;
    }
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId
          ? { ...m, deleted_at: nowIso, deleted_by: userIdRef.current }
          : m
      )
    );
    // Attachment objects (00012) are not removed by the soft-delete tombstone
    // — clean up the storage object best-effort so a deleted message doesn't
    // keep its file around forever.
    const att = attachmentsRef.current.get(messageId);
    if (att) {
      s.storage.from("chat-attachments").remove([att.storage_path]).catch(() => {});
    }
  }, [toast, id]);

  // Attachment download (00012): private bucket, so open a short-lived
  // signed URL in a new tab. Only reachable when the ledger exists.
  const downloadAttachment = useCallback(async (msg: Message) => {
    const s = getSupabase();
    if (!s || !msg.attachment) return;
    const { data, error } = await s.storage
      .from("chat-attachments")
      .createSignedUrl(msg.attachment.storage_path, 60);
    if (error || !data?.signedUrl) {
      console.error("[PeerTalks][ATTACH] signed URL failed", {
        sessionId: msg.session_id,
        messageId: msg.id,
        message: error?.message ?? "no URL",
      });
      toast.error("Couldn't open the attachment");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  }, [toast]);

  // Unread badge (00013): incoming messages newer than my last-read marker.
  const unreadCount = useMemo(() => {
    if (!readsEnabled || !myUserId) return 0;
    const threshold = lastReadId ?? 0;
    return messages.filter(
      (m) => m.sender_id !== myUserId && m.id > threshold && !m.deleted_at
    ).length;
  }, [messages, readsEnabled, myUserId, lastReadId]);

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
    triggerOverlay();
    if (signalingChannelRef.current) {
      signalingChannelRef.current.send({
        type: "broadcast",
        event: "reaction",
        payload: { type, senderId: userIdRef.current },
      }).catch(() => {});
    }
  };

  const toggleMessageReaction = useCallback(async (messageId: number, emoji: string) => {
    const supabase = getSupabase();
    if (!supabase) return;

    const current = messageReactionsRef.current[messageId]?.[emoji];
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
  }, [toast]);

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
        <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-hide overscroll-contain" onScroll={handleListScroll}>
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
              onReact={toggleMessageReaction}
              seen={msg.sender_id === myUserId && seenByPeer.has(msg.id)}
              onDelete={msg.sender_id === myUserId ? deleteMessage : undefined}
              onDownload={downloadAttachment}
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
          {pendingFile && (
            <div className="mb-2 flex items-center gap-2 px-3 py-2 rounded-xl glass-strong text-xs text-white/60">
              <span className="truncate max-w-[240px]">📎 {pendingFile.name}</span>
              <button
                onClick={() => setPendingFile(null)}
                className="ml-auto text-white/30 hover:text-white/70"
                aria-label="Remove attachment"
              >
                <Icons.Close size={12} />
              </button>
            </div>
          )}
          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                if (f) {
                  if (f.size > MAX_ATTACHMENT_BYTES) {
                    toast.error("File too large — max 10 MB");
                  } else {
                    setPendingFile(f);
                  }
                }
                e.target.value = "";
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-11 h-11 rounded-xl glass-strong flex items-center justify-center hover:bg-white/[0.08] transition-all duration-200 shrink-0"
              aria-label="Attach file"
              title="Attach file (max 10 MB)"
            >
              <Icons.Paperclip size={15} />
            </button>
            <button
              onClick={() => setEmojiPickerOpen((v) => !v)}
              className="w-11 h-11 rounded-xl glass-strong flex items-center justify-center hover:bg-white/[0.08] transition-all duration-200 shrink-0"
              aria-label="Emoji picker"
            >
              <span className="text-lg leading-none">😊</span>
            </button>
            <textarea
              ref={inputRef}
              placeholder="Type a message..."
              value={newMessage}
              rows={Math.min(4, Math.max(1, newMessage.split("\n").length))}
              onChange={(e) => {
                setNewMessage(e.target.value);
                notifyTyping();
              }}
              onKeyDown={(e) => {
                // Enter sends; Shift+Enter inserts a newline.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendMessage();
                }
              }}
              className="flex-1 min-h-11 max-h-28 py-3 px-4 rounded-xl glass-input text-sm text-white/80 placeholder:text-white/20 transition-all duration-200 focus:outline-none resize-none"
            />
            <button
              onClick={sendMessage}
              disabled={!newMessage.trim() && !pendingFile}
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
      <>
        {capacityBanner && <div className="fixed top-0 left-0 right-0 z-[60]">{capacityBanner}</div>}
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
      </>
    );
  }

  return (
    <div ref={containerRef} className="flex flex-col h-screen bg-background">
      <h1 className="sr-only">Video chat</h1>
      {capacityBanner}
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 relative">
          <VideoCard
            stream={remoteStream}
            connectionState={connectionState}
            isLoading={connectionState === "connecting" || callState === "signaling"}
            statusText={
              callState === "reconnecting"
                ? "Reconnecting…"
                : connectionState === "connected" && !remoteStream
                ? "Waiting for their video…"
                : undefined
            }
          />
          <ReactionOverlay reactions={overlayReactions} />
          {callState === "reconnecting" && (
            <div role="status" aria-live="polite" className="absolute top-4 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
              <span className="text-[11px] uppercase tracking-wider font-medium px-3 py-1.5 rounded-full bg-warning-soft text-warning border border-warning/20">
                Reconnecting…
              </span>
            </div>
          )}
          {callState === "connected" && callQuality && (
            <div
              role="status"
              aria-label={`Call quality: ${callQuality}`}
              className="absolute bottom-4 left-4 z-30 pointer-events-none"
            >
              <span
                className={
                  "text-[10px] uppercase tracking-wider font-medium px-2.5 py-1 rounded-full border flex items-center gap-1.5 " +
                  (callQuality === "excellent"
                    ? "bg-success-soft text-success border-success/20"
                    : callQuality === "good"
                    ? "bg-white/10 text-white/70 border-white/10"
                    : "bg-warning-soft text-warning border-warning/20")
                }
              >
                <span
                  className={
                    "w-1.5 h-1.5 rounded-full " +
                    (callQuality === "excellent" ? "bg-success" : callQuality === "good" ? "bg-white/50" : "bg-warning")
                  }
                />
                {callQuality === "excellent" ? "Excellent" : callQuality === "good" ? "Good" : "Weak"}
              </span>
            </div>
          )}
          {(screenSharing || peerScreenSharing) && (
            <div role="status" aria-live="polite" className="absolute top-4 left-4 z-30 pointer-events-none">
              <span className="text-[11px] uppercase tracking-wider font-medium px-3 py-1.5 rounded-full bg-white/10 text-white/70 border border-white/10">
                {screenSharing ? "Sharing your screen" : "Screen sharing active"}
              </span>
            </div>
          )}
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
              {unreadCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-error text-[10px] font-semibold text-white flex items-center justify-center">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
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
            <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-hide overscroll-contain" onScroll={handleListScroll}>
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
                  onReact={toggleMessageReaction}
                  seen={msg.sender_id === myUserId && seenByPeer.has(msg.id)}
                  onDelete={msg.sender_id === myUserId ? deleteMessage : undefined}
                  onDownload={downloadAttachment}
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
              {pendingFile && (
                <div className="mb-2 flex items-center gap-2 px-3 py-2 rounded-xl glass-strong text-xs text-white/60">
                  <span className="truncate max-w-[240px]">📎 {pendingFile.name}</span>
                  <button
                    onClick={() => setPendingFile(null)}
                    className="ml-auto text-white/30 hover:text-white/70"
                    aria-label="Remove attachment"
                  >
                    <Icons.Close size={12} />
                  </button>
                </div>
              )}
              <div className="flex gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    if (f) {
                      if (f.size > MAX_ATTACHMENT_BYTES) {
                        toast.error("File too large — max 10 MB");
                      } else {
                        setPendingFile(f);
                      }
                    }
                    e.target.value = "";
                  }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-11 h-11 rounded-xl glass-strong flex items-center justify-center hover:bg-white/[0.08] transition-all duration-200 shrink-0"
                  aria-label="Attach file"
                  title="Attach file (max 10 MB)"
                >
                  <Icons.Paperclip size={15} />
                </button>
                <button
                  onClick={() => setEmojiPickerOpen((v) => !v)}
                  className="w-11 h-11 rounded-xl glass-strong flex items-center justify-center hover:bg-white/[0.08] transition-all duration-200 shrink-0"
                  aria-label="Emoji picker"
                >
                  <span className="text-lg leading-none">😊</span>
                </button>
                <textarea
                  ref={inputRef}
                  placeholder="Type a message..."
                  value={newMessage}
                  rows={Math.min(4, Math.max(1, newMessage.split("\n").length))}
                  onChange={(e) => {
                    setNewMessage(e.target.value);
                    notifyTyping();
                  }}
                  onKeyDown={(e) => {
                    // Enter sends; Shift+Enter inserts a newline.
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void sendMessage();
                    }
                  }}
                  className="flex-1 min-h-11 max-h-28 py-3 px-4 rounded-xl glass-input text-sm text-white/80 placeholder:text-white/20 transition-all duration-200 focus:outline-none resize-none"
                />
                <button
                  onClick={sendMessage}
                  disabled={!newMessage.trim() && !pendingFile}
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
        onToggleScreenShare={toggleScreenShare}
        screenSharing={screenSharing}
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

const MessageBubble = memo(function MessageBubble({ msg, mine, reactions, onReact, seen, onDelete, onDownload }: {
  msg: Message;
  mine: boolean;
  reactions?: Record<string, { count: number; mine: boolean }>;
  onReact: (messageId: number, emoji: string) => void;
  seen?: boolean;
  onDelete?: (messageId: number) => void;
  onDownload?: (msg: Message) => void;
}) {
  if (msg.deleted_at) {
    return (
      <div className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
        <div className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-xs italic text-white/25 ${mine ? "bg-white/[0.08]" : "bg-white/[0.05]"}`}>
          Message deleted
        </div>
        <div className="flex items-center gap-1.5 mt-1">
          <span className="text-[10px] text-white/20">
            {new Date(msg.created_at).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className={`group flex flex-col ${mine ? "items-end" : "items-start"}`}>
      <div className={`relative max-w-[85%]`}>
        <div className={`px-4 py-2.5 rounded-2xl text-sm text-white/80 whitespace-pre-wrap break-words ${mine ? "bg-white/20" : "bg-white/10"}`}>
          {msg.content}
        </div>
        {msg.attachment && !msg.deleted_at && (
          <button
            onClick={() => onDownload?.(msg)}
            className="mt-2 flex items-center gap-2 rounded-xl px-3 py-2 text-xs border border-white/10 bg-white/[0.06] hover:bg-white/10 transition-all duration-150"
            aria-label={`Download ${msg.attachment.file_name}`}
            title={`Download ${msg.attachment.file_name}`}
          >
            <Icons.Download size={13} />
            <span className="max-w-[180px] truncate">{msg.attachment.file_name}</span>
            <span className="text-white/35 shrink-0">{formatBytes(msg.attachment.file_size)}</span>
          </button>
        )}
        {mine && onDelete && (
          <button
            onClick={() => onDelete(msg.id)}
            className="absolute -left-8 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg text-white/25 hover:text-error hover:bg-error/[0.1] opacity-0 group-hover:opacity-100 focus:opacity-100 flex items-center justify-center transition-all duration-150"
            aria-label="Delete message"
            title="Delete message"
          >
            <Icons.Trash size={13} />
          </button>
        )}
      </div>
      <div className="flex items-center gap-1.5 mt-1">
        <span className="text-[10px] text-white/20">
          {new Date(msg.created_at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        {mine && seen && <span className="text-[10px] text-emerald-400/80 font-medium">Seen</span>}
        <div className="flex items-center gap-0.5">
          {reactions &&
            Object.entries(reactions).map(([emoji, data]) => (
              <button
                key={emoji}
                onClick={() => onReact(msg.id, emoji)}
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
});

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
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