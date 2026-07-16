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

  return NextResponse.json(room);
}
