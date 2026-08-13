import { createServerSupabaseClient } from "./supabase/server";
import { TOKEN_COSTS, TOKEN_ALLOWANCE } from "./constants";

export interface TokenResult {
  success: boolean;
  balance: number;
  reason?: string;
  /** true when the request was an exact replay of a completed operation */
  idempotent?: boolean;
}

export interface DailyClaimResult {
  claimed: boolean;
  balance: number;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFUND_KEY_PREFIX = "refund:";

/**
 * Reads the client-supplied idempotency key (`x-request-id` header).
 * A valid key must be a plain UUID. Refunds derive their own distinct key
 * from it (`refund:<uuid>`) so a charge and its reversal never collide.
 */
export function parseRequestKey(request: Request): string | null {
  const raw = request.headers.get("x-request-id");
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  return UUID_RE.test(key) ? key : null;
}

export function refundKeyFor(key: string): string {
  return `${REFUND_KEY_PREFIX}${key}`;
}

export async function getUserTokenBalance(userId: string): Promise<number> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new Error("Server configuration error");
  const { data } = await supabase
    .from("token_balances")
    .select("balance")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.balance ?? 0;
}

/**
 * Today's boundary (start of calendar day) as a Date in the given timezone.
 * The caller supplies the user's IANA timezone (e.g. "Asia/Kolkata") so the
 * "calendar day" is the USER's calendar day, not UTC.
 */
function todayInTimezone(tz: string): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return new Date(`${get("year")}-${get("month")}-${get("day")}T00:00:00Z`);
}

/**
 * Atomic daily grant: EXACTLY +20 once per calendar day.
 *
 * Primary path: the `claim_daily_tokens` DB function (row-locked, calendar-day,
 * caller-verified). Fallback (function/tables not yet deployed): an optimistic
 * conditional update keyed on last_daily_at, retried on any concurrent change —
 * two simultaneous requests can still produce at most one +20 grant.
 */
export async function ensureDailyTokens(
  userId: string,
  tz: string = "UTC"
): Promise<DailyClaimResult> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new Error("Server configuration error");

  const { data, error } = await supabase.rpc("claim_daily_tokens", {
    p_user_id: userId,
    p_amount: TOKEN_ALLOWANCE.AMOUNT,
    p_timezone: tz,
  });

  if (!error && data) {
    const r = data as { success?: boolean; claimed?: boolean; balance?: number };
    if (r.success) {
      return { claimed: r.claimed === true, balance: r.balance ?? 0 };
    }
  }

  // ── Fallback: optimistic conditional update (atomic under READ COMMITTED) ──
  const today = todayInTimezone(tz);
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: balance } = await supabase
      .from("token_balances")
      .select("balance, last_daily_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (!balance) {
      // Row missing: try to seed it. Concurrent inserts collide on the PK —
      // on collision a concurrent grant already happened, so loop and re-check.
      const { error: insertError } = await supabase.from("token_balances").insert({
        user_id: userId,
        balance: TOKEN_ALLOWANCE.AMOUNT,
        last_daily_at: new Date().toISOString(),
      });
      if (!insertError) {
        await supabase.from("token_transactions").insert({
          user_id: userId,
          amount: TOKEN_ALLOWANCE.AMOUNT,
          type: "daily_allowance",
          description: "Daily token allowance",
        });
        return { claimed: true, balance: TOKEN_ALLOWANCE.AMOUNT };
      }
      continue;
    }

    const lastDaily = new Date(balance.last_daily_at);
    if (lastDaily >= today) {
      return { claimed: false, balance: balance.balance };
    }

    const newBalance = balance.balance + TOKEN_ALLOWANCE.AMOUNT;
    const { data: updated } = await supabase
      .from("token_balances")
      .update({
        balance: newBalance,
        last_daily_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("last_daily_at", balance.last_daily_at)
      .select("balance")
      .maybeSingle();

    if (updated) {
      await supabase.from("token_transactions").insert({
        user_id: userId,
        amount: TOKEN_ALLOWANCE.AMOUNT,
        type: "daily_allowance",
        description: "Daily token allowance",
      });
      return { claimed: true, balance: newBalance };
    }
    // Concurrent change detected — retry with fresh values.
  }

  const { data: finalBalance } = await supabase
    .from("token_balances")
    .select("balance")
    .eq("user_id", userId)
    .maybeSingle();
  return { claimed: false, balance: finalBalance?.balance ?? 0 };
}

/**
 * Atomic deduction via the `deduct_tokens` DB function (row-locked).
 * Fallback: optimistic update keyed on the read balance, retried on change —
 * two simultaneous deductions can never consume the same tokens twice.
 * Positive amount = charge, negative amount = refund (atomic add).
 */
export async function deductTokens(
  userId: string,
  amount: number,
  description: string,
  sessionId?: string,
  idempotencyKey?: string
): Promise<TokenResult> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new Error("Server configuration error");

  const { data, error } = await supabase.rpc("deduct_tokens", {
    p_user_id: userId,
    p_amount: amount,
    p_type: amount >= 0 ? "chat_cost" : "refund",
    p_description: description,
    p_session_id: sessionId ?? null,
    p_idempotency_key: idempotencyKey ?? null,
  });

  if (!error && data) {
    const r = data as { success?: boolean; balance?: number; reason?: string; idempotent?: boolean };
    return {
      success: r.success === true,
      balance: r.balance ?? 0,
      reason: r.reason,
      idempotent: r.idempotent === true,
    };
  }

  // ── Fallback: optimistic locking on the balance column ──
  // First honor idempotency: if this exact operation already committed,
  // replay it as a no-op so retried requests never double-charge.
  if (idempotencyKey) {
    const { data: existing } = await supabase
      .from("token_transactions")
      .select("id")
      .eq("user_id", userId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (existing) {
      const { data: knownBalance } = await supabase
        .from("token_balances")
        .select("balance")
        .eq("user_id", userId)
        .maybeSingle();
      return { success: true, balance: knownBalance?.balance ?? 0, idempotent: true };
    }
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: balance } = await supabase
      .from("token_balances")
      .select("balance")
      .eq("user_id", userId)
      .maybeSingle();

    const current = balance?.balance ?? 0;
    if (amount > 0 && current < amount) {
      return { success: false, balance: current, reason: "insufficient" };
    }

    const newBalance = current + amount;
    const { data: updated } = await supabase
      .from("token_balances")
      .update({ balance: newBalance, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("balance", current)
      .select("balance")
      .maybeSingle();

    if (updated) {
      const { error: txError } = await supabase.from("token_transactions").insert({
        user_id: userId,
        amount: -amount,
        type: amount >= 0 ? "chat_cost" : "refund",
        description,
        session_id: sessionId ?? null,
        idempotency_key: idempotencyKey ?? null,
      });
      if (txError?.code === "23505") {
        // A concurrent request committed this key first — same outcome.
        return { success: true, balance: newBalance, idempotent: true };
      }
      return { success: true, balance: newBalance };
    }
  }

  const { data: finalBalance } = await supabase
    .from("token_balances")
    .select("balance")
    .eq("user_id", userId)
    .maybeSingle();
  return { success: false, balance: finalBalance?.balance ?? 0 };
}

export async function refundTokens(
  userId: string,
  amount: number,
  sessionId?: string,
  idempotencyKey?: string
): Promise<TokenResult> {
  return deductTokens(userId, -amount, "Token refund", sessionId, idempotencyKey);
}

export function getChatCost(mode: "video" | "text"): number {
  return mode === "video" ? TOKEN_COSTS.VIDEO_CHAT : TOKEN_COSTS.TEXT_CHAT;
}