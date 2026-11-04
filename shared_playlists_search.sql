-- ALAMKAROK shared playlist cards + room-wide song search
-- Run once in the Supabase SQL Editor for the existing project.

create table if not exists public.room_playlists (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  created_by uuid references public.participants(id) on delete set null,
  created_by_name text not null default 'Room member',
  created_at timestamptz not null default now()
);

create table if not exists public.room_playlist_items (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  playlist_id uuid not null references public.room_playlists(id) on delete cascade,
  video_id text not null,
  title text not null default 'YouTube video',
  thumbnail text,
  position integer not null default 0,
  added_by uuid references public.participants(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (playlist_id, video_id)
);

create index if not exists room_playlists_room_created_idx on public.room_playlists(room_id, created_at desc);
create index if not exists room_playlist_items_room_position_idx on public.room_playlist_items(room_id, position);
create index if not exists room_playlist_items_playlist_position_idx on public.room_playlist_items(playlist_id, position);

alter table public.room_playlists enable row level security;
alter table public.room_playlist_items enable row level security;

drop policy if exists room_playlists_select on public.room_playlists;
drop policy if exists room_playlists_insert on public.room_playlists;
drop policy if exists room_playlists_delete on public.room_playlists;
drop policy if exists room_playlist_items_select on public.room_playlist_items;
drop policy if exists room_playlist_items_insert on public.room_playlist_items;
drop policy if exists room_playlist_items_delete on public.room_playlist_items;

-- Match the current ALAMKAROK MVP room-access policy model.
create policy room_playlists_select on public.room_playlists for select to anon, authenticated using (true);
create policy room_playlists_insert on public.room_playlists for insert to anon, authenticated with check (true);
create policy room_playlists_delete on public.room_playlists for delete to anon, authenticated using (true);
create policy room_playlist_items_select on public.room_playlist_items for select to anon, authenticated using (true);
create policy room_playlist_items_insert on public.room_playlist_items for insert to anon, authenticated with check (true);
create policy room_playlist_items_delete on public.room_playlist_items for delete to anon, authenticated using (true);

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='room_playlists') then alter publication supabase_realtime add table public.room_playlists; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='room_playlist_items') then alter publication supabase_realtime add table public.room_playlist_items; end if;
end $$;
