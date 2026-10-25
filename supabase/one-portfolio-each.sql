-- Dollar Search: everyone, admins included, can create only one portfolio.
-- Research projects inside a portfolio stay unlimited.
-- Run once in Supabase: SQL Editor -> New query -> paste this whole file -> Run.
-- Portfolios that already exist are kept; this only stops new extra ones.

drop policy if exists "create own profile" on public.profiles;
create policy "create own profile" on public.profiles for insert to authenticated
  with check (
    owner_id = auth.uid()
    and not exists (select 1 from public.profiles p where p.owner_id = auth.uid())
  );
