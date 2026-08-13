# Developer role, license keys, and account creation — setup steps

Everything below is already written and saved in this repo. This file is
just the checklist for actually applying it to the live Supabase project —
4 SQL migrations, then 1 edge function redeploy.

## Why the edge function step is separate from SQL

Supabase has two different places code lives:

| Type | File extension | Where you run it |
|---|---|---|
| **SQL migrations** | `.sql` | Supabase Dashboard → **SQL Editor** |
| **Edge Functions** | `.ts` (TypeScript) | Terminal (`supabase functions deploy`) or Dashboard → **Edge Functions** |

Pasting a `.ts` file into the SQL Editor will error — they're not
interchangeable. `create-account` (the file that's blocking you right now)
is a `.ts` file, so it needs the Edge Functions path, not SQL Editor.

---

## Step 1 — Run 4 SQL migrations, in order

Open Supabase Dashboard → **SQL Editor**, and run each of these files' full
contents, one at a time, in this order. All four are safe to re-run if
you're not sure whether you already ran one — every statement uses
`create or replace`, `if exists`, or `on conflict`, so running twice does
nothing extra.

1. `supabase/024_developer_role.sql` — adds the `developer` role
2. `supabase/025_license_keys.sql` — creates the license key system,
   seeds 3 keys, and promotes `jrnovera@gmail.com` to developer
3. `supabase/026_hide_developer_accounts.sql` — hides developer accounts
   from superadmin's Accounts list
4. `supabase/027_redeem_license_key.sql` — lets superadmin activate a
   license by typing its code

Each file is in `supabase/` in this project — open it, copy the whole
thing, paste into the SQL Editor, click Run.

## Step 2 — Deploy the `create-account` edge function

This is the file that currently blocks a developer account from creating
new accounts (it only checked for `role === "superadmin"`). The fix is
already saved at:

```
supabase/functions/create-account/index.ts
```

**Deploy it one of two ways:**

### Option A — Terminal
```bash
cd /Users/macbookpro/Desktop/admin-artisan/adminartisan3
supabase functions deploy create-account
```
If this fails with an access-token error, you're not logged in to the
Supabase CLI — run `supabase login` first, then retry the deploy command.

### Option B — Dashboard (if the CLI login won't cooperate)
1. Supabase Dashboard → **Edge Functions** → **create-account**
2. Open its code editor
3. Select all existing code, delete it
4. Open `supabase/functions/create-account/index.ts` in this repo, copy
   the entire file, paste it in
5. Click **Deploy**

### What changed in that file

The only functional change is this block (around line 90–99) — everything
else in the file is unchanged:

```ts
// Developer inherits every superadmin-gated action — see
// supabase/024_developer_role.sql for the reasoning. isValidRole below
// still only accepts staff/admin/superadmin — a developer creating
// *another* developer stays SQL-only, on purpose.
const callerIsPrivileged =
  (callerRole?.role === "superadmin" || callerRole?.role === "developer") &&
  callerRole.approved;
if (!callerIsPrivileged) {
  return json({ error: "Only a superadmin can create accounts" }, 403);
}
```

It used to be just:
```ts
if (callerRole?.role !== "superadmin" || !callerRole.approved) {
  return json({ error: "Only a superadmin can create accounts" }, 403);
}
```

That single `!==` check is why a developer account got rejected — it only
ever recognized `"superadmin"` as valid, nothing else.

Two other edge functions got the same fix earlier and should already be
deployed from before: `update-account` and `delete-account`. If accounts
still won't create after Step 2, double check those two are also deployed
(`supabase functions deploy update-account` / `delete-account`).

---

## Step 3 — Verify it worked

1. Sign in as your **developer** account (`jrnovera@gmail.com`)
2. Go to **Accounts**
3. Under "Create an account", fill in an email, password, and pick a role
   (Staff / Admin / **Superadmin**)
4. Click **Create account** — it should succeed immediately, no more
   "Only a superadmin can create accounts" error

If it still fails, the error message in the toast will say why — most
likely Step 2's deploy didn't take. Re-run it and hard-refresh the app.

---

## Quick reference — what each role can now do

| Action | Staff | Admin | Superadmin | Developer |
|---|---|---|---|---|
| Create staff/admin/superadmin accounts | ❌ | ❌ | ✅ | ✅ |
| Create a developer account | ❌ | ❌ | ❌ | ❌ (SQL only) |
| See/edit/delete a developer's account | ❌ | ❌ | ❌ (invisible to them) | ✅ |
| See the license key list | ❌ | ❌ | ❌ | ✅ |
| Activate a license by typing a code | ❌ | ❌ | ✅ | ✅ |
| See "Danger Zone" (delete all bookings) | ❌ | ❌ | ❌ | ✅ |
| Use the app once the license expires | ❌ | ❌ | ✅ (code-entry screen only) | ✅ |
