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

-- Realtime publication for database changes.
alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.participants;
alter publication supabase_realtime add table public.queue_items;
