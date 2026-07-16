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

  const { data: balance } = await supabase
    .from("token_balances")
    .select("balance, last_daily_at")
    .eq("user_id", session.user.id)
    .single();

  const { data: transactions } = await supabase
    .from("token_transactions")
    .select("*")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  return NextResponse.json({
    balance: balance?.balance ?? 0,
    lastDailyAt: balance?.last_daily_at ?? null,
    transactions: transactions ?? [],
  });
}
