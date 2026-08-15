-- ============================================================
-- 00009: private-room lookup RPC — removes the service-role
-- dependency from the user-facing room-join flow, WITHOUT exposing
-- password_hash.
--
-- WHY: rooms/join looked up the room by name with the service-role
-- client, because private_rooms RLS only lets host/guest see a room
-- (a prospective guest, guest_id still null, sees zero rows). That
-- made the route require SUPABASE_SERVICE_ROLE_KEY just to find the
-- room. This RPC does the SAME lookup under SECURITY DEFINER (like
-- the matching RPCs), so the authenticated user session is enough:
--
--   create:      authenticated client (policy: host_id = auth.uid())
--   join:        lookup_private_room(name, password) RPC
--                -> password verified inside the RPC (pgcrypto crypt)
--                -> deduct -> join RPC
--
-- SECURITY: password_hash NEVER leaves the database. The RPC takes
-- the plaintext password and compares it against the stored bcrypt
-- hash with pgcrypto's crypt() inside Postgres; the caller receives
-- only safe room metadata plus a password_valid boolean. bcrypt
-- hashes created by bcryptjs ($2a$ prefix) are verified natively by
-- pgcrypto's blowfish crypt, so the comparison is unchanged in
-- strength from the old Node-side bcrypt.compare. If the stored
-- hash is unparseable the RPC returns password_valid = false rather
-- than erroring.
--
-- Safe to re-run (create or replace).
-- ============================================================

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

revoke execute on function public.lookup_private_room(text, text) from anon;