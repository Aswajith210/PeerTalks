import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deductTokens, refundTokens, parseRequestKey, refundKeyFor } from "@/lib/tokens";
import { TOKEN_COSTS, MATCHING_TIMEOUT_MS } from "@/lib/constants";
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

/**
 * Recovery record: when the PEER's RPC matched us, our own queue row flips
 * to status=matched with a session_id — but our own RPC never sees it
 * (it only scans other users' rows). Without this check we depend entirely
 * on a realtime event that may not be configured, leaving us on
 * "Looking for someone" forever. The recency window + non-ended session
 * guard rejects stale matched rows from earlier abandoned attempts.
 */
async function findOwnRecentMatch(
  supabase: NonNullable<Awaited<ReturnType<typeof createServerSupabaseClient>>>,
  userId: string
): Promise<{ session_id: string; peer_id: string } | null> {
  const { data: own } = await supabase
    .from("matching_queue")
    .select("session_id, matched_user_id")
    .eq("user_id", userId)
    .eq("mode", "interest")
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
  // Ended sessions (or ones the peer never joined) are stale — never
  // resurrect them.
  if (!session || session.status === "ended" || !session.user2_id) return null;

  return { session_id: own.session_id, peer_id: own.matched_user_id };
}

/**
 * Direct-query pairing used ONLY when the find_interest_match RPC is missing
 * from the database (PGRST202). Requires SUPABASE_SERVICE_ROLE_KEY server-side
 * (never exposed to the browser); RLS would hide other users' queue rows from
 * the anon client, which made the old fallback match nobody.
 *
 * Matching is case-insensitive on the overlap so chips ("Gaming") and typed
 * interests ("gaming") pair. Returns null when the fallback is unavailable,
 * { matched: false } when nobody is waiting, or a matched payload.
 */
