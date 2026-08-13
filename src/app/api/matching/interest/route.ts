import { createServerSupabaseClient } from "@/lib/supabase/server";
import { deductTokens, refundTokens, parseRequestKey } from "@/lib/tokens";
import { TOKEN_COSTS } from "@/lib/constants";
import { NextResponse } from "next/server";
import { validateInput, schemas } from "@/lib/validations";

async function deduct(userId: string, requestKey: string) {
  return deductTokens(
    userId,
    TOKEN_COSTS.VIDEO_CHAT,
    "Interest-based chat",
    undefined,
    requestKey
  );
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const requestKey = parseRequestKey(request);
  if (!requestKey) {
    return NextResponse.json({ error: "Missing or invalid idempotency key" }, { status: 400 });
  }

  const body = await request.json();
  const validationError = validateInput(body, schemas.matchingInterest);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

  const callType = request.headers.get("x-call-type") ?? "video";
  if (callType !== "video" && callType !== "text") {
    return NextResponse.json({ error: "Invalid call type" }, { status: 400 });
  }

  const { interests } = body;
  const userId = session.user.id;

  // Save interests
  for (const interest of interests) {
    await supabase.from("user_interests").upsert(
      { user_id: userId, interest: interest.toLowerCase().trim() },
      { onConflict: "user_id, interest" }
    );
  }

  // Clear orphaned waiting rows from lost-response attempts (see random).
  await supabase
    .from("matching_queue")
    .delete()
    .eq("user_id", userId)
    .eq("mode", "interest")
    .eq("status", "waiting")
    .lt("created_at", new Date(Date.now() - 120_000).toISOString());

  const deduction = await deduct(userId, requestKey);
  if (!deduction.success) {
    return NextResponse.json({ error: "Insufficient tokens", balance: deduction.balance }, { status: 400 });
  }

  let matchResult: Record<string, unknown> | null = null;

  // Try RPC first
  const rpcResult = await supabase.rpc("find_interest_match", { p_user_id: userId, p_interests: interests, p_call_type: callType });
  const rpcData = rpcResult.data as Record<string, unknown> | null;
  const rpcErr = rpcResult.error;

  if (rpcData?.matched) {
    matchResult = rpcData;
  } else if (!rpcErr || rpcErr.code !== "PGRST202") {
    matchResult = { matched: false };
  }

  if (!matchResult) {
    // Fallback: find interest matches via direct query
    const { data: existing } = await supabase
      .from("matching_queue")
      .select("*")
      .eq("mode", "interest").eq("call_type", callType).eq("status", "waiting")
      .neq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(20);

    if (existing) {
      for (const entry of existing) {
        const entryInterests = (entry.interests as string[]) || [];
        const overlap = interests.some((i: string) =>
          entryInterests.some((ei: string) => ei.toLowerCase() === i.toLowerCase())
        );
        if (overlap) {
          const { data: chat } = await supabase
            .from("chat_sessions")
            .insert({ mode: "interest", status: "connected", call_type: callType, user1_id: entry.user_id, user2_id: userId })
            .select().single();
          if (chat) {
            await supabase.from("matching_queue").update({
              status: "matched", matched_user_id: userId,
              session_id: chat.id, matched_at: new Date().toISOString(),
            }).eq("id", entry.id);

            await supabase.from("matching_queue").insert({
              user_id: userId, mode: "interest", call_type: callType, interests,
              status: "matched", matched_user_id: entry.user_id,
              session_id: chat.id, matched_at: new Date().toISOString(),
            });

            matchResult = { matched: true, session_id: chat.id };
            break;
          }
        }
      }
    }

    matchResult ??= { matched: false };
  }

  if (matchResult?.matched) {
    return NextResponse.json({
      matched: true,
      sessionId: matchResult.session_id as string,
      matchedInterest: (matchResult.matched_interest as string) ?? "",
    });
  }

  const { data: queueEntry } = await supabase
    .from("matching_queue")
    .insert({ user_id: userId, mode: "interest", call_type: callType, interests, status: "waiting" })
    .select().single();

  return NextResponse.json({
    matched: false,
    queueId: queueEntry?.id,
    message: "Looking for someone who shares your interests...",
  });
}

export async function DELETE() {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Refund ONLY when a waiting entry was actually removed (see random route).
  const { data: deleted } = await supabase
    .from("matching_queue")
    .delete({ count: "exact" })
    .eq("user_id", session.user.id)
    .eq("mode", "interest")
    .eq("status", "waiting")
    .select("id");

  if (deleted && deleted.length > 0) {
    const refund = await refundTokens(session.user.id, TOKEN_COSTS.VIDEO_CHAT);
    return NextResponse.json({ success: refund.success, refunded: true });
  }
  return NextResponse.json({ success: true, refunded: false });
}