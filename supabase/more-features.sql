-- Dollar Search: more features (research tags and pictures, pinned research, daily stars, bookmarks,
-- reactions, messages, collab notes, gifting, reports and the admin page).
-- Run once in Supabase: SQL Editor -> New query -> paste this whole file -> Run. Safe to run again.
-- Run star-shop.sql first (this file builds on its tables).

-- ---------------------------------------------------------------------------
-- Research: topic tags, a cover picture, and when it was last updated. A pinned card per portfolio.
-- ---------------------------------------------------------------------------
alter table public.projects add column if not exists tags text[] not null default '{}';
alter table public.projects add column if not exists image text not null default '';
-- Old research counts as last updated when it was posted (only fills in empty dates, so running again is safe).
alter table public.projects add column if not exists updated_at timestamptz;
update public.projects set updated_at = created_at where updated_at is null;
alter table public.projects alter column updated_at set default now();
alter table public.projects alter column updated_at set not null;
alter table public.projects drop constraint if exists projects_tags_check;
alter table public.projects add constraint projects_tags_check check (cardinality(tags) <= 3);
alter table public.projects drop constraint if exists projects_image_check;
alter table public.projects add constraint projects_image_check check (char_length(image) <= 500);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists projects_touch_updated_at on public.projects;
create trigger projects_touch_updated_at before update on public.projects
  for each row execute function public.touch_updated_at();

grant update (title, link, description, sources, tags, image) on public.projects to authenticated;

alter table public.profiles add column if not exists pinned_project uuid references public.projects (id) on delete set null;
grant update (name, description, email, avatar, pinned_project) on public.profiles to authenticated;
