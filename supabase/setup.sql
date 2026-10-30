-- Dollar Search: database tables and security rules.
-- Run once in Supabase: SQL Editor -> New query -> paste this whole file -> Run.
-- Safe to run again: it only creates what is missing and replaces the rules.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- The homepage name and intro (a single row).
create table if not exists public.site_settings (
  id int primary key default 1 check (id = 1),
  hub_name text not null default 'Dollar Search' check (char_length(hub_name) between 1 and 60),
  hub_intro text not null default '' check (char_length(hub_intro) <= 300)
);
insert into public.site_settings (id) values (1) on conflict (id) do nothing;

-- People who run the site: they can edit the homepage, add several profiles and remove anyone's profile.
create table if not exists public.site_admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  description text not null default '' check (char_length(description) <= 300),
  email text not null default '' check (char_length(email) <= 120),
  -- { "mode": "character", "character": {...} } or { "mode": "photo", "photo": "data:image/jpeg;base64,..." }
  avatar jsonb check (avatar is null or pg_column_size(avatar) < 220000),
  created_at timestamptz not null default now()
);
create index if not exists profiles_owner_idx on public.profiles (owner_id);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  link text not null default '' check (char_length(link) <= 500),
  description text not null default '' check (char_length(description) <= 400),
  -- [{ "name": "...", "link": "https://..." }, ...]
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array' and pg_column_size(sources) < 60000),
  created_at timestamptz not null default now()
);
create index if not exists projects_profile_idx on public.projects (profile_id);

create table if not exists public.likes (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, profile_id)
);

create table if not exists public.follows (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, profile_id)
);

-- Up to when each person has read their notifications. Private to that person.
create table if not exists public.notif_state (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  seen_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Helper: is the signed-in person a site admin?
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.site_admins where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security: every table is locked; the rules below open exactly what the site needs.
-- ---------------------------------------------------------------------------
alter table public.site_settings enable row level security;
alter table public.site_admins enable row level security;
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.likes enable row level security;
alter table public.follows enable row level security;
alter table public.notif_state enable row level security;

-- Homepage settings: everyone reads, admins edit.
drop policy if exists "settings readable" on public.site_settings;
create policy "settings readable" on public.site_settings for select to anon, authenticated using (true);
drop policy if exists "admins edit settings" on public.site_settings;
create policy "admins edit settings" on public.site_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Admin list: people can only see whether they themselves are an admin.
drop policy if exists "see own admin row" on public.site_admins;
create policy "see own admin row" on public.site_admins for select to authenticated using (user_id = auth.uid());

-- Profiles: everyone reads; you create one profile as yourself (admins too);
-- you edit only your own; you or an admin can delete.
drop policy if exists "profiles readable" on public.profiles;
create policy "profiles readable" on public.profiles for select to anon, authenticated using (true);
drop policy if exists "create own profile" on public.profiles;
create policy "create own profile" on public.profiles for insert to authenticated
  with check (
    owner_id = auth.uid()
    and not exists (select 1 from public.profiles p where p.owner_id = auth.uid())
  );
drop policy if exists "edit own profile" on public.profiles;
create policy "edit own profile" on public.profiles for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "delete own profile or admin" on public.profiles;
create policy "delete own profile or admin" on public.profiles for delete to authenticated
  using (owner_id = auth.uid() or public.is_admin());

-- Research projects: everyone reads; only the profile's owner adds, edits or deletes.
drop policy if exists "projects readable" on public.projects;
create policy "projects readable" on public.projects for select to anon, authenticated using (true);
drop policy if exists "owner adds projects" on public.projects;
create policy "owner adds projects" on public.projects for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = profile_id and p.owner_id = auth.uid()));
drop policy if exists "owner edits projects" on public.projects;
create policy "owner edits projects" on public.projects for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = profile_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.profiles p where p.id = profile_id and p.owner_id = auth.uid()));
drop policy if exists "owner deletes projects" on public.projects;
create policy "owner deletes projects" on public.projects for delete to authenticated
  using (exists (select 1 from public.profiles p where p.id = profile_id and p.owner_id = auth.uid()));

-- Likes and follows: everyone reads the counts; you like or follow only as yourself, never your own
-- portfolio, and undo only your own.
drop policy if exists "likes readable" on public.likes;
create policy "likes readable" on public.likes for select to anon, authenticated using (true);
drop policy if exists "like as yourself" on public.likes;
create policy "like as yourself" on public.likes for insert to authenticated
  with check (
    user_id = auth.uid()
    and not exists (select 1 from public.profiles p where p.id = profile_id and p.owner_id = auth.uid())
  );
drop policy if exists "unlike your own" on public.likes;
create policy "unlike your own" on public.likes for delete to authenticated using (user_id = auth.uid());

drop policy if exists "follows readable" on public.follows;
create policy "follows readable" on public.follows for select to anon, authenticated using (true);
drop policy if exists "follow as yourself" on public.follows;
create policy "follow as yourself" on public.follows for insert to authenticated
  with check (
    user_id = auth.uid()
    and not exists (select 1 from public.profiles p where p.id = profile_id and p.owner_id = auth.uid())
  );
drop policy if exists "unfollow your own" on public.follows;
create policy "unfollow your own" on public.follows for delete to authenticated using (user_id = auth.uid());

