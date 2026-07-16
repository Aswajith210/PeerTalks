import { createServerSupabaseClient } from "@/lib/supabase/server";
import { deductTokens, refundTokens } from "@/lib/tokens";
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

  const deduction = await deductTokens(userId, 2, "Interest-based chat");
  if (!deduction.success) {
    return NextResponse.json(
      { error: "Insufficient tokens", balance: deduction.balance },
      { status: 400 }
    );
  }

  for (const interest of interests) {
    await supabase.from("user_interests").upsert(
      { user_id: userId, interest: interest.toLowerCase().trim() },
      { onConflict: "user_id, interest" }
    );
  }

  const { data: existingMatches } = await supabase
    .from("matching_queue")
    .select("*, user_id")
    .eq("mode", "interest")
    .eq("status", "waiting")
    .neq("user_id", userId)
    .order("created_at", { ascending: true });

  let bestMatch: Record<string, unknown> | null = null;
  let matchedInterest = "";

  if (existingMatches) {
    for (const entry of existingMatches) {
      const overlap = (entry.interests as string[])?.filter((i: string) =>
        interests.some((j: string) => j.toLowerCase() === i.toLowerCase())
      );
      if (overlap && overlap.length > 0) {
        bestMatch = entry;
        matchedInterest = overlap[0];
        break;
      }
    }
  }

  if (bestMatch) {
    const matchUserId = bestMatch.user_id as string;
    const matchId = bestMatch.id as number;

    const { data: chatSession } = await supabase
      .from("chat_sessions")
      .insert({
        mode: "interest",
        status: "connected",
        user1_id: matchUserId,
        user2_id: userId,
      })
      .select()
      .single();

    if (chatSession) {
      await supabase
        .from("matching_queue")
        .update({
          status: "matched",
          matched_user_id: userId,
          session_id: chatSession.id,
          matched_at: new Date().toISOString(),
        })
        .eq("id", matchId);

      await supabase.from("matching_queue").insert({
        user_id: userId,
        mode: "interest",
        interests,
        status: "matched",
        matched_user_id: matchUserId,
        session_id: chatSession.id,
        matched_at: new Date().toISOString(),
      });

      return NextResponse.json({
        matched: true,
        sessionId: chatSession.id,
        matchedInterest,
      });
    }
  }

  const { data: queueEntry } = await supabase
    .from("matching_queue")
    .insert({
      user_id: userId,
      mode: "interest",
      interests,
      status: "waiting",
    })
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
