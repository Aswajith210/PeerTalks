const requestCounts = new Map<string, { count: number; resetAt: number }>();

const LIMITS: Record<string, { window: number; max: number }> = {
  default: { window: 60_000, max: 60 },
  auth: { window: 60_000, max: 10 },
  matching: { window: 30_000, max: 15 },
  rooms: { window: 60_000, max: 20 },
  messages: { window: 60_000, max: 30 },
  tokens: { window: 10_000, max: 10 },
};

export function getRateLimitKey(key: string): string {
  return key;
}

export function checkRateLimit(
  identifier: string,
  category: keyof typeof LIMITS = "default"
): { allowed: boolean; remaining: number; resetAt: number } {
  const limit = LIMITS[category] || LIMITS.default;
  const now = Date.now();

  const record = requestCounts.get(identifier);

  if (!record || now >= record.resetAt) {
    requestCounts.set(identifier, { count: 1, resetAt: now + limit.window });
    return { allowed: true, remaining: limit.max - 1, resetAt: now + limit.window };
  }

  if (record.count >= limit.max) {
    return { allowed: false, remaining: 0, resetAt: record.resetAt };
  }

  record.count++;
  return { allowed: true, remaining: limit.max - record.count, resetAt: record.resetAt };
}

export function getRateLimitCategory(path: string): keyof typeof LIMITS {
  if (path.includes("/auth/")) return "auth";
  if (path.includes("/matching/")) return "matching";
  if (path.includes("/rooms/")) return "rooms";
  if (path.includes("/messages")) return "messages";
  if (path.includes("/tokens")) return "tokens";
  return "default";
}
