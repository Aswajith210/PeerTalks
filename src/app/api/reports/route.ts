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
  const reportedUserId = String(body.reportedUserId ?? "");
  const reason = String(body.reason ?? "").trim();
  const sessionId = body.sessionId ? String(body.sessionId) : null;

  if (!reportedUserId) return NextResponse.json({ error: "reportedUserId is required" }, { status: 400 });
  if (reportedUserId === session.user.id) return NextResponse.json({ error: "You cannot report yourself" }, { status: 400 });
  if (reason.length < 1 || reason.length > 500) return NextResponse.json({ error: "Reason must be 1-500 characters" }, { status: 400 });
  if (!UUID_RE.test(reportedUserId)) return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  if (sessionId && !UUID_RE.test(sessionId)) return NextResponse.json({ error: "Invalid session id" }, { status: 400 });

  const { data, error } = await supabase
    .from("reports")
    .insert({ reporter_id: session.user.id, reported_user_id: reportedUserId, session_id: sessionId, reason })
    .select()
    .single();

  if (error) return NextResponse.json({ error: "Failed to submit report" }, { status: 500 });
  return NextResponse.json({ success: true, report: data });
}