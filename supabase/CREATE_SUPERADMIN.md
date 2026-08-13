# Create a superadmin account

Two paths. **Path A works right now, guaranteed, with no edge function
involved at all.** Use it to get unblocked. Path B is for fixing the
in-app Accounts page afterwards.

---

# PATH A — Create the account now (2 minutes, cannot fail)

The in-app "Create account" button is just a convenience wrapper around
Supabase's own admin API. You can do the exact same thing directly, and it
bypasses the edge function entirely.

## A1. Create the login

1. Supabase Dashboard → **Authentication** (left sidebar) → **Users**
2. Click **Add user** → **Create new user**
3. Fill in:
   - **Email**: whatever you want, e.g. `superadmin@artisan.com`
   - **Password**: your choice, min 6 characters
   - ✅ **Tick "Auto Confirm User"** ← important, skips the email
     confirmation that would otherwise never arrive
4. Click **Create user**

## A2. Give it the superadmin role

Supabase Dashboard → **SQL Editor** → paste and run, replacing the email
with the one you just used:

```sql
insert into public.user_roles (user_id, role, approved)
select id, 'superadmin', true
from auth.users
where email = 'superadmin@artisan.com'
on conflict (user_id) do update set role = 'superadmin', approved = true;
```

## A3. Confirm it worked

```sql
select u.email, r.role, r.approved
from public.user_roles r
join auth.users u on u.id = r.user_id
order by u.created_at desc;
```

You should see your new account with `role = superadmin`, `approved = true`.
It can sign in immediately. **Done — you have your superadmin account.**

---

# PATH B — Fix the in-app Accounts page

Only needed if you want the "Create account" button in the app to work
while signed in as developer.

## B1. Redeploy create-account (it now reports the real reason)

The function has been updated so its error message includes what role the
server actually sees for your account. Deploy it:

```bash
cd /Users/macbookpro/Desktop/admin-artisan/adminartisan3
supabase functions deploy create-account
```

## B2. Try creating an account in the app again

The error toast will now say one of these:

### `role=developer, approved=true`
The server sees you correctly and should have let you through — meaning the
deploy didn't actually replace the running code. Go to Dashboard → Edge
Functions → create-account, look at the source shown there, and confirm it
contains the word `developer`. If it doesn't, paste in the file from
`supabase/functions/create-account/index.ts` manually and deploy from the
Dashboard.

### `role=superadmin, approved=true`
Your account was never promoted to developer. Fix:
```sql
insert into public.user_roles (user_id, role, approved)
select id, 'developer', true from auth.users where email = 'jrnovera@gmail.com'
on conflict (user_id) do update set role = 'developer', approved = true;
```
Then **sign out of the app and sign back in** — your browser caches your
role at login and won't notice the change until a fresh session.

### `role=developer, approved=false`
Approval flag is off. Fix:
```sql
update public.user_roles set approved = true
where user_id = (select id from auth.users where email = 'jrnovera@gmail.com');
```

### `role=none, approved=none`
No `user_roles` row exists for your account at all. Run the insert from the
`role=superadmin` case above — it creates the row if missing.

---

# Why the app can't create auth users without the edge function

Creating a confirmed login requires Supabase's Auth Admin API, which
requires the **service role key**. That key can never be shipped to a
browser — anyone could read it from the page source and take over the whole
project. So the app hands the job to a server-side edge function instead,
which holds the key safely and verifies who's asking before acting.

That's the only reason this isn't a plain SQL operation, and why Path A
(doing it through the Dashboard, which is already authenticated as the
project owner) sidesteps the problem entirely.
