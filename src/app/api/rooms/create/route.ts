import { createServerSupabaseClient } from "@/lib/supabase/server";
import { deductTokens } from "@/lib/tokens";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { validateInput, schemas } from "@/lib/validations";

async function refundOnError(supabase: NonNullable<Awaited<ReturnType<typeof createServerSupabaseClient>>>, userId: string) {
  await supabase.rpc("deduct_tokens", {
    p_user_id: userId,
    p_amount: -5,
    p_type: "refund",
    p_description: "Room creation failed - token refund",
    p_session_id: null,
  });
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

  const body = await request.json();
  const validationError = validateInput(body, schemas.createRoom);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const { name, password } = body;

  const deduction = await deductTokens(session.user.id, 5, "Private room");
  if (!deduction.success) {
    return NextResponse.json(
      { error: "Insufficient tokens", balance: deduction.balance },
      { status: 400 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const { data: room } = await supabase
    .from("private_rooms")
    .insert({
      name,
      password_hash: passwordHash,
      host_id: session.user.id,
    })
    .select()
    .single();

  if (!room) {
    await refundOnError(supabase, session.user.id);
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
    await refundOnError(supabase, session.user.id);
    return NextResponse.json({ error: "Failed to create chat session" }, { status: 500 });
  }

  return NextResponse.json({ room, session: chatSession });
}
