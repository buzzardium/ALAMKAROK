-- ALAMKAROK shared-queue concurrency protection
-- Run this ONCE in Supabase SQL Editor after the existing schema/chat setup.
-- This file does not touch config.js.

alter table public.rooms
  add column if not exists queue_version bigint not null default 0;

create or replace function public.reorder_queue_item(
  p_room_id uuid,
  p_item_id uuid,
  p_target_id uuid,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_version bigint;
  v_exists boolean;
  v_ordered uuid[];
  v_from integer;
  v_to integer;
  v_tmp uuid;
  v_result jsonb;
begin
  select queue_version into v_version
  from public.rooms
  where id=p_room_id
  for update;

  if not found then raise exception 'Room not found'; end if;
  if v_version <> coalesce(p_expected_version,0) then
    raise exception 'QUEUE_VERSION_CONFLICT: Queue changed by another user';
  end if;

  select exists(select 1 from public.queue_items where id=p_item_id and room_id=p_room_id)
    and exists(select 1 from public.queue_items where id=p_target_id and room_id=p_room_id)
    into v_exists;
  if not v_exists then raise exception 'Queue item not found in this room'; end if;

  select array_agg(id order by position, created_at, id)
    into v_ordered
  from public.queue_items
  where room_id=p_room_id;

  v_from := array_position(v_ordered,p_item_id);
  v_to := array_position(v_ordered,p_target_id);
  if v_from is null or v_to is null or v_from=v_to then
    return jsonb_build_object(
      'queue_version',v_version,
      'queue',coalesce((select jsonb_agg(to_jsonb(q) order by q.position,q.created_at,q.id) from public.queue_items q where q.room_id=p_room_id),'[]'::jsonb)
    );
  end if;

  v_tmp := v_ordered[v_from];
  -- Build the final order by inserting the dragged item immediately before the target.
  declare
    v_new uuid[] := ARRAY[]::uuid[];
  begin
    for i in 1..array_length(v_ordered,1) loop
      if v_ordered[i]=v_tmp then continue; end if;
      if v_ordered[i]=p_target_id then v_new := array_append(v_new,v_tmp); end if;
      v_new := array_append(v_new,v_ordered[i]);
    end loop;
    v_ordered := v_new;
  end;

  -- Rewrite positions inside the same transaction while the room and queue rows are locked.
  for i in 1..array_length(v_ordered,1) loop
    update public.queue_items set position=-i where id=v_ordered[i];
  end loop;
  for i in 1..array_length(v_ordered,1) loop
    update public.queue_items set position=i-1 where id=v_ordered[i];
  end loop;

  update public.rooms
    set queue_version=queue_version+1,
        updated_at=now()
    where id=p_room_id
    returning queue_version into v_version;

  select jsonb_build_object(
    'queue_version',v_version,
    'queue',coalesce(jsonb_agg(to_jsonb(q) order by q.position,q.created_at,q.id),'[]'::jsonb)
  ) into v_result
  from public.queue_items q
  where q.room_id=p_room_id;

  return v_result;
end;
$$;

grant execute on function public.reorder_queue_item(uuid,uuid,uuid,bigint) to anon, authenticated;

create or replace function public.shuffle_queue(
  p_room_id uuid,
  p_expected_version bigint,
  p_ordered_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_version bigint;
  v_count integer;
  v_i integer;
  v_result jsonb;
begin
  select queue_version into v_version
  from public.rooms
  where id=p_room_id
  for update;
  if not found then raise exception 'Room not found'; end if;
  if v_version <> coalesce(p_expected_version,0) then
    raise exception 'QUEUE_VERSION_CONFLICT: Queue changed by another user';
  end if;

  select count(*) into v_count from public.queue_items where room_id=p_room_id;
  if coalesce(array_length(p_ordered_ids,1),0) <> v_count then
    raise exception 'Queue changed by another user';
  end if;
  if exists (
    select 1
    from public.queue_items q
    where q.room_id=p_room_id
      and not (q.id = any(p_ordered_ids))
  ) then raise exception 'Queue changed by another user'; end if;

  -- Ensure every submitted id belongs to this room and there are no duplicates.
  if (select count(distinct x) from unnest(p_ordered_ids) x) <> v_count then
    raise exception 'Invalid queue order';
  end if;

  -- Use negative temporary positions so there is never a transient duplicate ordering.
  for v_i in 1..v_count loop
    update public.queue_items set position=-v_i where id=p_ordered_ids[v_i] and room_id=p_room_id;
  end loop;
  for v_i in 1..v_count loop
    update public.queue_items set position=v_i-1 where id=p_ordered_ids[v_i] and room_id=p_room_id;
  end loop;

  update public.rooms
    set queue_version=queue_version+1,
        updated_at=now()
    where id=p_room_id
    returning queue_version into v_version;

  select jsonb_build_object(
    'queue_version',v_version,
    'queue',coalesce(jsonb_agg(to_jsonb(q) order by q.position,q.created_at,q.id),'[]'::jsonb)
  ) into v_result
  from public.queue_items q
  where q.room_id=p_room_id;
  return v_result;
end;
$$;

grant execute on function public.shuffle_queue(uuid,bigint,uuid[]) to anon, authenticated;
