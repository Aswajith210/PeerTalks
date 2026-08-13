import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  deductTokens,
  refundTokens,
  parseRequestKey,
} from "@/lib/tokens";
import { TOKEN_COSTS } from "@/lib/constants";
import { NextResponse } from "next/server";

async function deduct(userId: string, requestKey: string) {
  return deductTokens(
    userId,
    TOKEN_COSTS.VIDEO_CHAT,
    "Random chat",
    undefined,
    requestKey
  );
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // The client supplies a per-attempt key (UUID). The SAME key replayed
  // (network retry, double-click) can never deduct twice.
  const requestKey = parseRequestKey(request);
  if (!requestKey) {
    return NextResponse.json({ error: "Missing or invalid idempotency key" }, { status: 400 });
  }

  const callType = request.headers.get("x-call-type") ?? "video";
  if (callType !== "video" && callType !== "text") {
    return NextResponse.json({ error: "Invalid call type" }, { status: 400 });
  }

  const userId = session.user.id;

  // Clear orphaned waiting rows from attempts whose response was lost
  // (e.g. a retried POST that queued but never got a reply). Rows newer
  // than the matching timeout are live attempts — never touch those.
  await supabase
    .from("matching_queue")
    .delete()
    .eq("user_id", userId)
    .eq("mode", "random")
    .eq("status", "waiting")
    .lt("created_at", new Date(Date.now() - 120_000).toISOString());

  const deduction = await deduct(userId, requestKey);
  if (!deduction.success) {
    console.error("[tokens] random chat blocked", {
      userId, cost: TOKEN_COSTS.VIDEO_CHAT, balance: deduction.balance, reason: deduction.reason,
    });
    return NextResponse.json({ error: "Insufficient tokens", balance: deduction.balance, reason: deduction.reason }, { status: 400 });
  }

  let matchResult: Record<string, unknown> | null = null;

  // Try RPC first
  const rpcResult = await supabase.rpc("find_random_match", { p_user_id: userId, p_call_type: callType });
  const rpcData = rpcResult.data as Record<string, unknown> | null;
  const rpcErr = rpcResult.error;

  if (rpcData?.matched) {
    matchResult = rpcData;
  } else if (!rpcErr || rpcErr.code !== "PGRST202") {
    matchResult = { matched: false };
  }

  if (!matchResult) {
    // Fallback: direct query (RLS limits to own rows, but may find matches anyway)
    const { data: existing } = await supabase
      .from("matching_queue")
      .select("*")
      .eq("mode", "random").eq("call_type", callType).eq("status", "waiting")
      .neq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (existing) {
      const { data: chat } = await supabase
        .from("chat_sessions")
        .insert({ mode: "random", status: "connected", call_type: callType, user1_id: existing.user_id, user2_id: userId })
        .select().single();

      if (chat) {
        await supabase.from("matching_queue").update({
          status: "matched", matched_user_id: userId,
          session_id: chat.id, matched_at: new Date().toISOString(),
        }).eq("id", existing.id);

        await supabase.from("matching_queue").insert({
          user_id: userId, mode: "random", call_type: callType, status: "matched",
          matched_user_id: existing.user_id, session_id: chat.id,
          matched_at: new Date().toISOString(),
        });

        matchResult = { matched: true, session_id: chat.id, peer_id: existing.user_id };
      }
    }

    matchResult ??= { matched: false };
  }

  if (matchResult?.matched) {
    return NextResponse.json({
      matched: true,
      sessionId: matchResult.session_id as string,
      peer: { id: matchResult.peer_id as string },
      balance: deduction.balance,
    });
  }

  const { data: queueEntry } = await supabase
    .from("matching_queue")
    .insert({ user_id: userId, mode: "random", call_type: callType, status: "waiting" })
    .select().single();

  if (queueEntry) {
    return NextResponse.json({
      matched: false,
      queueId: queueEntry.id,
      message: "Waiting for a match...",
      balance: deduction.balance,
    });
  }

  return NextResponse.json({ matched: false, message: "Waiting for a match...", balance: deduction.balance });
}

export async function DELETE() {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Refund ONLY when a waiting queue entry was actually removed. A user who
  // already matched (entry status=matched) or already cancelled (no row)
  // must NOT be refunded — otherwise every matched chat refunds itself and
  // a repeated DELETE(double-cancel / page unmount) refunds again.
  const { data: deleted } = await supabase
    .from("matching_queue")
    .delete({ count: "exact" })
    .eq("user_id", session.user.id)
    .eq("mode", "random")
    .eq("status", "waiting")
    .select("id");

  if (deleted && deleted.length > 0) {
    const refund = await refundTokens(session.user.id, TOKEN_COSTS.VIDEO_CHAT);
    return NextResponse.json({ success: refund.success, refunded: true, balance: refund.balance });
  }
  return NextResponse.json({ success: true, refunded: false });
}