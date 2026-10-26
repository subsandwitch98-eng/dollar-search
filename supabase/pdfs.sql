-- Dollar Search: PDF uploads on research cards.
-- PDFs are stored in a Supabase Storage bucket called "research-pdfs". Anyone can view them (like the
-- research itself); you can only add or remove PDFs in your own folder.
-- Run once in Supabase: SQL Editor -> New query -> paste this whole file -> Run. Safe to run again.

-- The bucket: public to read, PDFs only, up to 10 MB each.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('research-pdfs', 'research-pdfs', true, 10485760, array['application/pdf'])
on conflict (id) do update
  set public = true, file_size_limit = 10485760, allowed_mime_types = array['application/pdf'];

-- Uploads go in a folder named after your account, and only you can add or remove files there.
drop policy if exists "upload your own research pdfs" on storage.objects;
create policy "upload your own research pdfs" on storage.objects for insert to authenticated
  with check (bucket_id = 'research-pdfs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "remove your own research pdfs" on storage.objects;
create policy "remove your own research pdfs" on storage.objects for delete to authenticated
  using (bucket_id = 'research-pdfs' and (storage.foldername(name))[1] = auth.uid()::text);

-- Each research card can have one PDF (its address in the bucket).
alter table public.projects add column if not exists pdf text not null default '';
alter table public.projects drop constraint if exists projects_pdf_check;
alter table public.projects add constraint projects_pdf_check check (char_length(pdf) <= 500);
grant update (title, link, description, sources, tags, image, status, is_draft, published_at, pdf) on public.projects to authenticated;
