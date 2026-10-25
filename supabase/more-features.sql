-- Dollar Search: more features (research tags and pictures, pinned research, daily stars, bookmarks,
-- reactions, messages, collab notes, gifting, reports and the admin page).
-- Run once in Supabase: SQL Editor -> New query -> paste this whole file -> Run. Safe to run again.
-- Run star-shop.sql first (this file builds on its tables).

-- ---------------------------------------------------------------------------
-- Research: topic tags, a cover picture, and when it was last updated. A pinned card per portfolio.
-- ---------------------------------------------------------------------------
alter table public.projects add column if not exists tags text[] not null default '{}';
alter table public.projects add column if not exists image text not null default '';
-- Old research counts as last updated when it was posted (only fills in empty dates, so running again is safe).
alter table public.projects add column if not exists updated_at timestamptz;
update public.projects set updated_at = created_at where updated_at is null;
alter table public.projects alter column updated_at set default now();
alter table public.projects alter column updated_at set not null;
alter table public.projects drop constraint if exists projects_tags_check;
alter table public.projects add constraint projects_tags_check check (cardinality(tags) <= 3);
alter table public.projects drop constraint if exists projects_image_check;
alter table public.projects add constraint projects_image_check check (char_length(image) <= 500);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists projects_touch_updated_at on public.projects;
create trigger projects_touch_updated_at before update on public.projects
  for each row execute function public.touch_updated_at();

grant update (title, link, description, sources, tags, image) on public.projects to authenticated;

alter table public.profiles add column if not exists pinned_project uuid references public.projects (id) on delete set null;
grant update (name, description, email, avatar, pinned_project) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Daily star: one free star per day (US Eastern days), claimed through claim_daily_star().
-- ---------------------------------------------------------------------------
create table if not exists public.star_claims (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null,
  primary key (user_id, day)
);
alter table public.star_claims enable row level security;
drop policy if exists "see own claims" on public.star_claims;
create policy "see own claims" on public.star_claims for select to authenticated using (user_id = auth.uid());
grant select on public.star_claims to authenticated;

create or replace function public.claim_daily_star()
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'America/New_York')::date;
  added int;
begin
  if auth.uid() is null then
    raise exception 'Sign in to claim your star.';
  end if;
  insert into public.star_claims (user_id, day) values (auth.uid(), today)
  on conflict (user_id, day) do nothing;
  get diagnostics added = row_count;
  return json_build_object('claimed', added > 0, 'day', today);
end;
$$;
revoke all on function public.claim_daily_star() from public;
grant execute on function public.claim_daily_star() to authenticated;

-- ---------------------------------------------------------------------------
-- Bookmarks: research you've saved. Private to you.
-- ---------------------------------------------------------------------------
create table if not exists public.bookmarks (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, project_id)
);
alter table public.bookmarks enable row level security;
drop policy if exists "own bookmarks" on public.bookmarks;
create policy "own bookmarks" on public.bookmarks for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, delete on public.bookmarks to authenticated;
