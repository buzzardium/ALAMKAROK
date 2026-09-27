-- ALAMKAROK display-name moderation
create extension if not exists unaccent with schema extensions;

-- Run this once in Supabase SQL Editor.
-- The client also checks names, but this trigger prevents direct API inserts
-- from bypassing the name filter.

create or replace function public.alamkarok_name_is_allowed(p_name text)
returns boolean
language plpgsql
immutable
as $$
declare
  n text;
  blocked text[] := array[
    'nigger','nigga','niggah','niggaz','jigaboo','porchmonkey',
    'kike','yid','heeb',
    'chink','gook','jap',
    'spic','spick','beaner','wetback',
    'paki','raghead','towelhead','sandnigger',
    'gypsy','kafir','kaffir','sandmonkey'
  ];
  term text;
begin
  n := lower(extensions.unaccent(coalesce(p_name,'')));
  n := translate(n, '01345789@$!', 'oieastbgasi');
  n := regexp_replace(n, '[^a-z0-9]+', '', 'g');
  n := regexp_replace(n, '(.)\\1{2,}', '\\1\\1', 'g');

  foreach term in array blocked loop
    if position(term in n) > 0 then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

create or replace function public.check_participant_name()
returns trigger
language plpgsql
as $$
begin
  if not public.alamkarok_name_is_allowed(new.name) then
    raise exception 'That name is not allowed. Please choose another name.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists participants_name_moderation on public.participants;
create trigger participants_name_moderation
before insert or update of name on public.participants
for each row execute function public.check_participant_name();
