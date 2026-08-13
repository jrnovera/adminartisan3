-- Hides developer accounts from list_user_accounts() when the caller isn't
-- a developer themselves — a superadmin can already see nothing sensitive
-- about a developer row (024/025 already block editing/deleting/reading the
-- license_keys table), but the account still showed up in the Accounts list
-- with a "protected" badge. This drops it from the query entirely instead,
-- so a superadmin has no way to even learn a developer account exists.
-- Run in Supabase Dashboard > SQL Editor. Safe to re-run.

create or replace function public.list_user_accounts()
returns table (
  user_id uuid,
  email text,
  role text,
  approved boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_superadmin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  return query
  select r.user_id, u.email::text, r.role, r.approved, u.created_at
  from public.user_roles r
  join auth.users u on u.id = r.user_id
  where r.role <> 'developer' or public.is_developer()
  -- Pending signups first — that's the queue a superadmin actually needs to
  -- act on; everyone already approved is reference info below it.
  order by r.approved asc, u.created_at desc;
end;
$$;

grant execute on function public.list_user_accounts() to authenticated;
