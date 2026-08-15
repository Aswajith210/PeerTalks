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
-- only safe room metadata plus a password_valid boolean. If the
-- stored hash is unparseable the RPC returns password_valid = false
-- rather than erroring.
--
-- HASH-FORMAT NOTE: bcryptjs (v3, what the app uses to create room
-- passwords) emits hashes with the $2b$ prefix. pgcrypto's crypt()
-- on many PostgreSQL versions does not recognise $2b$ and raises
-- "unrecognized password hash algorithm". The $2a$/$2b$/$2y$ markers
-- denote implementation-bugfix variants and are cryptographically
-- IDENTICAL for ASCII passwords (the only difference affects the
-- rare 8-bit-bug case), so normalising the prefix to $2a$ before
-- verification is the standard, security-neutral fix. Live testing
-- proved the correct password failed without this normalisation.
--
-- SCHEMA NOTE: pgcrypto's functions live in the `extensions` schema
-- on Supabase, but on projects where the extension was created via
-- `create extension pgcrypto` in the SQL editor they end up in the
-- `public` schema instead, so the function tries `extensions.crypt`
-- and falls back to `public.crypt`. `create extension if not exists
-- pgcrypto` is idempotent.
--
-- Safe to re-run (create or replace).
-- ============================================================

create extension if not exists pgcrypto;

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
  v_hash   text;
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

  -- bcryptjs emits $2b$; pgcrypto crypt() may only understand $2a$.
  -- $2a$/$2b$/$2y$ compute identically for ASCII passwords, so
  -- normalising the marker keeps verification identical in strength.
  v_hash := replace(replace(v_row.password_hash, '$2b$', '$2a$'), '$2y$', '$2a$');

  begin
    v_valid := extensions.crypt(p_password, v_hash) = v_hash;
  exception
    when undefined_function then
      v_valid := public.crypt(p_password, v_hash) = v_hash;
    when others then
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