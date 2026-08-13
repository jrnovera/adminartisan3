-- Fourth role tier: developer — above superadmin, the only role exempt from
-- the license freeze (see src/lib/license.ts), and the only one that can see
-- the Danger Zone in Settings. Run in Supabase Dashboard > SQL Editor.
-- Safe to re-run.
--
-- Deliberately NOT grantable through the app (same reasoning as superadmin
-- in 017_superadmin_role.sql): the "Superadmins update roles" policy below
-- is tightened so a superadmin can promote/demote staff/admin/superadmin
-- freely, but can neither set anyone's role to 'developer' nor touch a row
-- that already is one. The only way to grant it is straight SQL — see the
-- example at the bottom.

-- ---------------------------------------------------------------
-- Allow the new role value
-- ---------------------------------------------------------------
alter table public.user_roles drop constraint if exists user_roles_role_check;
alter table public.user_roles add constraint user_roles_role_check
  check (role in ('staff', 'admin', 'superadmin', 'developer'));

-- ---------------------------------------------------------------
-- Developer inherits every is_superadmin()-gated capability automatically
-- (delete bookings/staff/activity, approve+edit+delete accounts, etc.) by
-- being folded into the same check, rather than duplicating every policy.
-- ---------------------------------------------------------------
create or replace function public.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles r
    where r.user_id = auth.uid() and r.approved
      and r.role in ('superadmin', 'developer')
  );
$$;

grant execute on function public.is_superadmin() to authenticated;

-- Distinct check for the few things that should be developer-only (the
-- Danger Zone gate reads this indirectly via the app's `isDeveloper` flag,
-- but this is here for any future DB-level policy that needs the same bar).
create or replace function public.is_developer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles r
    where r.user_id = auth.uid() and r.approved and r.role = 'developer'
  );
$$;

grant execute on function public.is_developer() to authenticated;

-- ---------------------------------------------------------------
-- Lock 'developer' out of the app-writable surface
-- ---------------------------------------------------------------
drop policy if exists "Superadmins update roles" on public.user_roles;
create policy "Superadmins update roles" on public.user_roles
  for update to authenticated
  using (public.is_superadmin() and role <> 'developer')
  with check (public.is_superadmin() and role in ('staff', 'admin', 'superadmin'));

-- ---------------------------------------------------------------
-- Granting the role — SQL only, on purpose. Replace the email, then run:
--
--   insert into public.user_roles (user_id, role, approved)
--   select id, 'developer', true from auth.users where email = 'you@example.com'
--   on conflict (user_id) do update set role = 'developer', approved = true;
-- ---------------------------------------------------------------
