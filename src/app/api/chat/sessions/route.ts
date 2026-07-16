import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { validateInput, schemas } from "@/lib/validations";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");

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

  if (sessionId) {
    const { data } = await supabase
      .from("chat_sessions")
      .select("*, messages(*)")
      .eq("id", sessionId)
      .single();

    return NextResponse.json(data);
  }

  const { data: sessions } = await supabase
    .from("chat_sessions")
    .select("*")
    .or(`user1_id.eq.${session.user.id},user2_id.eq.${session.user.id}`)
    .order("created_at", { ascending: false })
    .limit(20);

  return NextResponse.json(sessions ?? []);
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
  const validationError = validateInput(body, schemas.endSession);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const { sessionId } = body;

  const { data: chatSession } = await supabase
    .from("chat_sessions")
    .update({
      status: "ended",
      ended_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .select()
    .single();

  return NextResponse.json(chatSession);
}
