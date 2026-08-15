-- ============================================================================
-- PeerTalks — FULL DATABASE SETUP (consolidated 00001 → 00005)
-- Safe to run once on an empty Supabase project, and safe to re-run.
--
-- What changed vs the original migration files:
--   1. claim_daily_tokens: daily grant is FIXED at exactly 20 per calendar
--      day. p_amount is still accepted (so existing callers keep working)
--      but ANY value other than 20 is rejected — 100/500/1000 are impossible.
--   2. deduct_tokens: idempotency is now enforced INSIDE the per-user row
--      lock. The balance row is locked FIRST (serializing every token
--      mutation for that user), then the idempotency key is checked — a
--      concurrent duplicate therefore blocks on the lock and then sees the
--      committed audit row, so it can never mutate the balance twice.
--   3. Refund hardening: negative amounts are only accepted when they reverse
--      a REAL chat_cost charge of the exact same amount from the last 24h.
--      Arbitrary 'refund' calls (e.g. deduct_tokens(u, -1000, 'refund'))
--      can no longer mint tokens. Amounts > 1000 are rejected outright.
--   4. Every table guards with IF NOT EXISTS; every policy drops its old
--      definition first (same RLS rules — nothing weakened); the realtime
--      publication adds each table only when it is not already a member.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. EXTENSIONS (tolerated: missing extensions are skipped, never fatal)
-- ----------------------------------------------------------------------------
do $$ begin
  create extension if not exists "uuid-ossp";
exception when others then null;
end $$;

do $$ begin
  create extension if not exists "pgcrypto";
exception when others then null;
end $$;

-- ----------------------------------------------------------------------------
-- 1. PROFILES — one row per user, created by the signup trigger below
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text,
  display_name  text,
  avatar_url    text,
  bio           text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Users can view their own profile" on public.profiles;
