-- Dollar Search: "Feedback wanted". People ask for feedback on one of their research cards, with a short
-- note about what they'd like help with. Everyone can see the requests; feedback is given as comments and tips.
-- Run once in Supabase: SQL Editor -> New query -> paste this whole file -> Run. Safe to run again.

create table if not exists public.feedback_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  note text not null default '' check (char_length(note) <= 200),
  closed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists feedback_requests_created on public.feedback_requests (created_at desc);
alter table public.feedback_requests enable row level security;

drop policy if exists "feedback requests readable" on public.feedback_requests;
create policy "feedback requests readable" on public.feedback_requests for select to anon, authenticated using (true);
-- You can only ask for feedback on your own research.
drop policy if exists "ask for feedback on your research" on public.feedback_requests;
create policy "ask for feedback on your research" on public.feedback_requests for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.projects r join public.profiles p on p.id = r.profile_id
                where r.id = project_id and p.owner_id = auth.uid())
  );
drop policy if exists "close your feedback requests" on public.feedback_requests;
create policy "close your feedback requests" on public.feedback_requests for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "remove your feedback requests" on public.feedback_requests;
create policy "remove your feedback requests" on public.feedback_requests for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());
grant select on public.feedback_requests to anon, authenticated;
grant insert (project_id, note) on public.feedback_requests to authenticated;
grant update (closed) on public.feedback_requests to authenticated;
grant delete on public.feedback_requests to authenticated;

-- Notes are checked for unkind words, like everything else people post. (Same as keep_it_kind() in
-- more-features-2.sql, now also checking notes.)
create or replace function public.keep_it_kind()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  fresh text;
  before_text text := '';
  check_mean boolean := tg_table_name in ('project_comments', 'messages', 'feedback_requests');
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
drop trigger if exists keep_it_kind on public.feedback_requests;
create trigger keep_it_kind before insert or update on public.feedback_requests
  for each row execute function public.keep_it_kind();
