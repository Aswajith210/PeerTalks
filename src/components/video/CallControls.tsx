"use client";

import { useEffect, useRef, useState } from "react";

interface CallControlsProps {
  audioEnabled: boolean;
  videoEnabled: boolean;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onEndCall: () => void;
  onToggleChat: () => void;
  onReaction: (type: string) => void;
  showChat: boolean;
}

function ControlButton({
  onClick,
  active,
  label,
  icon,
  danger,
}: {
  onClick: () => void;
  active?: boolean;
  label: string;
  icon: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-11 h-11 sm:w-12 sm:h-12 rounded-2xl flex items-center justify-center transition-all duration-200 btn-premium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/15 ${
        danger
          ? "bg-error-soft text-error hover:bg-error/[0.2] active:bg-error/[0.15]"
          : active === false
          ? "bg-error-soft/70 text-error/70 hover:bg-error/[0.15]"
          : active === true
          ? "bg-white/[0.06] text-white/70 border border-white/[0.08] hover:bg-white/[0.08] hover:text-white"
          : "bg-white/[0.04] text-white/50 border border-white/[0.06] hover:bg-white/[0.06] hover:text-white/70"
      }`}
      aria-label={label}
    >
      {icon}
    </button>
  );
}

const REACTIONS = ["heart", "thumbsup", "clap", "fire", "laugh"] as const;

export function CallControls({
  audioEnabled,
  videoEnabled,
  onToggleAudio,
  onToggleVideo,
  onEndCall,
  onToggleChat,
  onReaction,
  showChat,
}: CallControlsProps) {
  const [visible, setVisible] = useState(true);
  const [showMore, setShowMore] = useState(false);
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const inactivityRef = useRef(0);

  useEffect(() => {
    const resetTimer = () => {
      inactivityRef.current = Date.now();
      setVisible(true);
      if (hideTimeout.current) clearTimeout(hideTimeout.current);
      hideTimeout.current = setTimeout(() => {
        setVisible(false);
        setShowMore(false);
      }, 4000);
    };

    const onMove = () => resetTimer();
    const onTouch = () => resetTimer();

    resetTimer();
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchstart", onTouch);

    return () => {
      if (hideTimeout.current) clearTimeout(hideTimeout.current);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchstart", onTouch);
    };
  }, []);

  return (
    <div
      ref={dockRef}
      className={`fixed bottom-0 left-0 right-0 flex items-center justify-center pb-6 sm:pb-8 pointer-events-none z-40 transition-all duration-500 ${
        visible ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"
      }`}
    >
      <div className="glass-strong rounded-2xl px-3 sm:px-4 py-3 flex items-center gap-2 sm:gap-3 pointer-events-auto shadow-glass-lg border-white/[0.06]">
        <ControlButton
          active={audioEnabled}
          onClick={onToggleAudio}
          label={audioEnabled ? "Mute microphone (M)" : "Unmute microphone (M)"}
          icon={
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              {audioEnabled ? (
                <>
                  <rect x="9" y="2" width="6" height="11" rx="3" />
                  <path d="M5 10a7 7 0 0014 0" />
                  <path d="M12 18v3" />
                  <path d="M9 21h6" />
                </>
              ) : (
                <>
                  <rect x="9" y="2" width="6" height="11" rx="3" />
                  <path d="M5 10a7 7 0 0014 0" />
                  <path d="M12 18v3" />
                  <path d="M3 3l18 18" opacity={0.5} />
                </>
              )}
            </svg>
          }
        />

        <ControlButton
          active={videoEnabled}
          onClick={onToggleVideo}
          label={videoEnabled ? "Turn off camera (C)" : "Turn on camera (C)"}
          icon={
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              {videoEnabled ? (
                <>
                  <rect x="2" y="4" width="16" height="16" rx="3" />
                  <path d="M18 10l4-2.5v9L18 14" />
                </>
              ) : (
                <>
                  <rect x="2" y="4" width="16" height="16" rx="3" />
                  <path d="M18 10l4-2.5v9L18 14" />
                  <path d="M3 3l18 18" opacity={0.5} />
                </>
              )}
            </svg>
          }
        />

        <div className="w-px h-8 bg-white/[0.06]" />

        <ControlButton
          active={showChat}
          onClick={onToggleChat}
          label="Toggle chat"
          icon={
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z" />
              <path d="M8 9h8" />
              <path d="M8 13h6" />
            </svg>
          }
        />

        {/* Reactions */}
        <div className="relative">
          <ControlButton
            active={false}
            onClick={() => setShowMore(!showMore)}
            label="Reactions"
            icon={
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <circle cx="12" cy="12" r="10" />
                <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                <circle cx="9" cy="9" r="1" />
                <circle cx="15" cy="9" r="1" />
              </svg>
            }
          />
          {showMore && (
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 glass-strong rounded-2xl px-3 py-2.5 flex gap-2 shadow-glass-lg border-white/[0.06]">
              {REACTIONS.map((type) => (
                <button
                  key={type}
                  onClick={() => { onReaction(type); setShowMore(false); }}
                  className="w-9 h-9 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] active:bg-white/[0.06] flex items-center justify-center transition-all duration-200 btn-premium"
                  aria-label={type}
                >
                  <svg className="w-4 h-4 text-white/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    {type === "heart" && <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />}
                    {type === "thumbsup" && <path d="M7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3m7-2V5a2 2 0 00-2-2 2 2 0 00-2 2v3m0 0v4m0-4h3l4 3.5a2.5 2.5 0 002 1.5h4a2 2 0 002-2v-.5a4 4 0 00-.5-2L19 11a2 2 0 00-1.75-1H14" />}
                    {type === "clap" && <path d="M7 11.5l1.5-1.5M10.5 9l1.5-1.5M14 7.5L15.5 6M17 6.5L18.5 5M6.5 13L5 14.5a4 4 0 005.66 5.66l5-5A4 4 0 0010 9.66L7 12.66" />}
                    {type === "fire" && <path d="M12 22c4 0 7-3 7-8 0-6-7-12-7-12s-7 6-7 12c0 5 3 8 7 8z" />}
                    {type === "laugh" && <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" />}
                  </svg>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="w-px h-8 bg-white/[0.06]" />

        <ControlButton
          danger
          onClick={onEndCall}
          label="End call"
          icon={
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
            </svg>
          }
        />
      </div>
    </div>
  );
}
