-- Dollar Search: nobody can like or follow their own portfolio.
-- Run once in Supabase: SQL Editor -> New query -> paste this whole file -> Run.

-- Remove any likes and follows people already gave their own portfolio.
delete from public.likes l using public.profiles p
 where l.profile_id = p.id and p.owner_id = l.user_id;
delete from public.follows f using public.profiles p
 where f.profile_id = p.id and p.owner_id = f.user_id;

-- From now on, you can only like or follow someone else's portfolio.
drop policy if exists "like as yourself" on public.likes;
create policy "like as yourself" on public.likes for insert to authenticated
  with check (
    user_id = auth.uid()
    and not exists (select 1 from public.profiles p where p.id = profile_id and p.owner_id = auth.uid())
  );
drop policy if exists "follow as yourself" on public.follows;
create policy "follow as yourself" on public.follows for insert to authenticated
  with check (
    user_id = auth.uid()
    and not exists (select 1 from public.profiles p where p.id = profile_id and p.owner_id = auth.uid())
  );
