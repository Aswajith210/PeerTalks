"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

interface TokenBalanceProps {
  className?: string;
}

export function TokenBalance({ className = "" }: TokenBalanceProps) {
  const [balance, setBalance] = useState<number | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      const supabase = await createClient();
      if (!supabase) return;

      const { data: { session } } = await supabase.auth.getSession();
      if (!session || !mounted) return;

      const { data } = await supabase
        .from("token_balances")
        .select("balance")
        .eq("user_id", session.user.id)
        .single();

      if (mounted && data) setBalance(data.balance);

      const channel = supabase
        .channel("token_balance")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "token_balances",
            filter: `user_id=eq.${session.user.id}`,
          },
          (payload: { new?: Record<string, unknown> }) => {
            if (payload.new && "balance" in payload.new) {
              setBalance(payload.new.balance as number);
            }
          }
        )
        .subscribe();

      if (mounted) channelRef.current = channel;
    };

    init();

    return () => {
      mounted = false;
      if (channelRef.current) {
        createClient().then((sb) => sb?.removeChannel(channelRef.current!));
      }
    };
  }, []);

  if (balance === null) return null;

  return (
    <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] ${className}`}>
      <svg className="w-3 h-3 text-white/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
      </svg>
      <span className="text-sm font-medium text-white/70">{balance}</span>
    </div>
  );
}
