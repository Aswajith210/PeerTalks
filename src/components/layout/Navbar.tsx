"use client";

import { useAuth } from "@/hooks/useAuth";
import { LoginButton } from "@/components/auth/LoginButton";
import { UserMenu } from "@/components/auth/UserMenu";
import { TokenBalance } from "@/components/tokens/TokenBalance";
import Link from "next/link";
import { useEffect, useState, useRef } from "react";
import { usePathname } from "next/navigation";

export function Navbar() {
  const { user, loading } = useAuth();
  const [visible, setVisible] = useState(true);
  const [scrolled, setScrolled] = useState(false);
  const lastScrollY = useRef(0);
  const ticking = useRef(false);
  const pathname = usePathname();

  const isVideoCall = pathname.startsWith("/chat/room/") && pathname !== "/chat/room/new";

  useEffect(() => {
    if (isVideoCall) return;

    const onScroll = () => {
      if (!ticking.current) {
        window.requestAnimationFrame(() => {
          const currentY = window.scrollY;
          setScrolled(currentY > 50);

          if (currentY > 100) {
            if (currentY > lastScrollY.current) {
              setVisible(false);
            } else {
              setVisible(true);
            }
          } else {
            setVisible(true);
          }

          lastScrollY.current = currentY;
          ticking.current = false;
        });
        ticking.current = true;
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [isVideoCall]);

  const navClass = isVideoCall
    ? "fixed top-0 left-0 right-0 z-50 transition-all duration-500 bg-transparent"
    : `fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
        visible ? "translate-y-0" : "-translate-y-full"
      } ${
        scrolled
          ? "bg-[#0f0f11]/80 backdrop-blur-2xl border-b border-white/[0.04] shadow-premium"
          : "bg-transparent"
      }`;

  return (
    <header className={navClass}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 sm:h-18">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-9 h-9 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center group-hover:bg-white/[0.06] transition-all duration-300">
              <svg className="w-[18px] h-[18px] text-white/60 group-hover:text-white/80 transition-colors duration-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <span className="text-base font-semibold text-white/80 group-hover:text-white/90 transition-colors duration-300">PeerTalks</span>
          </Link>

          <div className="flex items-center gap-2 sm:gap-3">
            {loading ? (
              <div className="w-22 h-9 rounded-xl bg-white/[0.03] animate-pulse" />
            ) : user ? (
              <>
                <TokenBalance />
                <UserMenu />
              </>
            ) : (
              <div className="w-max">
                <LoginButton />
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
