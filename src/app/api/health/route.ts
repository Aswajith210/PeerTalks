import { NextResponse } from "next/server";
import { config } from "@/lib/config";

export async function GET() {
  const checks = {
    supabaseUrl: !!config.supabase.url,
    supabaseAnonKey: !!config.supabase.anonKey,
    supabaseServiceRoleKey: !!config.supabase.serviceRoleKey,
    siteUrl: !!config.site.url,
  };

  const allOk = Object.values(checks).every(Boolean);

  return NextResponse.json(
    {
      status: allOk ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      checks,
    },
    { status: allOk ? 200 : 200 }
  );
}