-- Notification "read up to" time: private to each person.
drop policy if exists "own notif state" on public.notif_state;
create policy "own notif state" on public.notif_state for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Grants: "Automatically expose new tables" is off, so open each table to the website on purpose.
-- The rules above still decide which rows each person can touch.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select on public.site_settings, public.profiles, public.projects, public.likes, public.follows to anon, authenticated;
grant update (hub_name, hub_intro) on public.site_settings to authenticated;
grant select on public.site_admins to authenticated;
grant insert, delete on public.profiles, public.projects to authenticated;
-- Only these columns can be changed later, so nobody can move a profile to another owner
-- or back-date research to fake a notification.
grant update (name, description, email, avatar) on public.profiles to authenticated;
grant update (title, link, description, sources) on public.projects to authenticated;
grant insert, delete on public.likes, public.follows to authenticated;
grant select, insert, update on public.notif_state to authenticated;
grant execute on function public.is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Likes on individual research projects (same as research-likes.sql)
-- ---------------------------------------------------------------------------

create table if not exists public.project_likes (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, project_id)
);

alter table public.project_likes enable row level security;

drop policy if exists "research likes readable" on public.project_likes;
create policy "research likes readable" on public.project_likes for select to anon, authenticated using (true);

drop policy if exists "like others' research" on public.project_likes;
create policy "like others' research" on public.project_likes for insert to authenticated
  with check (
    user_id = auth.uid()
    and not exists (
      select 1 from public.projects r
      join public.profiles p on p.id = r.profile_id
      where r.id = project_id and p.owner_id = auth.uid()
    )
  );

drop policy if exists "unlike your own research likes" on public.project_likes;
create policy "unlike your own research likes" on public.project_likes for delete to authenticated
  using (user_id = auth.uid());

grant select on public.project_likes to anon, authenticated;
grant insert, delete on public.project_likes to authenticated;

-- ---------------------------------------------------------------------------
-- Comments and tips on research (same as research-comments.sql)
-- ---------------------------------------------------------------------------
create table if not exists public.project_comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null default 'comment' check (kind in ('comment', 'tip')),
  body text not null check (char_length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists project_comments_project_idx on public.project_comments (project_id);

alter table public.project_comments enable row level security;

drop policy if exists "comments readable" on public.project_comments;
create policy "comments readable" on public.project_comments for select to anon, authenticated using (true);

drop policy if exists "comment on others' research" on public.project_comments;
create policy "comment on others' research" on public.project_comments for insert to authenticated
  with check (
    user_id = auth.uid()
    and not exists (
      select 1 from public.projects r
      join public.profiles p on p.id = r.profile_id
      where r.id = project_id and p.owner_id = auth.uid()
    )
  );

drop policy if exists "delete comments you wrote or received" on public.project_comments;
create policy "delete comments you wrote or received" on public.project_comments for delete to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.projects r
      join public.profiles p on p.id = r.profile_id
      where r.id = project_id and p.owner_id = auth.uid()
    )
  );

grant select on public.project_comments to anon, authenticated;
grant insert (project_id, kind, body), delete on public.project_comments to authenticated;

-- ---------------------------------------------------------------------------
-- Collaboration requests on research (same as collab-requests.sql)
-- ---------------------------------------------------------------------------
create table if not exists public.collab_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  from_user uuid not null default auth.uid() references auth.users (id) on delete cascade,
  to_profile uuid not null references public.profiles (id) on delete cascade,
  message text not null default '' check (char_length(message) <= 300),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (project_id, to_profile)
);
create index if not exists collab_requests_to_idx on public.collab_requests (to_profile);

-- Is the signed-in person an accepted collaborator on this research card?
create or replace function public.is_collaborator(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.collab_requests c
    join public.profiles p on p.id = c.to_profile
    where c.project_id = pid and c.status = 'accepted' and p.owner_id = auth.uid()
  );
$$;
grant execute on function public.is_collaborator(uuid) to authenticated;

alter table public.collab_requests enable row level security;

-- Accepted collabs are public (cards show who they're shared with); requests are private to the two people.
drop policy if exists "collabs readable" on public.collab_requests;
create policy "collabs readable" on public.collab_requests for select to anon, authenticated
  using (
    status = 'accepted'
    or from_user = auth.uid()
    or exists (select 1 from public.profiles p where p.id = to_profile and p.owner_id = auth.uid())
  );

-- You can only invite people to your own research, and not to your own portfolio.
drop policy if exists "request collab on your research" on public.collab_requests;
create policy "request collab on your research" on public.collab_requests for insert to authenticated
  with check (
    from_user = auth.uid()
    and status = 'pending'
    and exists (
      select 1 from public.projects r
      join public.profiles p on p.id = r.profile_id
      where r.id = project_id and p.owner_id = auth.uid()
    )
    and not exists (select 1 from public.profiles p where p.id = to_profile and p.owner_id = auth.uid())
  );

-- Only the person invited can accept or decline.
drop policy if exists "answer collab requests" on public.collab_requests;
create policy "answer collab requests" on public.collab_requests for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = to_profile and p.owner_id = auth.uid()))
  with check (
    status in ('accepted', 'declined')
    and exists (select 1 from public.profiles p where p.id = to_profile and p.owner_id = auth.uid())
  );

-- Either person can cancel a request or end a collab.
drop policy if exists "cancel or end collabs" on public.collab_requests;
create policy "cancel or end collabs" on public.collab_requests for delete to authenticated
  using (
    from_user = auth.uid()
    or exists (select 1 from public.profiles p where p.id = to_profile and p.owner_id = auth.uid())
  );

grant select on public.collab_requests to anon, authenticated;
grant insert (project_id, to_profile, message), delete on public.collab_requests to authenticated;
grant update (status, responded_at) on public.collab_requests to authenticated;

-- Research cards: the owner, or an accepted collaborator, can edit. Only the owner can delete.
drop policy if exists "owner edits projects" on public.projects;
create policy "owner edits projects" on public.projects for update to authenticated
  using (
    exists (select 1 from public.profiles p where p.id = profile_id and p.owner_id = auth.uid())
    or public.is_collaborator(id)
  )
  with check (
    exists (select 1 from public.profiles p where p.id = profile_id and p.owner_id = auth.uid())
    or public.is_collaborator(id)
  );

