"use client";

import { LoginButton } from "@/components/auth/LoginButton";
import Link from "next/link";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative z-10">
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
          <div className="w-full">
            <LoginButton />
          </div>
        </div>
      </div>
    </div>
  );
}
