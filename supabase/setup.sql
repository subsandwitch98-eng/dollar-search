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
