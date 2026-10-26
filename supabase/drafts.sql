-- Dollar Search: private drafts. A draft research card is only visible to its owner (and accepted
-- collaborators) until it's published. Publishing sets published_at, which is when it counts as posted.
-- Run once in Supabase: SQL Editor -> New query -> paste this whole file -> Run. Safe to run again.

alter table public.projects add column if not exists is_draft boolean not null default false;
-- When research was published. Older research counts as published when it was posted.
alter table public.projects add column if not exists published_at timestamptz;
update public.projects set published_at = created_at where published_at is null;
alter table public.projects alter column published_at set default now();
alter table public.projects alter column published_at set not null;
grant update (title, link, description, sources, tags, image, status, is_draft, published_at) on public.projects to authenticated;

-- Everyone can read published research. Drafts are readable only by the owner and accepted collaborators.
drop policy if exists "projects readable" on public.projects;
create policy "projects readable" on public.projects for select to anon, authenticated using (not is_draft);
drop policy if exists "drafts readable by their team" on public.projects;
create policy "drafts readable by their team" on public.projects for select to authenticated
  using (
    is_draft
    and (
      exists (select 1 from public.profiles p where p.id = profile_id and p.owner_id = auth.uid())
      or public.is_collaborator(id)
    )
  );
