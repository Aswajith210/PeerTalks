import type { NextConfig } from "next";
import path from "path";

// ── Supabase environment guard (build time) ────────────────────────────────
// NEXT_PUBLIC_* variables are INLINED into the bundle at build time. A build
// made without them (or with a key from a different project) ships silently
// and then fails at runtime with cryptic "Invalid API key" errors. Fail the
// build loudly instead. The key itself is never logged — only refs/names.
function supabaseProjectRef(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.split(".")[0] || null;
  } catch {
    return null;
  }
}

function anonKeyProjectRef(anonKey: string | undefined): string | null {
  if (!anonKey) return null;
  try {
    const payload = anonKey.split(".")[1];
    if (!payload) return null;
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const parsed = JSON.parse(
      Buffer.from(b64, "base64").toString("utf8")
    );
    return typeof parsed.ref === "string" ? parsed.ref : null;
  } catch {
    return null;
  }
}

function isLegacyAnonKey(value: string): boolean {
  return /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}

function isPublishableKey(value: string): boolean {
  return /^sb_publishable_[A-Za-z0-9_-]+$/.test(value);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !anonKey) {
  throw new Error(
    "Missing Supabase environment variables. Set NEXT_PUBLIC_SUPABASE_URL and " +
      "NEXT_PUBLIC_SUPABASE_ANON_KEY (Vercel → Project Settings → Environment " +
      "Variables → Production) before building. The current key/URL pair is " +
      "inlined at build time — a build without them produces 'Invalid API key' " +
      "in production."
  );
}

if (anonKey.startsWith("NEXT_PUBLIC_SUPABASE_ANON_KEY=") || anonKey.startsWith("NEXT_PUBLIC_SUPABASE_URL=")) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY is malformed: its value contains the whole " +
      "`KEY=value` line (it starts with \"NEXT_PUBLIC_SUPABASE_ANON_KEY=\"). " +
      "In Vercel, paste ONLY the key itself (e.g. `eyJ...`) into the Value field — " +
      "do not include the variable name or an `=` sign. A prefixed value makes the " +
      "app send an invalid apikey header, which Supabase rejects with " +
      "\"Invalid API key\"."
  );
}

if (!isLegacyAnonKey(anonKey) && !isPublishableKey(anonKey)) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY does not look like a Supabase key. Expected a " +
      "JWT (starts with `eyJ`) or a publishable key (starts with `sb_publishable_`). " +
      "Copy it from Supabase → Settings → API → API Keys for the project matching " +
      "NEXT_PUBLIC_SUPABASE_URL."
  );
}

const urlRef = supabaseProjectRef(supabaseUrl);
const keyRef = anonKeyProjectRef(anonKey);

if (urlRef && keyRef && urlRef !== keyRef) {
  throw new Error(
    `Supabase configuration mismatch: NEXT_PUBLIC_SUPABASE_URL points to project "${urlRef}" ` +
      `but NEXT_PUBLIC_SUPABASE_ANON_KEY belongs to project "${keyRef}". ` +
      "Use the anon key from the same project as the URL (Supabase → Settings → API)."
  );
}

const nextConfig: NextConfig = {
  transpilePackages: ["three"],
  outputFileTracingRoot: path.join(__dirname),
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      {
        protocol: "https",
        hostname: "*.supabase.co",
      },
    ],
  },
};

export default nextConfig;
