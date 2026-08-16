import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deductTokens, refundTokens, parseRequestKey, refundKeyFor } from "@/lib/tokens";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { validateInput, schemas } from "@/lib/validations";

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requestKey = parseRequestKey(request);
  if (!requestKey) {
    return NextResponse.json({ error: "Missing or invalid idempotency key" }, { status: 400 });
  }

  const body = await request.json();
  const validationError = validateInput(body, schemas.joinRoom);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const { name, password } = body;
  const callType = request.headers.get("x-call-type") ?? "video";
  if (callType !== "video" && callType !== "text") {
    return NextResponse.json({ error: "Invalid call type" }, { status: 400 });
  }

  // Room lookup via SECURITY DEFINER RPC: private_rooms RLS only lets
  // host/guest SELECT rows, so a prospective guest (guest_id still null)
  // sees zero rows with the authenticated client — exactly the reason this
  // used to need the service-role key. The RPC does the same cross-user
  // lookup under definer rights AND verifies the bcrypt password inside
  // Postgres (pgcrypto crypt), so the route needs no elevated key and the
  // password_hash never leaves the database.
  let { data: lookup, error: lookupError } = await supabase.rpc("lookup_private_room", {
    p_name: name,
    p_password: password,
  });

  // RPC not deployed (PGRST202) — fall back to the service-role lookup.
  // Same semantics: the admin client fetches the row, bcrypt.compare runs
  // server-side in Node, and the hash is stripped before any response.
  if (lookupError?.code === "PGRST202") {
    let admin;
    try {
      admin = createAdminClient();
    } catch {
      return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
    }
    const fallback = await admin
      .from("private_rooms")
      .select("id, name, password_hash, host_id, guest_id, is_active, created_at, ended_at")
      .eq("name", name)
      .eq("is_active", true)
      .single();
    lookupError = fallback.error;
    if (!fallback.error && fallback.data) {
      const rr = fallback.data;
      const passwordValid = await bcrypt.compare(password, rr.password_hash);
      lookup = {
        found: true,
        password_valid: passwordValid,
        room: {
          id: rr.id,
          name: rr.name,
          host_id: rr.host_id,
          guest_id: rr.guest_id,
          is_active: rr.is_active,
          created_at: rr.created_at,
          ended_at: rr.ended_at,
        },
      };
    } else {
      lookup = null;
    }
  }

  if (lookupError && lookupError.code !== "PGRST202") {
    return NextResponse.json({ error: "Failed to look up room" }, { status: 500 });
  }

  if (!lookup?.found) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  if (!lookup.password_valid) {
    return NextResponse.json({ error: "Invalid password" }, { status: 403 });
  }

  const room = lookup.room;

  if (room.guest_id) {
    return NextResponse.json({ error: "Room is full" }, { status: 400 });
  }

  const deduction = await deductTokens(
    user.id,
    5,
    "Private room",
    undefined,
    requestKey
  );
  if (!deduction.success) {
    console.error("[tokens] room join blocked", {
      userId: user.id, cost: 5, balance: deduction.balance, reason: deduction.reason,
    });
    return NextResponse.json(
      { error: "Insufficient tokens", balance: deduction.balance, reason: deduction.reason },
      { status: 400 }
    );
  }
  console.log("[PeerTalks][TOKENS] room join deducted", {
    userId: user.id, idempotent: deduction.idempotent, balance: deduction.balance,
  });

  // Try RPC first (security definer bypasses RLS)
  const { data: joinResult, error: joinError } = await supabase
    .rpc("join_private_room_as_guest", {
      p_room_id: room.id,
      p_guest_id: user.id,
    });

  if (!joinError && joinResult?.success) {
    // The RPC (older signature) creates the session without a call_type
    // when no waiting session exists — normalize it to the requested type.
    await supabase
      .from("chat_sessions")
      .update({ call_type: callType })
      .eq("id", joinResult.session_id)
      .neq("call_type", callType);
    return NextResponse.json({
      room,
      session: { id: joinResult.session_id },
      balance: deduction.balance,
    });
  }

  // Failure after the 5-token charge — refund so the user only pays when
  // the private session actually starts. Idempotent replays never refund
  // (a replay of a committed join must not mint tokens).
  const refundCharge = async () => {
    if (!deduction.idempotent) {
      await refundTokens(user.id, 5, undefined, refundKeyFor(requestKey));
    }
  };

  if (joinError) {
    if (joinError.code === "PGRST202") {
      // Function not deployed — fall through to direct updates below.
    } else {
      await refundCharge();
      return NextResponse.json(
        { error: "Failed to join room" },
        { status: 500 }
      );
    }
  } else if (!joinResult?.success) {
    await refundCharge();
    return NextResponse.json(
      { error: joinResult?.error ?? "Room not found or already full" },
      { status: 400 }
    );
  }

  // Fallback: direct update (service-role client — the guest update and the
  // session writes below are RLS-restricted to the host/participants).
  // The `.is("guest_id", null)` guard makes the update a CAS: two
  // concurrent guests racing here — both passed the pre-checks — can only
  // have ONE of them match a row. Select the row back so the loser is
  // detected instead of silently creating a second session (room capacity
  // is exactly one guest). Only runs when the RPCs above are missing
  // (PGRST202); needs the server-side service-role key.
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    await refundCharge();
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }

  const { data: assigned, error: updateError } = await admin
    .from("private_rooms")
    .update({ guest_id: user.id })
    .eq("id", room.id)
    .eq("is_active", true)
    .is("guest_id", null)
    .select("id")
    .maybeSingle();

  if (updateError) {
    await refundCharge();
    return NextResponse.json({ error: "Failed to join room" }, { status: 500 });
  }
  if (!assigned) {
    // Another guest won the race — the room is full for this request.
    await refundCharge();
    return NextResponse.json({ error: "Room is full" }, { status: 400 });
  }

  // Find or create chat session
  const { data: existingSession } = await admin
    .from("chat_sessions")
    .select("id")
    .eq("room_id", room.id.toString())
    .eq("status", "waiting")
    .maybeSingle();

  let sessionId: string;

  if (existingSession) {
    const { data: updated } = await admin
      .from("chat_sessions")
      .update({ status: "connected", user2_id: user.id, call_type: callType })
      .eq("id", existingSession.id)
      .select("id")
      .single();
    sessionId = updated?.id ?? existingSession.id;
  } else {
    const { data: newSession } = await admin
      .from("chat_sessions")
      .insert({
        mode: "private_room", status: "connected",
        call_type: callType,
        user1_id: room.host_id, user2_id: user.id,
        room_id: room.id.toString(),
      })
      .select("id")
      .single();
    sessionId = newSession?.id;
  }

  if (!sessionId) {
    await refundCharge();
    return NextResponse.json({ error: "Failed to create chat session" }, { status: 500 });
  }

  return NextResponse.json({
    room,
    session: { id: sessionId },
    balance: deduction.balance,
  });
}
