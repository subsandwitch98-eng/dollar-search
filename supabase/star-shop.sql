-- Dollar Search: the Star Shop.
-- You earn 1 star for every like your portfolio or your research gets, plus any stars you've been
-- gifted, and spend them on items for your character. Purchases can only be made through
-- buy_shop_item(), which checks the price and that you have enough stars, so nobody can give
-- themselves items for free.
-- Run once in Supabase: SQL Editor -> New query -> paste this whole file -> Run. Safe to run again.

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
