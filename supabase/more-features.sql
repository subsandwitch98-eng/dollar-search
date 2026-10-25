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

-- ---------------------------------------------------------------------------
-- Reactions on research: Inspiring, Smart and Well-sourced, on top of likes. Everyone can see them.
-- ---------------------------------------------------------------------------
create table if not exists public.project_reactions (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  kind text not null check (kind in ('inspiring', 'smart', 'sourced')),
  created_at timestamptz not null default now(),
  primary key (user_id, project_id, kind)
);
alter table public.project_reactions enable row level security;
drop policy if exists "reactions readable" on public.project_reactions;
create policy "reactions readable" on public.project_reactions for select to anon, authenticated using (true);
-- You can react to other people's research, not your own.
drop policy if exists "react to others" on public.project_reactions;
create policy "react to others" on public.project_reactions for insert to authenticated
  with check (
    user_id = auth.uid()
    and not exists (select 1 from public.projects r join public.profiles p on p.id = r.profile_id
                    where r.id = project_id and p.owner_id = auth.uid())
  );
drop policy if exists "remove own reactions" on public.project_reactions;
create policy "remove own reactions" on public.project_reactions for delete to authenticated using (user_id = auth.uid());
grant select on public.project_reactions to anon, authenticated;
grant insert, delete on public.project_reactions to authenticated;

-- ---------------------------------------------------------------------------
-- Messages between friends (people who follow each other). Only the two people in a chat can read it.
-- ---------------------------------------------------------------------------
create or replace function public.are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select a <> b
    and exists (select 1 from public.follows f join public.profiles p on p.id = f.profile_id
                where f.user_id = a and p.owner_id = b)
    and exists (select 1 from public.follows f join public.profiles p on p.id = f.profile_id
                where f.user_id = b and p.owner_id = a);
$$;
revoke all on function public.are_friends(uuid, uuid) from public;
grant execute on function public.are_friends(uuid, uuid) to authenticated;

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null default auth.uid() references auth.users (id) on delete cascade,
  to_user uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists messages_to_user on public.messages (to_user, created_at);
create index if not exists messages_from_user on public.messages (from_user, created_at);
alter table public.messages enable row level security;
drop policy if exists "read your chats" on public.messages;
create policy "read your chats" on public.messages for select to authenticated
  using (from_user = auth.uid() or to_user = auth.uid());
drop policy if exists "message friends" on public.messages;
create policy "message friends" on public.messages for insert to authenticated
  with check (from_user = auth.uid() and public.are_friends(auth.uid(), to_user));
-- The person a message was sent to can mark it read.
drop policy if exists "mark messages read" on public.messages;
create policy "mark messages read" on public.messages for update to authenticated
  using (to_user = auth.uid()) with check (to_user = auth.uid());
grant select, insert on public.messages to authenticated;
grant update (read_at) on public.messages to authenticated;

-- ---------------------------------------------------------------------------
-- Team notes: one shared notepad per research card, for its owner and accepted collaborators only.
-- ---------------------------------------------------------------------------
create or replace function public.on_research_team(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.projects r join public.profiles p on p.id = r.profile_id
                 where r.id = pid and p.owner_id = auth.uid())
    or exists (select 1 from public.collab_requests c join public.profiles p on p.id = c.to_profile
               where c.project_id = pid and c.status = 'accepted' and p.owner_id = auth.uid());
$$;
revoke all on function public.on_research_team(uuid) from public;
grant execute on function public.on_research_team(uuid) to authenticated;

create table if not exists public.collab_notes (
  project_id uuid primary key references public.projects (id) on delete cascade,
  body text not null default '' check (char_length(body) <= 4000),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.collab_notes enable row level security;
drop policy if exists "team reads notes" on public.collab_notes;
create policy "team reads notes" on public.collab_notes for select to authenticated using (public.on_research_team(project_id));
drop policy if exists "team adds notes" on public.collab_notes;
create policy "team adds notes" on public.collab_notes for insert to authenticated with check (public.on_research_team(project_id));
drop policy if exists "team edits notes" on public.collab_notes;
create policy "team edits notes" on public.collab_notes for update to authenticated
  using (public.on_research_team(project_id)) with check (public.on_research_team(project_id));
grant select, insert on public.collab_notes to authenticated;
grant update (body, updated_by, updated_at) on public.collab_notes to authenticated;
