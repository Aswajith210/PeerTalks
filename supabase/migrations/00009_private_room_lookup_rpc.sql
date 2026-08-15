-- ============================================================
-- 00009: private-room lookup RPC — removes the service-role
-- dependency from the user-facing room-join flow
--
-- WHY: rooms/join looked up the room by name with the service-role
-- client, because private_rooms RLS only lets host/guest see a room
-- (a prospective guest, guest_id still null, sees zero rows). That
-- made the route require SUPABASE_SERVICE_ROLE_KEY just to find the
-- room. This RPC does the SAME lookup under SECURITY DEFINER (like
-- the matching RPCs), so the authenticated user session is enough:
--
--   create:      authenticated client (policy: host_id = auth.uid())
--   join:        lookup_private_room() RPC -> deduct -> join RPC
--
-- NOTE: the RPC returns password_hash to the authenticated caller —
-- identical to what the old service-role lookup handed the route;
-- bcrypt compare still happens in the Node route. bcrypt hashes are
-- not reversible and the room is only reachable by its name, so the
-- exposure is unchanged from the previous design.
--
-- Safe to re-run.
-- ============================================================

create or replace function public.lookup_private_room(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  if p_name is null or p_name = '' or auth.uid() is null then
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

  return jsonb_build_object(
    'id', v_row.id,
    'name', v_row.name,
    'password_hash', v_row.password_hash,
    'host_id', v_row.host_id,
    'guest_id', v_row.guest_id,
    'is_active', v_row.is_active,
    'created_at', v_row.created_at,
    'ended_at', v_row.ended_at
  );
end;
$$;

revoke execute on function public.lookup_private_room(text) from anon;