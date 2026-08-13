"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

interface AuthGuardProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Server-validated auth gate for protected pages.
 *
 * Uses getUser() (verifies the token against Supabase, not just the cookie),
 * and keeps listening to auth events so sign-out / session changes are
 * reflected immediately instead of leaving a half-mounted authenticated UI.
 * Unauthenticated users are sent to /login — never bounced to the marketing
 * home, which previously read as "redirected back to Continue with Google".
 */
export function AuthGuard({ children, fallback }: AuthGuardProps) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    let mounted = true;
    let subscription: { subscription: { unsubscribe: () => void } } | null = null;
    let checking = false;

    const checkAuth = async () => {
      if (checking) return;
      checking = true;
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = await createClient();
      if (!supabase) {
        if (mounted) setAuthenticated(false);
        checking = false;
        return;
      }

      // getUser() round-trips to Supabase: a stale/expired cookie is treated
      // as unauthenticated instead of trusting the client-side decode.
      const { data, error } = await supabase.auth.getUser();
      if (!mounted) return;

      const hasUser = !error && !!data.user;
      setAuthenticated(hasUser);

      if (!hasUser && !fallback) {
        router.replace("/login");
      }
      checking = false;
    };

    const onAuthStateChange = async () => {
      // SESSION_CHANGED / SIGNED_OUT / TOKEN_REFRESHED — re-verify.
      await checkAuth();
    };

    const init = async () => {
      await checkAuth();
      const { createClient: getClient } = await import("@/lib/supabase/client");
      const supabase = await getClient();
      if (!supabase) return;
      const { data: sub } = supabase.auth.onAuthStateChange(onAuthStateChange);
      subscription = sub;
    };
    init();

    return () => {
      mounted = false;
      subscription?.subscription.unsubscribe();
      subscription = null;
    };
  }, [pathname, router, fallback]);

  if (authenticated === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
      </div>
    );
  }

  if (!authenticated) return fallback || null;
  return <>{children}</>;
}