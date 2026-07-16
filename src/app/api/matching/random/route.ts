import { createServerSupabaseClient } from "@/lib/supabase/server";
import { deductTokens, refundTokens } from "@/lib/tokens";
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

  const deduction = await deductTokens(userId, 2, "Random chat");
  if (!deduction.success) {
    return NextResponse.json(
      { error: "Insufficient tokens", balance: deduction.balance },
      { status: 400 }
    );
  }

  const { data: existingMatch } = await supabase
    .from("matching_queue")
    .select("*, user_id, profiles!inner(display_name, avatar_url)")
    .eq("mode", "random")
    .eq("status", "waiting")
    .neq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  if (existingMatch) {
    const { data: session } = await supabase
      .from("chat_sessions")
      .insert({
        mode: "random",
        status: "connected",
        user1_id: existingMatch.user_id,
        user2_id: userId,
      })
      .select()
      .single();

    if (session) {
      await supabase
        .from("matching_queue")
        .update({
          status: "matched",
          matched_user_id: userId,
          session_id: session.id,
          matched_at: new Date().toISOString(),
        })
        .eq("id", existingMatch.id);

      await supabase.from("matching_queue").insert({
        user_id: userId,
        mode: "random",
        status: "matched",
        matched_user_id: existingMatch.user_id,
        session_id: session.id,
        matched_at: new Date().toISOString(),
      });

      return NextResponse.json({
        matched: true,
        sessionId: session.id,
        peer: {
          id: existingMatch.user_id,
        },
      });
    }
  }

  const { data: queueEntry } = await supabase
    .from("matching_queue")
    .insert({
      user_id: userId,
      mode: "random",
      status: "waiting",
    })
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
