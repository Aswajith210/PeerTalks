"use client";

import { useRef, useEffect, useState, useCallback } from "react";

interface FloatingPreviewProps {
  stream: MediaStream | null;
  audioEnabled: boolean;
  videoEnabled: boolean;
}

export function FloatingPreview({ stream, audioEnabled, videoEnabled }: FloatingPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 16, y: 80 });
  const [dragging, setDragging] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const [visible, setVisible] = useState(true);
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  useEffect(() => {
    const resetTimer = () => {
      setVisible(true);
      if (hideTimeout.current) clearTimeout(hideTimeout.current);
      hideTimeout.current = setTimeout(() => setVisible(false), 5000);
    };

    resetTimer();
    window.addEventListener("mousemove", resetTimer);

    return () => {
      if (hideTimeout.current) clearTimeout(hideTimeout.current);
      window.removeEventListener("mousemove", resetTimer);
    };
  }, []);

  const handleDragStart = useCallback((clientX: number, clientY: number) => {
    setDragging(true);
    dragOffset.current = {
      x: clientX - position.x,
      y: clientY - position.y,
    };
  }, [position]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    handleDragStart(e.clientX, e.clientY);
  }, [handleDragStart]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    handleDragStart(e.touches[0].clientX, e.touches[0].clientY);
  }, [handleDragStart]);

  useEffect(() => {
    if (!dragging) return;

    const handleMove = (clientX: number, clientY: number) => {
      setPosition({
        x: Math.max(16, Math.min(clientX - dragOffset.current.x, window.innerWidth - 200)),
        y: Math.max(80, Math.min(clientY - dragOffset.current.y, window.innerHeight - 180)),
      });
    };

    const handleMouseMove = (e: MouseEvent) => handleMove(e.clientX, e.clientY);
    const handleTouchMove = (e: TouchEvent) => handleMove(e.touches[0].clientX, e.touches[0].clientY);

    const handleEnd = () => {
      setDragging(false);
      setPosition(prev => ({
        x: prev.x < window.innerWidth / 2 ? 16 : window.innerWidth - 196,
        y: prev.y,
      }));
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleEnd);
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", handleEnd);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleEnd);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleEnd);
    };
  }, [dragging]);

  if (!stream) return null;

  return (
    <div
      ref={containerRef}
      className={`fixed z-30 transition-all duration-300 ${
        visible ? "opacity-100" : "opacity-0 pointer-events-none"
      } ${dragging ? "scale-105" : ""}`}
      style={{
        left: position.x,
        top: position.y,
        width: expanded ? 280 : 160,
        cursor: dragging ? "grabbing" : "grab",
      }}
    >
      <div
        className={`relative rounded-2xl overflow-hidden ${
          expanded ? "shadow-premium-lg" : "shadow-glass"
        } border border-white/[0.06] bg-black/40`}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover -scale-x-100"
          style={{ aspectRatio: expanded ? "16/9" : "3/4" }}
        />

        {!videoEnabled && (
          <div className="absolute inset-0 bg-black/70 flex items-center justify-center backdrop-blur-sm">
            <svg className="w-5 h-5 text-white/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <rect x="2" y="4" width="16" height="16" rx="3" />
              <path d="M18 10l4-2.5v9L18 14" />
              <path d="M3 3l18 18" opacity={0.5} />
            </svg>
          </div>
        )}

        {/* Drag handle */}
        <div
          className="absolute inset-0 z-10 touch-none"
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          onDoubleClick={() => setExpanded(!expanded)}
        />

        {/* Audio indicator */}
        <div className="absolute top-2 right-2">
            <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${
            audioEnabled ? "bg-white/[0.06]" : "bg-error-soft/70"
          }`}>
            <svg className={`w-3 h-3 ${audioEnabled ? "text-white/50" : "text-error/70"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              {audioEnabled ? (
                <><rect x="9" y="2" width="6" height="11" rx="3" /><path d="M5 10a7 7 0 0014 0" /><path d="M12 18v3" /></>
              ) : (
                <><rect x="9" y="2" width="6" height="11" rx="3" /><path d="M5 10a7 7 0 0014 0" /><path d="M12 18v3" /><path d="M3 3l18 18" opacity={0.5} /></>
              )}
            </svg>
          </div>
        </div>

        {/* Gloss overlay */}
        <div className="absolute inset-0 rounded-2xl pointer-events-none" style={{
          background: "linear-gradient(180deg, rgba(255,255,255,0.04) 0%, transparent 50%)",
        }} />
      </div>
    </div>
  );
}
