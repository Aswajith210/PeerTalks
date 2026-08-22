-- ============================================================
-- 00015: fix infinite-recursion RLS policies (regression from 00011)
--
-- PROBLEM (proven against the live DB, all return 42P17
-- "infinite recursion detected in policy"):
--   1. chat_participants SELECT policy "Session participants can
--      view the roster" (00011) checks membership via
--      `exists (select 1 from chat_participants ...)` — a policy
--      on a table that queries ITSELF. Evaluating it re-enters
--      itself forever.
--   2. room_participants SELECT policy "Room host or participants
--      can view members" (00011) has the identical self-reference.
--   3. Every other policy that consults chat_participants
--      (messages select/insert in 00011/00012/00013, chat_sessions
--      select in 00011) inherits the recursion, so:
--        - INSERT chat_sessions ... RETURNING        -> 500
--          (breaks /api/rooms/create AND any session insert)
--        - SELECT chat_sessions                      -> 500
--          (breaks the room page session load)
--        - SELECT chat_participants / room_participants -> 500
--
-- FIX: membership checks move into SECURITY DEFINER helper
-- functions (owner bypasses RLS, same contract as the matching /
-- join RPCs). Policies call the helper; no policy references a
-- table whose own policy it can trigger.
--
-- Safe to re-run (or-replace functions, drop-if-exists policies).
-- ============================================================

-- ------------------------------------------------------------
-- 1. MEMBERSHIP HELPERS (SECURITY DEFINER, locked search_path)
-- ------------------------------------------------------------
create or replace function public.is_session_participant(p_session_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.chat_sessions cs
    where cs.id = p_session_id
      and (cs.user1_id = auth.uid() or cs.user2_id = auth.uid())
  ) or exists (
    select 1 from public.chat_participants cp
    where cp.session_id = p_session_id and cp.user_id = auth.uid()
  );
$$;

revoke execute on function public.is_session_participant(uuid) from public, anon;
grant execute on function public.is_session_participant(uuid) to authenticated;

create or replace function public.is_room_participant(p_room_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.private_rooms pr
    where pr.id = p_room_id and pr.host_id = auth.uid()
  ) or exists (
    select 1 from public.room_participants rp
    where rp.room_id = p_room_id and rp.user_id = auth.uid()
  );
$$;

revoke execute on function public.is_room_participant(uuid) from public, anon;
grant execute on function public.is_room_participant(uuid) to authenticated;

-- ------------------------------------------------------------
-- 2. REPLACE THE RECURSIVE POLICIES
-- ------------------------------------------------------------
drop policy if exists "Session participants can view the roster" on public.chat_participants;
create policy "Session participants can view the roster"
  on public.chat_participants for select
  using (public.is_session_participant(session_id));

drop policy if exists "Room host or participants can view members" on public.room_participants;
create policy "Room host or participants can view members"
  on public.room_participants for select
  using (public.is_room_participant(room_id));