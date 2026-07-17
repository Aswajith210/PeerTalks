import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ensureDailyTokens, getUserTokenBalance } from "@/lib/tokens";
import { NextResponse } from "next/server";

export async function POST() {
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

  try {
    await ensureDailyTokens(session.user.id);
    const balance = await getUserTokenBalance(session.user.id);
    return NextResponse.json({ claimed: true, balance });
  } catch {
    return NextResponse.json({ error: "Failed to claim daily tokens" }, { status: 500 });
  }
}
