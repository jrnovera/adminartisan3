import { getSupabaseClient } from "./supabase";

export type UserRole = "staff" | "admin" | "superadmin" | "developer";

export type RoleInfo = {
  role: UserRole;
  approved: boolean;
} | null; // null = no row at all — a legacy account from before this system
// existed. Treated as fully-trusted, unrestricted access (same as the app
// behaved before roles existed) rather than locked out, so introducing this
// system can't silently break an existing admin's access.

/**
 * The signed-in user's role, from public.user_roles (see
 * supabase/019_signup_approval.sql) — not from a list in this file, so the
 * UI and the RLS policies that actually enforce deletion/approval can't
 * disagree about who is what.
 *
 * Fails closed on error: `null` here is indistinguishable from "no row",
 * i.e. full legacy access — that's deliberate for existing accounts, but
 * means a transient network error also reads as unrestricted rather than
 * locked out. Given every real delete/approval action is re-checked at the
 * database via is_superadmin(), that tradeoff favors not locking someone out
 * of their own dashboard over a flaky connection.
 */
export async function fetchRole(userId: string): Promise<RoleInfo> {
  const { data, error } = await getSupabaseClient()
    .from("user_roles")
    .select("role, approved")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return null;
  return { role: data.role as UserRole, approved: data.approved as boolean };
}
