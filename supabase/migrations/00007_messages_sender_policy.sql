-- ============================================================
-- 00007: messages INSERT policy must bind sender_id
--
-- PROVEN DEFECT: the messages INSERT policy only checked session
-- participation, so any participant could insert a message with
-- sender_id set to ANY OTHER user (message spoofing — a user can
-- make it look like their partner said anything). The chat room
-- inserts messages client-side (room/[id]/page.tsx), so this is a
-- live spoofing vector, not a theoretical one.
--
-- Fix: the WITH CHECK clause now also requires
--   sender_id = auth.uid()
-- (the message must be FROM the authenticated user). A user can
-- still only send into sessions they participate in — that check
-- stays unchanged.
--
-- Safe to re-run (drop policy if exists + create).
-- ============================================================

drop policy if exists "Session participants can insert messages" on public.messages;

create policy "Session participants can insert messages"
  on public.messages for insert
  with check (
    exists (
      select 1 from public.chat_sessions
      where id = session_id
        and (user1_id = auth.uid() or user2_id = auth.uid())
    )
    and sender_id = auth.uid()
  );