-- ============================================================
-- 00006: chat_sessions realtime + re-match guard in matching RPCs
--
-- 1. REALTIME: chat_sessions must be in the supabase_realtime
--    publication so clients can react to:
--      * guest assignment on private rooms (user2_id becomes set)
--      * a peer ending the session (status -> 'ended')
--    Guarded membership check — safe to re-run.
--
-- 2. RE-MATCH GUARD (find_random_match / find_interest_match):
--    While a poll is in flight, the peer's RPC may already have
--    matched us. Without a guard the poll's own RPC can then match
--    a THIRD user, creating two sessions for the same user (the
--    classic "stuck peer" bug). Both RPCs now:
--      * lock the caller's own queue rows first, serializing
--        concurrent RPCs from the same user (two tabs, retries)
--      * return the user's OWN most recent matched session (if
--        newer than the guard window) INSTEAD of matching a new
--        peer — both users therefore always land on the SAME
--        session id.
-- ============================================================

-- ------------------------------------------------------------
-- 1. REALTIME PUBLICATION MEMBERSHIP
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_sessions'
  ) then
    alter publication supabase_realtime add table public.chat_sessions;
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 2. find_random_match with re-match guard
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
  v_own_session text;
begin
  if p_user_id is null
     or auth.uid() is null
     or auth.uid() <> p_user_id then
    return jsonb_build_object('matched', false, 'error', 'unauthorized');
  end if;

  -- Serialize concurrent RPCs for the SAME user: lock the caller's own
  -- waiting rows (and recent matched rows). A duplicate request that
  -- arrives while another is in flight waits here, then sees the result
  -- below instead of matching a second peer.
  perform 1
  from public.matching_queue
  where user_id = p_user_id
    and (status = 'waiting' or matched_at > now() - interval '3 minutes')
  for update;

  -- Already matched very recently (the peer's RPC claimed us while our
  -- poll was in flight, or the response was lost)? Return the SAME
  -- session so both users always converge on one session id.
  select session_id into v_own_session
  from public.matching_queue
  where user_id = p_user_id
    and status = 'matched'
    and matched_at > now() - interval '3 minutes'
  order by matched_at desc
  limit 1;

  if found then
    select matched_user_id into v_match_user_id
    from public.matching_queue
    where user_id = p_user_id
      and status = 'matched'
      and session_id = v_own_session
    limit 1;
    return jsonb_build_object(
      'matched', true,
      'session_id', v_own_session,
      'peer_id', v_match_user_id
    );
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

-- ------------------------------------------------------------
-- 3. find_interest_match with re-match guard
-- ------------------------------------------------------------
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
  v_own_session text;
  v_entry record;
begin
  if p_user_id is null
     or auth.uid() is null
     or auth.uid() <> p_user_id then
    return jsonb_build_object('matched', false, 'error', 'unauthorized');
  end if;

  -- Same-user serialization (see find_random_match above).
  perform 1
  from public.matching_queue
  where user_id = p_user_id
    and (status = 'waiting' or matched_at > now() - interval '3 minutes')
  for update;

  -- Re-match guard: return the caller's own recent session if present.
  select session_id into v_own_session
  from public.matching_queue
  where user_id = p_user_id
    and status = 'matched'
    and matched_at > now() - interval '3 minutes'
  order by matched_at desc
  limit 1;

  if found then
    select matched_user_id into v_match_user_id
    from public.matching_queue
    where user_id = p_user_id
      and status = 'matched'
      and session_id = v_own_session
    limit 1;
    return jsonb_build_object(
      'matched', true,
      'session_id', v_own_session,
      'peer_id', v_match_user_id
    );
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

-- ------------------------------------------------------------
-- 4. SECURITY: unchanged — anon still cannot execute these.
-- ------------------------------------------------------------
revoke execute on function public.find_random_match(uuid, text) from anon;
revoke execute on function public.find_interest_match(uuid, text[], text) from anon;