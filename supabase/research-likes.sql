-- Dollar Search: likes on individual research projects.
-- Everyone sees the counts; signed-in people can like research in other people's portfolios,
-- never their own. Run once in Supabase: SQL Editor -> New query -> paste this whole file -> Run.

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
