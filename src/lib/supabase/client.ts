import type { SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;
let _initPromise: Promise<void> | null = null;
let _diagnosed = false;

function projectRefFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.split(".")[0] || null;
  } catch {
    return null;
  }
}

function projectRefFromKey(key: string): string | null {
  try {
    const payload = key.split(".")[1];
    if (!payload) return null;
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    return (JSON.parse(atob(b64)) as { ref?: string }).ref ?? null;
  } catch {
    return null;
  }
}

export async function createClient(): Promise<SupabaseClient | null> {
  if (_client) return _client;

  if (typeof window === "undefined") return null;

  if (!_initPromise) {
    _initPromise = init();
  }

  await _initPromise;
  return _client;
}

async function init() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    if (!_diagnosed) {
      _diagnosed = true;
      console.error(
        "[Supabase] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are empty in this build. " +
          "The deployment was built without them — redeploy after setting the variables " +
          "(this is what causes 'Invalid API key' at runtime)."
      );
    }
    return;
  }

  if (supabaseKey.startsWith("NEXT_PUBLIC_SUPABASE_ANON_KEY=")) {
    if (!_diagnosed) {
      _diagnosed = true;
      console.error(
        "[Supabase] NEXT_PUBLIC_SUPABASE_ANON_KEY contains the whole `KEY=value` line. " +
          "In Vercel, paste ONLY the key itself (e.g. `eyJ...`) into the Value field — no " +
          "variable name, no `=` sign. The prefixed value makes the app send an invalid " +
          "apikey header, which Supabase rejects with 'Invalid API key'."
      );
    }
    return;
  }

  const urlRef = projectRefFromUrl(supabaseUrl);
  const keyRef = projectRefFromKey(supabaseKey);
  if (urlRef && keyRef && urlRef !== keyRef) {
    if (!_diagnosed) {
      _diagnosed = true;
      console.error(
        `[Supabase] NEXT_PUBLIC_SUPABASE_URL is project "${urlRef}" but NEXT_PUBLIC_SUPABASE_ANON_KEY ` +
          `belongs to project "${keyRef}". Use the anon key matching the URL.`
      );
    }
    return;
  }

  try {
    const { createBrowserClient } = await import("@supabase/ssr");
    _client = createBrowserClient(supabaseUrl, supabaseKey) as unknown as SupabaseClient;
  } catch {}
}
