-- ALAMKAROK MVP schema for Supabase
-- Run this in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  host_id uuid,
  current_video_id text,
  current_index integer not null default 0,
  is_playing boolean not null default false,
  position_seconds double precision not null default 0,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid,
  name text not null check (char_length(name) between 1 and 40),
  color text not null,
  created_at timestamptz not null default now(),
  unique(room_id, user_id)
);

create table if not exists public.queue_items (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  video_id text not null,
  title text not null default 'YouTube video',
  thumbnail text,
  added_by uuid references public.participants(id) on delete set null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists queue_room_position_idx on public.queue_items(room_id, position);
create index if not exists participants_room_idx on public.participants(room_id);

alter table public.rooms enable row level security;
alter table public.participants enable row level security;
alter table public.queue_items enable row level security;

-- MVP policies. This is intentionally simple so the prototype can be deployed quickly.
-- For a production deployment, replace these with stricter room-membership policies.
drop policy if exists rooms_select on public.rooms;
drop policy if exists rooms_insert on public.rooms;
drop policy if exists rooms_update on public.rooms;
drop policy if exists participants_select on public.participants;
drop policy if exists participants_insert on public.participants;
drop policy if exists participants_update on public.participants;
drop policy if exists participants_delete on public.participants;
drop policy if exists queue_select on public.queue_items;
drop policy if exists queue_insert on public.queue_items;
drop policy if exists queue_update on public.queue_items;
drop policy if exists queue_delete on public.queue_items;

create policy rooms_select on public.rooms for select to anon, authenticated using (true);
create policy rooms_insert on public.rooms for insert to anon, authenticated with check (true);
create policy rooms_update on public.rooms for update to anon, authenticated using (true) with check (true);

create policy participants_select on public.participants for select to anon, authenticated using (true);
create policy participants_insert on public.participants for insert to anon, authenticated with check (true);
create policy participants_update on public.participants for update to anon, authenticated using (true) with check (true);
create policy participants_delete on public.participants for delete to anon, authenticated using (true);

create policy queue_select on public.queue_items for select to anon, authenticated using (true);
create policy queue_insert on public.queue_items for insert to anon, authenticated with check (true);
create policy queue_update on public.queue_items for update to anon, authenticated using (true) with check (true);
create policy queue_delete on public.queue_items for delete to anon, authenticated using (true);

-- Realtime publication for database changes. Safe to run more than once.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='rooms') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='participants') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.participants;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='queue_items') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.queue_items;
  END IF;
END $$;

-- Chat + points additions for fresh installations.
alter table public.participants add column if not exists points integer not null default 0;
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  sender_id uuid references public.participants(id) on delete set null,
  name text not null check (char_length(name) between 1 and 40),
  color text not null,
  message text not null check (char_length(message) between 1 and 240),
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_room_created_idx on public.chat_messages(room_id, created_at);
alter table public.chat_messages enable row level security;
drop policy if exists chat_messages_select on public.chat_messages;
drop policy if exists chat_messages_insert on public.chat_messages;
drop policy if exists chat_messages_delete on public.chat_messages;
create policy chat_messages_select on public.chat_messages for select to anon, authenticated using (true);
create policy chat_messages_insert on public.chat_messages for insert to anon, authenticated with check (true);
create policy chat_messages_delete on public.chat_messages for delete to anon, authenticated using (true);
-- Song-scoped points: each giver can award each recipient once per video in a room.
create table if not exists public.point_votes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  video_id text not null,
  giver_id uuid not null references public.participants(id) on delete cascade,
  recipient_id uuid not null references public.participants(id) on delete cascade,
  amount integer not null check (amount in (1,5,10)),
  created_at timestamptz not null default now(),
  constraint point_votes_no_self check (giver_id <> recipient_id),
  constraint point_votes_once_per_recipient_per_song unique (room_id, video_id, giver_id, recipient_id)
);
alter table public.point_votes enable row level security;
drop policy if exists point_votes_select on public.point_votes;
create policy point_votes_select on public.point_votes for select to anon, authenticated using (true);

drop function if exists public.give_points(uuid,uuid,uuid,integer);
create or replace function public.give_points(p_room_id uuid,p_giver_id uuid,p_recipient_id uuid,p_video_id text,p_amount integer)
returns integer language plpgsql security definer set search_path=public as $
declare new_points integer; giver_room uuid; recipient_room uuid; current_video text; playing boolean; inserted_vote uuid;
begin
  if p_amount not in (1,5,10) then raise exception 'Invalid point amount'; end if;
  select room_id into giver_room from public.participants where id=p_giver_id;
  select room_id into recipient_room from public.participants where id=p_recipient_id;
  if giver_room is null or recipient_room is null or giver_room<>p_room_id or recipient_room<>p_room_id then raise exception 'Participants are not in this room'; end if;
  if p_giver_id=p_recipient_id then raise exception 'You cannot give points to yourself'; end if;
  select current_video_id,is_playing into current_video,playing from public.rooms where id=p_room_id;
  if not coalesce(playing,false) or current_video is distinct from p_video_id then raise exception 'Song is not playing or current song changed'; end if;
  insert into public.point_votes(room_id,video_id,giver_id,recipient_id,amount)
  values(p_room_id,p_video_id,p_giver_id,p_recipient_id,p_amount)
  on conflict (room_id,video_id,giver_id,recipient_id) do nothing
  returning id into inserted_vote;
  if inserted_vote is null then raise exception 'Already voted for this person for this song'; end if;
  update public.participants set points=points+p_amount where id=p_recipient_id returning points into new_points;
  return new_points;
end; $;
grant execute on function public.give_points(uuid,uuid,uuid,text,integer) to anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='chat_messages') then alter publication supabase_realtime add table public.chat_messages; end if;
end $$;
