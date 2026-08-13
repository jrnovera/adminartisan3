import { getSupabaseClient } from "./supabase";
import type { UserRole } from "./roles";

export type UserAccount = {
  user_id: string;
  email: string;
  role: UserRole;
  approved: boolean;
  created_at: string;
};

/** Superadmin-only — see public.list_user_accounts() and its own FORBIDDEN check. */
export async function fetchUserAccounts(): Promise<UserAccount[]> {
  const { data, error } = await getSupabaseClient().rpc("list_user_accounts");
  if (error) throw new Error(error.message);
  return (data ?? []) as UserAccount[];
}

/** Approves a pending self-signup, or changes an existing account's role.
 * Relies on the "Superadmins update roles" RLS policy — the database
 * re-checks is_superadmin() itself, this call is not the security boundary. */
export async function updateAccount(
  userId: string,
  changes: Partial<{ role: UserRole; approved: boolean }>
) {
  const { error } = await getSupabaseClient()
    .from("user_roles")
    .update(changes)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

const FUNCTIONS_URL = "https://sdticckqzxmgjbmbqlaj.supabase.co/functions/v1";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body?.error ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

/**
 * Public sign-up — no session required. Always lands as role 'staff' with
 * approved = false; a superadmin has to accept it from the Team screen
 * before it can sign in (see supabase/functions/self-signup).
 */
export async function signUpAsStaff(email: string, password: string) {
  const res = await fetch(`${FUNCTIONS_URL}/self-signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(await readError(res));
}

/**
 * Superadmin-only: edit an existing account's email and/or password from
 * inside the app (see supabase/functions/update-account). Requires the
 * caller's own access token, which the Edge Function re-verifies server-side
 * — this call is not itself the security boundary, just the transport.
 * Role/approved changes don't go through here — use updateAccount() instead.
 */
export async function editAccountAuth(input: {
  userId: string;
  email?: string;
  password?: string;
}) {
  const {
    data: { session },
  } = await getSupabaseClient().auth.getSession();
  if (!session) throw new Error("Not signed in");

  const res = await fetch(`${FUNCTIONS_URL}/update-account`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res));
}

/**
 * Superadmin-only: permanently delete an account (see
 * supabase/functions/delete-account). Requires the caller's own access
 * token, which the Edge Function re-verifies server-side — this call is not
 * itself the security boundary, just the transport. The matching
 * user_roles row is removed automatically via ON DELETE CASCADE.
 */
export async function deleteAccount(userId: string) {
  const {
    data: { session },
  } = await getSupabaseClient().auth.getSession();
  if (!session) throw new Error("Not signed in");

  const res = await fetch(`${FUNCTIONS_URL}/delete-account`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) throw new Error(await readError(res));
}

/**
 * Superadmin-only: create an already-approved account with a chosen role,
 * from inside the app (see supabase/functions/create-account). Requires the
 * caller's own access token, which the Edge Function re-verifies server-side
 * — this call is not itself the security boundary, just the transport.
 */
export async function createAccount(input: {
  email: string;
  password: string;
  role: UserRole;
}) {
  const {
    data: { session },
  } = await getSupabaseClient().auth.getSession();
  if (!session) throw new Error("Not signed in");

  const res = await fetch(`${FUNCTIONS_URL}/create-account`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res));
}
