import { createServerSupabaseClient } from "@/lib/supabase/server";
import { refundTokens } from "@/lib/tokens";
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

  const userId = session.user.id;

  // Atomic token deduction via RPC
  const { data: deduction } = await supabase.rpc("deduct_tokens", {
    p_user_id: userId,
    p_amount: 2,
    p_type: "chat_cost",
    p_description: "Random chat",
    p_session_id: null,
  });

  if (!deduction?.success) {
    return NextResponse.json(
      { error: "Insufficient tokens", balance: deduction?.balance ?? 0 },
      { status: 400 }
    );
  }

  // Use security definer RPC to find a match (bypasses RLS)
  const { data: matchResult, error: matchError } = await supabase
    .rpc("find_random_match", { p_user_id: userId });

  if (matchError) {
    return NextResponse.json({ error: "Matching failed" }, { status: 500 });
  }

  if (matchResult?.matched) {
    return NextResponse.json({
      matched: true,
      sessionId: matchResult.session_id,
      peer: { id: matchResult.peer_id },
    });
  }

  // No match — join waiting queue
  const { data: queueEntry } = await supabase
    .from("matching_queue")
    .insert({ user_id: userId, mode: "random", status: "waiting" })
    .select()
    .single();

  return NextResponse.json({
    matched: false,
    queueId: queueEntry?.id,
    message: "Waiting for a match...",
  });
}

export async function DELETE() {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await supabase
    .from("matching_queue")
    .delete()
    .eq("user_id", session.user.id)
    .eq("status", "waiting");

  await refundTokens(session.user.id, 2, undefined);

  return NextResponse.json({ success: true });
}
