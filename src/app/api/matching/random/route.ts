import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  deductTokens,
  refundTokens,
  parseRequestKey,
  refundKeyFor,
} from "@/lib/tokens";
import { TOKEN_COSTS, MATCHING_TIMEOUT_MS } from "@/lib/constants";
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

/**
 * The RPC only pairs the CALLER with another user's waiting row. When the
 * peer's RPC matched us, OUR row flips to status=matched with a session_id —
 * but our own RPC can never see that (it excludes our own rows). Without
 * this check we depend entirely on a realtime event that may not be
 * configured on the production database, leaving us on "Finding someone"
 * forever. The recency window + non-ended session guard rejects stale
 * matched rows from earlier abandoned attempts.
 */
async function findOwnRecentMatch(
  supabase: NonNullable<Awaited<ReturnType<typeof createServerSupabaseClient>>>,
  userId: string
): Promise<{ session_id: string; peer_id: string } | null> {
  const { data: own } = await supabase
    .from("matching_queue")
    .select("session_id, matched_user_id")
    .eq("user_id", userId)
    .eq("mode", "random")
    .eq("status", "matched")
    .not("session_id", "is", null)
    .gte("matched_at", new Date(Date.now() - MATCHING_TIMEOUT_MS).toISOString())
    .order("matched_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!own?.session_id) return null;

  const { data: session } = await supabase
    .from("chat_sessions")
    .select("status, user2_id")
    .eq("id", own.session_id)
    .maybeSingle();
  // A session that is ended, or one the peer never joined (user2 unset),
  // is stale — never resurrect it.
  if (!session || session.status === "ended" || !session.user2_id) return null;

  return { session_id: own.session_id, peer_id: own.matched_user_id };
}

/**
 * Direct-query pairing used ONLY when the find_random_match RPC is missing
 * from the database (PGRST202). Requires SUPABASE_SERVICE_ROLE_KEY server-side
 * (never exposed to the browser); RLS would hide other users' queue rows from
 * the anon client, which made the old fallback match nobody.
 *
 * Returns null when the fallback itself is unavailable (no service-role key),
 * { matched: false } when the queue is empty, or a matched payload.
 */
async function tryDirectMatch(
  callType: string,
  userId: string
): Promise<Record<string, unknown> | null> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return null;
  }

  const { data: blocks } = await admin
    .from("blocks")
    .select("blocker_id, blocked_id")
    .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`);
  const blocked = new Set<string>();
  for (const b of blocks ?? []) {
    if (b.blocker_id !== userId) blocked.add(b.blocker_id);
    if (b.blocked_id !== userId) blocked.add(b.blocked_id);
  }

  const { data: existing } = await admin
    .from("matching_queue")
    .select("id, user_id")
    .eq("mode", "random")
    .eq("call_type", callType)
    .eq("status", "waiting")
    .neq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(5);

  const candidate = (existing ?? []).find((e) => !blocked.has(e.user_id)) ?? null;
  if (!candidate) return { matched: false };

  const { data: chat } = await admin
    .from("chat_sessions")
    .insert({ mode: "random", status: "connected", call_type: callType, user1_id: candidate.user_id, user2_id: userId })
    .select("id")
    .single();
  if (!chat) return { matched: false };

  await admin
    .from("matching_queue")
    .update({
      status: "matched", matched_user_id: userId,
      session_id: chat.id, matched_at: new Date().toISOString(),
    })
    .eq("id", candidate.id);

  await admin.from("matching_queue").insert({
    user_id: userId, mode: "random", call_type: callType, status: "matched",
    matched_user_id: candidate.user_id, session_id: chat.id,
    matched_at: new Date().toISOString(),
  });

  // Consume the caller's own waiting row (if any) so it can never be
  // re-matched into a second session later.
  await admin
    .from("matching_queue")
    .update({
      status: "matched", matched_user_id: candidate.user_id,
      session_id: chat.id, matched_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("mode", "random")
    .eq("status", "waiting");

  return { matched: true, session_id: chat.id, peer_id: candidate.user_id };
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  const userId = user.id;
  console.log("[PeerTalks][AUTH] authenticated: true, userId:", userId);
  console.log("[PeerTalks][AUTH] random POST", { userId, callType });

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
  console.log("[PeerTalks][QUEUE] deduction done", {
    userId, idempotent: deduction.idempotent, balance: deduction.balance,
  });

  // Pre-check: if the PEER's RPC already matched us while our previous
  // poll was in flight, return that exact session instead of letting our
  // own RPC match a THIRD user (the duplicate-session race).
  const preMatch = await findOwnRecentMatch(supabase, userId);
  if (preMatch) {
    console.log("[PeerTalks][SESSION] pre-check recovered match made by peer", {
      userId, sessionId: preMatch.session_id, peerId: preMatch.peer_id,
    });
    return NextResponse.json({
      matched: true,
      sessionId: preMatch.session_id,
      peer: { id: preMatch.peer_id },
      balance: deduction.balance,
    });
  }

  // Insert OUR waiting row BEFORE matching (first POST of the attempt only).
  // The RPC pairs us with the OLDEST other waiting row, so our own row must
  // already exist while the RPC runs — otherwise two users who start in the
  // same poll window can both see an empty queue and neither ever matches.
  let queueEntry: { id: number } | null = null;
  if (!deduction.idempotent) {
    const inserted = await supabase
      .from("matching_queue")
      .insert({ user_id: userId, mode: "random", call_type: callType, status: "waiting" })
      .select().single();
    queueEntry = (inserted.data as { id: number } | null) ?? null;
    if (!queueEntry) {
      console.log("[PeerTalks][QUEUE] waiting row", {
        userId, queueId: null, insertFailed: true,
        error: inserted.error ? { code: inserted.error.code, message: inserted.error.message } : null,
      });
      await refundTokens(userId, TOKEN_COSTS.VIDEO_CHAT, undefined, refundKeyFor(requestKey));
      console.log("[PeerTalks][TOKENS] refunded on queue_insert_failed", { userId });
      return NextResponse.json(
        {
          matched: false,
          error: "Could not join the matching queue. Please try again.",
          reason: "queue_insert_failed",
        },
        { status: 500 }
      );
    }
  }

  // Reap waiting rows from killed browsers / abandoned attempts. The RPC
  // pairs with the OLDEST waiting row, so a row left behind by a dead page
  // would otherwise be matched forever after and strand the new peer.
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const admin = createAdminClient();
      await admin
        .from("matching_queue")
        .delete()
        .eq("mode", "random")
        .eq("status", "waiting")
        .lt("created_at", new Date(Date.now() - 120_000).toISOString());
    } catch {
      // Service-role unavailable — own-row cleanup below still applies.
    }
  }

  // Try RPC first
  const rpcResult = await supabase.rpc("find_random_match", { p_user_id: userId, p_call_type: callType });
  const rpcData = rpcResult.data as Record<string, unknown> | null;
  const rpcErr = rpcResult.error;
  console.log("[PeerTalks][MATCH] find_random_match", {
    userId, callType, matched: rpcData?.matched ?? false, data: rpcData,
    error: rpcErr ? { code: rpcErr.code, message: rpcErr.message } : null,
  });

  let matchResult: Record<string, unknown> | null = null;

  if (rpcData?.matched) {
    matchResult = rpcData;
  } else if (rpcErr) {
    // RPC missing (PGRST202) or not executable — try the service-role direct
    // path, then fail loudly instead of pretending we are waiting forever.
    console.error("[PeerTalks][MATCH] find_random_match unavailable", {
      userId, code: rpcErr.code, message: rpcErr.message,
    });
    matchResult = await tryDirectMatch(callType, userId);
    if (matchResult?.matched) {
      console.log("[PeerTalks][SESSION] matched via direct fallback", {
        userId, sessionId: matchResult.session_id, peerId: matchResult.peer_id,
      });
    } else if (matchResult === null) {
      // The queue row was never inserted and the charge is unrecoverable
      // through DELETE (nothing to remove) — refund explicitly so a failed
      // attempt never costs tokens.
      await refundTokens(userId, TOKEN_COSTS.VIDEO_CHAT, undefined, refundKeyFor(requestKey));
      console.log("[PeerTalks][TOKENS] refunded on matchmaking_unavailable", { userId });
      return NextResponse.json(
        {
          matched: false,
          error: "Matchmaking is not available right now. Please try again in a moment.",
          reason: "matchmaking_unavailable",
        },
        { status: 503 }
      );
    } else {
      // RPC missing but direct fallback worked — no candidate yet, keep waiting.
      matchResult = { matched: false };
    }
  } else {
    matchResult = { matched: false };
  }

  // The peer may have matched US between our polls (their RPC flipped our
  // waiting row to matched with a session_id). Pick that up here so we
  // always land on the SAME session both users see.
  if (!matchResult?.matched) {
    const ownMatch = await findOwnRecentMatch(supabase, userId);
    if (ownMatch) {
      console.log("[PeerTalks][SESSION] recovered match made by peer", {
        userId, sessionId: ownMatch.session_id, peerId: ownMatch.peer_id,
      });
      matchResult = { matched: true, session_id: ownMatch.session_id, peer_id: ownMatch.peer_id };
    }
  }

  if (matchResult?.matched) {
    // The deployed find_random_match has no re-match guard, so a peer whose
    // poll overlaps ours can counter-match us into a NEWER session while our
    // own RPC is in flight. Wait a beat, then re-check: the newest own match
    // wins — both users converge on ONE session this way.
    await new Promise((r) => setTimeout(r, 150));
    const ownMatch = await findOwnRecentMatch(supabase, userId);
    if (ownMatch) {
      console.log("[PeerTalks][SESSION] counter-match picked newer session", {
        userId, sessionId: ownMatch.session_id, peerId: ownMatch.peer_id,
      });
      matchResult = { matched: true, session_id: ownMatch.session_id, peer_id: ownMatch.peer_id };
    }
    // Consume our own waiting row so it can never be picked up by a later
    // peer RPC (which would create a SECOND session for us — the RPC only
    // flips the PEER's row and inserts a fresh matched row for the caller).
    await supabase
      .from("matching_queue")
      .update({
        status: "matched",
        matched_user_id: matchResult.peer_id as string,
        session_id: matchResult.session_id as string,
        matched_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("mode", "random")
      .eq("status", "waiting");
    console.log("[PeerTalks][SESSION] matched", {
      userId, sessionId: matchResult.session_id, peerId: matchResult.peer_id,
    });
    return NextResponse.json({
      matched: true,
      sessionId: matchResult.session_id as string,
      peer: { id: matchResult.peer_id as string },
      balance: deduction.balance,
    });
  }

  // No match yet. The waiting row was already inserted above (first POST of
  // the attempt); replays just report the still-queued state.
  return NextResponse.json({
    matched: false,
    queueId: queueEntry?.id ?? null,
    message: "Waiting for a match...",
    balance: deduction.balance,
  });
}

export async function DELETE(request: Request) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  console.log("[PeerTalks][AUTH] random DELETE", { userId: user.id });

  // The attempt's idempotency key (sent by the client's matching page):
  // the refund derives `refund:<key>`, so a retried/duplicated DELETE can
  // never refund the same charge twice (keyless refunds were the
  // POST-commit → DELETE-refund → replay-reinsert → DELETE-refund race).
  const requestKey = parseRequestKey(request);

  // Body flag: the chat room calls this when leaving a session so stale
  // "matched" rows are purged too (they must never resurrect an old
  // session during the next matching attempt). Matched rows are never
  // refunded — the cost was already spent on the actual chat.
  let cleanupMatched = false;
  try {
    const body = await request.json();
    cleanupMatched = body?.cleanupMatched === true;
  } catch {}

  // Refund ONLY when a waiting queue entry was actually removed. A user who
  // already matched (entry status=matched) or already cancelled (no row)
  // must NOT be refunded — otherwise every matched chat refunds itself and
  // a repeated DELETE(double-cancel / page unmount) refunds again.
  const { data: deleted } = await supabase
    .from("matching_queue")
    .delete({ count: "exact" })
    .eq("user_id", user.id)
    .eq("mode", "random")
    .eq("status", "waiting")
    .select("id");

  if (deleted && deleted.length > 0) {
    const refund = await refundTokens(
      user.id,
      TOKEN_COSTS.VIDEO_CHAT,
      undefined,
      requestKey ? refundKeyFor(requestKey) : undefined
    );
    if (cleanupMatched) {
      await supabase
        .from("matching_queue")
        .delete()
        .eq("user_id", user.id)
        .eq("mode", "random")
        .eq("status", "matched");
    }
    return NextResponse.json({ success: refund.success, refunded: true, balance: refund.balance });
  }

  if (cleanupMatched) {
    await supabase
      .from("matching_queue")
      .delete()
      .eq("user_id", user.id)
      .eq("mode", "random")
      .eq("status", "matched");
    console.log("[PeerTalks][QUEUE] purged matched rows", { userId: user.id });
  }

  return NextResponse.json({ success: true, refunded: false });
}
