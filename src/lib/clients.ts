import { getSupabaseClient } from "./supabase";
import type { Client } from "./types";

/** A row from public.clients — see supabase/030_clients.sql. */
export type ClientRow = {
  id: string;
  created_at: string;
  full_name: string;
  email: string;
  mobile: string;
  address: string | null;
  notes: string | null;
};

export type NewClient = {
  full_name: string;
  email: string;
  mobile: string;
  address: string | null;
  notes: string | null;
};

export async function fetchClientRows(): Promise<ClientRow[]> {
  const { data, error } = await getSupabaseClient()
    .from("clients")
    .select("*")
    .order("full_name");
  if (error) throw new Error(error.message);
  return (data ?? []) as ClientRow[];
}

export async function createClient(input: NewClient): Promise<string> {
  const { data, error } = await getSupabaseClient()
    .from("clients")
    .insert(input)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

/**
 * Folds explicitly-created `clients` rows into the list already derived from
 * bookings (see deriveClients() in ./bookings) — matched by email, the same
 * key bookings use to identify a client. Visit stats (visits, totalSpent,
 * firstVisit, lastVisit) only exist as a booking aggregate, so those always
 * come from `derived`. But identity/contact fields — full_name, mobile,
 * address, notes — come from the real `clients` row once one exists: that
 * table is the durable profile (created once, editable by an admin
 * afterwards — directly in Supabase or a future edit UI), whereas
 * sync_client_from_booking() (see supabase/031_sync_clients_from_bookings.sql)
 * deliberately never touches full_name again after a client's first
 * booking. If this merge fell back to the booking-derived name instead, an
 * admin's manual correction would appear to silently not save.
 */
export function mergeClientRows(
  derived: Client[],
  rows: ClientRow[]
): Client[] {
  const byEmail = new Map(derived.map((c) => [c.email.toLowerCase(), c]));

  for (const row of rows) {
    const key = row.email.toLowerCase();
    const existing = byEmail.get(key);
    if (existing) {
      byEmail.set(key, {
        ...existing,
        id: row.id,
        full_name: row.full_name,
        mobile: row.mobile,
        address: row.address,
        notes: row.notes,
      });
    } else {
      byEmail.set(key, {
        id: row.id,
        email: row.email,
        full_name: row.full_name,
        mobile: row.mobile,
        address: row.address,
        notes: row.notes,
        visits: 0,
        totalSpent: 0,
        firstVisit: "",
        lastVisit: "",
        currency: "AED",
      });
    }
  }

  return [...byEmail.values()].sort((a, b) => b.totalSpent - a.totalSpent);
}
