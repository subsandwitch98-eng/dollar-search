-- Dollar Search: comments and tips on research projects.
-- Everyone can read them; signed-in people can write on other people's research, never their own.
-- The writer, the research's owner and site admins can delete a comment.
-- Run once in Supabase: SQL Editor -> New query -> paste this whole file -> Run.

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
