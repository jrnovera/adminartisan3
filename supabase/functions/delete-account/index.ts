// Edge Function: delete-account
//
// Lets a superadmin permanently remove a login from the admin website.
// Deleting an auth user requires the Auth Admin API (service role key), same
// reasoning as create-account/update-account: that key can never ship to the
// browser, so this runs server-side. The caller sends their own access
// token; this function verifies they're a superadmin using that token, then
// uses the service role key (auto-injected into every Edge Function's
// environment) to delete the target account.
//
// The matching public.user_roles row is removed automatically — it has
// `on delete cascade` back to auth.users (see supabase/017_superadmin_role.sql).
//
// Deploy: supabase functions deploy delete-account
// No extra secrets to set: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
// provided automatically, same as create-account and update-account.

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

type DeleteAccountPayload = {
  userId: string;
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
    return json({ error: "Only a superadmin can delete accounts" }, 403);
  }

  let payload: DeleteAccountPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Bad request" }, 400);
  }

  const userId = payload.userId?.trim();
  if (!userId) {
    return json({ error: "Missing userId" }, 400);
  }

  if (userId === callerData.user.id) {
    return json({ error: "You can't delete your own account" }, 400);
  }

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);
  if (deleteError) {
    return json({ error: deleteError.message }, 400);
  }

  return json({ id: userId });
});
