-- ALAMKAROK chat + point giving migration
-- Run this once in Supabase SQL Editor on an existing ALAMKAROK project.

alter table public.participants
  add column if not exists points integer not null default 0;

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  sender_id uuid references public.participants(id) on delete set null,
  name text not null check (char_length(name) between 1 and 40),
  color text not null,
  message text not null check (char_length(message) between 1 and 240),
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_room_created_idx
  on public.chat_messages(room_id, created_at);

alter table public.chat_messages enable row level security;

drop policy if exists chat_messages_select on public.chat_messages;
drop policy if exists chat_messages_insert on public.chat_messages;
drop policy if exists chat_messages_delete on public.chat_messages;

create policy chat_messages_select on public.chat_messages
  for select to anon, authenticated using (true);

create policy chat_messages_insert on public.chat_messages
  for insert to anon, authenticated with check (true);

create policy chat_messages_delete on public.chat_messages
  for delete to anon, authenticated using (true);

-- Atomic point transfer so two people giving points at the same time do not overwrite each other.
create or replace function public.give_points(
  p_room_id uuid,
  p_giver_id uuid,
  p_recipient_id uuid,
  p_amount integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_points integer;
  giver_room uuid;
  recipient_room uuid;
begin
  if p_amount not in (1,5,10) then
    raise exception 'Invalid point amount';
  end if;

  select room_id into giver_room from public.participants where id = p_giver_id;
  select room_id into recipient_room from public.participants where id = p_recipient_id;

  if giver_room is null or recipient_room is null or giver_room <> p_room_id or recipient_room <> p_room_id then
    raise exception 'Participants are not in this room';
  end if;

  if p_giver_id = p_recipient_id then
    raise exception 'You cannot give points to yourself';
  end if;

  update public.participants
     set points = points + p_amount
   where id = p_recipient_id
   returning points into new_points;

  return new_points;
end;
$$;

grant execute on function public.give_points(uuid,uuid,uuid,integer) to anon, authenticated;

-- Enable realtime for chat history updates.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;
