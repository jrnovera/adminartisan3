// Edge Function: update-account
//
// Lets a superadmin edit an existing login's email and/or password directly
// from the admin website. Changing a user's email or password requires the
// Auth Admin API (service role key), same reasoning as create-account: that
// key can never ship to the browser, so this runs server-side. The caller
// sends their own access token; this function verifies they're a superadmin
// using that token, then uses the service role key (auto-injected into every
// Edge Function's environment) to update the target account.
//
// Role/approved changes don't need this function — those go straight through
// the "Superadmins update roles" RLS policy on user_roles from the client.
//
// Deploy: supabase functions deploy update-account
// No extra secrets to set: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
// provided automatically, same as create-account.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

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

type UpdateAccountPayload = {
  userId: string;
  email?: string;
  password?: string;
};

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

  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${callerToken}` } },
  });
  const { data: callerData, error: callerError } =
    await callerClient.auth.getUser();
  if (callerError || !callerData.user) {
    return json({ error: "Invalid session" }, 401);
  }

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: callerRole } = await adminClient
    .from("user_roles")
    .select("role, approved")
    .eq("user_id", callerData.user.id)
    .maybeSingle();

  if (callerRole?.role !== "superadmin" || !callerRole.approved) {
    return json({ error: "Only a superadmin can edit accounts" }, 403);
  }

  let payload: UpdateAccountPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Bad request" }, 400);
  }

  const userId = payload.userId?.trim();
  if (!userId) {
    return json({ error: "Missing userId" }, 400);
  }

  const updates: { email?: string; password?: string } = {};

  if (payload.email !== undefined) {
    const email = payload.email.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      return json({ error: "Invalid email" }, 400);
    }
    updates.email = email;
  }

  if (payload.password !== undefined && payload.password !== "") {
    if (payload.password.length < 6) {
      return json({ error: "Password must be at least 6 characters" }, 400);
    }
    updates.password = payload.password;
  }

  if (!updates.email && !updates.password) {
    return json({ error: "Nothing to update" }, 400);
  }

  const { data: updated, error: updateError } =
    await adminClient.auth.admin.updateUserById(userId, {
      ...(updates.email ? { email: updates.email, email_confirm: true } : {}),
      ...(updates.password ? { password: updates.password } : {}),
    });

  if (updateError || !updated.user) {
    return json({ error: updateError?.message ?? "Could not update user" }, 400);
  }

  return json({ id: updated.user.id, email: updated.user.email });
});
