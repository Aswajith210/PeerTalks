import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createServerSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error(
      "[Supabase] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are empty in this build. " +
        "The deployment was built without them — redeploy after setting the variables " +
        "(this is what causes 'Invalid API key' at runtime)."
    );
    return null;
  }

  if (supabaseKey.startsWith("NEXT_PUBLIC_SUPABASE_ANON_KEY=")) {
    console.error(
      "[Supabase] NEXT_PUBLIC_SUPABASE_ANON_KEY contains the whole `KEY=value` line. " +
        "In Vercel, paste ONLY the key itself (e.g. `eyJ...`) into the Value field — no " +
        "variable name, no `=` sign. The prefixed value makes the app send an invalid " +
        "apikey header, which Supabase rejects with 'Invalid API key'."
    );
    return null;
  }

  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {}
      },
    },
  });
}
