import { createServerSupabaseClient } from "./supabase/server";
import { TOKEN_COSTS, TOKEN_ALLOWANCE } from "./constants";

export async function getUserTokenBalance(userId: string): Promise<number> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new Error("Server configuration error");
  const { data } = await supabase
    .from("token_balances")
    .select("balance")
    .eq("user_id", userId)
    .single();
  return data?.balance ?? 0;
}

export async function ensureDailyTokens(userId: string): Promise<void> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new Error("Server configuration error");

  // Use the atomic RPC function
  const { data } = await supabase.rpc("claim_daily_tokens", {
    p_user_id: userId,
    p_amount: TOKEN_ALLOWANCE.AMOUNT,
  });

  if (data?.success !== true) {
    // Fallback: try application-level logic
    const { data: balance } = await supabase
      .from("token_balances")
      .select("balance, last_daily_at")
      .eq("user_id", userId)
      .single();

    if (!balance) {
      await supabase.from("token_balances").insert({
        user_id: userId,
        balance: TOKEN_ALLOWANCE.AMOUNT,
        last_daily_at: new Date().toISOString(),
      });
      await supabase.from("token_transactions").insert({
        user_id: userId,
        amount: TOKEN_ALLOWANCE.AMOUNT,
        type: "daily_allowance",
        description: "Welcome bonus",
      });
      return;
    }

    const lastDaily = new Date(balance.last_daily_at);
    const now = new Date();
    const hoursSinceLastDaily =
      (now.getTime() - lastDaily.getTime()) / (1000 * 60 * 60);

    if (hoursSinceLastDaily >= TOKEN_ALLOWANCE.INTERVAL_HOURS) {
      const newBalance = balance.balance + TOKEN_ALLOWANCE.AMOUNT;
      await supabase
        .from("token_balances")
        .update({
          balance: newBalance,
          last_daily_at: now.toISOString(),
          updated_at: now.toISOString(),
        })
        .eq("user_id", userId);

      await supabase.from("token_transactions").insert({
        user_id: userId,
        amount: TOKEN_ALLOWANCE.AMOUNT,
        type: "daily_allowance",
        description: "Daily token allowance",
      });
    }
  }
}

export async function deductTokens(
  userId: string,
  amount: number,
  description: string,
  sessionId?: string
): Promise<{ success: boolean; balance: number }> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new Error("Server configuration error");

  // Try the atomic RPC first
  const { data } = await supabase.rpc("deduct_tokens", {
    p_user_id: userId,
    p_amount: amount,
    p_type: "chat_cost",
    p_description: description,
    p_session_id: sessionId ?? null,
  });

  if (data) {
    return { success: data.success as boolean, balance: (data.balance as number) ?? 0 };
  }

  // Fallback: application-level deduction
  const { data: balance } = await supabase
    .from("token_balances")
    .select("balance")
    .eq("user_id", userId)
    .single();

  if (!balance || balance.balance < amount) {
    return { success: false, balance: balance?.balance ?? 0 };
  }

  const newBalance = balance.balance - amount;

  await supabase
    .from("token_balances")
    .update({
      balance: newBalance,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  await supabase.from("token_transactions").insert({
    user_id: userId,
    amount: -amount,
    type: "chat_cost",
    description,
    session_id: sessionId ?? null,
  });

  return { success: true, balance: newBalance };
}

export async function refundTokens(
  userId: string,
  amount: number,
  sessionId?: string
): Promise<void> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new Error("Server configuration error");

  // Refund is always safe (no race condition on adding tokens)
  const { data: balance } = await supabase
    .from("token_balances")
    .select("balance")
    .eq("user_id", userId)
    .single();

  const newBalance = (balance?.balance ?? 0) + amount;

  await supabase
    .from("token_balances")
    .update({
      balance: newBalance,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  await supabase.from("token_transactions").insert({
    user_id: userId,
    amount,
    type: "refund",
    description: "Token refund",
    session_id: sessionId ?? null,
  });
}

export function getChatCost(mode: "video" | "text"): number {
  return mode === "video" ? TOKEN_COSTS.VIDEO_CHAT : TOKEN_COSTS.TEXT_CHAT;
}
