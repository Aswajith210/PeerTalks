-- ============================================================
-- 00003: Safety features + video/text call types
-- Adds: reports, blocks, message_reactions tables
--       call_type on chat_sessions + matching_queue
--       block-aware matching RPCs
-- ============================================================

-- Call type (video or text) for sessions
alter table public.chat_sessions
  add column if not exists call_type text not null default 'video'
  check (call_type in ('video', 'text'));

alter table public.matching_queue
  add column if not exists call_type text not null default 'video'
  check (call_type in ('video', 'text'));

-- ============================================================
-- REPORTS
-- ============================================================
create table if not exists public.reports (
  id                bigint generated always as identity primary key,
  reporter_id       uuid not null references auth.users(id) on delete cascade,
  reported_user_id  uuid not null references auth.users(id) on delete cascade,
  session_id        text,
  reason            text not null check (char_length(reason) between 1 and 500),
  created_at        timestamptz not null default now()
);

alter table public.reports enable row level security;

create policy "Users can create reports"
  on public.reports for insert
  with check (auth.uid() = reporter_id);

create policy "Users can view their own reports"
  on public.reports for select
  using (auth.uid() = reporter_id);

create index idx_reports_reporter on public.reports(reporter_id);
create index idx_reports_reported on public.reports(reported_user_id);

-- ============================================================
-- BLOCKS
-- ============================================================
create table if not exists public.blocks (
  id          bigint generated always as identity primary key,
  blocker_id  uuid not null references auth.users(id) on delete cascade,
  blocked_id  uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (blocker_id, blocked_id)
);

alter table public.blocks enable row level security;

create policy "Users can create blocks"
  on public.blocks for insert
  with check (auth.uid() = blocker_id);

create policy "Users can view their own blocks"
  on public.blocks for select
  using (auth.uid() = blocker_id);

create policy "Users can delete their own blocks"
  on public.blocks for delete
  using (auth.uid() = blocker_id);

create index idx_blocks_blocker on public.blocks(blocker_id);
create index idx_blocks_blocked on public.blocks(blocked_id);

-- ============================================================
-- MESSAGE REACTIONS
-- ============================================================
create table if not exists public.message_reactions (
  id          bigint generated always as identity primary key,
  message_id  bigint not null references public.messages(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  reaction    text not null check (char_length(reaction) <= 16),
  created_at  timestamptz not null default now(),
  unique (message_id, user_id)
);

alter table public.message_reactions enable row level security;

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

create policy "Users can delete their own reactions"
  on public.message_reactions for delete
  using (auth.uid() = user_id);

create index idx_msg_reactions_message on public.message_reactions(message_id);
create index idx_msg_reactions_user on public.message_reactions(user_id);

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.message_reactions;
alter publication supabase_realtime add table public.matching_queue;

-- ============================================================
-- RPC: Find and claim a random match atomically (block-aware)
-- ============================================================
create or replace function public.find_random_match(
  p_user_id uuid,
  p_call_type text default 'video'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match_id bigint;
  v_match_user_id uuid;
  v_session_id uuid;
begin
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

-- ============================================================
-- RPC: Find an interest match atomically (block-aware)
-- ============================================================
create or replace function public.find_interest_match(
  p_user_id uuid,
  p_interests text[],
  p_call_type text default 'video'
)
returns jsonb
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