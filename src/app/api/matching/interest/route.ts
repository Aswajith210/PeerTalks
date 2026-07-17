import { createServerSupabaseClient } from "@/lib/supabase/server";
import { refundTokens } from "@/lib/tokens";
import { NextResponse } from "next/server";
import { validateInput, schemas } from "@/lib/validations";

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

  const body = await request.json();
  const validationError = validateInput(body, schemas.matchingInterest);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const { interests } = body;
  const userId = session.user.id;

  // Save user interests
  for (const interest of interests) {
    await supabase.from("user_interests").upsert(
      { user_id: userId, interest: interest.toLowerCase().trim() },
      { onConflict: "user_id, interest" }
    );
  }

  // Atomic token deduction via RPC
  const { data: deduction } = await supabase.rpc("deduct_tokens", {
    p_user_id: userId,
    p_amount: 2,
    p_type: "chat_cost",
    p_description: "Interest-based chat",
    p_session_id: null,
  });

  if (!deduction?.success) {
    return NextResponse.json(
      { error: "Insufficient tokens", balance: deduction?.balance ?? 0 },
      { status: 400 }
    );
  }

  // Use security definer RPC to find an interest match (bypasses RLS)
  const { data: matchResult, error: matchError } = await supabase
    .rpc("find_interest_match", { p_user_id: userId, p_interests: interests });

  if (matchError) {
    return NextResponse.json({ error: "Matching failed" }, { status: 500 });
  }

  if (matchResult?.matched) {
    return NextResponse.json({
      matched: true,
      sessionId: matchResult.session_id,
      matchedInterest: "",
    });
  }

  // No match — join waiting queue
  const { data: queueEntry } = await supabase
    .from("matching_queue")
    .insert({ user_id: userId, mode: "interest", interests, status: "waiting" })
    .select()
    .single();

  return NextResponse.json({
    matched: false,
    queueId: queueEntry?.id,
    message: "Looking for someone who shares your interests...",
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
