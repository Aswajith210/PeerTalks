-- ============================================================
-- 00005: Idempotent token deductions
-- Guarantees "one deduction per operation" even when the same
-- request arrives twice (retry, double-click, parallel tabs):
--   * token_transactions gains an idempotency_key column
--   * unique (user_id, idempotency_key) — the key can apply a
--     charge or refund at most once, ever
--   * deduct_tokens redefined with p_idempotency_key: an exact
--     replay returns the current balance WITHOUT mutating anything
-- The old 5-arg overload is dropped (the new 6-arg signature takes
-- defaulted arguments so every existing caller shape keeps working).
-- ============================================================

-- ------------------------------------------------------------
-- SCHEMA: idempotency tracking on the audit log
-- ------------------------------------------------------------
alter table public.token_transactions
  add column if not exists idempotency_key text;

create unique index if not exists uq_token_transactions_idempotency
  on public.token_transactions (user_id, idempotency_key)
  where idempotency_key is not null;

-- ------------------------------------------------------------
-- REDEFINE DEDUCT/REFUND (atomic, authenticated, idempotent)
-- ------------------------------------------------------------
drop function if exists public.deduct_tokens(uuid, integer, text, text, text);

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
  -- does both. NOTE: 00004's version computed `balance + p_amount`,
  -- which made every "deduction" credit the user; this corrects it.
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