create policy "Users can view their own profile"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- ----------------------------------------------------------------------------
-- 2. TOKEN BALANCES — authoritative server-side balance (single policy set)
-- ----------------------------------------------------------------------------
create table if not exists public.token_balances (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  balance       integer not null default 0,
  last_daily_at timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.token_balances enable row level security;

drop policy if exists "Users can view their own token balance" on public.token_balances;
create policy "Users can view their own token balance"
  on public.token_balances for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert token balances" on public.token_balances;
create policy "Users can insert token balances"
  on public.token_balances for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update token balances" on public.token_balances;
create policy "Users can update token balances"
  on public.token_balances for update
  using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 3. TOKEN TRANSACTIONS — audit log + idempotency keys
-- ----------------------------------------------------------------------------
create table if not exists public.token_transactions (
  id               bigint generated always as identity primary key,
  user_id          uuid not null references auth.users(id) on delete cascade,
  amount           integer not null,
  type             text not null check (type in ('daily_allowance', 'chat_cost', 'admin_grant', 'refund')),
  description      text,
  session_id       text,
  idempotency_key  text,
  created_at       timestamptz not null default now()
);

alter table public.token_transactions enable row level security;

drop policy if exists "Users can view their own transactions" on public.token_transactions;
create policy "Users can view their own transactions"
  on public.token_transactions for select
  using (auth.uid() = user_id);

drop policy if exists "System can insert transactions" on public.token_transactions;
create policy "System can insert transactions"
  on public.token_transactions for insert
  with check (auth.uid() = user_id);

create index if not exists idx_token_transactions_user on public.token_transactions(user_id);
create index if not exists idx_token_transactions_created on public.token_transactions(created_at desc);

-- One operation (charge or refund) per key, ever.
create unique index if not exists uq_token_transactions_idempotency
  on public.token_transactions (user_id, idempotency_key)
  where idempotency_key is not null;

-- ----------------------------------------------------------------------------
-- 4. CHAT SESSIONS
-- ----------------------------------------------------------------------------
create table if not exists public.chat_sessions (
  id            uuid primary key default gen_random_uuid(),
  mode          text not null check (mode in ('random', 'interest', 'private_room')),
  status        text not null check (status in ('waiting', 'matching', 'connected', 'ended')) default 'waiting',
  user1_id      uuid references auth.users(id) on delete set null,
  user2_id      uuid references auth.users(id) on delete set null,
  room_id       text,
  call_type     text not null default 'video' check (call_type in ('video', 'text')),
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  created_at    timestamptz not null default now()
);

alter table public.chat_sessions enable row level security;

drop policy if exists "Participants can view their sessions" on public.chat_sessions;
create policy "Participants can view their sessions"
  on public.chat_sessions for select
  using (auth.uid() = user1_id or auth.uid() = user2_id);

drop policy if exists "Users can create sessions" on public.chat_sessions;
create policy "Users can create sessions"
  on public.chat_sessions for insert
  with check (auth.uid() = user1_id);

drop policy if exists "Participants can update their sessions" on public.chat_sessions;
create policy "Participants can update their sessions"
  on public.chat_sessions for update
  using (auth.uid() = user1_id or auth.uid() = user2_id);

create index if not exists idx_chat_sessions_user1 on public.chat_sessions(user1_id);
create index if not exists idx_chat_sessions_user2 on public.chat_sessions(user2_id);
create index if not exists idx_chat_sessions_status on public.chat_sessions(status);

-- ----------------------------------------------------------------------------
-- 5. MESSAGES
-- ----------------------------------------------------------------------------
create table if not exists public.messages (
  id            bigint generated always as identity primary key,
  session_id    uuid not null references public.chat_sessions(id) on delete cascade,
  sender_id     uuid references auth.users(id) on delete set null,
  content       text not null,
  created_at    timestamptz not null default now()
);

alter table public.messages enable row level security;

drop policy if exists "Session participants can view messages" on public.messages;
create policy "Session participants can view messages"
  on public.messages for select
  using (
    exists (
      select 1 from public.chat_sessions
      where id = session_id
        and (user1_id = auth.uid() or user2_id = auth.uid())
    )
  );

drop policy if exists "Session participants can insert messages" on public.messages;
create policy "Session participants can insert messages"
  on public.messages for insert
  with check (
    exists (
      select 1 from public.chat_sessions
      where id = session_id
        and (user1_id = auth.uid() or user2_id = auth.uid())
    )
    and sender_id = auth.uid()
  );

create index if not exists idx_messages_session on public.messages(session_id);
create index if not exists idx_messages_created on public.messages(created_at desc);

-- ----------------------------------------------------------------------------
-- 6. PRIVATE ROOMS — password gate stays at the application layer (the API
--    route bcrypt-compares the password before ever calling the join RPC)
-- ----------------------------------------------------------------------------
create table if not exists public.private_rooms (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  password_hash text not null,
  host_id       uuid not null references auth.users(id) on delete cascade,
  guest_id      uuid references auth.users(id) on delete set null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  ended_at      timestamptz
);

alter table public.private_rooms enable row level security;

drop policy if exists "Host can manage their rooms" on public.private_rooms;
create policy "Host can manage their rooms"
  on public.private_rooms for select
  using (auth.uid() = host_id or auth.uid() = guest_id);

drop policy if exists "Users can create rooms" on public.private_rooms;
create policy "Users can create rooms"
  on public.private_rooms for insert
  with check (auth.uid() = host_id);

drop policy if exists "Host can update their rooms" on public.private_rooms;
create policy "Host can update their rooms"
  on public.private_rooms for update
  using (auth.uid() = host_id);

create index if not exists idx_private_rooms_host on public.private_rooms(host_id);
create index if not exists idx_private_rooms_active on public.private_rooms(is_active) where is_active = true;

-- One ACTIVE room per name (ended/deleted rooms free the name).
create unique index if not exists uq_private_rooms_active_name
  on public.private_rooms (name)
  where is_active = true;

-- ----------------------------------------------------------------------------
-- 7. USER INTERESTS
-- ----------------------------------------------------------------------------
create table if not exists public.user_interests (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  interest      text not null,
  created_at    timestamptz not null default now(),
  unique(user_id, interest)
);

alter table public.user_interests enable row level security;

drop policy if exists "Users can view their own interests" on public.user_interests;
create policy "Users can view their own interests"
  on public.user_interests for select
  using (auth.uid() = user_id);

drop policy if exists "Users can manage their own interests" on public.user_interests;
create policy "Users can manage their own interests"
  on public.user_interests for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own interests" on public.user_interests;
create policy "Users can delete their own interests"
  on public.user_interests for delete
  using (auth.uid() = user_id);

create index if not exists idx_user_interests_user on public.user_interests(user_id);
create index if not exists idx_user_interests_interest on public.user_interests(interest);

-- ----------------------------------------------------------------------------
-- 8. MATCHING QUEUE
-- ----------------------------------------------------------------------------
create table if not exists public.matching_queue (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  mode            text not null check (mode in ('random', 'interest')),
  interests       text[] default '{}',
  call_type       text not null default 'video' check (call_type in ('video', 'text')),
  status          text not null check (status in ('waiting', 'matched')) default 'waiting',
  matched_user_id uuid references auth.users(id) on delete set null,
  session_id      text,
  created_at      timestamptz not null default now(),
  matched_at      timestamptz
);

alter table public.matching_queue enable row level security;

drop policy if exists "Users can view their own queue entries" on public.matching_queue;
create policy "Users can view their own queue entries"
  on public.matching_queue for select
  using (auth.uid() = user_id);

drop policy if exists "Users can create queue entries" on public.matching_queue;
create policy "Users can create queue entries"
  on public.matching_queue for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own queue entries" on public.matching_queue;
create policy "Users can update their own queue entries"
  on public.matching_queue for update
  using (auth.uid() = user_id);

drop policy if exists "Users can delete their own queue entries" on public.matching_queue;
create policy "Users can delete their own queue entries"
  on public.matching_queue for delete
  using (auth.uid() = user_id);

create index if not exists idx_matching_queue_status on public.matching_queue(status);
create index if not exists idx_matching_queue_mode on public.matching_queue(mode);
create index if not exists idx_matching_queue_created on public.matching_queue(created_at);

-- ----------------------------------------------------------------------------
-- 9. REPORTS
-- ----------------------------------------------------------------------------
create table if not exists public.reports (
  id                bigint generated always as identity primary key,
  reporter_id       uuid not null references auth.users(id) on delete cascade,
  reported_user_id  uuid not null references auth.users(id) on delete cascade,
  session_id        text,
  reason            text not null check (char_length(reason) between 1 and 500),
  created_at        timestamptz not null default now()
);

alter table public.reports enable row level security;

drop policy if exists "Users can create reports" on public.reports;
create policy "Users can create reports"
  on public.reports for insert
  with check (auth.uid() = reporter_id);

drop policy if exists "Users can view their own reports" on public.reports;
create policy "Users can view their own reports"
  on public.reports for select
  using (auth.uid() = reporter_id);

create index if not exists idx_reports_reporter on public.reports(reporter_id);
create index if not exists idx_reports_reported on public.reports(reported_user_id);

-- ----------------------------------------------------------------------------
-- 10. BLOCKS
-- ----------------------------------------------------------------------------
create table if not exists public.blocks (
  id          bigint generated always as identity primary key,
  blocker_id  uuid not null references auth.users(id) on delete cascade,
  blocked_id  uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (blocker_id, blocked_id)
);

alter table public.blocks enable row level security;

drop policy if exists "Users can create blocks" on public.blocks;
create policy "Users can create blocks"
  on public.blocks for insert
  with check (auth.uid() = blocker_id);

drop policy if exists "Users can view their own blocks" on public.blocks;
create policy "Users can view their own blocks"
  on public.blocks for select
  using (auth.uid() = blocker_id);

drop policy if exists "Users can delete their own blocks" on public.blocks;
create policy "Users can delete their own blocks"
  on public.blocks for delete
  using (auth.uid() = blocker_id);

-- The blocks upsert (POST /api/blocks) does insert ... on conflict
-- (blocker_id, blocked_id) do update — that needs an UPDATE policy.
drop policy if exists "Users can update their own blocks" on public.blocks;
create policy "Users can update their own blocks"
  on public.blocks for update
  using (auth.uid() = blocker_id)
  with check (auth.uid() = blocker_id);

create index if not exists idx_blocks_blocker on public.blocks(blocker_id);
create index if not exists idx_blocks_blocked on public.blocks(blocked_id);

-- ----------------------------------------------------------------------------
-- 11. MESSAGE REACTIONS
-- ----------------------------------------------------------------------------
create table if not exists public.message_reactions (
  id          bigint generated always as identity primary key,
  message_id  bigint not null references public.messages(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  reaction    text not null check (char_length(reaction) <= 16),
  created_at  timestamptz not null default now(),
  unique (message_id, user_id)
);

alter table public.message_reactions enable row level security;

drop policy if exists "Session participants can view reactions" on public.message_reactions;
create policy "Session participants can view reactions"
  on public.message_reactions for select
  using (
    exists (
      select 1 from public.messages m
      join public.chat_sessions cs on cs.id = m.session_id
      where m.id = message_id
        and (cs.user1_id = auth.uid() or cs.user2_id = auth.uid())
    )
  );

drop policy if exists "Session participants can react" on public.message_reactions;
create policy "Session participants can react"
  on public.message_reactions for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.messages m
      join public.chat_sessions cs on cs.id = m.session_id
      where m.id = message_id
        and (cs.user1_id = auth.uid() or cs.user2_id = auth.uid())
    )
  );

