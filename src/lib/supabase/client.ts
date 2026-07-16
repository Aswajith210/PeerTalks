import type { SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;
let _initPromise: Promise<void> | null = null;

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

  if (!supabaseUrl || !supabaseKey) return;

  try {
    const { createBrowserClient } = await import("@supabase/ssr");
    _client = createBrowserClient(supabaseUrl, supabaseKey) as unknown as SupabaseClient;
  } catch {}
}
