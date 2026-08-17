-- ============================================================
-- 00010: REPORT-ONLY — refund guard for deduct_tokens
--
-- CRITICAL FINDING (audit, 2026-08-16):
--   public.deduct_tokens (00005) enforces auth.uid() = p_user_id
--   and a balance gate for POSITIVE amounts (charges), but for
--   NEGATIVE amounts (refunds) there is NO gate at all:
--
--     select public.deduct_tokens(auth.uid(), -100000, 'mint', 'x');
--
--   mints 100,000 tokens for any authenticated user. The refund
--   path is unbounded; tokens only flow in via signup grants,
--   so a single request defeats the whole economy.
--
-- FIX (below): every negative amount must be a LEGITIMATE refund
--   tied 1:1 to an existing charge on the same user:
--     * p_idempotency_key is REQUIRED and must start with "refund:"
--     * a charge transaction must exist with
--         idempotency_key = substring(p_idempotency_key from 8)
--         and amount      = p_amount
--       (00005 records charges as amount = -p_amount_charged, so a
--       refund of the same amount sees amount == p_amount)
--   Anything else is rejected with 'unauthorized'. The app already
--   complies: every refund site uses refundKeyFor(requestKey)
--   ("refund:" + the original charge's key) with the exact charge
--   amount (src/lib/tokens.ts + matching/random, matching/interest,
--   rooms/create, rooms/join routes).
--
-- STATUS: REPORT-ONLY — NOT APPLIED, NOT VERIFIED LIVE (no
--   service-role DB access during the audit). Review, then run in
--   the Supabase SQL editor. Re-running is safe (create or replace
--   + revoke).
--
-- AUDIT NOTES (previously reported items, current state):
--   * lookup_private_room bcrypt-in-DB: RESOLVED in 00009
--     (password_hash never leaves Postgres; $2b$ normalised to $2a$,
--     crypt() compared inside the RPC; revoke from anon).
--   * SECURITY DEFINER RPCs: all use set search_path = '' and
--     auth.uid() checks; charges re-check the balance under a row
--     lock. The only missing enforcement was the refund path
--     covered here.
--   * private_rooms RLS: host/guest-only + is_active checks (00006);
--     join path goes through lookup_private_room (00009).
-- ============================================================

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
  v_already_done boolean;
  v_refund_charge_amount integer;
begin
  -- The caller MUST be the user whose tokens change. This stops an
  -- anon-key caller from charging/crediting arbitrary user ids.
  if p_user_id is null
     or p_amount is null
     or p_amount = 0
     or p_type is null
     or auth.uid() is null
     or auth.uid() <> p_user_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  -- REFUND GUARD (CRITICAL fix): negative amounts are ONLY allowed
  -- as a twin of an existing charge on this user. A bare negative
  -- call (the mint vector) is rejected here, before any mutation.
  if p_amount < 0 then
    if p_idempotency_key is null
       or left(p_idempotency_key, 7) <> 'refund:' then
      return jsonb_build_object('success', false, 'error', 'unauthorized');
    end if;

    select t.amount into v_refund_charge_amount
    from public.token_transactions t
    where t.user_id = p_user_id
      and t.idempotency_key = substring(p_idempotency_key from 8)
      and t.amount = p_amount
    limit 1;

    if not found then
      return jsonb_build_object('success', false, 'error', 'unauthorized');
    end if;
  end if;

  -- Idempotency guard: if this exact operation already committed, it is a
  -- replay (network retry, double-click, parallel duplicate). Return the
  -- current balance without touching anything.
  if p_idempotency_key is not null then
    select exists(
      select 1
      from public.token_transactions
      where user_id = p_user_id
        and idempotency_key = p_idempotency_key
    ) into v_already_done;

    if v_already_done then
      select coalesce(balance, 0) into v_balance
      from public.token_balances
      where user_id = p_user_id;
      if not found then
        v_balance := 0;
      end if;
      return jsonb_build_object('success', true, 'balance', v_balance, 'idempotent', true);
    end if;
  end if;

  -- Row lock = atomicity. For refunds (negative amounts) there is no
  -- balance gate; for deductions the gate is re-checked under the lock.
  select balance into v_balance
  from public.token_balances
  where user_id = p_user_id
  for update;

  if not found then
    insert into public.token_balances (user_id, balance)
    values (p_user_id, 0);
    v_balance := 0;
  end if;

  if p_amount > 0 and v_balance < p_amount then
    return jsonb_build_object('success', false, 'balance', v_balance, 'reason', 'insufficient');
  end if;

  -- p_amount > 0 = charge (balance -= p_amount), p_amount < 0 = refund
  -- (balance += |p_amount|) — the single formula `balance - p_amount`
  -- does both.
  update public.token_balances
  set balance = balance - p_amount,
      updated_at = now()
  where user_id = p_user_id;

  -- Two racing requests with the same key can both pass the pre-check
  -- before either commits; the unique index admits exactly one. The loser
  -- sees a unique_violation here and treats the operation as already done.
  begin
    insert into public.token_transactions (user_id, amount, type, description, session_id, idempotency_key)
    values (p_user_id, -p_amount, p_type, p_description, p_session_id, p_idempotency_key);
  exception when unique_violation then
    null;
  end;

  return jsonb_build_object('success', true, 'balance', v_balance - p_amount);
end;
$$;

-- ------------------------------------------------------------
-- SECURITY: never executable by the anon role
-- ------------------------------------------------------------
revoke execute on function public.deduct_tokens(uuid, integer, text, text, text, text) from anon;

-- ------------------------------------------------------------
-- VERIFY (run after applying):
--   1) Mint must now fail:
--        select public.deduct_tokens(auth.uid(), -100000, 'mint', 'x');
--      expect {"success": false, "error": "unauthorized"} and a
--      balance unchanged from before the call.
--   2) A real refund still works (matches the app flow): charge with
--      key 'k1' via the app (rooms/create or matching), then:
--        select public.deduct_tokens(auth.uid(), -5, 'Token refund', NULL, NULL, 'refund:k1');
--      expect success:true and balance restored by exactly 5.
--   3) Duplicate replay of the same 'refund:k1' returns idempotent:true
--      without changing the balance.
-- ------------------------------------------------------------
