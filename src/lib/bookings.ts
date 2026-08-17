import { getSupabaseClient } from "./supabase";
import { isStaffOffOn } from "./staff";
import { toDateKey } from "./format";
import type {
  BillAddon,
  Booking,
  BookingStatus,
  Client,
  ServiceLocation,
  Staff,
  StaffTimeOff,
} from "./types";

export async function fetchBookings(): Promise<Booking[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .order("booking_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as Booking[];
}

export async function updateBookingStatus(id: string, status: BookingStatus) {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("bookings")
    .update({ status })
    .eq("id", id);

  if (error) throw new Error(error.message);
}

/**
 * Permanently removes a booking row — used from Appointments, Transactions
 * and POS. Gated to the superadmin account in the UI (see lib/superadmin.ts);
 * this call itself has no extra guard, so it must only be reachable from a
 * control that has already checked `isSuperAdmin`.
 */
export async function deleteBooking(id: string) {
  const { error } = await getSupabaseClient()
    .from("bookings")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Wipes every booking row — Appointments, Transactions, Reports and Clients
 * all read from this same table (Clients is derived via `deriveClients`,
 * not its own table), so this clears all four screens at once. Gated to
 * superadmin in the UI (see Settings' Danger Zone); this call itself has no
 * extra guard, so it must only be reachable from a control that has already
 * checked `isSuperAdmin`. Irreversible — there is no trash/undo.
 */
export async function deleteAllBookings() {
  const { error } = await getSupabaseClient()
    .from("bookings")
    .delete()
    .not("id", "is", null);
  if (error) throw new Error(error.message);
}

export type NewBooking = {
  service_id: string;
  service_name: string;
  duration_minutes: number;
  price: number;
  staff_id: string;
  staff_name: string;
  booking_date: string;
  booking_time: string;
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
  full_name: string;
  email: string;
  mobile: string;
  address: string | null;
  notes: string | null;
  status: BookingStatus;
  is_paid: boolean;
  /** Where the appointment happens. The call-out fee, tax and total for a
   * home visit are recomputed by the insert trigger from shop_settings —
   * never sent from here — see booking-artisan/supabase/004_home_service.sql.
   * A home booking with a blank address is rejected by a check constraint. */
  service_location?: ServiceLocation;
};

export async function createBooking(input: NewBooking): Promise<string> {
  const { data, error } = await getSupabaseClient()
    .from("bookings")
    .insert(input)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function setBookingPaid(
  id: string,
  isPaid: boolean,
  method: string | null
) {
  const { error } = await getSupabaseClient()
    .from("bookings")
    .update({
      is_paid: isPaid,
      payment_method: isPaid ? method : null,
      paid_at: isPaid ? new Date().toISOString() : null,
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
}

export async function rescheduleBooking(
  id: string,
  changes: {
    booking_date?: string;
    booking_time?: string;
    staff_id?: string;
    staff_name?: string;
    service_id?: string;
    service_name?: string;
    duration_minutes?: number;
    price?: number;
    subtotal?: number;
    tax?: number;
    total?: number;
    discount?: number;
    // Client contact details — editable from BookingDrawer's Contact
    // section, separately from the scheduling fields above.
    full_name?: string;
    email?: string;
    mobile?: string;
    address?: string | null;
    notes?: string | null;
  }
) {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("bookings").update(changes).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function checkoutBooking(
  id: string,
  input: {
    addons: BillAddon[];
    tip: number;
    subtotal: number;
    tax: number;
    total: number;
    payment_method: string;
  }
) {
  const { error } = await getSupabaseClient()
    .from("bookings")
    .update({
      addons: input.addons,
      tip: input.tip,
      subtotal: input.subtotal,
      tax: input.tax,
      total: input.total,
      payment_method: input.payment_method,
      is_paid: true,
      paid_at: new Date().toISOString(),
      status: "completed",
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
}

export function deriveClients(bookings: Booking[]): Client[] {
  const byEmail = new Map<string, Client>();

  for (const booking of bookings) {
    if (booking.status === "cancelled") continue;
    const key = booking.email.toLowerCase();
    const existing = byEmail.get(key);

    if (!existing) {
      byEmail.set(key, {
        id: null,
        email: booking.email,
        full_name: booking.full_name,
        mobile: booking.mobile,
        address: booking.address ?? null,
        notes: null,
        visits: 1,
        totalSpent: Number(booking.total),
        firstVisit: booking.booking_date,
        lastVisit: booking.booking_date,
        currency: booking.currency,
      });
      continue;
    }

    existing.visits += 1;
    existing.totalSpent += Number(booking.total);
    if (booking.booking_date < existing.firstVisit) {
      existing.firstVisit = booking.booking_date;
    }
    if (booking.booking_date > existing.lastVisit) {
      existing.lastVisit = booking.booking_date;
      existing.full_name = booking.full_name;
      existing.mobile = booking.mobile;
      existing.address = booking.address ?? existing.address;
    }
  }

  return [...byEmail.values()].sort((a, b) => b.totalSpent - a.totalSpent);
}

export type ReassignmentResult = {
  /** Successfully moved onto another team member. */
  reassigned: Array<{ booking: Booking; toStaffName: string }>;
  /** Nobody was free at that exact date/time — left pointing at the removed
   * staff member's old id, which the calendar already renders as
   * "Unassigned" (see calendar/page.tsx's byId/byName resolution). */
  unassignable: Booking[];
};

/**
 * Moves a staff member's upcoming, live appointments onto someone else
 * before that staff member is deleted — so removing someone from the team
 * doesn't strand their clients' bookings on a therapist who no longer
 * exists.
 *
 * Only pending/confirmed bookings from today onward are touched; completed,
 * cancelled and past appointments are history and stay exactly as they were
 * for reporting purposes.
 *
 * A candidate is skipped if they're off that day (weekly day off or booked
 * time off) and otherwise ranked by: same role as the departing staff member
 * first, then whoever has the fewest bookings that day — the "freest"
 * therapist gets first refusal. The actual scheduling conflict check is left
 * to the database's exclusion constraint (bookings_no_double_booking): if an
 * update collides, this catches it and moves on to the next candidate rather
 * than guessing at availability itself.
 */
export async function reassignStaffBookings(
  removedStaff: Staff,
  allBookings: Booking[],
  activeStaff: Staff[],
  timeOff: StaffTimeOff[]
): Promise<ReassignmentResult> {
  const supabase = getSupabaseClient();
  const today = toDateKey(new Date());
  const candidates = activeStaff.filter((s) => s.id !== removedStaff.id);

  const toMove = allBookings.filter(
    (b) =>
      b.staff_id === removedStaff.id &&
      (b.status === "pending" || b.status === "confirmed") &&
      b.booking_date >= today
  );

  const result: ReassignmentResult = { reassigned: [], unassignable: [] };
  if (toMove.length === 0 || candidates.length === 0) {
    result.unassignable.push(...toMove);
    return result;
  }

  // Mutated as bookings get placed so same-day load balances across this
  // batch instead of every booking racing for whoever looked freest at the
  // start.
  const runtime = [...allBookings];

  for (const booking of toMove) {
    const ranked = candidates
      .filter((c) => !isStaffOffOn(c, booking.booking_date, timeOff))
      .sort((a, b) => {
        const roleRank = (s: Staff) => (s.role === removedStaff.role ? 0 : 1);
        const loadOf = (staffId: string) =>
          runtime.filter(
            (b) =>
              b.staff_id === staffId &&
              b.booking_date === booking.booking_date &&
              b.status !== "cancelled"
          ).length;
        return roleRank(a) - roleRank(b) || loadOf(a.id) - loadOf(b.id);
      });

    let placed = false;
    for (const candidate of ranked) {
      const { error } = await supabase
        .from("bookings")
        .update({ staff_id: candidate.id, staff_name: candidate.name })
        .eq("id", booking.id);

      if (!error) {
        const index = runtime.findIndex((b) => b.id === booking.id);
        if (index !== -1) {
          runtime[index] = {
            ...runtime[index],
            staff_id: candidate.id,
            staff_name: candidate.name,
          };
        }
        result.reassigned.push({ booking, toStaffName: candidate.name });
        placed = true;
        break;
      }
      // 23P01 = the no-double-booking exclusion constraint — this candidate
      // already has something else at that time. Try the next one.
      if (error.code !== "23P01") throw new Error(error.message);
    }

    if (!placed) result.unassignable.push(booking);
  }

  return result;
}
