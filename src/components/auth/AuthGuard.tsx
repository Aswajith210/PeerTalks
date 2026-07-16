"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

interface AuthGuardProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function AuthGuard({ children, fallback }: AuthGuardProps) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    let mounted = true;
    const checkAuth = async () => {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = await createClient();
      if (!supabase) {
        if (mounted) setAuthenticated(false);
        return;
      }
      const { data: { session } } = await supabase.auth.getSession();
      if (!mounted) return;

      if (session) {
        setAuthenticated(true);
      } else {
        setAuthenticated(false);
        if (!fallback) router.push("/");
      }
    };
    checkAuth();
    return () => { mounted = false; };
  }, [pathname, fallback, router]);

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
