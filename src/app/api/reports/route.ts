import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const reportedUserId = String(body.reportedUserId ?? "");
  const reason = String(body.reason ?? "").trim();
  const sessionId = body.sessionId ? String(body.sessionId) : null;

  if (!reportedUserId) return NextResponse.json({ error: "reportedUserId is required" }, { status: 400 });
  if (reportedUserId === user.id) return NextResponse.json({ error: "You cannot report yourself" }, { status: 400 });
  if (reason.length < 1 || reason.length > 500) return NextResponse.json({ error: "Reason must be 1-500 characters" }, { status: 400 });
  if (!UUID_RE.test(reportedUserId)) return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  if (sessionId && !UUID_RE.test(sessionId)) return NextResponse.json({ error: "Invalid session id" }, { status: 400 });

  // A report must reference a session this user actually participated in —
  // otherwise anyone could file reports (with fabricated session context)
  // against users they never met.
  if (sessionId) {
    const { data: session } = await supabase
      .from("chat_sessions")
      .select("id")
      .eq("id", sessionId)
      .or(`user1_id.eq.${user.id},user2_id.eq.${user.id}`)
      .maybeSingle();
    if (!session) {
      return NextResponse.json(
        { error: "You can only report users within a session you joined" },
        { status: 403 }
      );
    }
  }

  // Dedup: one active report per reporter -> user. Repeated submissions
  // would otherwise spam the moderation queue with the same accusation.
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: existing } = await supabase
    .from("reports")
    .select("id")
    .eq("reporter_id", user.id)
    .eq("reported_user_id", reportedUserId)
    .gte("created_at", dayAgo)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      { error: "You already reported this user recently" },
      { status: 409 }
    );
  }

  const { data, error } = await supabase
    .from("reports")
    .insert({ reporter_id: user.id, reported_user_id: reportedUserId, session_id: sessionId, reason })
    .select()
    .single();

  if (error) return NextResponse.json({ error: "Failed to submit report" }, { status: 500 });
  return NextResponse.json({ success: true, report: data });
}