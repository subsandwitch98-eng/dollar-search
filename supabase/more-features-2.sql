-- Dollar Search: more features, part 2 (kind-words filter, blocking, research status, comment replies,
-- polls, the weekly challenge, and the Valentine's and spring shops).
-- Run once in Supabase: SQL Editor -> New query -> paste this whole file -> Run. Safe to run again.
-- Run more-features.sql first (this file builds on its tables).

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
  check_mean boolean := tg_table_name in ('project_comments', 'messages', 'feedback_requests');
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