-- ---------------------------------------------------------------------------
-- Star Shop (same as star-shop.sql)
-- ---------------------------------------------------------------------------
create table if not exists public.shop_purchases (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item text not null check (char_length(item) between 1 and 40),
  price int not null check (price >= 0),
  created_at timestamptz not null default now(),
  primary key (user_id, item)
);

alter table public.shop_purchases enable row level security;

-- You can see only your own purchases. There is no insert rule: buying goes through the function below.
drop policy if exists "see own purchases" on public.shop_purchases;
create policy "see own purchases" on public.shop_purchases for select to authenticated
  using (user_id = auth.uid());
grant select on public.shop_purchases to authenticated;

-- Stars given as gifts (for example, to early testers). Each gift has a reason, and a person
-- gets each reason only once, so running this file again never doubles a gift.
create table if not exists public.star_gifts (
  user_id uuid not null references auth.users (id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 60),
  stars int not null check (stars > 0),
  created_at timestamptz not null default now(),
  primary key (user_id, reason)
);

alter table public.star_gifts enable row level security;

-- You can see only your own gifts. Gifts are added here in the SQL Editor, not from the website.
drop policy if exists "see own gifts" on public.star_gifts;
create policy "see own gifts" on public.star_gifts for select to authenticated
  using (user_id = auth.uid());
grant select on public.star_gifts to authenticated;

-- 100 stars for each early tester (the portfolios with the magic wand; keep in step with
-- earlyTesterProfileIds in config.js).
insert into public.star_gifts (user_id, reason, stars)
select owner_id, 'early-tester', 100 from public.profiles
where id in (
  'f5a93142-7bf7-4cae-834c-ebfe4ef78a51', -- $ubway's Subway
  '2ab64137-3e43-4c2a-9fc3-62b1c2a26188', -- The One and Only Ramko
  'e218a1b2-63f5-4c31-b7f1-dc7af94d1965', -- Purplelicious Sudiksha
  'd85d9644-8f3a-408c-ad73-4c5539d0812e', -- Promprompromise
  '71767f0d-6a43-4455-b325-b99b6804f70c'  -- Soph_Soph
)
on conflict (user_id, reason) do nothing;

