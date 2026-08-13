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
