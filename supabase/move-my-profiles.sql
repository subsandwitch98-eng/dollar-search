-- Dollar Search: make you the site admin and copy your profiles over from the Claude version.
-- Run AFTER setup.sql, and after you have signed up on the new site and confirmed your email.
--
-- 1. Replace you@example.com below with the email you signed up with.
-- 2. SQL Editor -> New query -> paste this whole file -> Run.
--
-- The two "Bell test" projects were only for testing notifications, so they are left out.

do $move$
declare
  me uuid;
  main_id uuid := gen_random_uuid();
  ramko_id uuid := gen_random_uuid();
begin
  select id into me from auth.users where email = 'you@example.com';
  if me is null then
    raise exception 'No account uses that email yet. Sign up on the site, confirm your email, put that email in this script, then run it again.';
  end if;

  insert into public.site_admins (user_id) values (me) on conflict (user_id) do nothing;

  update public.site_settings
     set hub_name = 'Dollar Search',
         hub_intro = 'Browse portfolios and create your own! Put your research, sources, creations, and projects all in one area. Manage your research efficiently and skim through others profiles to read theirs.'
   where id = 1;

  if exists (select 1 from public.profiles where owner_id = me and name = '$ubway Surfer Portfolio') then
    raise notice 'Your profiles were already copied over, so nothing else was added.';
    return;
  end if;

  insert into public.profiles (id, owner_id, name, description, email, avatar) values
    (main_id, me, '$ubway Surfer Portfolio', 'I research and write', 'subsandwitch98@gmail.com',
     '{"mode":"character","character":{"skin":4,"hairStyle":2,"bangs":1,"hairColor":0,"top":5,"headwear":1,"glasses":2,"face":2,"bg":0}}'::jsonb),
    (ramko_id, me, 'Ramko', 'The ramko', 'rk@gmail.com',
     '{"mode":"character","character":{"skin":4,"hairStyle":1,"bangs":0,"hairColor":2,"top":5,"headwear":0,"glasses":0,"face":0,"bg":4}}'::jsonb);

  -- Older projects get earlier times so they keep their order and don't show up as new in anyone's bell.
  insert into public.projects (profile_id, title, link, description, sources, created_at) values
    (main_id, 'Research',
     'https://docs.google.com/document/d/19v8oOIZ7TtIX3G4iHVIvIpqNjJ9pc65Be-1ukw6sAck/edit?tab=t.0',
     'Research$$$$$',
     '[{"name":"kawaii","link":"https://docs.google.com/document/d/19v8oOIZ7TtIX3G4iHVIvIpqNjJ9pc65Be-1ukw6sAck/edit?tab=t.0"},{"name":"coolbeans","link":"https://groupbuild.vercel.app/"}]'::jsonb,
     now() - interval '3 days'),
    (main_id, 'coolbeans', '', 'cool', '[]'::jsonb, now() - interval '2 days 23 hours'),
    (main_id, 'hjhk', '', 'dfghj',
     '[{"name":"dfghn","link":"https://claude.ai/artifact/Sh7sfrNY1yuoKtXU4f7enN#profiles"}]'::jsonb,
     now() - interval '2 days 22 hours'),
    (ramko_id, 'Boooo', 'https://google.com/', 'Hey', '[]'::jsonb, now() - interval '2 days 21 hours');

  raise notice 'Done: you are the site admin, and your 2 profiles and 4 research projects were copied over.';
end
$move$;