create or replace function public.buy_shop_item(item_id text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  cost int;
  earned int;
  spent int;
begin
  if auth.uid() is null then
    raise exception 'Sign in to shop.';
  end if;
  -- The Halloween items are limited: they leave the shop when October 31, 2026 ends (midnight, US Eastern time).
  -- Keep in step with SHOP_ENDS in app.js.
  if now() >= timestamptz '2026-11-01 04:00:00+00' then
    raise exception 'The Halloween items have left the shop.';
  end if;
  -- Prices live here so the website can't change them. Keep in step with SHOP in app.js.
  cost := case item_id
    when 'pumpkin-top' then 1
    when 'witchy-hair' then 1
    when 'bat-headband' then 2
    when 'pumpkin-hat' then 3
    when 'witch-hat' then 4
    when 'ghost-frame' then 4
    when 'pumpkin-frame' then 5
    when 'midnight-bg' then 1
    when 'devil-horns' then 2
    when 'vampire-fangs' then 2
    when 'witch-face' then 3
    when 'candy-crown' then 3
    when 'candy-frame' then 3
    when 'vampire-cape' then 4
    when 'web-frame' then 4
    when 'bat-pet' then 5
    when 'ghost-pet' then 5
    when 'pumpkin-pet' then 6
    else null
  end;
  if cost is null then
    raise exception 'That item is not in the shop.';
  end if;
  if exists (select 1 from public.shop_purchases where user_id = auth.uid() and item = item_id) then
    raise exception 'You already own that item.';
  end if;
  -- Stars earned: likes on your portfolio, likes on your research, and gifted stars.
  select
    (select count(*) from public.likes l
       join public.profiles p on p.id = l.profile_id
      where p.owner_id = auth.uid())
    + (select count(*) from public.project_likes pl
         join public.projects r on r.id = pl.project_id
         join public.profiles p on p.id = r.profile_id
        where p.owner_id = auth.uid())
    + (select coalesce(sum(g.stars), 0) from public.star_gifts g where g.user_id = auth.uid())
  into earned;
  select coalesce(sum(price), 0) from public.shop_purchases where user_id = auth.uid() into spent;
  if earned - spent < cost then
    raise exception 'Not enough stars yet.';
  end if;
  insert into public.shop_purchases (user_id, item, price) values (auth.uid(), item_id, cost);
  return json_build_object('ok', true, 'stars', earned - spent - cost);
end;
$$;

revoke all on function public.buy_shop_item(text) from public;
grant execute on function public.buy_shop_item(text) to authenticated;

-- ===========================================================================
-- More features (same as supabase/more-features.sql). This replaces buy_shop_item() above.
-- ===========================================================================

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

-- ---------------------------------------------------------------------------
-- Star Shop: Fall and Winter items, gifts to friends, and daily stars counting toward your balance.
-- Replaces buy_shop_item() from star-shop.sql.
-- ---------------------------------------------------------------------------
-- Who paid for an item (a friend, when it was a gift). Empty means you bought it yourself.
alter table public.shop_purchases add column if not exists paid_by uuid references auth.users (id) on delete set null;
drop policy if exists "see own purchases" on public.shop_purchases;
create policy "see own purchases" on public.shop_purchases for select to authenticated
  using (user_id = auth.uid() or paid_by = auth.uid());

-- Who sent a gift of stars (a friend). Empty for gifts from the site, like the early tester gift.
alter table public.star_gifts add column if not exists from_user uuid references auth.users (id) on delete set null;
drop policy if exists "see own gifts" on public.star_gifts;
create policy "see own gifts" on public.star_gifts for select to authenticated
  using (user_id = auth.uid() or from_user = auth.uid());

-- Each item's price and when it's in the shop (US Eastern dates). Keep in step with SHOP and SEASONS in app.js.
create or replace function public.shop_item_info(item_id text, out price int, out starts timestamptz, out ends timestamptz)
language sql
immutable
set search_path = ''
as $$
  select items.cost,
    case items.season when 'halloween' then timestamptz '2000-01-01 00:00:00+00'
                      when 'fall' then timestamptz '2026-11-01 04:00:00+00'
                      else timestamptz '2026-12-01 05:00:00+00' end,
    case items.season when 'halloween' then timestamptz '2026-11-01 04:00:00+00'
                      when 'fall' then timestamptz '2026-12-01 05:00:00+00'
                      else timestamptz '2027-01-01 05:00:00+00' end
  from (values
    ('pumpkin-top', 1, 'halloween'), ('witchy-hair', 1, 'halloween'), ('bat-headband', 2, 'halloween'),
    ('pumpkin-hat', 3, 'halloween'), ('witch-hat', 4, 'halloween'), ('ghost-frame', 4, 'halloween'),
    ('pumpkin-frame', 5, 'halloween'), ('midnight-bg', 1, 'halloween'), ('devil-horns', 2, 'halloween'),
    ('vampire-fangs', 2, 'halloween'), ('witch-face', 3, 'halloween'), ('candy-crown', 3, 'halloween'),
    ('candy-frame', 3, 'halloween'), ('vampire-cape', 4, 'halloween'), ('web-frame', 4, 'halloween'),
    ('bat-pet', 5, 'halloween'), ('ghost-pet', 5, 'halloween'), ('pumpkin-pet', 6, 'halloween'),
    ('harvest-bg', 1, 'fall'), ('leaf-crown', 2, 'fall'), ('flannel', 3, 'fall'),
    ('maple-frame', 4, 'fall'), ('hedgehog-pet', 5, 'fall'),
    ('pine-bg', 1, 'winter'), ('earmuffs', 2, 'winter'), ('cozy-scarf', 3, 'winter'), ('santa-hat', 3, 'winter'),
    ('snowflake-frame', 4, 'winter'), ('snowman-pet', 5, 'winter'), ('penguin-pet', 6, 'winter')
  ) as items (id, cost, season)
  where items.id = item_id;
$$;

-- Stars the signed-in person has left: likes on their portfolios and research, gifts and daily stars,
-- minus what they've spent on items (for themselves or as gifts) and stars they've given away.
create or replace function public.shop_stars_left()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select (
    (select count(*) from public.likes l join public.profiles p on p.id = l.profile_id where p.owner_id = auth.uid())
    + (select count(*) from public.project_likes pl join public.projects r on r.id = pl.project_id
         join public.profiles p on p.id = r.profile_id where p.owner_id = auth.uid())
    + (select coalesce(sum(g.stars), 0) from public.star_gifts g where g.user_id = auth.uid())
    + (select count(*) from public.star_claims c where c.user_id = auth.uid())
    - (select coalesce(sum(s.price), 0) from public.shop_purchases s where coalesce(s.paid_by, s.user_id) = auth.uid())
    - (select coalesce(sum(g.stars), 0) from public.star_gifts g where g.from_user = auth.uid() and g.user_id <> auth.uid())
  )::int;
$$;
revoke all on function public.shop_stars_left() from public, anon, authenticated;

create or replace function public.buy_shop_item(item_id text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  info record;
  left_over int;
begin
  if auth.uid() is null then
    raise exception 'Sign in to shop.';
  end if;
  select * into info from public.shop_item_info(item_id);
  if info.price is null then
    raise exception 'That item is not in the shop.';
  end if;
  if now() < info.starts then
    raise exception 'That item is not in the shop yet.';
  end if;
  if now() >= info.ends then
    raise exception 'That item has left the shop.';
  end if;
  if exists (select 1 from public.shop_purchases where user_id = auth.uid() and item = item_id) then
    raise exception 'You already own that item.';
  end if;
  left_over := public.shop_stars_left();
  if left_over < info.price then
    raise exception 'Not enough stars yet.';
  end if;
  insert into public.shop_purchases (user_id, item, price) values (auth.uid(), item_id, info.price);
  return json_build_object('ok', true, 'stars', left_over - info.price);
end;
$$;
revoke all on function public.buy_shop_item(text) from public;
grant execute on function public.buy_shop_item(text) to authenticated;

-- Buy an item for a friend. It goes into their inventory; you pay the stars.
create or replace function public.gift_shop_item(item_id text, to_user uuid)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  info record;
  left_over int;
begin
  if auth.uid() is null then
    raise exception 'Sign in to send gifts.';
  end if;
  if not public.are_friends(auth.uid(), to_user) then
    raise exception 'You can only send gifts to friends: people who follow you back.';
  end if;
  select * into info from public.shop_item_info(item_id);
  if info.price is null then
    raise exception 'That item is not in the shop.';
  end if;
  if now() < info.starts or now() >= info.ends then
    raise exception 'That item is not in the shop right now.';
  end if;
  if exists (select 1 from public.shop_purchases where user_id = to_user and item = item_id) then
    raise exception 'Your friend already has that item. Try another one!';
  end if;
  left_over := public.shop_stars_left();
  if left_over < info.price then
    raise exception 'Not enough stars yet.';
  end if;
  insert into public.shop_purchases (user_id, item, price, paid_by) values (to_user, item_id, info.price, auth.uid());
  return json_build_object('ok', true, 'stars', left_over - info.price);
end;
$$;
revoke all on function public.gift_shop_item(text, uuid) from public;
grant execute on function public.gift_shop_item(text, uuid) to authenticated;

-- Send 1 to 50 of your stars to a friend.
create or replace function public.gift_stars(to_user uuid, amount int)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  left_over int;
begin
  if auth.uid() is null then
    raise exception 'Sign in to send gifts.';
  end if;
  if amount is null or amount < 1 or amount > 50 then
    raise exception 'You can send 1 to 50 stars at a time.';
  end if;
  if not public.are_friends(auth.uid(), to_user) then
    raise exception 'You can only send gifts to friends: people who follow you back.';
  end if;
  left_over := public.shop_stars_left();
  if left_over < amount then
    raise exception 'You do not have that many stars yet.';
  end if;
  insert into public.star_gifts (user_id, reason, stars, from_user)
  values (to_user, 'friend-gift:' || gen_random_uuid()::text, amount, auth.uid());
  return json_build_object('ok', true, 'stars', left_over - amount);
end;
$$;
revoke all on function public.gift_stars(uuid, int) from public;
grant execute on function public.gift_stars(uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Reports: anyone signed in can report a comment, a portfolio or a research card. Only the site owner sees them all.
-- ---------------------------------------------------------------------------
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('comment', 'profile', 'project')),
  target_id uuid not null,
  reason text not null default '' check (char_length(reason) <= 300),
  created_at timestamptz not null default now(),
  unique (reporter, kind, target_id)
);
alter table public.reports enable row level security;
drop policy if exists "send reports" on public.reports;
create policy "send reports" on public.reports for insert to authenticated with check (reporter = auth.uid());
drop policy if exists "see your reports or all as owner" on public.reports;
create policy "see your reports or all as owner" on public.reports for select to authenticated
  using (reporter = auth.uid() or public.is_admin());
drop policy if exists "owner clears reports" on public.reports;
create policy "owner clears reports" on public.reports for delete to authenticated using (public.is_admin());
grant select, insert, delete on public.reports to authenticated;

-- ---------------------------------------------------------------------------
-- Owner tools: delete spam research, gift stars, and see who has signed up.
-- ---------------------------------------------------------------------------
drop policy if exists "owner deletes any research" on public.projects;
create policy "owner deletes any research" on public.projects for delete to authenticated using (public.is_admin());

drop policy if exists "owner gives stars" on public.star_gifts;
create policy "owner gives stars" on public.star_gifts for insert to authenticated
  with check (public.is_admin() and from_user is null);
grant insert (user_id, reason, stars) on public.star_gifts to authenticated;

-- Everyone who has made an account, newest first. Only the site owner can call this.
create or replace function public.admin_users()
returns table (id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only the site owner can see this.';
  end if;
  return query
    select u.id, u.email::text, u.created_at, u.last_sign_in_at from auth.users u order by u.created_at desc;
end;
$$;
revoke all on function public.admin_users() from public, anon;
grant execute on function public.admin_users() to authenticated;

-- ===========================================================================
-- More features, part 2 (same as supabase/more-features-2.sql).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Keep it kind: swear words and slurs are blocked everywhere; mean words are also blocked in
-- comments, replies and messages. Keep in step with SWEARS and MEAN_WORDS in app.js.
-- ---------------------------------------------------------------------------
create or replace function public.is_unkind(t text, check_mean boolean)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(t, '') ~* ('\m(fuck\w*|shit\w*|bitch\w*|bastard\w*|asshole\w*|dick|dickhead\w*|cunt\w*|slut\w*|whore\w*|'
      || 'nigg\w*|fag|fags|faggot\w*|retard\w*|tranny|kys|kill yourself)\M')
    or (check_mean and coalesce(t, '') ~* '\m(idiot\w*|stupid|dumb|dumbass|loser\w*|moron\w*|ugly|shut up|hate you)\M');
$$;

-- One trigger for every table people write in. Only new or changed text is checked, so older posts
-- can still be edited in other ways.
create or replace function public.keep_it_kind()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  fresh text;
  before_text text := '';
  check_mean boolean := tg_table_name in ('project_comments', 'messages', 'site_feedback');
begin
  fresh := concat_ws(' ', to_jsonb(new) ->> 'name', to_jsonb(new) ->> 'description', to_jsonb(new) ->> 'title',
    to_jsonb(new) ->> 'body', to_jsonb(new) ->> 'question', to_jsonb(new) ->> 'options', to_jsonb(new) ->> 'note');
  if tg_op = 'UPDATE' then
    before_text := concat_ws(' ', to_jsonb(old) ->> 'name', to_jsonb(old) ->> 'description', to_jsonb(old) ->> 'title',
      to_jsonb(old) ->> 'body', to_jsonb(old) ->> 'question', to_jsonb(old) ->> 'options', to_jsonb(old) ->> 'note');
    if fresh = before_text then return new; end if;
  end if;
  if public.is_unkind(fresh, check_mean) then
    raise exception 'Please keep it kind. Try saying that another way.';
  end if;
  return new;
end;
$$;

drop trigger if exists keep_it_kind on public.project_comments;
create trigger keep_it_kind before insert or update on public.project_comments for each row execute function public.keep_it_kind();
drop trigger if exists keep_it_kind on public.messages;
create trigger keep_it_kind before insert or update on public.messages for each row execute function public.keep_it_kind();
drop trigger if exists keep_it_kind on public.projects;
create trigger keep_it_kind before insert or update on public.projects for each row execute function public.keep_it_kind();
drop trigger if exists keep_it_kind on public.profiles;
create trigger keep_it_kind before insert or update on public.profiles for each row execute function public.keep_it_kind();

-- ---------------------------------------------------------------------------
-- Blocking: someone you block can't message you or comment on your research (and you can't on theirs).
-- ---------------------------------------------------------------------------
create table if not exists public.blocks (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  blocked_user uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, blocked_user),
  check (user_id <> blocked_user)
);
alter table public.blocks enable row level security;
drop policy if exists "own blocks" on public.blocks;
create policy "own blocks" on public.blocks for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, delete on public.blocks to authenticated;

