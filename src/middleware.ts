import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit, getRateLimitCategory } from "@/lib/rate-limiter";

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.supabase.co https://fonts.googleapis.com https://www.googletagmanager.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https://*.supabase.co https://lh3.googleusercontent.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "frame-src 'self' https://*.supabase.co",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(self), microphone=(self), geolocation=(), interest-cohort=()",
  "X-DNS-Prefetch-Control": "on",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
};

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Supabase session refresh.
  // NOTE: the OAuth callback path must NOT touch the session here — the fresh
  // authorization code is exchanged exactly once by the route handler, and any
  // concurrent getUser()/cookie writes in middleware would corrupt that state
  // (flow_state_already_used after Google account selection).
  const isAuthCallback = pathname.startsWith("/api/auth/callback");

  let supabaseResponse = NextResponse.next({ request });
  let user: Awaited<ReturnType<ReturnType<typeof createServerClient>["auth"]["getUser"]>>["data"]["user"] | null = null;

  if (!isAuthCallback) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.next({ request });
    }

    supabaseResponse = NextResponse.next({ request });

    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    });

    const { data } = await supabase.auth.getUser();
    user = data.user;

    // Rate limiting for API routes — keyed by the authenticated user when
    // possible (an IP spoofed in x-forwarded-for cannot rotate around it),
    // falling back to the client IP. x-forwarded-for may be a comma-separated
    // chain ("client, proxy1"); the FIRST entry is the client.
    if (pathname.startsWith("/api/")) {
      const forwarded = request.headers.get("x-forwarded-for") ?? "";
      const clientIp =
        request.headers.get("x-real-ip") ||
        (forwarded.includes(",") ? forwarded.split(",")[0].trim() : forwarded) ||
        "unknown";
      const identifier = user?.id ?? clientIp;
      const category = getRateLimitCategory(pathname);
      const result = checkRateLimit(identifier, category);

      if (!result.allowed) {
        return new NextResponse(
          JSON.stringify({ error: "Too many requests. Please try again later." }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": String(Math.ceil((result.resetAt - Date.now()) / 1000)),
            },
          }
        );
      }
    }

    // Route protection: pages that require an authenticated session redirect
    // to /login (validated server-side via the JWT, not the cookie alone).
    const isProtected =
      pathname.startsWith("/dashboard") || pathname.startsWith("/chat");
    if (isProtected && !user) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.search = "";
      supabaseResponse = NextResponse.redirect(loginUrl);
    }
  }

  // Apply security headers
  const headers = new Headers(supabaseResponse.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value);
  }

  // Only add CSP for HTML responses (not API)
  if (!pathname.startsWith("/api/")) {
    headers.set("Content-Security-Policy", CSP);
  }

  return new NextResponse(supabaseResponse.body, {
    status: supabaseResponse.status,
    statusText: supabaseResponse.statusText,
    headers,
  });
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
