insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('business-logos', 'business-logos', false, 2097152, array['image/jpeg'])
on conflict (id) do update set
  public = false,
  file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg'];

drop policy if exists "fieldcraft_logo_select_own" on storage.objects;
drop policy if exists "fieldcraft_logo_insert_own" on storage.objects;
drop policy if exists "fieldcraft_logo_update_own" on storage.objects;
drop policy if exists "fieldcraft_logo_delete_own" on storage.objects;

create policy "fieldcraft_logo_select_own" on storage.objects
for select to authenticated
using (bucket_id = 'business-logos' and name = (auth.uid()::text || '/logo.jpg'));

create policy "fieldcraft_logo_insert_own" on storage.objects
for insert to authenticated
with check (bucket_id = 'business-logos' and name = (auth.uid()::text || '/logo.jpg'));

create policy "fieldcraft_logo_update_own" on storage.objects
for update to authenticated
using (bucket_id = 'business-logos' and name = (auth.uid()::text || '/logo.jpg'))
with check (bucket_id = 'business-logos' and name = (auth.uid()::text || '/logo.jpg'));

create policy "fieldcraft_logo_delete_own" on storage.objects
for delete to authenticated
using (bucket_id = 'business-logos' and name = (auth.uid()::text || '/logo.jpg'));
