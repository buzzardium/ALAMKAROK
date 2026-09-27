-- ALAMKAROK announcements
-- Run this once in Supabase SQL Editor.

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null default '',
  image_url text,
  button_text text,
  button_url text,
  active boolean not null default true,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists announcements_active_idx
  on public.announcements(active, starts_at, expires_at, created_at desc);

alter table public.admin_users enable row level security;
alter table public.announcements enable row level security;

drop policy if exists "admins can read own admin row" on public.admin_users;
create policy "admins can read own admin row"
on public.admin_users for select to authenticated
using (user_id = auth.uid());

-- Visitors may read only currently active announcements.
drop policy if exists "public can read active announcements" on public.announcements;
create policy "public can read active announcements"
on public.announcements for select to anon, authenticated
using (
  active = true
  and starts_at <= now()
  and (expires_at is null or expires_at > now())
);

-- Administrators may manage all announcements.
drop policy if exists "admins can read announcements" on public.announcements;
create policy "admins can read announcements"
on public.announcements for select to authenticated
using (exists (select 1 from public.admin_users a where a.user_id = auth.uid()));

drop policy if exists "admins can insert announcements" on public.announcements;
create policy "admins can insert announcements"
on public.announcements for insert to authenticated
with check (exists (select 1 from public.admin_users a where a.user_id = auth.uid()));

drop policy if exists "admins can update announcements" on public.announcements;
create policy "admins can update announcements"
on public.announcements for update to authenticated
using (exists (select 1 from public.admin_users a where a.user_id = auth.uid()))
with check (exists (select 1 from public.admin_users a where a.user_id = auth.uid()));

drop policy if exists "admins can delete announcements" on public.announcements;
create policy "admins can delete announcements"
on public.announcements for delete to authenticated
using (exists (select 1 from public.admin_users a where a.user_id = auth.uid()));

-- Public announcement image bucket.
insert into storage.buckets (id, name, public)
values ('announcement-images', 'announcement-images', true)
on conflict (id) do update set public = true;

drop policy if exists "public can view announcement images" on storage.objects;
create policy "public can view announcement images"
on storage.objects for select
using (bucket_id = 'announcement-images');

drop policy if exists "admins can upload announcement images" on storage.objects;
create policy "admins can upload announcement images"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'announcement-images'
  and exists (select 1 from public.admin_users a where a.user_id = auth.uid())
);

drop policy if exists "admins can update announcement images" on storage.objects;
create policy "admins can update announcement images"
on storage.objects for update to authenticated
using (
  bucket_id = 'announcement-images'
  and exists (select 1 from public.admin_users a where a.user_id = auth.uid())
)
with check (
  bucket_id = 'announcement-images'
  and exists (select 1 from public.admin_users a where a.user_id = auth.uid())
);

drop policy if exists "admins can delete announcement images" on storage.objects;
create policy "admins can delete announcement images"
on storage.objects for delete to authenticated
using (
  bucket_id = 'announcement-images'
  and exists (select 1 from public.admin_users a where a.user_id = auth.uid())
);

-- FIRST ADMIN SETUP:
-- 1. Create your admin account in Supabase Authentication > Users.
-- 2. Copy that user's UUID.
-- 3. Run this, replacing the UUID:
-- insert into public.admin_users(user_id) values ('YOUR-AUTH-USER-UUID');
