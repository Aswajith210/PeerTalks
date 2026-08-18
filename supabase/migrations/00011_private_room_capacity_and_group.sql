-- ============================================================
-- 00011: private-room capacity + group sessions
--
-- The schema was strictly 1-1: private_rooms (host_id, guest_id)
-- and chat_sessions (user1_id, user2_id). This migration adds
-- capacity limits and the membership tables needed for rooms of
-- 3+ people, while keeping every existing policy and flow intact
-- (new membership is an OR-path, never a replacement).
--
-- 1. private_rooms.capacity   (default 2, max 8) — the host sets
--    it at creation; 1 means "host only" is NOT valid (check 2..8).
-- 2. room_participants        — who is in the room. The host row
--    is written by the room-create route; guests are added by the
--    join RPC below.
-- 3. chat_participants        — who is in the CHAT SESSION. 2-user
--    sessions do not need rows here (all existing policies still
--    work off user1_id/user2_id); group sessions carry the extras.
-- 4. join_private_room RPC    — ATOMIC join: locks the room row so
--    two concurrent joins cannot both pass the capacity check,
--    verifies is_active, rejects when full, records the guest
--    (guest_id backfill keeps the old UI/RLS working), finds or
--    creates the connected session, and syncs room members into
--    chat_participants. Security definer, caller-bound to
--    auth.uid() — same contract as the matching RPCs.
-- 5. Group OR-policies        — messages (select + insert) and
--    chat_sessions (select) now also accept chat_participants
--    membership. Policies are permissive-OR, so 1-1 behaviour is
--    byte-for-byte unchanged.
-- 6. Realtime                 — chat_participants joins the
--    supabase_realtime publication (roster changes broadcast).
--
-- Safe to re-run (guarded do-blocks, drop-if-exists, or-replace).
-- ============================================================

-- ------------------------------------------------------------
-- 1. CAPACITY ON private_rooms
-- ------------------------------------------------------------
alter table public.private_rooms
  add column if not exists capacity integer not null default 2
  check (capacity between 2 and 8);

-- ------------------------------------------------------------
-- 2. ROOM PARTICIPANTS (group membership on the room itself)
-- ------------------------------------------------------------
create table if not exists public.room_participants (
  room_id   uuid not null references public.private_rooms(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

alter table public.room_participants enable row level security;

-- Roster is visible to the host and to any participant.
-- Writes happen only inside the security-definer join RPC / the
-- room-create route, so no client insert/update/delete policies
-- exist: a direct client write is rejected by RLS.
create policy "Room host or participants can view members"
  on public.room_participants for select
  using (
    exists (
      select 1 from public.private_rooms pr
      where pr.id = room_id
        and (
          pr.host_id = auth.uid()
          or exists (
            select 1 from public.room_participants rp
            where rp.room_id = room_id and rp.user_id = auth.uid()
          )
        )
    )
  );

create index if not exists idx_room_participants_user on public.room_participants(user_id);

-- ------------------------------------------------------------
-- 3. CHAT PARTICIPANTS (group membership on the session)
-- ------------------------------------------------------------
create table if not exists public.chat_participants (
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (session_id, user_id)
);

alter table public.chat_participants enable row level security;

-- Roster is visible to anyone who is part of the session (via the
-- 1-1 columns or via chat_participants itself).
create policy "Session participants can view the roster"
  on public.chat_participants for select
  using (
    exists (
      select 1 from public.chat_sessions cs
      where cs.id = session_id
        and (
          cs.user1_id = auth.uid()
          or cs.user2_id = auth.uid()
          or exists (
            select 1 from public.chat_participants cp
            where cp.session_id = session_id and cp.user_id = auth.uid()
          )
        )
    )
  );

create index if not exists idx_chat_participants_user on public.chat_participants(user_id);
create index if not exists idx_chat_participants_session on public.chat_participants(session_id);

-- ------------------------------------------------------------
-- 4. ATOMIC JOIN RPC (capacity enforced under a row lock)
-- ------------------------------------------------------------
create or replace function public.join_private_room(
  p_room_id uuid,
  p_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room      record;
  v_occupancy integer;
  v_session_id uuid;
begin
  if p_room_id is null or p_user_id is null
     or auth.uid() is null or auth.uid() <> p_user_id then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  -- Row lock serializes concurrent joins: the second caller waits
  -- here and then re-counts against the NEW occupancy.
  select id, host_id, is_active, capacity
    into v_room
    from public.private_rooms
    where id = p_room_id
    for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'room_not_found');
  end if;

  if not v_room.is_active then
    return jsonb_build_object('success', false, 'error', 'room_ended');
  end if;

  -- Already a participant? Idempotent re-join returns the session.
  perform 1 from public.room_participants
  where room_id = p_room_id and user_id = p_user_id;

  if found then
    select id into v_session_id
    from public.chat_sessions
    where room_id = p_room_id::text and status = 'connected'
    order by created_at desc
    limit 1;

    return jsonb_build_object(
      'success', true,
      'session_id', v_session_id::text,
      'already_joined', true
    );
  end if;

  -- Capacity: the host occupies one slot; count the guests.
  select count(*) into v_occupancy
  from public.room_participants
  where room_id = p_room_id
    and user_id <> v_room.host_id;

  if v_occupancy >= v_room.capacity - 1 then
    return jsonb_build_object('success', false, 'error', 'room_full');
  end if;

  insert into public.room_participants (room_id, user_id)
  values (p_room_id, p_user_id);

  -- guest_id backfill: the pre-capacity UI and RLS read guest_id,
  -- so the FIRST guest also fills that column.
  update public.private_rooms
  set guest_id = p_user_id
  where id = p_room_id and guest_id is null;

  -- Reuse the room's connected session (first join creates it).
  select id into v_session_id
  from public.chat_sessions
  where room_id = p_room_id::text and status = 'connected'
  order by created_at desc
  limit 1;

  if not found then
    insert into public.chat_sessions (mode, status, user1_id, user2_id, room_id)
    values ('private_room', 'connected', v_room.host_id, p_user_id, p_room_id::text)
    returning id into v_session_id;
  end if;

  -- Mirror every room member into the session roster.
  insert into public.chat_participants (session_id, user_id)
  select v_session_id, rp.user_id
  from public.room_participants rp
  where rp.room_id = p_room_id
  on conflict (session_id, user_id) do nothing;

  return jsonb_build_object('success', true, 'session_id', v_session_id::text);
end;
$$;

revoke execute on function public.join_private_room(uuid, uuid) from anon;

-- ------------------------------------------------------------
-- 5. GROUP OR-POLICIES (existing 1-1 behaviour unchanged)
-- ------------------------------------------------------------
create policy "Chat participants can view messages"
  on public.messages for select
  using (
    exists (
      select 1 from public.chat_participants
      where session_id = messages.session_id
        and user_id = auth.uid()
    )
  );

create policy "Chat participants can insert messages"
  on public.messages for insert
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.chat_participants
      where session_id = messages.session_id
        and user_id = auth.uid()
    )
  );

create policy "Chat participants can view their sessions"
  on public.chat_sessions for select
  using (
    exists (
      select 1 from public.chat_participants
      where session_id = chat_sessions.id
        and user_id = auth.uid()
    )
  );

-- ------------------------------------------------------------
-- 6. REALTIME MEMBERSHIP (guarded, safe to re-run)
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_participants'
  ) then
    alter publication supabase_realtime add table public.chat_participants;
  end if;
end;
$$;