import { getSupabaseClient } from "./supabase";
import type { LicenseKey } from "./types";

/**
 * Whether the app's license is currently active — backed by
 * public.license_keys (see supabase/025_license_keys.sql), not a hardcoded
 * date. Callable by any authenticated role; only reveals yes/no, never the
 * key strings themselves (those are developer-only, see fetchLicenseKeys).
 *
 * Fails open on error (same stance as role-fetch failures elsewhere in this
 * app) — a transient network hiccup shouldn't lock out a whole business.
 */
export async function fetchIsLicenseActive(): Promise<boolean> {
  const { data, error } = await getSupabaseClient().rpc("is_license_active");
  if (error) throw new Error(error.message);
  return Boolean(data);
}

/**
 * Activates a key by its code, without ever reading public.license_keys
 * directly — a superadmin can call this (RLS blocks them from the table
 * itself), but only ever learns success or "invalid code", nothing about
 * what keys exist. See redeem_license_key() in
 * supabase/027_redeem_license_key.sql.
 */
export async function redeemLicenseKey(code: string) {
  const { error } = await getSupabaseClient().rpc("redeem_license_key", {
    input_key: code.trim(),
  });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------
// Developer-only key management — RLS on license_keys refuses these to
// anyone else, so calling them as a non-developer just returns nothing /
// errors, never partial data.
// ---------------------------------------------------------------

export async function fetchLicenseKeys(): Promise<LicenseKey[]> {
  const { data, error } = await getSupabaseClient()
    .from("license_keys")
    .select("id, key, starts_at, expires_at, status, note, created_at, activated_at")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data as LicenseKey[]) ?? [];
}

/** Swaps the active key atomically — see activate_license_key() in
 * 025_license_keys.sql for why this isn't two plain client-side updates. */
export async function activateLicenseKey(id: string) {
  const { error } = await getSupabaseClient().rpc("activate_license_key", {
    target_id: id,
  });
  if (error) throw new Error(error.message);
}

export async function revokeLicenseKey(id: string) {
  const { error } = await getSupabaseClient()
    .from("license_keys")
    .update({ status: "revoked" })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

function randomSegment(): string {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}

/** ARTS-XXXX-XXXX-XXXX — not cryptographically significant, just needs to
 * look and read like a license key; uniqueness is enforced by the table's
 * own constraint, retried once on the rare collision. */
export async function generateLicenseKey(input: {
  startsAt: string;
  expiresAt: string;
  note: string | null;
}) {
  const client = getSupabaseClient();
  for (let attempt = 0; attempt < 3; attempt++) {
    const key = `ARTS-${randomSegment()}-${randomSegment()}-${randomSegment()}`;
    const { error } = await client.from("license_keys").insert({
      key,
      starts_at: input.startsAt,
      expires_at: input.expiresAt,
      status: "available",
      note: input.note,
    });
    if (!error) return key;
    if (error.code !== "23505") throw new Error(error.message);
    // 23505 = unique violation on `key` — vanishingly unlikely, just retry.
  }
  throw new Error("Could not generate a unique key, try again.");
}
