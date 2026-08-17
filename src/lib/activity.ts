import { getSupabaseClient } from "./supabase";

export type ActivityEntity =
  | "booking"
  | "block"
  | "staff"
  | "time_off"
  | "product"
  | "promo"
  | "service"
  | "service_category"
  | "settings"
  | "client";

export type Activity = {
  id: string;
  created_at: string;
  actor: string | null;
  entity: ActivityEntity;
  entity_id: string | null;
  action: string;
  summary: string;
  detail: string | null;
};

export type ActivityInput = {
  actor?: string | null;
  entity: ActivityEntity;
  entity_id?: string | null;
  action: string;
  summary: string;
  detail?: string | null;
};

const LOCAL_KEY = "artisan.activity";
const LOCAL_LIMIT = 200;

/** Set once we learn the activity_log table has not been migrated yet. */
let tableMissing = false;

export function isActivityTableMissing() {
  return tableMissing;
}

function readLocal(): Activity[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    return raw ? (JSON.parse(raw) as Activity[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(entries: Activity[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      LOCAL_KEY,
      JSON.stringify(entries.slice(0, LOCAL_LIMIT))
    );
  } catch {
    // Storage full or blocked — history is best-effort, so ignore.
  }
}

/**
 * Records an action. Never throws: a failed audit write must not roll back or
 * mask the change the admin actually made. Falls back to localStorage so the
 * feature still works before migration 009 has been applied.
 */
export async function logActivity(input: ActivityInput): Promise<void> {
  const hasRandomUUID =
    typeof crypto !== "undefined" && "randomUUID" in crypto;
  const entry: Activity = {
    id: hasRandomUUID
      ? crypto.randomUUID()
      : `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    created_at: new Date().toISOString(),
    actor: input.actor ?? null,
    entity: input.entity,
    entity_id: input.entity_id ?? null,
    action: input.action,
    summary: input.summary,
    detail: input.detail ?? null,
  };

  // Always keep a local copy so the timeline is populated immediately.
  writeLocal([entry, ...readLocal()]);

  if (tableMissing) return;

  try {
    // Reuse the locally generated id (when it's a real uuid — the "local-…"
    // fallback isn't one and would fail the column type) so the remote row
    // and the local copy above are recognized as the same entry when
    // fetchActivity merges them — otherwise both survive and the timeline
    // shows every action twice.
    const { error } = await getSupabaseClient()
      .from("activity_log")
      .insert({
        ...(hasRandomUUID ? { id: entry.id } : {}),
        created_at: entry.created_at,
        actor: entry.actor,
        entity: entry.entity,
        entity_id: entry.entity_id,
        action: entry.action,
        summary: entry.summary,
        detail: entry.detail,
      });
    if (error) {
      // PGRST205 = table not in the schema cache (migration not applied).
      if (error.code === "PGRST205" || error.code === "42P01") {
        tableMissing = true;
      }
    }
  } catch {
    // Offline or blocked — the local copy above still stands.
  }
}

export async function fetchActivity(limit = 100): Promise<Activity[]> {
  const local = readLocal();

  if (tableMissing) return local.slice(0, limit);

  try {
    const { data, error } = await getSupabaseClient()
      .from("activity_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      if (error.code === "PGRST205" || error.code === "42P01") {
        tableMissing = true;
      }
      return local.slice(0, limit);
    }

    const rows = (data ?? []) as Activity[];
    // Merge in any local-only entries recorded before the table existed.
    const seen = new Set(rows.map((row) => row.id));
    const merged = [...rows, ...local.filter((row) => !seen.has(row.id))];
    merged.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return merged.slice(0, limit);
  } catch {
    return local.slice(0, limit);
  }
}

export function clearLocalActivity() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(LOCAL_KEY);
}

/** "3 min ago", "2 h ago", "Mon 14:05" — compact relative time. */
export function relativeTime(iso: string) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const minutes = Math.round(diff / 60_000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;

  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;

  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
