-- ============================================================
-- 00004: Calendar-day daily token grant + RPC hardening
-- Replaces the rolling 24h claim with a strict calendar-day claim:
--   * exactly +20 once per calendar day (per the authenticated user)
--   * atomic via row lock (FOR UPDATE) — concurrent claims => one grant
--   * caller must prove identity: auth.uid() must equal p_user_id
--   * never runs as anon (EXECUTE revoked from anon)
-- Does NOT alter balance semantics: 0 -> 20, 8 -> 28, 20 -> 40.
-- Existing costs are untouched (2 random/interest, 5 private).
-- ============================================================

-- ------------------------------------------------------------
-- DROP STALE OVERLOADS
-- 00001/00002 created older signatures that are now superseded:
--   * claim_daily_tokens(uuid, integer)   — no caller verification (faucet)
--   * find_random_match(uuid)             — pre call_type signature
--   * find_interest_match(uuid, text[])   — pre call_type signature
-- Keeping them would allow unguarded calls or ambiguous resolution.
-- ------------------------------------------------------------
drop function if exists public.claim_daily_tokens(uuid, integer);
drop function if exists public.find_random_match(uuid);
drop function if exists public.find_interest_match(uuid, text[]);

-- ------------------------------------------------------------
-- DAILY CLAIM (calendar-day, atomic, authenticated)
-- ------------------------------------------------------------
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
  -- The caller MUST be the user being credited. This stops an anon-key
  -- caller from fauceting tokens to arbitrary user ids.
  if p_user_id is null
     or p_amount is null
     or p_amount <= 0
     or p_amount > 1000
     or auth.uid() is null
     or auth.uid() <> p_user_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  -- Resolve the caller's calendar day. Unknown timezone names fall back
  -- to UTC instead of aborting the claim.
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

  -- Row lock serializes simultaneous claims: the second caller blocks
  -- until the first commits, then sees last_daily_at = today and gets
  -- claimed=false. Only ONE +20 grant per calendar day can ever land.
  select balance, last_daily_at into v_balance, v_last_daily
  from public.token_balances
  where user_id = p_user_id
  for update;

  if not found then
    -- First ever claim (e.g. right after welcome bonus was skipped)
    insert into public.token_balances (user_id, balance, last_daily_at)
    values (p_user_id, p_amount, now());

    insert into public.token_transactions (user_id, amount, type, description)
    values (p_user_id, p_amount, 'daily_allowance', 'Daily token allowance');

    return jsonb_build_object('success', true, 'claimed', true, 'balance', p_amount);
  end if;

  -- Claim valid only when the last grant was on an EARLIER calendar day.
  -- Adds +p_amount to the existing balance — never a reset to p_amount.
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

-- ------------------------------------------------------------
-- DEDUCT / REFUND (atomic, authenticated)
-- p_amount > 0 => deduct (rejected when balance insufficient)
-- p_amount < 0 => refund (adds |p_amount|) — atomic, no read-modify-write
-- ------------------------------------------------------------
create or replace function public.deduct_tokens(
  p_user_id uuid,
  p_amount integer,
  p_type text,
  p_description text default null,
  p_session_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance integer;
begin
  if p_user_id is null
     or p_amount is null
     or p_amount = 0
     or p_type is null
     or auth.uid() is null
     or auth.uid() <> p_user_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  -- Row lock = atomicity. For refunds (negative amounts) there is no
  -- balance gate; for deductions the gate is re-checked under the lock.
  select balance into v_balance
  from public.token_balances
  where user_id = p_user_id
  for update;

  if not found then
    -- No balance row yet: create one so later claims/deductions work.
    insert into public.token_balances (user_id, balance)
    values (p_user_id, 0);
    v_balance := 0;
  end if;

  if p_amount > 0 and v_balance < p_amount then
    return jsonb_build_object('success', false, 'balance', v_balance, 'reason', 'insufficient');
  end if;

  update public.token_balances
  set balance = balance + p_amount,
      updated_at = now()
  where user_id = p_user_id;

  insert into public.token_transactions (user_id, amount, type, description, session_id)
  values (p_user_id, -p_amount, p_type, p_description, p_session_id);

  return jsonb_build_object('success', true, 'balance', v_balance + p_amount);
end;
$$;

-- ------------------------------------------------------------
-- MATCHING RPCs: caller verification (security hardening)
-- ------------------------------------------------------------
create or replace function public.find_random_match(
  p_user_id uuid,
  p_call_type text default 'video'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match_id bigint;
  v_match_user_id uuid;
  v_session_id uuid;
begin
  if p_user_id is null
     or auth.uid() is null
     or auth.uid() <> p_user_id then
    return jsonb_build_object('matched', false, 'error', 'unauthorized');
  end if;

  select id, user_id into v_match_id, v_match_user_id
  from public.matching_queue
  where mode = 'random'
    and status = 'waiting'
    and call_type = p_call_type
    and user_id != p_user_id
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = p_user_id and b.blocked_id = matching_queue.user_id)
         or (b.blocker_id = matching_queue.user_id and b.blocked_id = p_user_id)
    )
  order by created_at asc
  limit 1
  for update skip locked;

  if not found then
    return jsonb_build_object('matched', false);
  end if;

  insert into public.chat_sessions (mode, status, call_type, user1_id, user2_id)
  values ('random', 'connected', p_call_type, v_match_user_id, p_user_id)
  returning id into v_session_id;

  update public.matching_queue
  set status = 'matched',
      matched_user_id = p_user_id,
      session_id = v_session_id::text,
      matched_at = now()
  where id = v_match_id;

  insert into public.matching_queue (user_id, mode, call_type, status, matched_user_id, session_id, matched_at)
  values (p_user_id, 'random', p_call_type, 'matched', v_match_user_id, v_session_id::text, now());

  return jsonb_build_object(
    'matched', true,
    'session_id', v_session_id::text,
    'peer_id', v_match_user_id
  );
