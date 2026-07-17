"use client";

import { useTokens } from "@/hooks/useTokens";

interface TokenBalanceProps {
  className?: string;
}

export function TokenBalance({ className = "" }: TokenBalanceProps) {
  const { balance, loading } = useTokens();

  if (loading || balance === 0) return null;

  return (
    <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] ${className}`}>
      <svg className="w-3 h-3 text-white/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
      </svg>
      <span className="text-sm font-medium text-white/70">{balance}</span>
    </div>
  );
}
