"use client";

interface GlassIconProps {
  children: React.ReactNode;
  size?: number;
  className?: string;
  active?: boolean;
}

export function GlassIcon({ children, size = 20, className = "", active }: GlassIconProps) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-xl relative overflow-hidden ${className}`}
      style={{
        width: size + 8,
        height: size + 8,
        background: active
          ? "linear-gradient(135deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.04) 100%)"
          : "linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)",
        backdropFilter: "blur(8px) saturate(1.4)",
        WebkitBackdropFilter: "blur(8px) saturate(1.4)",
        border: "1px solid rgba(255,255,255,0.06)",
        boxShadow: active
          ? "0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.1)"
          : "0 1px 4px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.05)",
      }}
    >
      <span
        className="absolute inset-0 rounded-xl pointer-events-none"
        style={{
          background: "linear-gradient(180deg, rgba(255,255,255,0.04) 0%, transparent 50%)",
        }}
      />
      <span className="relative z-10" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ color: active ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.5)" }}
        >
          {children}
        </svg>
      </span>
    </span>
  );
}

export function GlassIconRaw({ size = 20, className = "", style }: { size?: number; className?: string; style?: React.CSSProperties }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-xl relative overflow-hidden ${className}`}
      style={{
        width: size + 8,
        height: size + 8,
        background: "linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)",
        backdropFilter: "blur(8px) saturate(1.4)",
        WebkitBackdropFilter: "blur(8px) saturate(1.4)",
        border: "1px solid rgba(255,255,255,0.06)",
        boxShadow: "0 1px 4px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.05)",
        ...style,
      }}
    >
      <span
        className="absolute inset-0 rounded-xl pointer-events-none"
        style={{
          background: "linear-gradient(180deg, rgba(255,255,255,0.04) 0%, transparent 50%)",
        }}
      />
    </span>
  );
}
