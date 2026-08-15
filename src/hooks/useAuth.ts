"use client";

import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import type { Subscription } from "@supabase/supabase-js";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const subscriptionRef = useRef<Subscription | null>(null);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = await createClient();
      if (!supabase) {
        if (mounted) setLoading(false);
        return;
      }

      // getUser() validates the JWT against the auth server (refreshing it
      // if needed) so an expired/revoked cookie session is never shown as
      // authenticated — getSession() alone would trust the local cookie.
      const { data: { user }, error } = await supabase.auth.getUser();
      let resolved = user ?? null;
      if (error) {
        const { data: { session } } = await supabase.auth.getSession();
        resolved = session?.user ?? null;
      }
      if (mounted) {
        setUser(resolved);
        setLoading(false);
      }

      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        if (mounted) setUser(session?.user ?? null);
      });
      subscriptionRef.current = subscription;
    };

    init();

    return () => {
      mounted = false;
      subscriptionRef.current?.unsubscribe();
      subscriptionRef.current = null;
    };
  }, []);

  return { user, loading };
}