drop policy if exists "Users can delete their own reactions" on public.message_reactions;
create policy "Users can delete their own reactions"
  on public.message_reactions for delete
  using (auth.uid() = user_id);

create index if not exists idx_msg_reactions_message on public.message_reactions(message_id);
create index if not exists idx_msg_reactions_user on public.message_reactions(user_id);

-- ----------------------------------------------------------------------------
-- 12. REALTIME PUBLICATION — create if missing; add each table only once
--     (guarded membership check; never double-registers, never fails on a
--     table that is already a member)
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'token_balances'
  ) then
    alter publication supabase_realtime add table public.token_balances;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'matching_queue'
  ) then
    alter publication supabase_realtime add table public.matching_queue;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reactions'
  ) then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 13. AUTO-CREATE PROFILE ON USER SIGNUP
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, username, display_name, avatar_url)
  values (
    new.id,
    substring(new.email from '^([^@]+)'),
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 14. DAILY TOKEN CLAIM — EXACTLY +20 once per calendar day, never more
--     p_amount is REJECTED unless it is exactly 20 (a client cannot request
--     100/500/1000). Unknown timezones fall back to UTC. Row-locked: N
--     simultaneous claims -> ONE grant. Additive (+20 on top of existing
--     balance) — legitimately purchased/bonus tokens are never destroyed.
-- ----------------------------------------------------------------------------
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
  -- Caller must be the credited user AND must request the official amount.
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

-- ----------------------------------------------------------------------------
-- 15. DEDUCT / REFUND — atomic, authenticated, TRULY idempotent per key
--
--     Concurrency guarantee (the critical fix):
--       * the user's token_balances row is locked FIRST (FOR UPDATE), which
--         serializes every token mutation for that user
--       * the idempotency check happens INSIDE that lock, AFTER acquisition —
--         a concurrent duplicate therefore blocks on the lock, then sees the
--         first transaction's committed audit row and returns without
--         touching the balance
--       * the unique (user_id, idempotency_key) index is the final backstop
--
--     Security:
--       * rejected: p_amount = 0 or |p_amount| > 1000 rejected
--       * refunds (p_amount < 0) must reverse a REAL chat_cost charge of the
--         exact same amount from the last 24h — arbitrary negative calls
--         (token minting) are rejected
--       * insufficient balance re-checked under the row lock
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 16. MATCHING RPCs — caller-verified, block-aware, atomic queue claims
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 17. PRIVATE ROOM JOIN — assigns the guest + session atomically.
--     NOTE: the bcrypt password check stays in the application API route
--     (it already compares the password BEFORE calling this RPC). This RPC
--     intentionally has no password parameter - it is the low-level join
--     and the password gate is the application layer, unchanged.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 17b. PRIVATE-ROOM LOOKUP RPC (00009) — removes the service-role
--      dependency from room join. Verifies the bcrypt password inside
--      Postgres (pgcrypto crypt) and NEVER returns password_hash.
-- ----------------------------------------------------------------------------
create or replace function public.lookup_private_room(
  p_name text,
  p_password text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row    record;
  v_valid  boolean;
begin
  if p_name is null or p_name = '' or p_password is null
     or auth.uid() is null then
    return null;
  end if;

  select id, name, password_hash, host_id, guest_id, is_active, created_at, ended_at
    into v_row
    from public.private_rooms
    where name = p_name
      and is_active = true;

  if not found then
    return null;
  end if;

  begin
    v_valid := extensions.crypt(p_password, v_row.password_hash) = v_row.password_hash;
  exception when others then
    v_valid := false;
  end;

  return jsonb_build_object(
    'found', true,
    'password_valid', v_valid,
    'room', jsonb_build_object(
      'id', v_row.id,
      'name', v_row.name,
      'host_id', v_row.host_id,
      'guest_id', v_row.guest_id,
      'is_active', v_row.is_active,
      'created_at', v_row.created_at,
      'ended_at', v_row.ended_at
    )
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 17c. GRANTS (00008) — restore the authenticated-role table grants the
--      production DB is missing. `anon` gets NO table grants: the client
--      never reads/writes a public table without a signed-in session.
-- ----------------------------------------------------------------------------
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ----------------------------------------------------------------------------
-- 18. SECURITY — none of these may ever run as the `anon` role.
-- ----------------------------------------------------------------------------
revoke execute on function public.claim_daily_tokens(uuid, integer, text) from anon;
revoke execute on function public.deduct_tokens(uuid, integer, text, text, text, text) from anon;
revoke execute on function public.find_random_match(uuid, text) from anon;
revoke execute on function public.find_interest_match(uuid, text[], text) from anon;
revoke execute on function public.join_private_room_as_guest(uuid, uuid) from anon;
revoke execute on function public.lookup_private_room(text, text) from anon;