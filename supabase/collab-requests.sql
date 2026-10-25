-- Dollar Search: collaboration requests on research.
-- You invite the owner of another portfolio to collaborate on one of your research cards.
-- If they accept, they can edit that card (not delete it) and it shows on their portfolio too.
-- Run once in Supabase: SQL Editor -> New query -> paste this whole file -> Run.

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
