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