-- Has either person blocked the other?
create or replace function public.is_blocked(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.blocks
                 where (user_id = a and blocked_user = b) or (user_id = b and blocked_user = a));
$$;
revoke all on function public.is_blocked(uuid, uuid) from public, anon;
grant execute on function public.is_blocked(uuid, uuid) to authenticated;

create or replace function public.respect_blocks()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  other_user uuid;
begin
  if tg_table_name = 'messages' then
    other_user := new.to_user;
  else
    select p.owner_id into other_user from public.projects r join public.profiles p on p.id = r.profile_id where r.id = new.project_id;
  end if;
  if other_user is not null and public.is_blocked(auth.uid(), other_user) then
    raise exception 'You can''t do that because one of you has blocked the other.';
  end if;
  return new;
end;
$$;
drop trigger if exists respect_blocks on public.messages;
create trigger respect_blocks before insert on public.messages for each row execute function public.respect_blocks();
drop trigger if exists respect_blocks on public.project_comments;
create trigger respect_blocks before insert on public.project_comments for each row execute function public.respect_blocks();

-- ---------------------------------------------------------------------------
-- Research status: In progress or Finished (or no label).
-- ---------------------------------------------------------------------------
alter table public.projects add column if not exists status text not null default '';
alter table public.projects drop constraint if exists projects_status_check;
alter table public.projects add constraint projects_status_check check (status in ('', 'in-progress', 'finished'));
grant update (title, link, description, sources, tags, image, status) on public.projects to authenticated;
-- Room for the research outline: descriptions can be up to 1500 characters (was 400).
alter table public.projects drop constraint if exists projects_description_check;
alter table public.projects add constraint projects_description_check check (char_length(description) <= 1500);

