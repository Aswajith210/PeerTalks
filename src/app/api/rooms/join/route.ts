import { createServerSupabaseClient } from "@/lib/supabase/server";
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

  const { data: roomRow } = await supabase
    .from("private_rooms")
    .select("id, name, password_hash, host_id, guest_id, is_active, created_at, ended_at")
    .eq("name", name)
    .eq("is_active", true)
    .single();

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

  // Try RPC first (security definer bypasses RLS)
  const { data: joinResult, error: joinError } = await supabase
    .rpc("join_private_room_as_guest", {
      p_room_id: room.id,
      p_guest_id: session.user.id,
    });

  if (!joinError && joinResult?.success) {
    return NextResponse.json({
      room,
      session: { id: joinResult.session_id },
      balance: deduction.balance,
    });
  }

  // Failure after the 5-token charge — refund so the user only pays when
  // the private session actually starts.
  if (joinError) {
    if (joinError.code === "PGRST202") {
      // Function not deployed — fall through to direct updates below.
    } else {
      await refundTokens(session.user.id, 5, undefined, refundKeyFor(requestKey));
      return NextResponse.json(
        { error: "Failed to join room" },
        { status: 500 }
      );
    }
  } else if (!joinResult?.success) {
    await refundTokens(session.user.id, 5, undefined, refundKeyFor(requestKey));
    return NextResponse.json(
      { error: joinResult?.error ?? "Room not found or already full" },
      { status: 400 }
    );
  }

  // Fallback: direct update
  const { error: updateError } = await supabase
    .from("private_rooms")
    .update({ guest_id: session.user.id })
    .eq("id", room.id)
    .eq("is_active", true)
    .is("guest_id", null);

  if (updateError) {
    await refundTokens(session.user.id, 5, undefined, refundKeyFor(requestKey));
    return NextResponse.json({ error: "Failed to join room" }, { status: 500 });
  }

  // Find or create chat session
  const { data: existingSession } = await supabase
    .from("chat_sessions")
    .select("id")
    .eq("room_id", room.id.toString())
    .eq("status", "waiting")
    .maybeSingle();

  let sessionId: string;

  if (existingSession) {
    const { data: updated } = await supabase
      .from("chat_sessions")
      .update({ status: "connected", user2_id: session.user.id })
      .eq("id", existingSession.id)
      .select("id")
      .single();
    sessionId = updated?.id ?? existingSession.id;
  } else {
    const { data: newSession } = await supabase
      .from("chat_sessions")
      .insert({
        mode: "private_room", status: "connected",
        user1_id: room.host_id, user2_id: session.user.id,
        room_id: room.id.toString(),
      })
      .select("id")
      .single();
    sessionId = newSession?.id;
  }

  if (!sessionId) {
    await refundTokens(session.user.id, 5, undefined, refundKeyFor(requestKey));
    return NextResponse.json({ error: "Failed to create chat session" }, { status: 500 });
  }

  return NextResponse.json({
    room,
    session: { id: sessionId },
    balance: deduction.balance,
  });
}
