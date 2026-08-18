-- ============================================================
-- 00013: message reads (seen system) + soft delete
--
-- 1. SOFT DELETE — messages gain deleted_at/deleted_by. Deletion
--    is a client-visible UPDATE (realtime already publishes
--    UPDATE events for messages, since 00002), so the peer's open
--    chat sees the tombstone instantly. Only the SENDER may
--    tombstone their own row; the row survives for audit, and the
--    receiver's history re-fetch shows the deleted state too.
-- 2. MESSAGE READS — message_reads holds (message_id, user_id)
--    markers written by the READING client. The peer subscribes
--    to the table and can render "seen" per message. Rows are
--    user-scoped: you may only read/insert your own markers, and
--    only into sessions you participate in.
-- 3. SESSION READ STATE — session_read_state holds the last
--    message id each participant has read, per session. This is
--    what powers the "unread / new messages" badge on re-entry:
--    the client compares its own last_read_message_id against
--    the session's newest message id.
--
-- Realtime: message_reads + session_read_state join the
-- supabase_realtime publication.
--
-- Safe to re-run (drop-if-exists, guarded do-block).
-- ============================================================

-- ------------------------------------------------------------
-- 1. SOFT DELETE COLUMNS + SENDER POLICY
-- ------------------------------------------------------------
alter table public.messages
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null;

-- Only the sender may update their own messages (this is what
-- makes tombstoning safe); sender_id stays bound on update.
drop policy if exists "Senders can soft-delete their own messages" on public.messages;

create policy "Senders can soft-delete their own messages"
  on public.messages for update
  using (sender_id = auth.uid())
  with check (sender_id = auth.uid());

-- ------------------------------------------------------------
-- 2. MESSAGE READS (seen markers)
-- ------------------------------------------------------------
create table if not exists public.message_reads (
  message_id bigint not null references public.messages(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  read_at    timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table public.message_reads enable row level security;

create policy "Session participants can view reads"
  on public.message_reads for select
  using (
    exists (
      select 1
      from public.messages m
      join public.chat_sessions cs on cs.id = m.session_id
      where m.id = message_id
        and (
          cs.user1_id = auth.uid()
          or cs.user2_id = auth.uid()
          or exists (
            select 1 from public.chat_participants cp
            where cp.session_id = cs.id and cp.user_id = auth.uid()
          )
        )
    )
  );

create policy "Users can mark their own reads"
  on public.message_reads for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.messages m
      join public.chat_sessions cs on cs.id = m.session_id
      where m.id = message_id
        and (
          cs.user1_id = auth.uid()
          or cs.user2_id = auth.uid()
          or exists (
            select 1 from public.chat_participants cp
            where cp.session_id = cs.id and cp.user_id = auth.uid()
          )
        )
    )
  );

create policy "Users can update their own reads"
  on public.message_reads for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create index if not exists idx_message_reads_user on public.message_reads(user_id);

-- ------------------------------------------------------------
-- 3. SESSION READ STATE (unread badge)
-- ------------------------------------------------------------
create table if not exists public.session_read_state (
  session_id           uuid not null references public.chat_sessions(id) on delete cascade,
  user_id              uuid not null references auth.users(id) on delete cascade,
  last_read_message_id bigint,
  updated_at           timestamptz not null default now(),
  primary key (session_id, user_id)
);

alter table public.session_read_state enable row level security;

create policy "Session participants can view read state"
  on public.session_read_state for select
  using (
    exists (
      select 1 from public.chat_sessions cs
      where cs.id = session_id
        and (
          cs.user1_id = auth.uid()
          or cs.user2_id = auth.uid()
          or exists (
            select 1 from public.chat_participants cp
            where cp.session_id = cs.id and cp.user_id = auth.uid()
          )
        )
    )
  );

create policy "Users can write their own read state"
  on public.session_read_state for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.chat_sessions cs
      where cs.id = session_id
        and (
          cs.user1_id = auth.uid()
          or cs.user2_id = auth.uid()
          or exists (
            select 1 from public.chat_participants cp
            where cp.session_id = cs.id and cp.user_id = auth.uid()
          )
        )
    )
  );

create policy "Users can update their own read state"
  on public.session_read_state for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ------------------------------------------------------------
-- 4. REALTIME MEMBERSHIP (guarded, safe to re-run)
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reads'
  ) then
    alter publication supabase_realtime add table public.message_reads;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'session_read_state'
  ) then
    alter publication supabase_realtime add table public.session_read_state;
  end if;
end;
$$;