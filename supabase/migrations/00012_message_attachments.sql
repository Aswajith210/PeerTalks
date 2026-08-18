-- ============================================================
-- 00012: chat attachments (message_attachments + private bucket)
--
-- Files are uploaded to a PRIVATE storage bucket whose folder
-- layout is {session_id}/{message_id}/{filename}, so an object's
-- first path segment already tells us which session it belongs
-- to. Uploads are allowed only for session participants and only
-- under their own session's folder; reads are allowed only for
-- session participants (folder + message_attachments row both
-- checked). message_attachments is the DB-side ledger that links
-- a stored object to a message, with the sender, size and mime
-- type the client needs to render the bubble.
--
-- 1. message_attachments table + RLS
--      select  -> session participant (1-1 columns or roster)
--      insert  -> uploader bound to auth.uid() + participant
--      (no update/delete policies: attachments are immutable;
--       rows die with the message via cascade)
-- 2. storage bucket chat-attachments (private, no public read)
-- 3. storage.objects policies
--      insert  -> participant of the session named by the first
--                 path segment (text comparison — no uuid cast,
--                 so a malformed folder can never raise)
--      select  -> the object has a message_attachments row AND
--                 the caller is a participant of that session
-- 4. Realtime: message_attachments joins supabase_realtime so
--    the peer receives the attachment event without polling.
--
-- Safe to re-run (create-table-if-not-exists, drop-if-exists,
-- guarded do-block).
-- ============================================================

-- ------------------------------------------------------------
-- 1. MESSAGE ATTACHMENTS
-- ------------------------------------------------------------
create table if not exists public.message_attachments (
  id           bigint generated always as identity primary key,
  message_id   bigint not null references public.messages(id) on delete cascade,
  session_id   uuid not null references public.chat_sessions(id) on delete cascade,
  uploader_id  uuid references auth.users(id) on delete set null,
  file_name    text not null,
  file_size    bigint not null check (file_size >= 0),
  mime_type    text,
  storage_path text not null unique,
  created_at   timestamptz not null default now()
);

alter table public.message_attachments enable row level security;

create policy "Session participants can view attachments"
  on public.message_attachments for select
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

create policy "Session participants can attach files"
  on public.message_attachments for insert
  with check (
    uploader_id = auth.uid()
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

create index if not exists idx_message_attachments_message on public.message_attachments(message_id);
create index if not exists idx_message_attachments_session on public.message_attachments(session_id);

-- ------------------------------------------------------------
-- 2. STORAGE BUCKET (private)
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('chat-attachments', 'chat-attachments', false)
on conflict (id) do nothing;

-- ------------------------------------------------------------
-- 3. STORAGE POLICIES
-- ------------------------------------------------------------
-- Upload: the first path segment is the session id; the caller
-- must be a participant of that session. Comparing id::text to
-- the folder avoids a uuid cast on garbage folders (a failed
-- cast would RAISE inside the policy instead of returning false).
drop policy if exists "Chat participants can upload attachments" on storage.objects;

create policy "Chat participants can upload attachments"
  on storage.objects for insert
  with check (
    bucket_id = 'chat-attachments'
    and exists (
      select 1 from public.chat_sessions cs
      where cs.id::text = (storage.foldername(name))[1]
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

-- Read: the object must be tracked by a message_attachments row
-- (the uploader inserts it right after the upload) and the caller
-- must be a participant of that row's session.
drop policy if exists "Chat participants can read attachments" on storage.objects;

create policy "Chat participants can read attachments"
  on storage.objects for select
  using (
    bucket_id = 'chat-attachments'
    and exists (
      select 1
      from public.message_attachments ma
      join public.chat_sessions cs on cs.id = ma.session_id
      where ma.storage_path = name
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
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_attachments'
  ) then
    alter publication supabase_realtime add table public.message_attachments;
  end if;
end;
$$;