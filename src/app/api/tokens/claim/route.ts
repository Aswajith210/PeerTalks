import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ensureDailyTokens, getUserTokenBalance } from "@/lib/tokens";
import { NextResponse } from "next/server";

const SAFE_TZ = /^[A-Za-z0-9_+\-/]{2,64}$/;

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const tz =
    typeof body?.tz === "string" && SAFE_TZ.test(body.tz) ? body.tz : "UTC";

  try {
    const result = await ensureDailyTokens(session.user.id, tz);
    const balance = await getUserTokenBalance(session.user.id);
    return NextResponse.json({
      claimed: result.claimed,
      balance: result.claimed ? result.balance : balance,
    });
  } catch {
    return NextResponse.json({ error: "Failed to claim daily tokens" }, { status: 500 });
  }
}