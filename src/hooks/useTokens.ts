"use client";

import { createClient } from "@/lib/supabase/client";
import { useState, useCallback, useEffect, useRef } from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

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
  const supabaseRef = useRef<SupabaseClient | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;

    const init = async () => {
      const supabase = await createClient();
      if (!supabase || !mountedRef.current) {
        if (mountedRef.current) setState((s) => ({ ...s, loading: false }));
        return;
      }
      supabaseRef.current = supabase;

      const { data: { session } } = await supabase.auth.getSession();
      if (!session || !mountedRef.current) {
        if (mountedRef.current) setState((s) => ({ ...s, loading: false }));
        return;
      }

      const { data, error } = await supabase
        .from("token_balances")
        .select("balance")
        .eq("user_id", session.user.id)
        .single();

      if (mountedRef.current) {
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
            if (payload.new && "balance" in payload.new && mountedRef.current) {
              setState((s) => ({
                ...s,
                balance: payload.new!.balance as number,
              }));
            }
          }
        )
        .subscribe();

      if (mountedRef.current) {
        channelRef.current = channel;
      } else {
        supabase.removeChannel(channel);
      }
    };

    init();

    return () => {
      mountedRef.current = false;
      if (channelRef.current && supabaseRef.current) {
        supabaseRef.current.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, []);

  const hasEnough = useCallback(
    (amount: number) => state.balance >= amount,
    [state.balance]
  );

  return {
    balance: state.balance,
    loading: state.loading,
    error: state.error,
    hasEnough,
  } as const;
}
