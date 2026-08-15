"use client";

export const dynamic = "force-dynamic";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { TokenBalance } from "@/components/tokens/TokenBalance";
import { useAuth } from "@/hooks/useAuth";
import { useTokens } from "@/hooks/useTokens";
import { TOKEN_COSTS } from "@/lib/constants";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useToast } from "@/hooks/useToast";
import { RecentSessions } from "@/components/dashboard/RecentSessions";
import { motion } from "framer-motion";

function QuickActionCard({
  title,
  description,
  icon,
  cost,
  onClick,
  disabled,
  index,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  cost: number;
  onClick: () => void;
  disabled?: boolean;
  index: number;
}) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.08, ease: [0.16, 1, 0.3, 1] }}
      onClick={onClick}
      disabled={disabled}
      className={`group text-left glass-card rounded-3xl p-6 sm:p-8 transition-all duration-300 cursor-pointer hover:border-white/[0.12] hover:bg-white/[0.03] active:scale-[0.99] ${
        disabled ? "opacity-30 pointer-events-none" : ""
      } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/15`}
    >
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center flex-shrink-0 group-hover:bg-white/[0.06] transition-all duration-300">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-white/90 mb-1">{title}</h3>
          <p className="text-sm text-muted leading-relaxed">{description}</p>
        </div>
        <span className="text-xs text-white/20 font-mono whitespace-nowrap">{cost} tokens</span>
      </div>
    </motion.button>
  );
}

function DashboardContent() {
  const router = useRouter();
  const { user } = useAuth();
  const { loading: tokensLoading, refresh, setBalance } = useTokens();
  const toast = useToast();

  const hasClaimed = useRef(false);

  useEffect(() => {
    const ensureTokens = async () => {
      if (!user || hasClaimed.current) return;
      hasClaimed.current = true;
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        const res = await fetch("/api/tokens/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tz }),
        });
        const data = await res.json();
        if (typeof data.balance === "number") setBalance(data.balance);
        await refresh();
        if (data.claimed) {
          const claimedBalance =
            typeof data.balance === "number"
              ? data.balance
              : (await refresh());
          toast.success(
            "Daily tokens claimed!",
            `${typeof claimedBalance === "number" ? claimedBalance : "Your"} tokens available`
          );
        }
      } catch {}
    };
    ensureTokens();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Revalidate the live balance before deciding "not enough tokens".
  const checkAndNavigate = async (cost: number, path: string) => {
    const fresh = await refresh();
    if (fresh !== null && fresh < cost) {
      console.warn("[tokens] dashboard check", { balance: fresh, cost });
      toast.error("Not enough tokens", "Claim your daily tokens or wait for refill");
      return;
    }
    router.push(path);
  };

  const hours = new Date().getHours();
  const greeting = hours < 12 ? "Good morning" : hours < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="max-w-5xl mx-auto px-4 pt-24 sm:pt-28 pb-16 relative z-10">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="flex items-start justify-between mb-10 sm:mb-12"
      >
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-white/90 tracking-tight">{greeting}</h1>
          <p className="text-sm text-muted mt-1.5">Start a new conversation or pick up where you left off.</p>
        </div>
        <TokenBalance />
      </motion.div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <QuickActionCard
          index={0}
          title="Random Chat"
          description="Match instantly with someone new."
          icon={
            <svg className="w-5 h-5 text-white/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          }
          cost={2}
          onClick={() => checkAndNavigate(TOKEN_COSTS.VIDEO_CHAT, "/chat/random")}
          disabled={tokensLoading}
        />
        <QuickActionCard
          index={1}
          title="Interest Chat"
          description="Connect over shared passions."
          icon={
            <svg className="w-5 h-5 text-white/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
          }
          cost={2}
          onClick={() => checkAndNavigate(TOKEN_COSTS.VIDEO_CHAT, "/chat/interest")}
          disabled={tokensLoading}
        />
        <QuickActionCard
          index={2}
          title="Private Room"
          description="Password-protected space for two."
          icon={
            <svg className="w-5 h-5 text-white/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <rect x="5" y="11" width="14" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
          }
          cost={5}
          onClick={() => checkAndNavigate(TOKEN_COSTS.PRIVATE_ROOM, "/chat/room/new")}
          disabled={tokensLoading}
        />
      </div>

      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
        className="mt-14 sm:mt-16"
      >
        <h2 className="text-lg font-semibold text-white/90 mb-5">Recent conversations</h2>
        <RecentSessions />
      </motion.section>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <AuthGuard>
      <DashboardContent />
    </AuthGuard>
  );
}
