-- Lets a superadmin (or developer) activate a license by typing its code —
-- without ever being able to read public.license_keys directly (RLS on
-- that table stays developer-only, see 025_license_keys.sql). This function
-- looks the code up itself, server-side, and only ever returns success/
-- failure — never the list of keys, an expiry date, or anything else about
-- keys that don't match. Run in Supabase Dashboard > SQL Editor. Safe to
-- re-run.

create or replace function public.redeem_license_key(input_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  found_id uuid;
begin
  if not public.is_superadmin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select id into found_id
  from public.license_keys
  where key = trim(input_key) and status <> 'revoked';

  if found_id is null then
    raise exception 'Invalid or revoked license key' using errcode = 'P0001';
  end if;

  update public.license_keys set status = 'available'
  where status = 'active' and id <> found_id;

  update public.license_keys set status = 'active', activated_at = now()
  where id = found_id;
end;
$$;

grant execute on function public.redeem_license_key(text) to authenticated;
