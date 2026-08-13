# Your CLI can't deploy — use the Dashboard

## The actual problem

`supabase functions deploy` has been silently failing. Confirmed by running:

```
supabase functions list
→ 403: "Your account does not have the necessary privileges to access this endpoint"
```

Same 403 hits `supabase db push` and `supabase migration list`. The CLI on
this machine cannot reach your project's management endpoints at all.

**So every edge function fix written so far never reached Supabase.** The
original code is still running there. That is the entire reason the error
message never changed — there was nothing new deployed to change it.

Nothing is wrong with the code. It just never got uploaded.

---

# FIRST — get your superadmin account (2 min, no deploy needed)

Do this now. It has nothing to do with edge functions.

### 1. Create the login
Supabase Dashboard → **Authentication** → **Users** → **Add user** →
**Create new user**

- Email: `superadmin@artisan.com` (or whatever you want)
- Password: your choice, 6+ characters
- ✅ **Tick "Auto Confirm User"**

Click **Create user**.

### 2. Make it a superadmin
Dashboard → **SQL Editor** → run (change the email to match):

```sql
insert into public.user_roles (user_id, role, approved)
select id, 'superadmin', true
from auth.users
where email = 'superadmin@artisan.com'
on conflict (user_id) do update set role = 'superadmin', approved = true;
```

### 3. Verify
```sql
select u.email, r.role, r.approved
from public.user_roles r
join auth.users u on u.id = r.user_id
order by u.created_at desc;
```

**You now have a working superadmin account.** It can sign in immediately.

---

# SECOND — fix the in-app button (optional)

Only if you want the Accounts page "Create account" button to work while
signed in as developer.

## Deploy through the Dashboard instead of the CLI

1. Supabase Dashboard → **Edge Functions** (left sidebar)
2. Click **create-account**
3. Look for a **Code** tab, or an **Edit function** / pencil button
4. Select all the existing code in the editor and **delete it**
5. Open this file on your Mac:
   ```
   /Users/macbookpro/Desktop/admin-artisan/adminartisan3/supabase/functions/create-account/index.ts
   ```
6. Copy the **entire** file, paste it into the Dashboard editor
7. Click **Deploy** (or **Save and deploy**)

Repeat the same for these two if you want developer to also edit/delete
accounts — they have the identical fix and the identical never-deployed
problem:

- `supabase/functions/update-account/index.ts`
- `supabase/functions/delete-account/index.ts`

## If the Dashboard has no code editor for functions

Some Supabase plans/versions only allow CLI deploys. In that case, fix the
CLI's access instead:

```bash
supabase login
```

This opens a browser to generate an access token. Log in with the account
that **owns** the project (`sdticckqzxmgjbmbqlaj`). The 403 suggests the CLI
is currently authenticated as an account without rights on this project, or
the token is stale — a fresh `supabase login` replaces it.

Then verify access is actually fixed before deploying:

```bash
supabase functions list
```

If that prints your functions instead of a 403, you're good:

```bash
cd /Users/macbookpro/Desktop/admin-artisan/adminartisan3
supabase functions deploy create-account
supabase functions deploy update-account
supabase functions deploy delete-account
```

A successful deploy prints `Deployed Function create-account`. If you don't
see that line, it did not deploy — don't assume it worked.

---

# What about the SQL migrations?

Those are fine. You ran them through the **SQL Editor** in the Dashboard,
which uses your browser login, not the CLI — so they bypassed the 403
entirely. Verified working earlier: `is_developer()` and
`is_license_active()` both exist and respond correctly on your live
database.

Only the **edge functions** were affected, because those are the only thing
that has to go through the CLI.
