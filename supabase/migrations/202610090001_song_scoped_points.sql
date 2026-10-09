-- ALAMKAROK: song-scoped points voting
-- Apply this migration in Supabase SQL Editor before deploying the matching app.js.
-- Each participant may award each other participant one selected amount per video per room,
-- and votes are accepted only while that video is the room's actively playing song.

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
returns integer language plpgsql security definer set search_path=public as $$
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
end; $$;
grant execute on function public.give_points(uuid,uuid,uuid,text,integer) to anon, authenticated;
