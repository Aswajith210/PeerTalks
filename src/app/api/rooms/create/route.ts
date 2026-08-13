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
  const validationError = validateInput(body, schemas.createRoom);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const { name, password } = body;

  const deduction = await deductTokens(
    session.user.id,
    5,
    "Private room",
    undefined,
    requestKey
  );
  if (!deduction.success) {
    console.error("[tokens] room create blocked", {
      userId: session.user.id, cost: 5, balance: deduction.balance, reason: deduction.reason,
    });
    return NextResponse.json(
      { error: "Insufficient tokens", balance: deduction.balance, reason: deduction.reason },
      { status: 400 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const { data: room, error: roomError } = await supabase
    .from("private_rooms")
    .insert({
      name,
      password_hash: passwordHash,
      host_id: session.user.id,
    })
    .select()
    .single();

  if (!room) {
    await refundOnError(session.user.id, requestKey);
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
      user1_id: session.user.id,
      room_id: room.id,
    })
    .select()
    .single();

  if (!chatSession) {
    // Room created but session failed — clean up
    await supabase.from("private_rooms").delete().eq("id", room.id);
    await refundOnError(session.user.id, requestKey);
    return NextResponse.json({ error: "Failed to create chat session" }, { status: 500 });
  }

  return NextResponse.json({ room, session: chatSession, balance: deduction.balance });
}
