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
-- SAFETY: every public table here has ROW LEVEL SECURITY enabled
-- with user-scoped policies, so granting DML to `authenticated`
-- restores Supabase's STANDARD defaults and changes nothing for
-- the anon role. Nothing is exposed that a policy doesn't allow.
-- Safe to re-run.
-- ============================================================

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
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

-- Re-assert the RPC execution guards (00004 already revokes these;
-- kept here so this file is self-contained if applied standalone).
revoke execute on function public.find_random_match(uuid, text) from anon;
revoke execute on function public.find_interest_match(uuid, text[], text) from anon;
revoke execute on function public.claim_daily_tokens(uuid, integer, text) from anon;
revoke execute on function public.deduct_tokens(uuid, integer, text, text) from anon;
revoke execute on function public.join_private_room_as_guest(uuid, uuid) from anon;