// Edge Function: create-account
//
// Lets a superadmin create a new login (staff/admin/superadmin) directly from
// the admin website, instead of needing the Supabase Dashboard. This exists
// because the client-side `auth.signUp()` path sends a real confirmation
// email — and this project has no SMTP provider configured, so that email
// never arrives and the account is stuck unconfirmed forever (see chat
// history: this is exactly what happened trying to create admin@gmail.com).
//
// Creating a *confirmed* user requires the Auth Admin API, which requires the
// service role key — far too dangerous to ship to a browser. So this runs
// server-side instead: the caller sends their own access token, this function
// verifies they're a superadmin using that token, and only then uses the
// service role key (auto-injected into every Edge Function's environment —
// never stored or set by hand) to create the account already confirmed.
//
// Deploy: supabase functions deploy create-account
// No extra secrets to set: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
// provided automatically, same as send-push and send-booking-confirmation.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// Called directly from the admin website's browser JS (not routed through
// the Supabase client library), so it needs its own CORS headers — the
// browser sends a preflight OPTIONS request first and blocks the real one
// if that preflight doesn't come back with these.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

type CreateAccountPayload = {
  email: string;
  password: string;
  role: "staff" | "admin" | "superadmin";
};

function isValidRole(value: unknown): value is CreateAccountPayload["role"] {
  return value === "staff" || value === "admin" || value === "superadmin";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const callerToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!callerToken) {
    return json({ error: "Missing authorization" }, 401);
  }

  // Verify the caller as themselves first (anon key + their token) — this
  // confirms the token is real and gets us their user id without trusting
  // anything the client claims about who they are.
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${callerToken}` } },
  });
  const { data: callerData, error: callerError } =
    await callerClient.auth.getUser();
  if (callerError || !callerData.user) {
    return json({ error: "Invalid session" }, 401);
  }

  // Now check their role with the service client, bypassing RLS — the
  // policy on user_roles only grants SELECT to the row's own owner in some
  // setups, and this function needs to read it regardless of that.
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: callerRole } = await adminClient
    .from("user_roles")
    .select("role, approved")
    .eq("user_id", callerData.user.id)
    .maybeSingle();

  // Developer inherits every superadmin-gated action — see
  // supabase/024_developer_role.sql for the reasoning. isValidRole below
  // still only accepts staff/admin/superadmin — a developer creating
  // *another* developer stays SQL-only, on purpose.
  const callerIsPrivileged =
    (callerRole?.role === "superadmin" || callerRole?.role === "developer") &&
    callerRole.approved;
  if (!callerIsPrivileged) {
    // The role/approved values are echoed back deliberately: without them
    // this 403 is indistinguishable from "the old version of this function
    // is still deployed", which cost a lot of debugging time once already.
    return json(
      {
        error:
          `Not allowed to create accounts. Your account is role=` +
          `${callerRole?.role ?? "none"}, approved=${callerRole?.approved ?? "none"}. ` +
          `Needs role=superadmin or developer with approved=true.`,
      },
      403
    );
  }

  let payload: CreateAccountPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Bad request" }, 400);
  }

  const email = payload.email?.trim().toLowerCase();
  const password = payload.password ?? "";
  if (!email || !email.includes("@")) {
    return json({ error: "Invalid email" }, 400);
  }
  if (password.length < 6) {
    return json({ error: "Password must be at least 6 characters" }, 400);
  }
  if (!isValidRole(payload.role)) {
    return json({ error: "Invalid role" }, 400);
  }

  // email_confirm: true is the whole point — this is what a Dashboard
  // "Add user" with "Auto Confirm User" ticked does, done from inside the app.
  const { data: created, error: createError } =
    await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

  if (createError || !created.user) {
    return json({ error: createError?.message ?? "Could not create user" }, 400);
  }

  // A superadmin creating an account directly is itself the approval — no
  // separate accept step needed, unlike a self-signup.
  const { error: roleError } = await adminClient
    .from("user_roles")
    .insert({ user_id: created.user.id, role: payload.role, approved: true });

  if (roleError) {
    // The auth user now exists without a role row — better to surface this
    // clearly than leave it silently defaulting to "no access", since the
    // caller needs to know to fix it (delete the user, or insert the role
    // row by hand) rather than assume the account is ready to use.
    return json(
      {
        error: `User created but role assignment failed: ${roleError.message}. Delete this user and retry, or set their role manually.`,
        userId: created.user.id,
      },
      500
    );
  }

  return json({ id: created.user.id, email, role: payload.role });
});
