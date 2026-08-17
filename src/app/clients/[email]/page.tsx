"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import BookingDrawer from "@/components/BookingDrawer";
import PageHeader from "@/components/PageHeader";
import StatusBadge from "@/components/StatusBadge";
import { EmptyState, ErrorBanner, TableSkeleton } from "@/components/Feedback";
import { IconChevronLeft, IconUsers } from "@/components/Icons";
import { useToast } from "@/components/Toast";
import { deriveClients } from "@/lib/bookings";
import { fetchClientRows, mergeClientRows, type ClientRow } from "@/lib/clients";
import { formatDateLong, formatMoney } from "@/lib/format";
import { fetchStaff } from "@/lib/staff";
import { useBookings } from "@/lib/useBookings";
import type { Booking, Staff } from "@/lib/types";

/** Full profile + booking history for one client — routed by email, since
 *  there's no stable id for clients that only exist via their bookings
 *  (see mergeClientRows() in @/lib/clients). */
export default function ClientDetailPage() {
  const params = useParams<{ email: string }>();
  const email = decodeURIComponent(params.email);

  const toast = useToast();
  const { bookings, loading, error, reload } = useBookings();
  const [clientRows, setClientRows] = useState<ClientRow[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  // Which row's full details are open — BookingDrawer (shared with
  // Calendar) handles editing/status/payment, so a row here opens the same
  // view an admin already knows from the rest of the app.
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);

  useEffect(() => {
    fetchClientRows().then(setClientRows, () => {});
    fetchStaff().then(setStaff, () => {});
  }, []);

  const client = useMemo(() => {
    const all = mergeClientRows(deriveClients(bookings), clientRows);
    return all.find((c) => c.email.toLowerCase() === email.toLowerCase()) ?? null;
  }, [bookings, clientRows, email]);

  const history = useMemo(
    () =>
      bookings
        .filter((b) => b.email.toLowerCase() === email.toLowerCase())
        .sort((a, b) =>
          `${b.booking_date}T${b.booking_time}`.localeCompare(
            `${a.booking_date}T${a.booking_time}`
          )
        ),
    [bookings, email]
  );

  return (
    <>
      <PageHeader
        title={client?.full_name ?? "Client"}
        subtitle={
          <Link
            href="/clients"
            className="inline-flex items-center gap-1 text-muted transition hover:text-foreground"
          >
            <IconChevronLeft size={14} />
            Back to clients
          </Link>
        }
      />

      <main className="flex-1 space-y-4 p-4 sm:p-6">
        {error && <ErrorBanner message={error} />}

        {loading ? (
          <div className="card overflow-hidden">
            <TableSkeleton rows={5} cols={3} />
          </div>
        ) : !client ? (
          <div className="card overflow-hidden">
            <EmptyState
              icon={<IconUsers size={22} />}
              title="Client not found"
              detail="This client doesn't have any bookings or a saved profile."
            />
          </div>
        ) : (
          <>
            <div className="card grid gap-4 p-5 sm:grid-cols-[1.3fr_1fr] sm:p-6">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold">
                  {client.full_name}
                </h2>
                <p className="mt-1 truncate text-sm text-muted">{client.email}</p>
                <p className="text-sm text-muted">{client.mobile || "—"}</p>
                <p className="mt-0.5 text-sm text-muted">
                  {client.address ?? "No address on file"}
                </p>
                {client.notes && (
                  <p className="mt-3 rounded-xl border border-line bg-background px-3.5 py-3 text-sm text-muted">
                    {client.notes}
                  </p>
                )}
              </div>

              <dl className="grid grid-cols-2 gap-3 rounded-2xl border border-line p-4 text-sm sm:self-start">
                <div>
                  <dt className="text-xs uppercase text-muted">Visits</dt>
                  <dd className="mt-0.5 font-semibold">{client.visits}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-muted">Total spent</dt>
                  <dd className="mt-0.5 font-semibold">
                    {formatMoney(client.totalSpent, client.currency)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-muted">First visit</dt>
                  <dd className="mt-0.5">
                    {client.firstVisit ? formatDateLong(client.firstVisit) : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-muted">Last visit</dt>
                  <dd className="mt-0.5">
                    {client.lastVisit ? formatDateLong(client.lastVisit) : "—"}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="card overflow-hidden">
              <p className="px-5 pt-5 text-xs font-semibold uppercase tracking-wide text-muted sm:px-6">
                Booking history
              </p>
              {history.length === 0 ? (
                <p className="p-5 text-sm text-muted sm:p-6">No bookings found.</p>
              ) : (
                <>
                  {/* Desktop: a plain spreadsheet-style table — one row per
                      booking, click through to the same drawer Calendar
                      uses for full details/editing. */}
                  <div className="mt-3 hidden overflow-x-auto sm:block">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-line text-xs uppercase text-muted">
                        <tr>
                          <th className="px-5 py-3 font-medium">Date</th>
                          <th className="px-5 py-3 font-medium">Time</th>
                          <th className="px-5 py-3 font-medium">Service</th>
                          <th className="px-5 py-3 font-medium">Staff</th>
                          <th className="px-5 py-3 font-medium">Status</th>
                          <th className="px-5 py-3 font-medium">Paid</th>
                          <th className="px-5 py-3 font-medium">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {history.map((booking) => (
                          <tr
                            key={booking.id}
                            onClick={() => setSelectedBooking(booking)}
                            className="row-hover cursor-pointer hover:bg-background"
                          >
                            <td className="px-5 py-3.5 whitespace-nowrap">
                              {formatDateLong(booking.booking_date)}
                            </td>
                            <td className="px-5 py-3.5 whitespace-nowrap">
                              {booking.booking_time}
                            </td>
                            <td className="px-5 py-3.5">{booking.service_name}</td>
                            <td className="px-5 py-3.5">{booking.staff_name}</td>
                            <td className="px-5 py-3.5">
                              <StatusBadge status={booking.status} />
                            </td>
                            <td className="px-5 py-3.5">
                              {booking.is_paid ? "Paid" : "Unpaid"}
                            </td>
                            <td className="px-5 py-3.5 tabular-nums font-medium">
                              {formatMoney(Number(booking.total), booking.currency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile card list — same rows, clickable, stacked. */}
                  <ul className="mt-3 divide-y divide-line sm:hidden">
                    {history.map((booking) => (
                      <li
                        key={booking.id}
                        onClick={() => setSelectedBooking(booking)}
                        className="cursor-pointer px-4 py-3.5 text-sm active:bg-background"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {booking.service_name}
                            </p>
                            <p className="text-xs text-muted">
                              {formatDateLong(booking.booking_date)} ·{" "}
                              {booking.booking_time} · {booking.staff_name}
                            </p>
                          </div>
                          <StatusBadge status={booking.status} />
                        </div>
                        <div className="mt-2 flex items-center justify-between text-xs text-muted">
                          <span>
                            {booking.is_paid
                              ? `Paid${
                                  booking.payment_method
                                    ? ` · ${booking.payment_method}`
                                    : ""
                                }`
                              : "Unpaid"}
                          </span>
                          <span className="font-medium tabular-nums text-foreground">
                            {formatMoney(Number(booking.total), booking.currency)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </>
        )}
      </main>

      {selectedBooking && (
        <BookingDrawer
          booking={selectedBooking}
          staff={staff}
          onClose={() => setSelectedBooking(null)}
          onChanged={() => {
            setSelectedBooking(null);
            reload();
            toast.success("Appointment updated");
          }}
        />
      )}
    </>
  );
}
