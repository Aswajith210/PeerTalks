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
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
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
  // lookup under definer rights, so the user session suffices.
  let { data: roomRow, error: lookupError } = await supabase.rpc("lookup_private_room", {
    p_name: name,
  });

  // RPC not deployed (PGRST202) — fall back to the service-role lookup.
  if (lookupError?.code === "PGRST202") {
    let admin;
    try {
      admin = createAdminClient();
    } catch {
      return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
    }
    const lookup = await admin
      .from("private_rooms")
      .select("id, name, password_hash, host_id, guest_id, is_active, created_at, ended_at")
      .eq("name", name)
      .eq("is_active", true)
      .single();
    roomRow = lookup.data ?? null;
    lookupError = lookup.error;
  }

  if (lookupError && lookupError.code !== "PGRST202") {
    return NextResponse.json({ error: "Failed to look up room" }, { status: 500 });
  }

  // Never expose password_hash to the client — strip it before any return.
  const room = roomRow
    ? {
        id: roomRow.id,
        name: roomRow.name,
        host_id: roomRow.host_id,
        guest_id: roomRow.guest_id,
        is_active: roomRow.is_active,
        created_at: roomRow.created_at,
        ended_at: roomRow.ended_at,
      }
    : null;

  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const valid = await bcrypt.compare(password, roomRow!.password_hash);
  if (!valid) {
    return NextResponse.json({ error: "Invalid password" }, { status: 403 });
  }

  if (room.guest_id) {
    return NextResponse.json({ error: "Room is full" }, { status: 400 });
  }

  const deduction = await deductTokens(
    session.user.id,
    5,
    "Private room",
    undefined,
    requestKey
  );
  if (!deduction.success) {
    console.error("[tokens] room join blocked", {
      userId: session.user.id, cost: 5, balance: deduction.balance, reason: deduction.reason,
    });
    return NextResponse.json(
      { error: "Insufficient tokens", balance: deduction.balance, reason: deduction.reason },
      { status: 400 }
    );
  }
  console.log("[PeerTalks][TOKENS] room join deducted", {
    userId: session.user.id, idempotent: deduction.idempotent, balance: deduction.balance,
  });

  // Try RPC first (security definer bypasses RLS)
  const { data: joinResult, error: joinError } = await supabase
    .rpc("join_private_room_as_guest", {
      p_room_id: room.id,
      p_guest_id: session.user.id,
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
      await refundTokens(session.user.id, 5, undefined, refundKeyFor(requestKey));
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
    .update({ guest_id: session.user.id })
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
      .update({ status: "connected", user2_id: session.user.id, call_type: callType })
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
        user1_id: room.host_id, user2_id: session.user.id,
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
