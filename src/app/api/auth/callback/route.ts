import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { TOKEN_ALLOWANCE } from "@/lib/constants";

export const dynamic = "force-dynamic";

// In-process guard: the authorization code MUST be exchanged exactly once.
// Guards against the same code being processed twice on the same instance
// (browser retries, duplicate requests, edge re-execution).
const processedCodes = new Map<string, number>();

function isSafeNext(next: string | null): boolean {
  if (!next || next.length === 0) return false;
  if (!next.startsWith("/")) return false; // must be a path, not a full URL
  if (next.startsWith("//")) return false; // protocol-relative open redirect
  if (next.startsWith("/api/")) return false; // never land on an API route
  return true;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);

  const code = searchParams.get("code");
  const errorParam = searchParams.get("error");
  const next = isSafeNext(searchParams.get("next")) ? searchParams.get("next")! : "/dashboard";

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const cookieStore = await cookies();

  if (!supabaseUrl || !supabaseKey) {
    console.error("[AUTH] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
    return NextResponse.redirect(`${origin}/login?error=missing_config`);
  }

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch (e) {
          console.error("[AUTH] Cookie set error:", e);
        }
      },
    },
  });

  // ── No code: Supabase reported an error (e.g. flow_state_already_used) ──
  if (!code || errorParam) {
    // The code may already have been consumed by a first successful visit.
    // If we already hold a session, the user IS signed in — continue, never error.
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(errorParam ?? "missing_code")}`
    );
  }

  // ── Guard: consume this code exactly once ──
  const now = Date.now();
  const previouslyProcessed = processedCodes.has(code);
  if (!previouslyProcessed) {
    processedCodes.set(code, now);
    // Keep the map small — drop entries older than 15 minutes
    for (const [k, t] of processedCodes) {
      if (now - t > 15 * 60 * 1000) processedCodes.delete(k);
    }
  }

  if (!previouslyProcessed) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      console.error("[AUTH] exchangeCodeForSession failed:", error.code ?? "", error.message);

      // flow_state_already_used / code already consumed:
      // the exchange may have succeeded on a previous request whose session
      // cookies were already persisted. Recover by checking the session.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) {
        return NextResponse.redirect(`${origin}${next}`);
      }
      return NextResponse.redirect(
        `${origin}/login?error=${encodeURIComponent(error.message || "exchange_failed")}`
      );
    }
  }

  // ── At this point the code was consumed exactly once ──
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) {
    return NextResponse.redirect(`${origin}/login?error=session_missing`);
  }

  // Ensure profile exists (idempotent — safe if this runs again)
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", session.user.id)
    .maybeSingle();

  if (!profile) {
    await supabase.from("profiles").insert({
      id: session.user.id,
      username: session.user.user_metadata?.email?.split("@")[0],
      display_name: session.user.user_metadata?.full_name,
      avatar_url: session.user.user_metadata?.avatar_url,
    });
  }

  // Ensure token balance exists (idempotent)
  const { data: balance } = await supabase
    .from("token_balances")
    .select("user_id")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (!balance) {
    await supabase.from("token_balances").insert({
      user_id: session.user.id,
      balance: TOKEN_ALLOWANCE.AMOUNT,
      last_daily_at: new Date().toISOString(),
    });
    await supabase.from("token_transactions").insert({
      user_id: session.user.id,
      amount: TOKEN_ALLOWANCE.AMOUNT,
      type: "daily_allowance",
      description: "Welcome bonus",
    });
  }

  return NextResponse.redirect(`${origin}${next}`);
}
