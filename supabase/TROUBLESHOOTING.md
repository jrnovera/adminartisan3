# Troubleshooting: "Only a superadmin can create accounts"

You've deployed `create-account` successfully. If you're still seeing this
error, there's exactly one thing left to check: **is your account's role
actually `developer` in the database right now?**

## Step 1 — Run this in Supabase SQL Editor

```sql
select u.email, r.role, r.approved
from public.user_roles r
join auth.users u on u.id = r.user_id
where u.email = 'jrnovera@gmail.com';
```

## Step 2 — Look at the `role` column it returns

### If it says `role = superadmin`
Your account was never actually promoted to developer. Run this to fix it:

```sql
insert into public.user_roles (user_id, role, approved)
select id, 'developer', true from auth.users where email = 'jrnovera@gmail.com'
on conflict (user_id) do update set role = 'developer', approved = true;
```

Then run the Step 1 query again to confirm it now says `role = developer`.

### If it says `role = developer` already
Your database is correct — the problem is your **browser session is stale**.
Your login token was issued before the role changed, so the app is still
using old, cached role info. Fix:

1. Sign out of the admin app completely
2. Sign back in with `jrnovera@gmail.com`
3. Try creating the account again

### If the query returns no rows at all
There's no `user_roles` row for that email at all. Run the same insert from
above — it creates the row if missing, updates it if present either way.

---

## Why this happens

Your role lives in the `user_roles` table, not on the browser. When you log
in, the app fetches your role **once** and holds onto it for that session.
If your role changes in the database *after* you're already logged in, the
app has no way to know — it's still holding the old value until you log out
and back in.

Deploying the edge function was step 2 of 2. This — making sure the role
row actually says `developer`, and that your session is fresh — is the
part that was still missing.
