"use client";

import { useEffect } from "react";

// If the OAuth provider (or a stale Supabase "Site URL" setting) redirects back
// to the site ROOT with a `code` query param — instead of /api/auth/callback —
// funnel the code to the callback route where it is exchanged exactly once.
export function OAuthCodeCapture() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (!url.searchParams.get("code")) return;
    if (url.pathname === "/api/auth/callback") return;
    window.location.replace(`/api/auth/callback${url.search}`);
  }, []);

  return null;
}
