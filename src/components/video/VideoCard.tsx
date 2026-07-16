"use client";

interface VideoCardProps {
  stream: MediaStream | null;
  muted?: boolean;
  mirrored?: boolean;
  label?: string;
  isLoading?: boolean;
  connectionState?: string;
}

export function VideoCard({
  stream,
  muted = false,
  mirrored = false,
  label,
  isLoading,
  connectionState,
}: VideoCardProps) {
  const handleRef = (el: HTMLVideoElement | null) => {
    if (el && stream) {
      el.srcObject = stream;
    }
  };

  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden rounded-3xl bg-black/40 border border-white/[0.04] shadow-premium-lg">
      {stream ? (
        <video
          ref={handleRef}
          autoPlay
          playsInline
          muted={muted}
          className={`w-full h-full object-cover transition-opacity duration-500 ${
            mirrored ? "-scale-x-100" : ""
          }`}
        />
      ) : (
        <div className="text-center px-6">
          <div className="flex justify-center mb-5">
            <div className="w-16 h-16 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
              <svg className="w-7 h-7 text-white/25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                <circle cx="9" cy="7" r="4" />
              </svg>
            </div>
          </div>
          <p className="text-white/25 text-sm font-light">
            {isLoading ? "Establishing secure connection..." : "Waiting for peer..."}
          </p>
          {isLoading && (
            <div className="mt-5 flex justify-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-white/15 animate-bounce" style={{ animationDelay: "0ms", animationDuration: "1.2s" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-white/15 animate-bounce" style={{ animationDelay: "200ms", animationDuration: "1.2s" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-white/15 animate-bounce" style={{ animationDelay: "400ms", animationDuration: "1.2s" }} />
            </div>
          )}
        </div>
      )}

      {connectionState && stream && (
        <div className="absolute top-4 left-4">
          <span className={`text-[10px] uppercase tracking-wider font-medium px-2.5 py-1 rounded-full border ${
            connectionState === "connected"
              ? "bg-success-soft text-success border-success/20"
              : connectionState === "connecting"
              ? "bg-warning-soft text-warning border-warning/20"
              : connectionState === "failed"
              ? "bg-error-soft text-error border-error/20"
              : "bg-white/[0.04] text-white/30 border-white/[0.06]"
          }`}>
            {connectionState}
          </span>
        </div>
      )}

      {label && (
        <div className="absolute bottom-4 left-4">
          <span className="text-xs text-white/50 font-light px-3 py-1.5 rounded-xl bg-black/30 backdrop-blur-md border border-white/[0.04]">
            {label}
          </span>
        </div>
      )}

      <div className="absolute inset-0 rounded-3xl pointer-events-none" style={{
        background: "linear-gradient(180deg, rgba(255,255,255,0.02) 0%, transparent 40%, transparent 60%, rgba(0,0,0,0.1) 100%)",
      }} />
    </div>
  );
}
