function getEnv(key: string, required = false): string | undefined {
  const value = process.env[key];
  if (required && !value) {
    if (typeof window === "undefined") {
      console.warn(`[Config] Missing required environment variable: ${key}`);
    }
  }
  return value;
}

export const config = {
  supabase: {
    url: getEnv("NEXT_PUBLIC_SUPABASE_URL", true) || "",
    anonKey: getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", true) || "",
    serviceRoleKey: getEnv("SUPABASE_SERVICE_ROLE_KEY") || "",
  },
  site: {
    url: getEnv("NEXT_PUBLIC_SITE_URL") || "http://localhost:3000",
  },
} as const;
