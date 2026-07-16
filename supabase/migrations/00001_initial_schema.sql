-- Enable UUID generation and pgcrypto for password hashing
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ============================================================
-- PROFILES
-- ============================================================
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

create policy "Users can view their own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- ============================================================
-- TOKEN BALANCES
-- ============================================================
create table if not exists public.token_balances (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  balance       integer not null default 0,
  last_daily_at timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.token_balances enable row level security;

create policy "Users can view their own token balance"
  on public.token_balances for select
  using (auth.uid() = user_id);

create policy "System can update token balances"
  on public.token_balances for insert
  with check (auth.uid() = user_id);

create policy "System can update token balances"
  on public.token_balances for update
  using (auth.uid() = user_id);

-- ============================================================
-- TOKEN TRANSACTIONS (audit log)
-- ============================================================
create table if not exists public.token_transactions (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  amount        integer not null,
  type          text not null check (type in ('daily_allowance', 'chat_cost', 'admin_grant', 'refund')),
  description   text,
  session_id    text,
  created_at    timestamptz not null default now()
);

alter table public.token_transactions enable row level security;

create policy "Users can view their own transactions"
  on public.token_transactions for select
  using (auth.uid() = user_id);

create policy "System can insert transactions"
  on public.token_transactions for insert
  with check (auth.uid() = user_id);

create index idx_token_transactions_user on public.token_transactions(user_id);
create index idx_token_transactions_created on public.token_transactions(created_at desc);

-- ============================================================
-- CHAT SESSIONS
-- ============================================================
create table if not exists public.chat_sessions (
  id            uuid primary key default gen_random_uuid(),
  mode          text not null check (mode in ('random', 'interest', 'private_room')),
  status        text not null check (status in ('waiting', 'matching', 'connected', 'ended')) default 'waiting',
  user1_id      uuid references auth.users(id) on delete set null,
  user2_id      uuid references auth.users(id) on delete set null,
  room_id       text,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  created_at    timestamptz not null default now()
);

alter table public.chat_sessions enable row level security;

create policy "Participants can view their sessions"
  on public.chat_sessions for select
  using (auth.uid() = user1_id or auth.uid() = user2_id);

create policy "Users can create sessions"
  on public.chat_sessions for insert
  with check (auth.uid() = user1_id);

create policy "Participants can update their sessions"
  on public.chat_sessions for update
  using (auth.uid() = user1_id or auth.uid() = user2_id);

create index idx_chat_sessions_user1 on public.chat_sessions(user1_id);
create index idx_chat_sessions_user2 on public.chat_sessions(user2_id);
create index idx_chat_sessions_status on public.chat_sessions(status);

-- ============================================================
-- MESSAGES
-- ============================================================
create table if not exists public.messages (
  id            bigint generated always as identity primary key,
  session_id    uuid not null references public.chat_sessions(id) on delete cascade,
  sender_id     uuid references auth.users(id) on delete set null,
  content       text not null,
  created_at    timestamptz not null default now()
);

alter table public.messages enable row level security;

create policy "Session participants can view messages"
  on public.messages for select
  using (
    exists (
      select 1 from public.chat_sessions
      where id = session_id
        and (user1_id = auth.uid() or user2_id = auth.uid())
    )
  );

create policy "Session participants can insert messages"
  on public.messages for insert
  with check (
    exists (
      select 1 from public.chat_sessions
      where id = session_id
        and (user1_id = auth.uid() or user2_id = auth.uid())
    )
  );

create index idx_messages_session on public.messages(session_id);
create index idx_messages_created on public.messages(created_at desc);

-- ============================================================
-- PRIVATE ROOMS
-- ============================================================
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

create policy "Host can manage their rooms"
  on public.private_rooms for select
  using (auth.uid() = host_id or auth.uid() = guest_id);

create policy "Users can create rooms"
  on public.private_rooms for insert
  with check (auth.uid() = host_id);

create policy "Host can update their rooms"
  on public.private_rooms for update
  using (auth.uid() = host_id);

create index idx_private_rooms_host on public.private_rooms(host_id);
create index idx_private_rooms_active on public.private_rooms(is_active) where is_active = true;

-- ============================================================
-- USER INTERESTS
-- ============================================================
create table if not exists public.user_interests (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  interest      text not null,
  created_at    timestamptz not null default now(),
  unique(user_id, interest)
);

alter table public.user_interests enable row level security;

create policy "Users can view their own interests"
  on public.user_interests for select
  using (auth.uid() = user_id);

create policy "Users can manage their own interests"
  on public.user_interests for insert
  with check (auth.uid() = user_id);

create policy "Users can delete their own interests"
  on public.user_interests for delete
  using (auth.uid() = user_id);

create index idx_user_interests_user on public.user_interests(user_id);
create index idx_user_interests_interest on public.user_interests(interest);

-- ============================================================
-- MATCHING QUEUE
-- ============================================================
create table if not exists public.matching_queue (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  mode            text not null check (mode in ('random', 'interest')),
  interests       text[] default '{}',
  status          text not null check (status in ('waiting', 'matched')) default 'waiting',
  matched_user_id uuid references auth.users(id) on delete set null,
  session_id      text,
  created_at      timestamptz not null default now(),
  matched_at      timestamptz
);

alter table public.matching_queue enable row level security;

create policy "Users can view their own queue entries"
  on public.matching_queue for select
  using (auth.uid() = user_id);

create policy "Users can create queue entries"
  on public.matching_queue for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own queue entries"
  on public.matching_queue for update
  using (auth.uid() = user_id);

create policy "Users can delete their own queue entries"
  on public.matching_queue for delete
  using (auth.uid() = user_id);

create index idx_matching_queue_status on public.matching_queue(status);
create index idx_matching_queue_mode on public.matching_queue(mode);
create index idx_matching_queue_created on public.matching_queue(created_at);

-- ============================================================
-- HELPER FUNCTION: Token deduction with atomic check
-- ============================================================
create or replace function public.deduct_tokens(
  p_user_id uuid,
  p_amount integer,
  p_type text,
  p_description text default null,
  p_session_id text default null
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_balance integer;
begin
  select balance into v_balance
  from public.token_balances
  where user_id = p_user_id
  for update;

  if not found or v_balance < p_amount then
    return jsonb_build_object('success', false, 'balance', coalesce(v_balance, 0));
  end if;

  update public.token_balances
  set balance = balance - p_amount,
      updated_at = now()
  where user_id = p_user_id;

  insert into public.token_transactions (user_id, amount, type, description, session_id)
  values (p_user_id, -p_amount, p_type, p_description, p_session_id);

  return jsonb_build_object('success', true, 'balance', v_balance - p_amount);
end;
$$;

-- ============================================================
-- HELPER FUNCTION: Daily token grant
-- ============================================================
create or replace function public.claim_daily_tokens(
  p_user_id uuid,
  p_amount integer default 20
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_balance integer;
  v_last_daily timestamptz;
begin
  select balance, last_daily_at into v_balance, v_last_daily
  from public.token_balances
  where user_id = p_user_id
  for update;

  if not found then
    insert into public.token_balances (user_id, balance, last_daily_at)
    values (p_user_id, p_amount, now());

    insert into public.token_transactions (user_id, amount, type, description)
    values (p_user_id, p_amount, 'daily_allowance', 'Welcome bonus');

    return jsonb_build_object('success', true, 'balance', p_amount, 'claimed', true);
  end if;

  if v_last_daily + interval '24 hours' <= now() then
    update public.token_balances
    set balance = v_balance + p_amount,
        last_daily_at = now(),
        updated_at = now()
    where user_id = p_user_id;

    insert into public.token_transactions (user_id, amount, type, description)
    values (p_user_id, p_amount, 'daily_allowance', 'Daily token allowance');

    return jsonb_build_object('success', true, 'balance', v_balance + p_amount, 'claimed', true);
  end if;

  return jsonb_build_object('success', true, 'balance', v_balance, 'claimed', false);
end;
$$;

-- ============================================================
-- AUTO-CREATE PROFILE ON USER SIGNUP
-- ============================================================
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
