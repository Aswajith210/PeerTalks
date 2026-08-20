-- ============================================================
-- 00014: Token economy write-path hardening (P0 audit fixes)
--
-- Removes every client-accessible WRITE path on the token ledger:
--
--   * token_balances:   INSERT/UPDATE policies dropped (select-only).
--                       Balance changes are ONLY possible through the
--                       security-definer RPCs below, which verify the
--                       caller, bound amounts, and lock the row.
--                       -> users can no longer set their own balance
--   * token_transactions: INSERT policy dropped. Audit rows are ONLY
--                       written by the RPCs (they run security definer
--                       and bypass RLS). 
--                       -> users can no longer forge refund/charge rows
--
-- Redeploys claim_daily_tokens + deduct_tokens with the hardened
-- definitions from apply_all.sql (idempotent create or replace):
--
--   * claim_daily_tokens: caller-verified, amount locked to exactly 20,
--                         calendar-day row-locked (one grant per day)
--   * deduct_tokens:      caller-verified, |amount| <= 1000, refunds only
--                         reverse a REAL chat_cost charge from the last
--                         24h (no arbitrary minting), row-locked with the
--                         idempotency check INSIDE the lock
--
-- App impact (verified tolerant): the server-side fallback paths in
-- lib/tokens.ts that write token_balances / token_transactions directly
-- log-and-continue when their write is rejected; the RPCs are the
-- primary path and create the balance row lazily. The signup callback's
-- welcome-bonus insert degrades to a no-op — the first daily claim
-- grants +20 identically.
--
-- This migration is SAFE to re-run (all statements idempotent).
-- ============================================================

-- ------------------------------------------------------------------
-- 1. TOKEN BALANCES — select-only
-- ------------------------------------------------------------------
drop policy if exists "System can update token balances" on public.token_balances;
drop policy if exists "Users can insert token balances"   on public.token_balances;
drop policy if exists "Users can update token balances"   on public.token_balances;

-- ------------------------------------------------------------------
-- 2. TOKEN TRANSACTIONS — RPC-write-only (audit log)
-- ------------------------------------------------------------------
drop policy if exists "System can insert transactions" on public.token_transactions;
drop policy if exists "Users can insert transactions"   on public.token_transactions;

-- ------------------------------------------------------------------
-- 3. CLAIM DAILY TOKENS — hardened redeploy
-- ------------------------------------------------------------------
create or replace function public.claim_daily_tokens(
  p_user_id uuid,
  p_amount integer default 20,
  p_timezone text default 'UTC'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance integer;
  v_last_daily timestamptz;
  v_today date;
  v_tz text;
begin
  if p_user_id is null
     or p_amount is null
     or p_amount <> 20
     or auth.uid() is null
     or auth.uid() <> p_user_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  v_tz := p_timezone;
  begin
    perform 1 from pg_timezone_names where name = p_timezone;
    if not found then
      v_tz := 'UTC';
    end if;
  exception when others then
    v_tz := 'UTC';
  end;
  v_today := (now() at time zone v_tz)::date;

  select balance, last_daily_at into v_balance, v_last_daily
  from public.token_balances
  where user_id = p_user_id
  for update;

  if not found then
    insert into public.token_balances (user_id, balance, last_daily_at)
    values (p_user_id, p_amount, now());

    insert into public.token_transactions (user_id, amount, type, description)
    values (p_user_id, p_amount, 'daily_allowance', 'Daily token allowance');

    return jsonb_build_object('success', true, 'claimed', true, 'balance', p_amount);
  end if;

  if (v_last_daily at time zone v_tz)::date < v_today then
    update public.token_balances
    set balance = v_balance + p_amount,
        last_daily_at = now(),
        updated_at = now()
    where user_id = p_user_id;

    insert into public.token_transactions (user_id, amount, type, description)
    values (p_user_id, p_amount, 'daily_allowance', 'Daily token allowance');

    return jsonb_build_object('success', true, 'claimed', true, 'balance', v_balance + p_amount);
  end if;

  return jsonb_build_object('success', true, 'claimed', false, 'balance', v_balance);
end;
$$;

-- ------------------------------------------------------------------
-- 4. DEDUCT / REFUND — hardened redeploy
-- ------------------------------------------------------------------
create or replace function public.deduct_tokens(
  p_user_id uuid,
  p_amount integer,
  p_type text,
  p_description text default null,
  p_session_id text default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance integer;
  v_real_charge boolean;
begin
  if p_user_id is null
     or p_amount is null
     or p_amount = 0
     or abs(p_amount) > 1000
     or p_type is null
     or auth.uid() is null
     or auth.uid() <> p_user_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  -- Refunds may only reverse a genuine, recent charge of the same amount.
  -- Without this gate any authenticated user could call
  -- deduct_tokens(own_id, -1000, 'refund') to mint tokens.
  if p_amount < 0 then
    select exists(
      select 1
      from public.token_transactions t
      where t.user_id = p_user_id
        and t.amount = p_amount
        and t.type = 'chat_cost'
        and t.created_at > now() - interval '24 hours'
    ) into v_real_charge;

    if not v_real_charge then
      return jsonb_build_object('success', false, 'error', 'no matching charge');
    end if;
  end if;

  -- 1) Lock the user's balance row. Every concurrent token operation for
  --    this user now serializes here; duplicates WAIT, so the check below
  --    always runs AFTER any in-flight identical request commits.
  select balance into v_balance
  from public.token_balances
  where user_id = p_user_id
  for update;

  if not found then
    insert into public.token_balances (user_id, balance)
    values (p_user_id, 0);
    v_balance := 0;
  end if;

  -- 2) Idempotency check INSIDE the lock: a replay of a committed operation
  --    is visible here and returned as a no-op.
  if p_idempotency_key is not null then
    if exists (
      select 1
      from public.token_transactions
      where user_id = p_user_id
        and idempotency_key = p_idempotency_key
    ) then
      return jsonb_build_object('success', true, 'balance', v_balance, 'idempotent', true);
    end if;
  end if;

  -- 3) Sufficiency re-checked under the lock.
  if p_amount > 0 and v_balance < p_amount then
    return jsonb_build_object('success', false, 'balance', v_balance, 'reason', 'insufficient');
  end if;

  -- 4) Single mutation: p_amount > 0 charges, p_amount < 0 refunds.
  update public.token_balances
  set balance = balance - p_amount,
      updated_at = now()
  where user_id = p_user_id;

  -- 5) Audit + idempotency record written in the SAME transaction as the
  --    mutation, so the lock guarantees the two are committed atomically.
  begin
    insert into public.token_transactions (user_id, amount, type, description, session_id, idempotency_key)
    values (p_user_id, -p_amount, p_type, p_description, p_session_id, p_idempotency_key);
  exception when unique_violation then
    null; -- unreachable under the row lock; kept as a backstop
  end;

  return jsonb_build_object('success', true, 'balance', v_balance - p_amount);
end;
$$;

-- ------------------------------------------------------------------
-- 5. Never executable by the anon role
-- ------------------------------------------------------------------
revoke execute on function public.claim_daily_tokens(uuid, integer, text) from anon;
revoke execute on function public.deduct_tokens(uuid, integer, text, text, text, text) from anon;