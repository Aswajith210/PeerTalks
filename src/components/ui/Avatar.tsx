"use client";

import Image from "next/image";

interface AvatarProps {
  src?: string | null;
  alt?: string;
  size?: number;
  className?: string;
}

export function Avatar({ src, alt = "", size = 40, className = "" }: AvatarProps) {
  return (
    <div
      className={`rounded-full bg-white/[0.04] flex items-center justify-center overflow-hidden border border-white/[0.08] flex-shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      {src ? (
        <Image src={src} alt={alt} width={size} height={size} className="w-full h-full object-cover" />
      ) : (
        <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none" className="text-white/25">
          <path
            d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"
            fill="currentColor"
          />
        </svg>
      )}
    </div>
  );
}
