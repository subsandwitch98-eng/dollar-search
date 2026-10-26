-- Dollar Search: the research calendar on each portfolio.
-- Everyone can see the days research was posted. Plans you add (due dates, reminders, ideas) are yours
-- alone: only you can see, add, change or remove them.
-- Run once in Supabase: SQL Editor -> New query -> paste this whole file -> Run. Safe to run again.

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null,
  title text not null check (char_length(title) between 1 and 80),
  project_id uuid references public.projects (id) on delete set null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists calendar_events_user_day on public.calendar_events (user_id, day);

alter table public.calendar_events enable row level security;
drop policy if exists "your own calendar" on public.calendar_events;
create policy "your own calendar" on public.calendar_events for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, delete on public.calendar_events to authenticated;
grant update (day, title, project_id, done) on public.calendar_events to authenticated;
