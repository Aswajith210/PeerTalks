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

  const applyDisplay = useCallback((balance: number, source: "db" | "server" | "realtime") => {
    console.log("[tokens] displaying balance", { balance, source });
    setState({ balance, loading: false, error: null });
  }, []);

  const fetchBalance = useCallback(async (): Promise<boolean> => {
    const supabase = supabaseRef.current;
    const userId = userIdRef.current;
    if (!supabase || !userId) return false;
    const id = ++refreshIdRef.current;
    console.log("[tokens] fetching balance", { userId });
    const { data, error } = await supabase
      .from("token_balances")
      .select("balance")
      .eq("user_id", userId)
      .maybeSingle();
    if (id !== refreshIdRef.current) return false;
    if (error) {
      console.error("[tokens] direct balance fetch error", { userId, message: error.message });
      setState((s) => ({ ...s, loading: false, error: error.message }));
      return false;
    }
    console.log("[tokens] direct balance fetched", { userId, balance: data?.balance ?? 0 });
    applyDisplay(data?.balance ?? 0, "db");
    return true;
  }, [applyDisplay]);

  const refresh = useCallback(async () => {
    await fetchBalance();
  }, [fetchBalance]);

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

      const syncToUser = async (userId: string | null) => {
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

        const directOk = await fetchBalance();
        if (gen !== wireGenRef.current || !mounted) return;

        if (!directOk) {
          // Secondary source: server-verified read using the cookie session.
          // Never cached, never localStorage — the DB row is the authority.
          try {
            const res = await fetch("/api/tokens", { cache: "no-store" });
            if (res.ok) {
              const body = (await res.json()) as { balance?: number };
              if (
                typeof body.balance === "number" &&
                gen === wireGenRef.current &&
                mounted
              ) {
                console.log("[tokens] server balance fallback", { userId, balance: body.balance });
                applyDisplay(body.balance, "server");
              }
            }
          } catch {}
          if (gen !== wireGenRef.current || !mounted) return;
        }

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
                applyDisplay(payload.new.balance as number, "realtime");
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

      // 1) Register the auth listener FIRST so no restore/login/logout event
      //    can happen before it exists (getSession may resolve BEFORE the
      //    remounted client finishes restoring cookies on a hard refresh).
      const { data: { subscription } } = supabase.auth.onAuthStateChange(
        (event, session) => {
          const nextUserId = session?.user.id ?? null;
          console.log("[tokens] auth event", {
            event, nextUserId, previousUserId: userIdRef.current,
          });
          if (!mounted) return;
          if (nextUserId !== userIdRef.current) {
            void syncToUser(nextUserId);
          }
        }
      );
      authSubscription = subscription;

      // 2) Resolve identity against the AUTH SERVER — validates the JWT and
      //    refreshes it if needed, so this is never a stale in-memory/cookie
      //    session or a previous account's cached user.
      try {
        const { data: { user } } = await supabase.auth.getUser();
        console.log("[tokens] identity resolved (getUser)", { userId: user?.id ?? null });
        if (mounted) await syncToUser(user?.id ?? null);
      } catch (userError) {
        console.error("[tokens] getUser failed, falling back to getSession", {
          message: (userError as Error).message,
        });
        const { data: { session } } = await supabase.auth.getSession();
        console.log("[tokens] identity resolved (getSession fallback)", {
          userId: session?.user.id ?? null,
        });
        if (mounted) await syncToUser(session?.user.id ?? null);
      }
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
  }, [applyDisplay, fetchBalance]);

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