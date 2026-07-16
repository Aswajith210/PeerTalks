import { createServerSupabaseClient } from "@/lib/supabase/server";
import { deductTokens } from "@/lib/tokens";
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

  const body = await request.json();
  const validationError = validateInput(body, schemas.joinRoom);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const { name, password } = body;

  const { data: room } = await supabase
    .from("private_rooms")
    .select("*")
    .eq("name", name)
    .eq("is_active", true)
    .single();

  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const valid = await bcrypt.compare(password, room.password_hash);
  if (!valid) {
    return NextResponse.json({ error: "Invalid password" }, { status: 403 });
  }

  if (room.guest_id) {
    return NextResponse.json({ error: "Room is full" }, { status: 400 });
  }

  const deduction = await deductTokens(session.user.id, 5, "Private room");
  if (!deduction.success) {
    return NextResponse.json(
      { error: "Insufficient tokens", balance: deduction.balance },
      { status: 400 }
    );
  }

  await supabase
    .from("private_rooms")
    .update({ guest_id: session.user.id })
    .eq("id", room.id);

  const { data: chatSession } = await supabase
    .from("chat_sessions")
    .insert({
      mode: "private_room",
      status: "connected",
      user1_id: room.host_id,
      user2_id: session.user.id,
      room_id: room.id,
    })
    .select()
    .single();

  return NextResponse.json({
    room,
    session: chatSession,
  });
}