end;
$$;

create or replace function public.find_interest_match(
  p_user_id uuid,
  p_interests text[],
  p_call_type text default 'video'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match_id bigint;
  v_match_user_id uuid;
  v_overlap text;
  v_session_id uuid;
  v_entry record;
begin
  if p_user_id is null
     or auth.uid() is null
     or auth.uid() <> p_user_id then
    return jsonb_build_object('matched', false, 'error', 'unauthorized');
  end if;

  for v_entry in
    select id, user_id, interests
    from public.matching_queue
    where mode = 'interest'
      and status = 'waiting'
      and call_type = p_call_type
      and user_id != p_user_id
      and not exists (
        select 1 from public.blocks b
        where (b.blocker_id = p_user_id and b.blocked_id = matching_queue.user_id)
           or (b.blocker_id = matching_queue.user_id and b.blocked_id = p_user_id)
      )
    order by created_at asc
    for update skip locked
  loop
    select i into v_overlap
    from unnest(p_interests) i
    where i = any(v_entry.interests)
    limit 1;

    if found then
      v_match_id := v_entry.id;
      v_match_user_id := v_entry.user_id;
      exit;
    end if;
  end loop;

  if v_match_id is null then
    return jsonb_build_object('matched', false);
  end if;

  insert into public.chat_sessions (mode, status, call_type, user1_id, user2_id)
  values ('interest', 'connected', p_call_type, v_match_user_id, p_user_id)
  returning id into v_session_id;

  update public.matching_queue
  set status = 'matched',
      matched_user_id = p_user_id,
      session_id = v_session_id::text,
      matched_at = now()
  where id = v_match_id;

  insert into public.matching_queue (user_id, mode, call_type, interests, status, matched_user_id, session_id, matched_at)
  values (p_user_id, 'interest', p_call_type, p_interests, 'matched', v_match_user_id, v_session_id::text, now());

  return jsonb_build_object(
    'matched', true,
    'session_id', v_session_id::text,
    'peer_id', v_match_user_id
  );
end;
$$;

create or replace function public.join_private_room_as_guest(
  p_room_id uuid,
  p_guest_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id text;
  v_host_id uuid;
begin
  if p_room_id is null
     or p_guest_id is null
     or auth.uid() is null
     or auth.uid() <> p_guest_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  update public.private_rooms
  set guest_id = p_guest_id
  where id = p_room_id
    and is_active = true
    and guest_id is null
  returning host_id into v_host_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Room not found or already full');
  end if;

  select id::text into v_session_id
  from public.chat_sessions
  where room_id = p_room_id::text
    and status = 'waiting';

  if found then
    update public.chat_sessions
    set status = 'connected', user2_id = p_guest_id
    where id = v_session_id::uuid;
  else
    insert into public.chat_sessions (mode, status, user1_id, user2_id, room_id)
    values ('private_room', 'connected', v_host_id, p_guest_id, p_room_id::text)
    returning id::text into v_session_id;
  end if;

  return jsonb_build_object('success', true, 'session_id', v_session_id);
end;
$$;

-- ------------------------------------------------------------
-- UNIQUE ACTIVE ROOM NAMES
-- Stops colliding room names (join matches the first active name).
-- Deleted/ended rooms keep their name free for reuse.
-- ------------------------------------------------------------
create unique index if not exists uq_private_rooms_active_name
  on public.private_rooms (name)
  where is_active = true;

-- ------------------------------------------------------------
-- SECURITY: these RPCs must never run as the `anon` role.
-- Authenticated (the user's JWT) and service_role still can.
-- ------------------------------------------------------------
revoke execute on function public.claim_daily_tokens(uuid, integer, text) from anon;
revoke execute on function public.deduct_tokens(uuid, integer, text, text, text) from anon;
revoke execute on function public.find_random_match(uuid, text) from anon;
revoke execute on function public.find_interest_match(uuid, text[], text) from anon;
revoke execute on function public.join_private_room_as_guest(uuid, uuid) from anon;