import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { validateInput, schemas } from "@/lib/validations";

/**
 * Server-side profile persistence.
 *
 * The browser never decides which user's row is written: the user id always
 * comes from the authenticated session, and the body's `id` field (if any) is
 * ignored. RLS on public.profiles additionally binds every read/write to
 * auth.uid(), so one user can never touch another user's row.
 */

export async function GET() {
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

  const { data } = await supabase
    .from("profiles")
    .select("display_name, bio")
    .eq("id", user.id)
    .maybeSingle();

  return NextResponse.json({ profile: data ?? null });
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

  const body = await request.json().catch(() => null);
  const validationError = validateInput(body, schemas.updateProfile);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const { displayName, bio } = body as { displayName: string; bio: string };

  const { data: saved, error } = await supabase
    .from("profiles")
    .upsert(
      {
        id: user.id,
        display_name: displayName.trim(),
        bio: bio.trim(),
      },
      { onConflict: "id" }
    )
    .select("display_name, bio")
    .maybeSingle();

  if (error || !saved) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to save profile" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    profile: { display_name: saved.display_name, bio: saved.bio },
  });
}