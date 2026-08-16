"use client";

import { LoginButton } from "@/components/auth/LoginButton";
import { OAuthCodeCapture } from "@/components/auth/OAuthCodeCapture";
import Link from "next/link";
import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";

function LoginError() {
  const params = useSearchParams();
  const error = params.get("error");
  const message = useMemo(() => {
    if (!error) return null;
    if (/verifier|flow state|flow_state|invalid flow/i.test(error)) {
      return "This sign-in link has already been used or expired. Please try again.";
    }
    if (error === "missing_code") {
      return "The sign-in request was incomplete. Please try again.";
    }
    if (error === "missing_config") {
      return "Sign-in is temporarily unavailable. Please try again later.";
    }
    return "Something went wrong while signing in. Please try again.";
  }, [error]);
  if (!message) return null;
  return (
    <div
      role="alert"
      className="mb-6 flex items-start gap-3 rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-left"
    >
      <svg className="w-4 h-4 mt-0.5 shrink-0 text-red-300/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4m0 4h.01" strokeLinecap="round" />
      </svg>
      <p className="text-sm text-red-200/80 font-light leading-relaxed">{message}</p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative z-10">
      <OAuthCodeCapture />
      <div className="text-center max-w-sm">
        <Link href="/" className="inline-flex items-center gap-2 mb-8 group">
          <div className="w-9 h-9 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center group-hover:bg-white/[0.06] transition-all duration-300">
            <svg className="w-4 h-4 text-white/60 group-hover:text-white/80 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
        </Link>
        <div className="glass-card rounded-3xl p-8 card-lift">
          <h1 className="text-xl font-semibold text-white/90 mb-2">Welcome back</h1>
          <p className="text-sm text-muted mb-6 leading-relaxed">
            Sign in to continue connecting with people around the world.
          </p>
          <Suspense fallback={null}>
            <LoginError />
          </Suspense>
          <div className="w-full">
            <LoginButton />
          </div>
        </div>
      </div>
    </div>
  );
}