-- ---------------------------------------------------------------------------
-- Replies to comments. The research owner can reply on their own research too.
-- ---------------------------------------------------------------------------
alter table public.project_comments add column if not exists parent_id uuid references public.project_comments (id) on delete cascade;
grant insert (project_id, kind, body, parent_id) on public.project_comments to authenticated;
drop policy if exists "comment on others' research" on public.project_comments;
create policy "comment on others' research" on public.project_comments for insert to authenticated
  with check (
    user_id = auth.uid()
    and (
      parent_id is not null
      or not exists (
        select 1 from public.projects r
        join public.profiles p on p.id = r.profile_id
        where r.id = project_id and p.owner_id = auth.uid()
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Polls: one quick poll per research card, made by its owner or collaborators. Everyone signed in can vote once.
-- ---------------------------------------------------------------------------
create table if not exists public.polls (
  project_id uuid primary key references public.projects (id) on delete cascade,
  question text not null check (char_length(question) between 1 and 120),
  options text[] not null check (cardinality(options) between 2 and 6),
  created_at timestamptz not null default now()
);
alter table public.polls enable row level security;
drop policy if exists "polls readable" on public.polls;
create policy "polls readable" on public.polls for select to anon, authenticated using (true);
drop policy if exists "team makes polls" on public.polls;
create policy "team makes polls" on public.polls for insert to authenticated with check (public.on_research_team(project_id));
drop policy if exists "team removes polls" on public.polls;
create policy "team removes polls" on public.polls for delete to authenticated using (public.on_research_team(project_id));
grant select on public.polls to anon, authenticated;
grant insert, delete on public.polls to authenticated;
drop trigger if exists keep_it_kind on public.polls;
create trigger keep_it_kind before insert or update on public.polls for each row execute function public.keep_it_kind();

create table if not exists public.poll_votes (
  project_id uuid not null references public.polls (project_id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  choice int not null check (choice between 0 and 5),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
alter table public.poll_votes enable row level security;
drop policy if exists "votes readable" on public.poll_votes;
create policy "votes readable" on public.poll_votes for select to anon, authenticated using (true);
drop policy if exists "vote once" on public.poll_votes;
create policy "vote once" on public.poll_votes for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "take back your vote" on public.poll_votes;
create policy "take back your vote" on public.poll_votes for delete to authenticated using (user_id = auth.uid());
grant select on public.poll_votes to anon, authenticated;
grant insert, delete on public.poll_votes to authenticated;

-- ---------------------------------------------------------------------------
-- Weekly research challenge: each week (Monday to Sunday, US Eastern) has a topic. When a week is over,
-- the most-liked research posted that week with that topic wins 10 stars. Anyone can call this; it only
-- ever awards each week once. Keep the topics and their order in step with TAGS in app.js.
-- ---------------------------------------------------------------------------
create or replace function public.award_challenge(week_start date)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  topics text[] := array['Science', 'Technology', 'Health', 'Environment', 'Space', 'Society', 'Money', 'Sports',
    'Food', 'Arts', 'Animals', 'Education', 'Psychology', 'History'];
  topic text;
  winner uuid;
  this_week date := date_trunc('week', (now() at time zone 'America/New_York'))::date;
begin
  if extract(isodow from week_start) <> 1 or week_start >= this_week or week_start < date '2026-10-26' then
    return json_build_object('awarded', false);
  end if;
  topic := topics[((week_start - date '2026-01-05') / 7) % 14 + 1];
  select p.owner_id into winner
  from public.projects r
  join public.profiles p on p.id = r.profile_id
  left join public.project_likes l on l.project_id = r.id
  where topic = any (r.tags)
    and (r.created_at at time zone 'America/New_York')::date between week_start and week_start + 6
  group by r.id, p.owner_id, r.created_at
  having count(l.user_id) > 0
  order by count(l.user_id) desc, r.created_at
  limit 1;
  if winner is null then
    return json_build_object('awarded', false);
  end if;
  insert into public.star_gifts (user_id, reason, stars)
  values (winner, 'challenge:' || week_start::text, 10)
  on conflict (user_id, reason) do nothing;
  return json_build_object('awarded', true, 'winner', winner);
end;
$$;
revoke all on function public.award_challenge(date) from public, anon;
grant execute on function public.award_challenge(date) to authenticated;

-- ---------------------------------------------------------------------------
-- Star Shop: the Valentine's shop (February 2027) and the spring shop (March to May 2027).
-- Replaces shop_item_info() from more-features.sql. Keep in step with SHOP and SEASONS in app.js.
-- ---------------------------------------------------------------------------
create or replace function public.shop_item_info(item_id text, out price int, out starts timestamptz, out ends timestamptz)
language sql
immutable
set search_path = ''
as $$
  select items.cost,
    case items.season when 'halloween' then timestamptz '2000-01-01 00:00:00+00'
                      when 'fall' then timestamptz '2026-11-01 04:00:00+00'
                      when 'winter' then timestamptz '2026-12-01 05:00:00+00'
                      when 'valentine' then timestamptz '2027-02-01 05:00:00+00'
                      else timestamptz '2027-03-01 05:00:00+00' end,
    case items.season when 'halloween' then timestamptz '2026-11-01 04:00:00+00'
                      when 'fall' then timestamptz '2026-12-01 05:00:00+00'
                      when 'winter' then timestamptz '2027-01-01 05:00:00+00'
                      when 'valentine' then timestamptz '2027-03-01 05:00:00+00'
                      else timestamptz '2027-06-01 04:00:00+00' end
  from (values
    ('pumpkin-top', 1, 'halloween'), ('witchy-hair', 1, 'halloween'), ('bat-headband', 2, 'halloween'),
    ('pumpkin-hat', 3, 'halloween'), ('witch-hat', 4, 'halloween'), ('ghost-frame', 4, 'halloween'),
    ('pumpkin-frame', 5, 'halloween'), ('midnight-bg', 1, 'halloween'), ('devil-horns', 2, 'halloween'),
    ('vampire-fangs', 2, 'halloween'), ('witch-face', 3, 'halloween'), ('candy-crown', 3, 'halloween'),
    ('candy-frame', 3, 'halloween'), ('vampire-cape', 4, 'halloween'), ('web-frame', 4, 'halloween'),
    ('bat-pet', 5, 'halloween'), ('ghost-pet', 5, 'halloween'), ('pumpkin-pet', 6, 'halloween'),
    ('harvest-bg', 1, 'fall'), ('leaf-crown', 2, 'fall'), ('flannel', 3, 'fall'),
    ('maple-frame', 4, 'fall'), ('hedgehog-pet', 5, 'fall'),
    ('pine-bg', 1, 'winter'), ('earmuffs', 2, 'winter'), ('cozy-scarf', 3, 'winter'), ('santa-hat', 3, 'winter'),
    ('snowflake-frame', 4, 'winter'), ('snowman-pet', 5, 'winter'), ('penguin-pet', 6, 'winter'),
    ('rose-bg', 1, 'valentine'), ('heart-headband', 2, 'valentine'), ('heart-sweater', 3, 'valentine'),
    ('cupid-frame', 4, 'valentine'), ('teddy-pet', 5, 'valentine'),
    ('meadow-bg', 1, 'spring'), ('bunny-ears', 2, 'spring'), ('sun-hat', 3, 'spring'), ('raincoat', 3, 'spring'),
    ('butterfly-frame', 4, 'spring'), ('duckling-pet', 5, 'spring')
  ) as items (id, cost, season)
  where items.id = item_id;
$$;

-- ===========================================================================
-- Research calendar (same as supabase/calendar.sql).
-- ===========================================================================

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null,
  title text not null check (char_length(title) between 1 and 80),
  project_id uuid references public.projects (id) on delete set null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists calendar_events_user_day on public.calendar_events (user_id, day);

alter table public.calendar_events enable row level security;
drop policy if exists "your own calendar" on public.calendar_events;
create policy "your own calendar" on public.calendar_events for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, delete on public.calendar_events to authenticated;
grant update (day, title, project_id, done) on public.calendar_events to authenticated;

-- ===========================================================================
-- Private drafts (same as supabase/drafts.sql).
-- ===========================================================================

alter table public.projects add column if not exists is_draft boolean not null default false;
-- When research was published. Older research counts as published when it was posted.
alter table public.projects add column if not exists published_at timestamptz;
update public.projects set published_at = created_at where published_at is null;
alter table public.projects alter column published_at set default now();
alter table public.projects alter column published_at set not null;
grant update (title, link, description, sources, tags, image, status, is_draft, published_at) on public.projects to authenticated;

-- Everyone can read published research. Drafts are readable only by the owner and accepted collaborators.
drop policy if exists "projects readable" on public.projects;
create policy "projects readable" on public.projects for select to anon, authenticated using (not is_draft);
drop policy if exists "drafts readable by their team" on public.projects;
create policy "drafts readable by their team" on public.projects for select to authenticated
  using (
    is_draft
    and (
      exists (select 1 from public.profiles p where p.id = profile_id and p.owner_id = auth.uid())
      or public.is_collaborator(id)
    )
  );

-- ===========================================================================
-- PDF uploads (same as supabase/pdfs.sql).
-- ===========================================================================

-- The bucket: public to read, PDFs only, up to 10 MB each.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('research-pdfs', 'research-pdfs', true, 10485760, array['application/pdf'])
on conflict (id) do update
  set public = true, file_size_limit = 10485760, allowed_mime_types = array['application/pdf'];

-- Uploads go in a folder named after your account, and only you can add or remove files there.
drop policy if exists "upload your own research pdfs" on storage.objects;
create policy "upload your own research pdfs" on storage.objects for insert to authenticated
  with check (bucket_id = 'research-pdfs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "remove your own research pdfs" on storage.objects;
create policy "remove your own research pdfs" on storage.objects for delete to authenticated
  using (bucket_id = 'research-pdfs' and (storage.foldername(name))[1] = auth.uid()::text);

-- Each research card can have one PDF (its address in the bucket).
alter table public.projects add column if not exists pdf text not null default '';
alter table public.projects drop constraint if exists projects_pdf_check;
alter table public.projects add constraint projects_pdf_check check (char_length(pdf) <= 500);
grant update (title, link, description, sources, tags, image, status, is_draft, published_at, pdf) on public.projects to authenticated;

-- ===========================================================================
-- Send us feedback (same as supabase/feedback.sql).
-- ===========================================================================


create table if not exists public.site_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid default auth.uid() references auth.users (id) on delete set null,
  kind text not null default 'other' check (kind in ('idea', 'problem', 'love', 'other')),
  body text not null check (char_length(btrim(body)) between 1 and 500),
  name text not null default '' check (char_length(name) <= 60),
  created_at timestamptz not null default now()
);
create index if not exists site_feedback_created on public.site_feedback (created_at desc);
alter table public.site_feedback enable row level security;

-- Anyone can send feedback. Signed-in people's feedback is marked as theirs.
drop policy if exists "anyone can send feedback" on public.site_feedback;
create policy "anyone can send feedback" on public.site_feedback for insert to anon, authenticated
  with check (user_id is not distinct from auth.uid());
-- Only admins can read it and clear it.
drop policy if exists "admins read feedback" on public.site_feedback;
create policy "admins read feedback" on public.site_feedback for select to anon, authenticated using (public.is_admin());
drop policy if exists "admins remove feedback" on public.site_feedback;
create policy "admins remove feedback" on public.site_feedback for delete to authenticated using (public.is_admin());
grant select on public.site_feedback to anon, authenticated;
grant insert (kind, body, name) on public.site_feedback to anon, authenticated;
grant delete on public.site_feedback to authenticated;

-- Feedback is checked for unkind words, like everything else people post. (Same as keep_it_kind() in
-- more-features-2.sql, now also checking feedback.)
create or replace function public.keep_it_kind()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  fresh text;
  before_text text := '';
  check_mean boolean := tg_table_name in ('project_comments', 'messages', 'site_feedback');
begin
  fresh := concat_ws(' ', to_jsonb(new) ->> 'name', to_jsonb(new) ->> 'description', to_jsonb(new) ->> 'title',
    to_jsonb(new) ->> 'body', to_jsonb(new) ->> 'question', to_jsonb(new) ->> 'options', to_jsonb(new) ->> 'note');
  if tg_op = 'UPDATE' then
    before_text := concat_ws(' ', to_jsonb(old) ->> 'name', to_jsonb(old) ->> 'description', to_jsonb(old) ->> 'title',
      to_jsonb(old) ->> 'body', to_jsonb(old) ->> 'question', to_jsonb(old) ->> 'options', to_jsonb(old) ->> 'note');
    if fresh = before_text then return new; end if;
  end if;
  if public.is_unkind(fresh, check_mean) then
    raise exception 'Please keep it kind. Try saying that another way.';
  end if;
  return new;
end;
$$;
drop trigger if exists keep_it_kind on public.site_feedback;
create trigger keep_it_kind before insert or update on public.site_feedback
  for each row execute function public.keep_it_kind();

-- ===========================================================================
-- Collections and edit history (same as supabase/collections-history.sql).
-- ===========================================================================


-- Collections: research cards with the same collection name are shown together as a series.
alter table public.projects add column if not exists collection text not null default '';
alter table public.projects drop constraint if exists projects_collection_check;
alter table public.projects add constraint projects_collection_check check (char_length(collection) <= 60);
grant update (title, link, description, sources, tags, image, status, is_draft, published_at, pdf, collection) on public.projects to authenticated;

-- Edit history: each time research is changed, the version before it is kept (the last 20 per card).
-- Only the card's owner and accepted collaborators can see them.
create table if not exists public.project_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null default '',
  link text not null default '',
  description text not null default '',
  sources jsonb not null default '[]'::jsonb,
  saved_at timestamptz not null default now()
);
create index if not exists project_versions_project on public.project_versions (project_id, saved_at desc);
alter table public.project_versions enable row level security;

drop policy if exists "team reads research versions" on public.project_versions;
create policy "team reads research versions" on public.project_versions for select to authenticated
  using (
    exists (select 1 from public.projects r join public.profiles p on p.id = r.profile_id
            where r.id = project_id and p.owner_id = auth.uid())
    or public.is_collaborator(project_id)
  );
grant select on public.project_versions to authenticated;

create or replace function public.keep_project_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (old.title, old.link, old.description, old.sources) is distinct from (new.title, new.link, new.description, new.sources) then
    insert into public.project_versions (project_id, title, link, description, sources, saved_at)
    values (old.id, old.title, old.link, old.description, old.sources, coalesce(old.updated_at, old.created_at));
    delete from public.project_versions
      where project_id = old.id
        and id not in (select v.id from public.project_versions v where v.project_id = old.id order by v.saved_at desc limit 20);
  end if;
  return new;
end;
$$;
revoke all on function public.keep_project_version() from public, anon, authenticated;
drop trigger if exists keep_project_version on public.projects;
create trigger keep_project_version after update on public.projects
  for each row execute function public.keep_project_version();
