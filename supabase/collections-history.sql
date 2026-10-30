-- Dollar Search: collections and edit history for research cards.
-- Run once in Supabase: SQL Editor -> New query -> paste this whole file -> Run. Safe to run again.

-- Collections: research cards with the same collection name are shown together as a series.
alter table public.projects add column if not exists collection text not null default '';
alter table public.projects drop constraint if exists projects_collection_check;
alter table public.projects add constraint projects_collection_check check (char_length(collection) <= 60);
grant update (title, link, description, sources, tags, image, status, is_draft, published_at, pdf, collection) on public.projects to authenticated;

-- Edit history: each time research is changed, the version before it is kept (the last 20 per card).
-- Only the card's owner and accepted collaborators can see them.
create table if not exists public.project_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null default '',
  link text not null default '',
  description text not null default '',
  sources jsonb not null default '[]'::jsonb,
  saved_at timestamptz not null default now()
);
create index if not exists project_versions_project on public.project_versions (project_id, saved_at desc);
alter table public.project_versions enable row level security;

drop policy if exists "team reads research versions" on public.project_versions;
create policy "team reads research versions" on public.project_versions for select to authenticated
  using (
    exists (select 1 from public.projects r join public.profiles p on p.id = r.profile_id
            where r.id = project_id and p.owner_id = auth.uid())
    or public.is_collaborator(project_id)
  );
grant select on public.project_versions to authenticated;

create or replace function public.keep_project_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (old.title, old.link, old.description, old.sources) is distinct from (new.title, new.link, new.description, new.sources) then
    insert into public.project_versions (project_id, title, link, description, sources, saved_at)
    values (old.id, old.title, old.link, old.description, old.sources, coalesce(old.updated_at, old.created_at));
    delete from public.project_versions
      where project_id = old.id
        and id not in (select v.id from public.project_versions v where v.project_id = old.id order by v.saved_at desc limit 20);
  end if;
  return new;
end;
$$;
revoke all on function public.keep_project_version() from public, anon, authenticated;
drop trigger if exists keep_project_version on public.projects;
create trigger keep_project_version after update on public.projects
  for each row execute function public.keep_project_version();