async function tryDirectMatch(
  callType: string,
  userId: string,
  interests: string[]
): Promise<Record<string, unknown> | null> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return null;
  }

  const mine = new Set(interests.map((i) => i.toLowerCase().trim()));

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
    .select("id, user_id, interests, status")
    .eq("mode", "interest")
    .eq("call_type", callType)
    .eq("status", "waiting")
    .neq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(20);

  const candidate = (existing ?? []).find((e) => {
    if (blocked.has(e.user_id)) return false;
    const theirs = (e.interests as string[] | null) ?? [];
    return theirs.some((t) => mine.has(t.toLowerCase().trim()));
  }) ?? null;
  if (!candidate) return { matched: false };

  // Safety: if the candidate's row is no longer "waiting" (e.g. already
  // matched by a concurrent direct-match or RPC), abort this attempt.
  if (candidate.status !== "waiting") return { matched: false };

  // Fix: lock the candidate's waiting row before inserting a session, to
  // prevent two parallel direct-match requests from both succeeding.
  // Crucial: .eq("status", "waiting") ensures this UPDATE only succeeds if
  // the row is still in the expected state. If another request already changed
  // the status, this UPDATE affects 0 rows and .single() throws, which we
  // catch below to return { matched: false } safely.
  try {
    await admin
      .from("matching_queue")
      .update({
        status: "matched", matched_user_id: userId,
        session_id: null, matched_at: null,
      })
      .eq("id", candidate.id)
      .eq("status", "waiting")  // <--- ONLY update if still waiting
      .select()
      .single();
  } catch {
    // The row was no longer "waiting" (concurrent request already matched it).
    return { matched: false };
  }

  const { data: chat } = await admin
    .from("chat_sessions")
    .insert({ mode: "interest", status: "connected", call_type: callType, user1_id: candidate.user_id, user2_id: userId })
    .select("id")
    .single();
  if (!chat) {
    // Roll back the lock
    await admin
      .from("matching_queue")
      .update({
        status: "waiting", matched_user_id: null, session_id: null, matched_at: null,
      })
      .eq("id", candidate.id);
    return { matched: false };
  }

  await admin
    .from("matching_queue")
    .update({
      status: "matched", matched_user_id: userId,
      session_id: chat.id, matched_at: new Date().toISOString(),
    })
    .eq("id", candidate.id);

  await admin.from("matching_queue").insert({
    user_id: userId, mode: "interest", call_type: callType, interests: [...mine],
    status: "matched", matched_user_id: candidate.user_id, session_id: chat.id,
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
    .eq("mode", "interest")
    .eq("status", "waiting");

  const matchedInterest =
    ((candidate.interests as string[] | null) ?? []).find((t) => mine.has(t.toLowerCase().trim())) ?? "";
  return { matched: true, session_id: chat.id, peer_id: candidate.user_id, matched_interest: matchedInterest };
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  const { interests: rawInterests } = body;
  const userId = user.id;
  console.log("[PeerTalks][Auth] interest POST", { userId });

  // Per-item validation: a non-string item (e.g. a number) would throw in
  // the normalization below and 500 the route; oversize items bloat the
  // queue rows. Max 60 chars per interest.
  if (
    !Array.isArray(rawInterests) ||
    rawInterests.some(
      (i) => typeof i !== "string" || i.trim().length === 0 || i.trim().length > 60
    )
  ) {
    return NextResponse.json(
      { error: "Interests must be non-empty strings up to 60 characters" },
      { status: 400 }
    );
  }

  // Normalize once: the find_interest_match RPC compares interests with
  // exact equality, so chips ("Gaming") and typed entries ("gaming") must
  // share one casing. Lowercase+trim here so the queue row, the RPC call
  // and user_interests are all consistent.
  const interests = (rawInterests as string[]).map((i: string) => i.toLowerCase().trim());

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
    console.error("[tokens] interest chat blocked", {
      userId, cost: TOKEN_COSTS.VIDEO_CHAT, balance: deduction.balance, reason: deduction.reason,
    });
    return NextResponse.json({ error: "Insufficient tokens", balance: deduction.balance, reason: deduction.reason }, { status: 400 });
  }
  console.log("[PeerTalks][Queue] deduction done", {
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
      matchedInterest: "",
      balance: deduction.balance,
    });
  }

  // Insert OUR waiting row BEFORE matching (first POST of the attempt only)
  // so the RPC — or a peer's RPC — can pair us in the same poll window.
  let queueEntry: { id: number } | null = null;
  if (!deduction.idempotent) {
    const inserted = await supabase
      .from("matching_queue")
      .insert({ user_id: userId, mode: "interest", call_type: callType, interests, status: "waiting" })
      .select().single();
    queueEntry = (inserted.data as { id: number } | null) ?? null;
    if (!queueEntry) {
      console.log("[PeerTalks][Queue] waiting row", {
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

  // Reap waiting rows from killed browsers / abandoned attempts.
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const admin = createAdminClient();
      await admin
        .from("matching_queue")
        .delete()
        .eq("mode", "interest")
        .eq("status", "waiting")
        .lt("created_at", new Date(Date.now() - 120_000).toISOString());
    } catch {
      // Service-role unavailable — own-row cleanup still applies.
    }
  }

  let matchResult: Record<string, unknown> | null = null;

  // Try RPC first
  const rpcResult = await supabase.rpc("find_interest_match", { p_user_id: userId, p_interests: interests, p_call_type: callType });
  const rpcData = rpcResult.data as Record<string, unknown> | null;
  const rpcErr = rpcResult.error;
  console.log("[PeerTalks][Match RPC] find_interest_match", {
    userId, callType, interests, matched: rpcData?.matched ?? false, data: rpcData,
    error: rpcErr ? { code: rpcErr.code, message: rpcErr.message } : null,
  });

  if (rpcData?.matched) {
    matchResult = rpcData;
  } else if (rpcErr) {
    // RPC missing (PGRST202) or not executable — try the service-role direct
    // path, then fail loudly instead of pretending we are waiting forever.
    console.error("[PeerTalks][Match RPC] find_interest_match unavailable", {
      userId, code: rpcErr.code, message: rpcErr.message,
    });
    matchResult = await tryDirectMatch(callType, userId, interests);
    if (matchResult?.matched) {
      console.log("[PeerTalks][Session] matched via direct fallback", {
        userId, sessionId: matchResult.session_id, peerId: matchResult.peer_id,
      });
    } else if (matchResult === null) {
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
  // waiting row to matched with a session_id). Pick that up so we always
  // land on the SAME session both users see.
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
    // The deployed find_interest_match has no re-match guard, so a peer whose
    // poll overlaps ours can counter-match us into a NEWER session while our
    // own RPC is in flight. Wait a beat, then re-check: the newest own match
    // wins — both users converge on ONE session this way.
    const matchedInterest = (matchResult.matched_interest as string) ?? "";
    await new Promise((r) => setTimeout(r, 150));
    const ownMatch = await findOwnRecentMatch(supabase, userId);
    if (ownMatch) {
      console.log("[PeerTalks][SESSION] counter-match picked newer session", {
        userId, sessionId: ownMatch.session_id, peerId: ownMatch.peer_id,
      });
      matchResult = { matched: true, session_id: ownMatch.session_id, peer_id: ownMatch.peer_id };
    }
    // Consume our own waiting row so it can never be re-matched into a
    // second session later.
    await supabase
      .from("matching_queue")
      .update({
        status: "matched",
        matched_user_id: matchResult.peer_id as string,
        session_id: matchResult.session_id as string,
        matched_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("mode", "interest")
      .eq("status", "waiting");
    console.log("[PeerTalks][Session] matched via RPC", {
      userId, sessionId: matchResult.session_id, peerId: matchResult.peer_id,
    });
    return NextResponse.json({
      matched: true,
      sessionId: matchResult.session_id as string,
      matchedInterest,
      balance: deduction.balance,
    });
  }

  // No match yet — the waiting row was already inserted above.
  return NextResponse.json({
    matched: false,
    queueId: queueEntry?.id ?? null,
    message: "Looking for someone who shares your interests...",
    balance: deduction.balance,
  });
}

export async function DELETE(request: Request) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  console.log("[PeerTalks][Auth] interest DELETE", { userId: user.id });

  // The attempt's idempotency key — the refund derives `refund:<key>` so a
  // duplicated DELETE can never refund the same charge twice (see random).
  const requestKey = parseRequestKey(request);

  let cleanupMatched = false;
  try {
    const body = await request.json();
    cleanupMatched = body?.cleanupMatched === true;
  } catch {}

  // Refund ONLY when a waiting entry was actually removed (see random route).
  const { data: deleted } = await supabase
    .from("matching_queue")
    .delete({ count: "exact" })
    .eq("user_id", user.id)
    .eq("mode", "interest")
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
        .eq("mode", "interest")
        .eq("status", "matched");
    }
    return NextResponse.json({ success: refund.success, refunded: true, balance: refund.balance });
  }

  if (cleanupMatched) {
    await supabase
      .from("matching_queue")
      .delete()
      .eq("user_id", user.id)
      .eq("mode", "interest")
      .eq("status", "matched");
    console.log("[PeerTalks][Queue] purged matched rows", { userId: user.id });
  }

  return NextResponse.json({ success: true, refunded: false });
}