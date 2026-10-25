-- Dollar Search: the Star Shop.
-- You earn 1 star for every like your portfolio or your research gets, and spend stars on items for
-- your character. Purchases can only be made through buy_shop_item(), which checks the price and
-- that you have enough stars, so nobody can give themselves items for free.
-- Run once in Supabase: SQL Editor -> New query -> paste this whole file -> Run.

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
    else null
  end;
  if cost is null then
    raise exception 'That item is not in the shop.';
  end if;
  if exists (select 1 from public.shop_purchases where user_id = auth.uid() and item = item_id) then
    raise exception 'You already own that item.';
  end if;
  -- Stars earned: likes on your portfolio plus likes on your research.
  select
    (select count(*) from public.likes l
       join public.profiles p on p.id = l.profile_id
      where p.owner_id = auth.uid())
    + (select count(*) from public.project_likes pl
         join public.projects r on r.id = pl.project_id
         join public.profiles p on p.id = r.profile_id
        where p.owner_id = auth.uid())
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
