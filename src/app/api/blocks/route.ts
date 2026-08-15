import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const blockedId = String(body.blockedUserId ?? "");

  if (!blockedId) return NextResponse.json({ error: "blockedUserId is required" }, { status: 400 });
  if (blockedId === session.user.id) return NextResponse.json({ error: "You cannot block yourself" }, { status: 400 });
  if (!UUID_RE.test(blockedId)) return NextResponse.json({ error: "Invalid user id" }, { status: 400 });

  const { data, error } = await supabase
    .from("blocks")
    .upsert(
      { blocker_id: session.user.id, blocked_id: blockedId },
      { onConflict: "blocker_id, blocked_id" }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: "Failed to block user" }, { status: 500 });
  return NextResponse.json({ success: true, block: data });
}

export async function DELETE(request: Request) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const blockedId = String(body.blockedUserId ?? "");

  if (!blockedId) return NextResponse.json({ error: "blockedUserId is required" }, { status: 400 });
  if (!UUID_RE.test(blockedId)) return NextResponse.json({ error: "Invalid user id" }, { status: 400 });

  const { error } = await supabase
    .from("blocks")
    .delete()
    .eq("blocker_id", session.user.id)
    .eq("blocked_id", blockedId);

  if (error) return NextResponse.json({ error: "Failed to unblock user" }, { status: 500 });
  return NextResponse.json({ success: true });
}