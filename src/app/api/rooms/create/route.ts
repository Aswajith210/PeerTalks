import { createServerSupabaseClient } from "@/lib/supabase/server";
import { deductTokens, refundTokens, parseRequestKey, refundKeyFor } from "@/lib/tokens";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { validateInput, schemas } from "@/lib/validations";

async function refundOnError(userId: string, requestKey: string) {
  await refundTokens(userId, 5, undefined, refundKeyFor(requestKey));
}

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
  const validationError = validateInput(body, schemas.createRoom);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const { name, password, capacity } = body;
  if (
    capacity !== undefined &&
    (!Number.isInteger(capacity) || capacity < 2 || capacity > 8)
  ) {
    return NextResponse.json(
      { error: "Room capacity must be between 2 and 8" },
      { status: 400 }
    );
  }

  const callType = request.headers.get("x-call-type") ?? "video";
  if (callType !== "video" && callType !== "text") {
    return NextResponse.json({ error: "Invalid call type" }, { status: 400 });
  }

  const deduction = await deductTokens(
    user.id,
    5,
    "Private room",
    undefined,
    requestKey
  );
  if (!deduction.success) {
    console.error("[tokens] room create blocked", {
      userId: user.id, cost: 5, balance: deduction.balance, reason: deduction.reason,
    });
    return NextResponse.json(
      { error: "Insufficient tokens", balance: deduction.balance, reason: deduction.reason },
      { status: 400 }
    );
  }
  console.log("[PeerTalks][TOKENS] room create deducted", {
    userId: user.id, idempotent: deduction.idempotent, balance: deduction.balance,
  });

  const passwordHash = await bcrypt.hash(password, 10);

  // Capacity is part of the 00011 migration. When the column is not yet
  // deployed, PostgREST answers 42703 — retry WITHOUT it so the room still
  // gets created at the default capacity (2). capacity_supported tells the
  // client which world it is in.
  let capacityStored = false;
  let room: { id: string } | null = null;
  let roomError: { code?: string } | null = null;
  const attempt: {
    data: { id: string } | null;
    error: { code?: string } | null;
  } = await supabase
    .from("private_rooms")
    .insert({
      name,
      password_hash: passwordHash,
      host_id: user.id,
      ...(typeof capacity === "number" ? { capacity } : {}),
    })
    .select(
      "id, name, host_id, guest_id, is_active, created_at, ended_at" +
        (typeof capacity === "number" ? ", capacity" : "")
    )
    .single();
  room = attempt.data;
  roomError = attempt.error;

  if (!room && (roomError?.code === "42703" || roomError?.code === "PGRST204")) {
    // capacity column not deployed — degrade to the default of 2.
    const retry = await supabase
      .from("private_rooms")
      .insert({ name, password_hash: passwordHash, host_id: user.id })
      .select("id, name, host_id, guest_id, is_active, created_at, ended_at")
      .single();
    room = retry.data;
    roomError = retry.error;
  } else if (room) {
    capacityStored = true;
  }

  if (!room) {
    // Only refund when THIS request actually charged — an idempotent replay
    // (network retry of a committed create) must not be refunded again or
    // the user would mint tokens.
    if (!deduction.idempotent) {
      await refundOnError(user.id, requestKey);
    }
    if (roomError?.code === "23505") {
      return NextResponse.json(
        { error: "A room with this name already exists. Choose another name." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Failed to create room" }, { status: 500 });
  }

  const { data: chatSession } = await supabase
    .from("chat_sessions")
    .insert({
      mode: "private_room",
      status: "waiting",
      call_type: callType,
      user1_id: user.id,
      room_id: room.id.toString(),
    })
    .select()
    .single();

  if (!chatSession) {
    // Room created but session failed — clean up
    await supabase.from("private_rooms").delete().eq("id", room.id);
    if (!deduction.idempotent) {
      await refundOnError(user.id, requestKey);
    }
    return NextResponse.json({ error: "Failed to create chat session" }, { status: 500 });
  }

  return NextResponse.json({
    room,
    session: chatSession,
    balance: deduction.balance,
    capacity_supported: capacityStored,
  });
}
