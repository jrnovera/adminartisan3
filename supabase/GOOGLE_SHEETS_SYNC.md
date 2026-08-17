# Google Sheets sync — status: not deployed yet

Every insert into any business table pushes a new row into a matching tab
in one Google Sheet, via a Database trigger → Edge Function, same pattern as
`send-push` (see PUSH_NOTIFICATIONS.md).

## What's built (code, not yet deployed)

- `supabase/functions/sync-to-sheets/index.ts` — Edge Function that
  authenticates as a Google service account and appends a row to the tab
  named after the table.
- `supabase/029_sheets_sync_triggers.sql` — template that wires an
  `after insert` trigger (via pg_net) onto every synced table:
  `bookings, products, promos, staff, staff_categories, services,
  service_categories, staff_blocks, staff_time_off, shop_settings,
  activity_log, license_keys, push_subscriptions, user_roles`.

Note: `license_keys`, `push_subscriptions`, and `user_roles` hold
license/security/auth data, not business records — they're included because
you asked for everything synced, but think about who gets access to the
Sheet before sharing it.

## What only you can do — Google Cloud setup

1. **Create a Google Cloud project** (or reuse one) at
   console.cloud.google.com.
2. **Enable the Google Sheets API** for that project (APIs & Services →
   Enable APIs → search "Google Sheets API").
3. **Create a service account** (IAM & Admin → Service Accounts → Create),
   then create a JSON key for it and download it. Note the
   `client_email` and `private_key` fields inside — you'll need both.
4. **Create the destination Google Sheet** (or use an existing one). Add
   one tab per table above, named *exactly* like the table (e.g. `products`,
   `bookings`), and put a header row in each matching that table's columns
   in the order Supabase returns them (id first, then the rest as defined
   in the table's migration file).
5. **Share the Sheet** with the service account's `client_email` as
   **Editor** (File → Share, paste the email — it looks like
   `something@project-id.iam.gserviceaccount.com`).
6. **Get the Sheet ID** — the long string in the Sheet's URL between
   `/d/` and `/edit`.

## What I'll do once you have the above

Send me (or paste into a message, not a file I'd commit) the service
account's `client_email`, `private_key`, and the Sheet ID, and I will:

- `supabase secrets set GOOGLE_SERVICE_ACCOUNT_EMAIL=... GOOGLE_PRIVATE_KEY=... GOOGLE_SHEET_ID=...`
  (private key gets its newlines escaped as `\n` when set this way)
- `supabase secrets set SHEETS_WEBHOOK_SECRET=...` (a random string I'll
  generate, used to keep the public function URL from being spammed)
- `supabase functions deploy sync-to-sheets`
- Apply `029_sheets_sync_triggers.sql` with the real service-role key and
  webhook secret substituted in, via the Management API
- Insert one test row per table and confirm it lands in the right tab

## If something needs changing later

- **Add a new table to the sync:** add its name to the `SYNCED_TABLES` set
  in `sync-to-sheets/index.ts`, add a matching tab + header row in the
  Sheet, add the table name to the array in
  `029_sheets_sync_triggers.sql`, redeploy the function, and re-run the
  trigger SQL.
- **Rotate the webhook secret or Google key:** `supabase secrets set ...`
  with new values, then re-run `029_sheets_sync_triggers.sql` with the new
  secret substituted in (the trigger has the old one baked in as a literal).
