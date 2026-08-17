// Edge Function: sync-to-sheets
//
// Triggered by a Supabase Database Webhook (pg_net trigger) on insert/update
// into any table listed in supabase/029_sheets_sync_triggers.sql. Appends
// (insert) or updates (update) the matching row in a Google Sheet, one tab
// per table — see supabase/GOOGLE_SHEETS_SYNC.md for full setup.
//
// Deploy: supabase functions deploy sync-to-sheets
// Secrets needed (supabase secrets set ...):
//   GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SHEET_ID,
//   SHEETS_WEBHOOK_SECRET
// Each target tab (sheet) name must exactly match the Postgres table name,
// and its header row must exist before the first sync (see setup doc).

import { GoogleAuth } from "npm:google-auth-library@9";

const SERVICE_ACCOUNT_EMAIL = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL") ?? "";
// Stored with literal \n escapes in the secret; convert back to real newlines.
const PRIVATE_KEY = (Deno.env.get("GOOGLE_PRIVATE_KEY") ?? "").replace(/\\n/g, "\n");
const SHEET_ID = Deno.env.get("GOOGLE_SHEET_ID") ?? "";
const WEBHOOK_SECRET = Deno.env.get("SHEETS_WEBHOOK_SECRET") ?? "";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

const auth = new GoogleAuth({
  credentials: { client_email: SERVICE_ACCOUNT_EMAIL, private_key: PRIVATE_KEY },
  scopes: SCOPES,
});

// Tables allowed to sync — must match the trigger list in
// 029_sheets_sync_triggers.sql. Guards against a stray/forged payload
// writing to an arbitrary tab name.
const SYNCED_TABLES = new Set([
  "bookings",
  "products",
  "promos",
  "staff",
  "staff_categories",
  "services",
  "service_categories",
  "staff_blocks",
  "staff_time_off",
  "shop_settings",
  "activity_log",
  "license_keys",
  "push_subscriptions",
  "user_roles",
]);

type WebhookPayload = {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  record: Record<string, unknown> | null;
};

async function getAccessToken(): Promise<string> {
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("Failed to obtain Google access token");
  return token;
}

async function appendRow(table: string, record: Record<string, unknown>, token: string) {
  // Column order = insertion order of the record's own keys, so the sheet's
  // header row (set up manually per table) must list columns in that order.
  const values = [Object.values(record).map((v) => (v === null ? "" : String(v)))];
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(
    table
  )}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values }),
  });

  if (!res.ok) {
    throw new Error(`Sheets API error ${res.status}: ${await res.text()}`);
  }
}

Deno.serve(async (req) => {
  if (WEBHOOK_SECRET && req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  if (payload.type !== "INSERT" || !payload.record || !SYNCED_TABLES.has(payload.table)) {
    return new Response("Ignored", { status: 200 });
  }

  try {
    const token = await getAccessToken();
    await appendRow(payload.table, payload.record, token);
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, table: payload.table }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
