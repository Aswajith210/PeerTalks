import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const messageId = Number(body.messageId);
  const reaction = String(body.reaction ?? "").trim();

  if (!messageId || messageId <= 0) return NextResponse.json({ error: "messageId is required" }, { status: 400 });
  if (!reaction || reaction.length > 16) return NextResponse.json({ error: "Invalid reaction" }, { status: 400 });

  // Check the message exists and the user is a session participant
  const { data: message } = await supabase
    .from("messages")
    .select("id, session_id")
    .eq("id", messageId)
    .single();

  if (!message) return NextResponse.json({ error: "Message not found" }, { status: 404 });

  const { data: chatSession } = await supabase
    .from("chat_sessions")
    .select("id")
    .eq("id", message.session_id)
    .or(`user1_id.eq.${user.id},user2_id.eq.${user.id}`)
    .maybeSingle();

  if (!chatSession) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { error } = await supabase
    .from("message_reactions")
    .upsert(
      { message_id: messageId, user_id: user.id, reaction },
      { onConflict: "message_id, user_id" }
    );

  if (error) return NextResponse.json({ error: "Failed to add reaction" }, { status: 500 });
  return NextResponse.json({ success: true });
}

export async function DELETE(request: Request) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const messageId = Number(body.messageId);

  if (!messageId || messageId <= 0) return NextResponse.json({ error: "messageId is required" }, { status: 400 });

  const { error } = await supabase
    .from("message_reactions")
    .delete()
    .eq("message_id", messageId)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: "Failed to remove reaction" }, { status: 500 });
  return NextResponse.json({ success: true });
}