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

      const { data: { session } } = await supabase.auth.getSession();
      if (mounted) {
        setUser(session?.user ?? null);
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
