"use client";

import { useRef, useEffect } from "react";
import { Button } from "@/components/ui/Button";

interface JoinScreenProps {
  stream: MediaStream | null;
  roomId: string;
  audioEnabled: boolean;
  videoEnabled: boolean;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onJoin: () => void;
  isJoining: boolean;
}

function MediaToggle({ enabled, onToggle, label, icon }: {
  enabled: boolean;
  onToggle: () => void;
  label: string;
  icon: { on: React.ReactNode; off: React.ReactNode };
}) {
  return (
    <button
      onClick={onToggle}
      className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-200 btn-premium ${
        enabled
          ? "bg-white/[0.06] border border-white/[0.1] text-white/70 hover:bg-white/[0.08]"
          : "bg-error-soft border border-error/20 text-error/70 hover:bg-error/[0.15]"
      }`}
      aria-label={label}
    >
      {enabled ? icon.on : icon.off}
    </button>
  );
}

export function JoinScreen({
  stream,
  roomId,
  audioEnabled,
  videoEnabled,
  onToggleAudio,
  onToggleVideo,
  onJoin,
  isJoining,
}: JoinScreenProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      <div className="w-full max-w-sm mx-4">
        <div className="glass-card rounded-3xl overflow-hidden">
          {/* Camera preview */}
          <div className="aspect-[4/3] relative bg-black/60">
            {stream ? (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover -scale-x-100"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <svg className="w-8 h-8 text-white/20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                  <rect x="2" y="4" width="16" height="16" rx="3" />
                  <path d="M18 10l4-2.5v9L18 14" />
                </svg>
              </div>
            )}

            {!videoEnabled && stream && (
              <div className="absolute inset-0 bg-black/80 flex items-center justify-center backdrop-blur-sm">
                <svg className="w-8 h-8 text-white/20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                  <rect x="2" y="4" width="16" height="16" rx="3" />
                  <path d="M18 10l4-2.5v9L18 14" />
                  <path d="M3 3l18 18" opacity={0.5} />
                </svg>
              </div>
            )}
          </div>

          <div className="p-6 space-y-5">
            <div className="text-center">
              <h2 className="text-lg font-semibold text-white/90 mb-1">Ready to join?</h2>
              <p className="text-xs text-muted">
                Room: <span className="font-mono text-white/50">{roomId.slice(0, 8)}...</span>
              </p>
            </div>

            {/* Media controls */}
            <div className="flex justify-center gap-3">
              <MediaToggle
                enabled={audioEnabled}
                onToggle={onToggleAudio}
                label="Toggle microphone"
                icon={{
                  on: (
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <rect x="9" y="2" width="6" height="11" rx="3" />
                      <path d="M5 10a7 7 0 0014 0" />
                      <path d="M12 18v3" />
                    </svg>
                  ),
                  off: (
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <rect x="9" y="2" width="6" height="11" rx="3" />
                      <path d="M5 10a7 7 0 0014 0" />
                      <path d="M12 18v3" />
                      <path d="M3 3l18 18" opacity={0.5} />
                    </svg>
                  ),
                }}
              />
              <MediaToggle
                enabled={videoEnabled}
                onToggle={onToggleVideo}
                label="Toggle camera"
                icon={{
                  on: (
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <rect x="2" y="4" width="16" height="16" rx="3" />
                      <path d="M18 10l4-2.5v9L18 14" />
                    </svg>
                  ),
                  off: (
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <rect x="2" y="4" width="16" height="16" rx="3" />
                      <path d="M18 10l4-2.5v9L18 14" />
                      <path d="M3 3l18 18" opacity={0.5} />
                    </svg>
                  ),
                }}
              />
            </div>

            <Button
              size="lg"
              className="w-full"
              loading={isJoining}
              onClick={onJoin}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
              </svg>
              Join call
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
