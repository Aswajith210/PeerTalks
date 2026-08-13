"use client";

import { createClient } from "@/lib/supabase/client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

interface TokenState {
  balance: number;
  loading: boolean;
  error: string | null;
}

interface TokensContextValue extends TokenState {
  refresh: () => Promise<void>;
  hasEnough: (amount: number) => boolean;
}

// Single provider mounted in the root layout keeps one fetch + one realtime
// channel as the shared source of truth for every consumer (navbar, dashboard,
// chat pages), so the balance can be refreshed everywhere with one call.
const TokensContext = createContext<TokensContextValue | null>(null);

export function TokensProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<TokenState>({
    balance: 0,
    loading: true,
    error: null,
  });

  const supabaseRef = useRef<SupabaseClient | null>(null);
  const userIdRef = useRef<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const wireGenRef = useRef(0);
  const refreshIdRef = useRef(0);

  const applyBalance = useCallback((balance: number) => {
    setState({ balance, loading: false, error: null });
  }, []);

  const fetchBalance = useCallback(async () => {
    const supabase = supabaseRef.current;
    const userId = userIdRef.current;
    if (!supabase || !userId) return;
    const id = ++refreshIdRef.current;
    const { data, error } = await supabase
      .from("token_balances")
      .select("balance")
      .eq("user_id", userId)
      .maybeSingle();
    if (id !== refreshIdRef.current) return;
    if (error) {
      setState((s) => ({ ...s, loading: false, error: error.message }));
    } else {
      applyBalance(data?.balance ?? 0);
    }
  }, [applyBalance]);

  const refresh = useCallback(() => fetchBalance(), [fetchBalance]);

  useEffect(() => {
    let mounted = true;
    let authSubscription: { unsubscribe: () => void } | null = null;

    const wire = async () => {
      const supabase = await createClient();
      if (!supabase) {
        if (mounted) setState((s) => ({ ...s, loading: false }));
        return;
      }
      supabaseRef.current = supabase;

      const setupForUser = async (userId: string | null) => {
        if (!mounted) return;
        const gen = ++wireGenRef.current;

        if (channelRef.current) {
          supabase.removeChannel(channelRef.current);
          channelRef.current = null;
        }
        userIdRef.current = userId;

        if (!userId) {
          if (gen === wireGenRef.current) {
            setState({ balance: 0, loading: false, error: null });
          }
          return;
        }

        await fetchBalance();
        if (gen !== wireGenRef.current || !mounted) return;

        const channel = supabase
          .channel(`token_balance_sync_${userId}`)
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "token_balances",
              filter: `user_id=eq.${userId}`,
            },
            (payload: { new?: Record<string, unknown> | null }) => {
              if (payload.new && "balance" in payload.new) {
                applyBalance(payload.new.balance as number);
              }
            }
          )
          .subscribe((status) => {
            // Non-fatal: balance falls back to explicit refresh() calls and
            // the initial fetch above.
            if (status === "CHANNEL_ERROR" && mounted) {
              setState((s) => ({ ...s, loading: false }));
            }
          });

        if (gen !== wireGenRef.current || !mounted) {
          supabase.removeChannel(channel);
          return;
        }
        channelRef.current = channel;
      };

      const { data: { session } } = await supabase.auth.getSession();
      await setupForUser(session?.user.id ?? null);

      const { data: { subscription } } = supabase.auth.onAuthStateChange(
        (_event, session) => {
          const nextUserId = session?.user.id ?? null;
          if (nextUserId !== userIdRef.current) {
            void setupForUser(nextUserId);
          }
        }
      );
      authSubscription = subscription;
    };

    void wire();

    return () => {
      mounted = false;
      authSubscription?.unsubscribe();
      if (channelRef.current && supabaseRef.current) {
        supabaseRef.current.removeChannel(channelRef.current);
      }
      channelRef.current = null;
      supabaseRef.current = null;
      userIdRef.current = null;
    };
  }, [applyBalance, fetchBalance]);

  const hasEnough = useCallback(
    (amount: number) => state.balance >= amount,
    [state.balance]
  );

  return (
    <TokensContext.Provider value={{ ...state, refresh, hasEnough }}>
      {children}
    </TokensContext.Provider>
  );
}

export function useTokens() {
  const ctx = useContext(TokensContext);
  if (!ctx) {
    throw new Error("useTokens must be used within a TokensProvider");
  }
  return ctx;
}