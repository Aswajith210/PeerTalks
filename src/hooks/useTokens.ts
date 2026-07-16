"use client";

import { createClient } from "@/lib/supabase/client";
import { useState, useCallback, useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

interface TokenState {
  balance: number;
  loading: boolean;
  error: string | null;
}

export function useTokens() {
  const [state, setState] = useState<TokenState>({
    balance: 0,
    loading: true,
    error: null,
  });
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      const supabase = await createClient();
      if (!supabase) {
        if (mounted) setState((s) => ({ ...s, loading: false }));
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        if (mounted) setState((s) => ({ ...s, loading: false }));
        return;
      }

      const { data, error } = await supabase
        .from("token_balances")
        .select("balance")
        .eq("user_id", session.user.id)
        .single();

      if (mounted) {
        if (error) {
          setState({ balance: 0, loading: false, error: error.message });
        } else {
          setState({ balance: data.balance, loading: false, error: null });
        }
      }

      const channel = supabase
        .channel("token_balance_sync")
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
              if (mounted) {
                setState((s) => ({
                  ...s,
                  balance: payload.new!.balance as number,
                }));
              }
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

  const hasEnough = useCallback(
    (amount: number) => {
      return state.balance >= amount;
    },
    [state.balance]
  );

  return {
    balance: state.balance,
    loading: state.loading,
    error: state.error,
    hasEnough,
  } as const;
}
