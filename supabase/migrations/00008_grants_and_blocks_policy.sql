-- ============================================================
-- 00008: restore standard Supabase table grants + blocks UPDATE
--
-- WHY: the production DB is missing the default schema grants
-- that Supabase normally applies automatically when tables are
-- created (`alter default privileges`). Live two-account testing
-- proved the symptoms:
--   * client-side messages insert -> "permission denied for
--     table chat_sessions" (the messages INSERT policy subqueries
--     chat_sessions under the caller's grants)
--   * blocks upsert (POST /api/blocks) -> 500
--   * reports insert (POST /api/reports) -> 500
--   * direct token_balances read (GET /api/tokens) -> null
-- RPC-driven flows (matching, claim/deduct) keep working because
-- the RPCs are SECURITY DEFINER — which masked the missing grants.
--
-- SCOPE: grants are added ONLY for the `authenticated` role (the
-- application's real sessions). The `anon` role receives NO table
-- grants here — the client does not read or write any public table
-- without a signed-in session, and RLS stays enabled and effective
-- on every table (each policy is user-scoped). Nothing is exposed
-- that a policy does not already allow.
--
-- Safe to re-run.
-- ============================================================

grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- The blocks upsert (POST /api/blocks) does insert ... on conflict
-- (blocker_id, blocked_id) do update — that needs an UPDATE policy,
-- which only existed for the host in private_rooms and nowhere for
-- blocks. The original insert/select/delete policies stay as-is.
drop policy if exists "Users can update their own blocks" on public.blocks;
create policy "Users can update their own blocks"
  on public.blocks for update
  using (auth.uid() = blocker_id)
  with check (auth.uid() = blocker_id);

-- Re-assert the RPC execution guards (00004/00005/00006 already
-- revoke these; kept here so this file is self-contained if applied
-- standalone). Signatures match exactly what is deployed.
revoke execute on function public.find_random_match(uuid, text) from anon;
revoke execute on function public.find_interest_match(uuid, text[], text) from anon;
revoke execute on function public.claim_daily_tokens(uuid, integer, text) from anon;
revoke execute on function public.deduct_tokens(uuid, integer, text, text, text, text) from anon;
revoke execute on function public.join_private_room_as_guest(uuid, uuid) from anon;