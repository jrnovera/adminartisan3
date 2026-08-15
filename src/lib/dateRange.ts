import { addDays, startOfWeek, toDateKey } from "./format";

export type PeriodKey =
  | "all"
  | "upcoming"
  | "today"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month";

export const periodLabels: Record<PeriodKey, string> = {
  all: "All time",
  upcoming: "Upcoming",
  today: "Today",
  this_week: "This week",
  last_week: "Last week",
  this_month: "This month",
  last_month: "Last month",
};

export const periodOptions: PeriodKey[] = [
  "all",
  "upcoming",
  "today",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
];

// Open-ended upper bound for "upcoming" — any real booking date sorts
// before this, so it behaves as "no end date" for the inclusive-range
// check in withinPeriod below.
const FAR_FUTURE = "9999-12-31";

/**
 * Inclusive [start, end] date-key bounds for a period, or `null` for "all
 * time" (no filtering). Weeks run Monday–Sunday to match startOfWeek, used
 * everywhere else in the app (the calendar's week view, in particular) —
 * a report that used Sunday-start weeks instead would disagree with the
 * calendar about which bookings are "this week".
 */
export function resolvePeriod(
  period: PeriodKey,
  today: Date = new Date()
): { start: string; end: string } | null {
  if (period === "all") return null;

  if (period === "upcoming") {
    return { start: toDateKey(today), end: FAR_FUTURE };
  }
  if (period === "today") {
    const key = toDateKey(today);
    return { start: key, end: key };
  }
  if (period === "this_week") {
    const start = startOfWeek(today);
    return { start: toDateKey(start), end: toDateKey(addDays(start, 6)) };
  }
  if (period === "last_week") {
    const start = addDays(startOfWeek(today), -7);
    return { start: toDateKey(start), end: toDateKey(addDays(start, 6)) };
  }
  if (period === "this_month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { start: toDateKey(start), end: toDateKey(end) };
  }
  // last_month
  const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const end = new Date(today.getFullYear(), today.getMonth(), 0);
  return { start: toDateKey(start), end: toDateKey(end) };
}

/** True when a booking_date falls inside the resolved bounds (or bounds is null). */
export function withinPeriod(
  dateKey: string,
  bounds: { start: string; end: string } | null
): boolean {
  if (!bounds) return true;
  return dateKey >= bounds.start && dateKey <= bounds.end;
}
