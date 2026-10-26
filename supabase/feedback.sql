-- Dollar Search: "Send us feedback". Anyone (signed in or not) can send feedback about the website.
-- Only site admins can read it or remove it.
-- Run once in Supabase: SQL Editor -> New query -> paste this whole file -> Run. Safe to run again.

create table if not exists public.site_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid default auth.uid() references auth.users (id) on delete set null,
  kind text not null default 'other' check (kind in ('idea', 'problem', 'love', 'other')),
  body text not null check (char_length(btrim(body)) between 1 and 500),
  name text not null default '' check (char_length(name) <= 60),
  created_at timestamptz not null default now()
);
create index if not exists site_feedback_created on public.site_feedback (created_at desc);
alter table public.site_feedback enable row level security;

-- Anyone can send feedback. Signed-in people's feedback is marked as theirs.
drop policy if exists "anyone can send feedback" on public.site_feedback;
create policy "anyone can send feedback" on public.site_feedback for insert to anon, authenticated
  with check (user_id is not distinct from auth.uid());
-- Only admins can read it and clear it.
drop policy if exists "admins read feedback" on public.site_feedback;
create policy "admins read feedback" on public.site_feedback for select to anon, authenticated using (public.is_admin());
drop policy if exists "admins remove feedback" on public.site_feedback;
create policy "admins remove feedback" on public.site_feedback for delete to authenticated using (public.is_admin());
grant select on public.site_feedback to anon, authenticated;
grant insert (kind, body, name) on public.site_feedback to anon, authenticated;
grant delete on public.site_feedback to authenticated;

-- Feedback is checked for unkind words, like everything else people post. (Same as keep_it_kind() in
-- more-features-2.sql, now also checking feedback.)
create or replace function public.keep_it_kind()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  fresh text;
  before_text text := '';
  check_mean boolean := tg_table_name in ('project_comments', 'messages', 'site_feedback');
begin
  fresh := concat_ws(' ', to_jsonb(new) ->> 'name', to_jsonb(new) ->> 'description', to_jsonb(new) ->> 'title',
    to_jsonb(new) ->> 'body', to_jsonb(new) ->> 'question', to_jsonb(new) ->> 'options', to_jsonb(new) ->> 'note');
  if tg_op = 'UPDATE' then
    before_text := concat_ws(' ', to_jsonb(old) ->> 'name', to_jsonb(old) ->> 'description', to_jsonb(old) ->> 'title',
      to_jsonb(old) ->> 'body', to_jsonb(old) ->> 'question', to_jsonb(old) ->> 'options', to_jsonb(old) ->> 'note');
    if fresh = before_text then return new; end if;
  end if;
  if public.is_unkind(fresh, check_mean) then
    raise exception 'Please keep it kind. Try saying that another way.';
  end if;
  return new;
end;
$$;
drop trigger if exists keep_it_kind on public.site_feedback;
create trigger keep_it_kind before insert or update on public.site_feedback
  for each row execute function public.keep_it_kind();
