-- Fix duplicate policy name on token_balances
drop policy if exists "System can update token balances" on public.token_balances;

create policy "Users can insert token balances"
  on public.token_balances for insert
  with check (auth.uid() = user_id);

create policy "Users can update token balances"
  on public.token_balances for update
  using (auth.uid() = user_id);

-- Enable Realtime for tables used by client subscriptions
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.token_balances;
alter publication supabase_realtime add table public.matching_queue;

-- ============================================================
-- RPC: Find and claim a random match atomically
-- Called by: anon-key client (security definer bypasses RLS)
-- ============================================================
create or replace function public.find_random_match(p_user_id uuid)
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
  -- Find the oldest waiting entry from another user (with row lock)
  select id, user_id into v_match_id, v_match_user_id
  from public.matching_queue
  where mode = 'random'
    and status = 'waiting'
    and user_id != p_user_id
  order by created_at asc
  limit 1
  for update skip locked;

  if not found then
    return jsonb_build_object('matched', false);
  end if;

  -- Create chat session
  insert into public.chat_sessions (mode, status, user1_id, user2_id)
  values ('random', 'connected', v_match_user_id, p_user_id)
  returning id into v_session_id;

  -- Mark first user's entry as matched
  update public.matching_queue
  set status = 'matched',
      matched_user_id = p_user_id,
      session_id = v_session_id::text,
      matched_at = now()
  where id = v_match_id;

  -- Insert second user's entry
  insert into public.matching_queue (user_id, mode, status, matched_user_id, session_id, matched_at)
  values (p_user_id, 'random', 'matched', v_match_user_id, v_session_id::text, now());

  return jsonb_build_object(
    'matched', true,
    'session_id', v_session_id::text,
    'peer_id', v_match_user_id
  );
end;
$$;

-- ============================================================
-- RPC: Find an interest match atomically
-- Called by: anon-key client (security definer bypasses RLS)
-- ============================================================
create or replace function public.find_interest_match(
  p_user_id uuid,
  p_interests text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match_id bigint;
  v_match_user_id uuid;
  v_match_interests text[];
  v_overlap text;
  v_session_id uuid;
  v_entry record;
begin
  -- Find waiting interest entries from other users
  for v_entry in
    select id, user_id, interests
    from public.matching_queue
    where mode = 'interest'
      and status = 'waiting'
      and user_id != p_user_id
    order by created_at asc
    for update skip locked
  loop
    -- Check for overlapping interests
    select i into v_overlap
    from unnest(p_interests) i
    where i = any(v_entry.interests)
    limit 1;

    if found then
      v_match_id := v_entry.id;
      v_match_user_id := v_entry.user_id;
      v_match_interests := v_entry.interests;
      exit;
    end if;
  end loop;

  if v_match_id is null then
    return jsonb_build_object('matched', false);
  end if;

  -- Create chat session
  insert into public.chat_sessions (mode, status, user1_id, user2_id)
  values ('interest', 'connected', v_match_user_id, p_user_id)
  returning id into v_session_id;

  -- Mark first user's entry as matched
  update public.matching_queue
  set status = 'matched',
      matched_user_id = p_user_id,
      session_id = v_session_id::text,
      matched_at = now()
  where id = v_match_id;

  -- Insert second user's entry
  insert into public.matching_queue (user_id, mode, interests, status, matched_user_id, session_id, matched_at)
  values (p_user_id, 'interest', p_interests, 'matched', v_match_user_id, v_session_id::text, now());

  return jsonb_build_object(
    'matched', true,
    'session_id', v_session_id::text,
    'peer_id', v_match_user_id
  );
end;
$$;

-- ============================================================
-- RPC: Join a private room as guest (full flow)
-- Handles: guest assignment + chat session lookup/creation
-- Called by: anon-key client (security definer bypasses RLS)
-- ============================================================
create or replace function public.join_private_room_as_guest(
  p_room_id uuid,
  p_guest_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id text;
  v_host_id uuid;
begin
  update public.private_rooms
  set guest_id = p_guest_id
  where id = p_room_id
    and is_active = true
    and guest_id is null
  returning host_id into v_host_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Room not found or already full');
  end if;

  -- Find existing waiting chat session
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
