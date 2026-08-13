-- Real license keys, replacing the hardcoded date window in
-- src/lib/license.ts. Three keys are seeded below, all covering the same
-- term (16 Jul 2026 -> 16 Jul 2027): one is switched on, the other two sit
-- in reserve so the developer can rotate to a fresh code without a SQL
-- session if one ever leaks. Run in Supabase Dashboard > SQL Editor.
-- Safe to re-run (seed uses ON CONFLICT).

create table if not exists public.license_keys (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  starts_at timestamptz not null,
  expires_at timestamptz not null,
  status text not null default 'available' check (status in ('available', 'active', 'revoked')),
  note text,
  created_at timestamptz not null default now(),
  activated_at timestamptz
);

alter table public.license_keys enable row level security;

-- Developer only, full stop — a superadmin can't even read the key strings,
-- let alone activate or revoke one. Same is_developer() gate as the Danger
-- Zone and the account-role protections in 024_developer_role.sql.
drop policy if exists "Developers manage license keys" on public.license_keys;
create policy "Developers manage license keys" on public.license_keys
  for all to authenticated
  using (public.is_developer())
  with check (public.is_developer());

-- ---------------------------------------------------------------
-- What the whole app actually gates on. Doesn't expose the table or any key
-- string — just a yes/no the freeze screen (AppShell) can check regardless
-- of role, so staff/admin/superadmin sessions can still be told to lock out
-- without ever being able to read a key.
-- ---------------------------------------------------------------
create or replace function public.is_license_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.license_keys k
    where k.status = 'active'
      and now() >= k.starts_at
      and now() < k.expires_at
  );
$$;

grant execute on function public.is_license_active() to authenticated;

-- ---------------------------------------------------------------
-- Swapping the active key is two writes (deactivate the old one, activate
-- the new one) — wrapped in a function so it can't land half-done, and so
-- the developer-only check happens once, server-side, rather than trusting
-- two separate client calls to both be guarded correctly.
-- ---------------------------------------------------------------
create or replace function public.activate_license_key(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_developer() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  update public.license_keys set status = 'available'
  where status = 'active' and id <> target_id;

  update public.license_keys set status = 'active', activated_at = now()
  where id = target_id;
end;
$$;

grant execute on function public.activate_license_key(uuid) to authenticated;

-- ---------------------------------------------------------------
-- Seed: 3 keys, same term, first one live.
-- ---------------------------------------------------------------
insert into public.license_keys (key, starts_at, expires_at, status, note)
values
  ('ARTS-7F3K-9QXP-2M6D', '2026-07-16T00:00:00Z', '2027-07-16T00:00:00Z', 'active', 'Primary — issued at launch'),
  ('ARTS-B4WZ-K8TN-5R1J', '2026-07-16T00:00:00Z', '2027-07-16T00:00:00Z', 'available', 'Spare #1'),
  ('ARTS-Q2LH-YV07-C9SE', '2026-07-16T00:00:00Z', '2027-07-16T00:00:00Z', 'available', 'Spare #2')
on conflict (key) do nothing;

-- ---------------------------------------------------------------
-- Promote the existing account to developer (per chat: jrnovera@gmail.com,
-- already superadmin — this replaces that role rather than adding a
-- second account, and developer inherits every superadmin capability
-- anyway, see 024_developer_role.sql).
-- ---------------------------------------------------------------
insert into public.user_roles (user_id, role, approved)
select id, 'developer', true from auth.users where email = 'jrnovera@gmail.com'
on conflict (user_id) do update set role = 'developer', approved = true;
