import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
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

  const { data: balance, error: balanceError } = await supabase
    .from("token_balances")
    .select("balance, last_daily_at")
    .eq("user_id", session.user.id)
    .maybeSingle();

  // A failed read must NOT be reported as balance 0 — the UI would clobber a
  // known-good balance with it. Report the failure instead.
  if (balanceError) {
    console.error("[tokens] api/tokens select blocked", {
      userId: session.user.id,
      message: balanceError.message,
      code: balanceError.code,
    });
    return NextResponse.json(
      { error: "Failed to read balance", balance: null },
      { status: 502 }
    );
  }

  const { data: transactions } = await supabase
    .from("token_transactions")
    .select("*")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  return NextResponse.json({
    balance: balance?.balance ?? null,
    lastDailyAt: balance?.last_daily_at ?? null,
    transactions: transactions ?? [],
  });
}
