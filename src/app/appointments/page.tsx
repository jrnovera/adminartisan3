"use client";

import { useMemo, useState } from "react";
import StatusBadge from "@/components/StatusBadge";
import ClickableStatusBadge from "@/components/ClickableStatusBadge";
import HomeBadge from "@/components/HomeBadge";
import PeriodFilter from "@/components/PeriodFilter";
import { EmptyState, ErrorBanner, TableSkeleton } from "@/components/Feedback";
import { IconClock } from "@/components/Icons";
import ExportBar from "@/components/ExportBar";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useToast } from "@/components/Toast";
import { deleteBooking, updateBookingStatus } from "@/lib/bookings";
import { logActivity } from "@/lib/activity";
import { useAuth } from "@/lib/auth";
import { formatDateLong, formatMoney, hasAppointmentStarted } from "@/lib/format";
import { resolvePeriod, withinPeriod, type PeriodKey } from "@/lib/dateRange";
import { exportBookingsCsv } from "@/lib/exportCsv";
import { useBookings } from "@/lib/useBookings";
import type { Booking, BookingStatus, ServiceLocation } from "@/lib/types";

const locationFilters: Array<ServiceLocation | "all"> = ["all", "salon", "home"];

const locationLabels: Record<ServiceLocation | "all", string> = {
  all: "Everywhere",
  salon: "In salon",
  home: "Home service",
};

const filters: Array<BookingStatus | "all"> = [
  "all",
  "pending",
  "confirmed",
  "completed",
  "cancelled",
];

const filterLabels: Record<BookingStatus | "all", string> = {
  all: "All",
  pending: "Pending",
  confirmed: "Accepted",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No show",
};

export default function AppointmentsPage() {
  const { bookings, loading, error, reload } = useBookings();
  const toast = useToast();
  const { session, isSuperAdmin } = useAuth();
  const actor = session?.user.email ?? null;
  const [deleting, setDeleting] = useState<Booking | null>(null);
  // `null` = the admin hasn't picked a filter yet, so fall back to whatever is
  // most useful: bookings waiting on a decision, or everything when there are
  // none. Derived rather than set in an effect so it settles as soon as the
  // bookings land, and stops adjusting itself the moment a tab is clicked.
  const [filter, setFilter] = useState<BookingStatus | "all" | null>(null);
  const [selected, setSelected] = useState<Booking | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const hasPending = useMemo(
    () => bookings.some((booking) => booking.status === "pending"),
    [bookings]
  );
  const activeFilter = filter ?? (hasPending ? "pending" : "all");

  const [locationFilter, setLocationFilter] = useState<ServiceLocation | "all">(
    "all"
  );
  // Date filtering: either a period preset (Upcoming, This week, …) or a
  // specific day picked below — the two aren't meant to combine, same
  // pattern as the POS page's date filter.
  const [period, setPeriod] = useState<PeriodKey>("all");
  const [exactDate, setExactDate] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const visible = useMemo(
    () => {
      const statusPriority: Record<BookingStatus, number> = {
        pending: 1,
        confirmed: 2,
        completed: 3,
        cancelled: 4,
        no_show: 5,
      };

      const today = new Date().toISOString().split('T')[0];
      const bounds = exactDate
        ? { start: exactDate, end: exactDate }
        : resolvePeriod(period);

      return bookings
        .filter((booking) => {
          if (activeFilter !== "all" && booking.status !== activeFilter) {
            return false;
          }
          if (!withinPeriod(booking.booking_date, bounds)) return false;
          if (locationFilter === "all") return true;
          // Bookings made before home service existed have no value stored,
          // and those were all in-salon.
          return (booking.service_location ?? "salon") === locationFilter;
        })
        // Sort by: 1) not completed first, 2) upcoming bookings, 3) time
        .sort((a, b) => {
          const statusDiff = statusPriority[a.status] - statusPriority[b.status];
          if (statusDiff !== 0) return statusDiff;

          // For same status, prioritize by booking date/time
          // Upcoming bookings (today or later) come first
          const aIsUpcoming = a.booking_date >= today;
          const bIsUpcoming = b.booking_date >= today;
          if (aIsUpcoming && !bIsUpcoming) return -1;
          if (!aIsUpcoming && bIsUpcoming) return 1;

          // Same status and both upcoming/past, sort by date then time
          const dateCompare = a.booking_date.localeCompare(b.booking_date);
          if (dateCompare !== 0) return dateCompare;
          return a.booking_time.localeCompare(b.booking_time);
        });
    },
    [bookings, activeFilter, locationFilter, period, exactDate]
  );

  const totalPages = Math.ceil(visible.length / itemsPerPage);
  const paginatedBookings = useMemo(
    () => {
      const start = (currentPage - 1) * itemsPerPage;
      return visible.slice(start, start + itemsPerPage);
    },
    [visible, currentPage]
  );

  // Reset to page 1 when filters change
  const handleFilterChange = (newFilter: BookingStatus | "all" | null) => {
    setFilter(newFilter);
    setCurrentPage(1);
  };

  const handleLocationFilterChange = (newLocation: ServiceLocation | "all") => {
    setLocationFilter(newLocation);
    setCurrentPage(1);
  };

  const handlePeriodChange = (newPeriod: PeriodKey) => {
    setExactDate("");
    setPeriod(newPeriod);
    setCurrentPage(1);
  };

  const handleExactDateChange = (value: string) => {
    setExactDate(value);
    setCurrentPage(1);
  };

  const homeCount = useMemo(
    () => bookings.filter((b) => b.service_location === "home").length,
    [bookings]
  );

  // "Completed" describes how the appointment went, so it's locked out
  // until its start time actually arrives — the other statuses aren't
  // time-gated. no_show isn't reachable from ClickableStatusBadge's menu
  // at all, so it doesn't need an entry here.
  function statusRestrictions(booking: Booking) {
    return hasAppointmentStarted(booking.booking_date, booking.booking_time)
      ? undefined
      : {
          completed:
            "Can't mark this until the appointment's start time arrives",
        };
  }

  async function changeStatus(booking: Booking, status: BookingStatus) {
    setSaving(true);
    setSaveError(null);
    try {
      await updateBookingStatus(booking.id, status);
      await reload();
      // Only refresh the details panel if it was already open for this
      // booking — changing status from the row/list dropdown shouldn't pop
      // details open on its own. The toast below is the confirmation.
      setSelected((current) =>
        current?.id === booking.id ? { ...booking, status } : current
      );
      toast.success(
        "Status updated",
        `${booking.full_name} is now ${filterLabels[status].toLowerCase()}.`
      );
      logActivity({
        actor,
        entity: "booking",
        entity_id: booking.id,
        action: `status-${status}`,
        summary: `Marked ${booking.full_name} as ${filterLabels[
          status
        ].toLowerCase()}`,
        detail: `${filterLabels[booking.status]} → ${filterLabels[status]} · ${
          booking.service_name
        } · ${formatDateLong(booking.booking_date)} ${booking.booking_time}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Update failed";
      setSaveError(message);
      toast.error("Update failed", message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteBooking() {
    if (!deleting || !isSuperAdmin) return;
    try {
      await deleteBooking(deleting.id);
      if (selected?.id === deleting.id) setSelected(null);
      setDeleting(null);
      await reload();
      toast.success("Booking deleted", `${deleting.full_name}'s appointment was permanently removed.`);
      logActivity({
        actor,
        entity: "booking",
        entity_id: deleting.id,
        action: "deleted",
        summary: `Deleted booking for ${deleting.full_name}`,
        detail: `${deleting.service_name} · ${formatDateLong(
          deleting.booking_date
        )} ${deleting.booking_time}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Delete failed";
      toast.error("Delete failed", message);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-4 px-4 pt-4 sm:gap-6 sm:px-6 sm:pt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Appointments</h1>
            <p className="text-sm text-muted">{visible.length} of {bookings.length} bookings</p>
          </div>
          <ExportBar
            rows={visible}
            allRows={bookings}
            onExport={exportBookingsCsv}
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {locationFilters.map((option) => (
            <button
              key={option}
              onClick={() => handleLocationFilterChange(option)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition-all duration-150 ${
                locationFilter === option
                  ? "bg-foreground text-white shadow-sm"
                  : "border border-line text-foreground/70 hover:bg-background"
              }`}
            >
              {locationLabels[option]}
              {option === "home" && homeCount > 0 && (
                <span className="ms-1.5 tabular-nums opacity-70">
                  {homeCount}
                </span>
              )}
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-line" aria-hidden />
          {filters.map((option) => (
            <button
              key={option}
              onClick={() => handleFilterChange(option)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium capitalize transition-all duration-150 ${
                activeFilter === option
                  ? "bg-foreground text-white shadow-sm"
                  : "border border-line text-foreground/70 hover:bg-background"
              }`}
            >
              {filterLabels[option]}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <PeriodFilter value={period} onChange={handlePeriodChange} />
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <span className="hidden sm:inline">or pick a date</span>
            <input
              type="date"
              value={exactDate}
              onChange={(event) => handleExactDateChange(event.target.value)}
              className="rounded-lg border border-line px-2.5 py-1.5 text-xs outline-none transition focus:border-foreground/40 focus:ring-4 focus:ring-foreground/[0.06]"
            />
            {exactDate && (
              <button
                onClick={() => handleExactDateChange("")}
                className="text-primary hover:underline"
              >
                Clear
              </button>
            )}
          </label>
        </div>
      </div>

      <main className="flex flex-1 flex-col gap-4 p-4 sm:gap-6 sm:p-6 xl:flex-row">
        <section className="min-w-0 flex-1 card overflow-hidden">
          {error && (
            <div className="p-4">
              <ErrorBanner message={error} />
            </div>
          )}
          {loading ? (
            <TableSkeleton rows={5} cols={5} />
          ) : visible.length === 0 ? (
            <EmptyState
              icon={<IconClock size={22} />}
              title="No appointments to show"
              detail="Try a different status filter."
            />
          ) : (
            <>
              {/* Desktop table — dense, gridded, spreadsheet-style rows with
                  a sticky header so long lists stay legible while scrolling.
                  Overflow is scoped to this scroller only (not the card), so
                  the status dropdown — rendered in a portal — is never
                  clipped by a short container when there's just one row. */}
              <div className="hidden max-h-[70vh] overflow-auto sm:block">
                <table className="w-full border-collapse text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-surface text-xs uppercase text-muted shadow-[inset_0_-1px_0_var(--color-line)]">
                    <tr>
                      <th className="border-b border-r border-line px-4 py-2.5 font-medium">Client</th>
                      <th className="border-b border-r border-line px-4 py-2.5 font-medium">Service</th>
                      <th className="border-b border-r border-line px-4 py-2.5 font-medium">Staff</th>
                      <th className="border-b border-r border-line px-4 py-2.5 font-medium">When</th>
                      <th className="border-b border-r border-line px-4 py-2.5 font-medium">Total</th>
                      <th className="border-b border-line px-4 py-2.5 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedBookings.map((booking, index) => (
                      <tr
                        key={booking.id}
                        onClick={() => setSelected(booking)}
                        className={`row-hover cursor-pointer border-b border-line hover:bg-background ${
                          selected?.id === booking.id
                            ? "bg-primary-50/60"
                            : index % 2 === 1
                            ? "bg-foreground/[0.015]"
                            : ""
                        }`}
                      >
                        <td className="border-r border-line px-4 py-2.5">
                          <p className="font-medium">{booking.full_name}</p>
                          <p className="text-xs text-muted">
                            {booking.mobile}
                          </p>
                        </td>
                        <td className="border-r border-line px-4 py-2.5">
                          <span className="flex flex-wrap items-center gap-1.5">
                            {booking.service_name}
                            <HomeBadge location={booking.service_location} />
                          </span>
                        </td>
                        <td className="border-r border-line px-4 py-2.5">{booking.staff_name}</td>
                        <td className="whitespace-nowrap border-r border-line px-4 py-2.5">
                          <p className="text-xs sm:text-sm">
                            {formatDateLong(booking.booking_date)}
                          </p>
                          <p className="text-[11px] tabular-nums text-muted sm:text-xs">
                            {booking.booking_time}
                          </p>
                        </td>
                        <td className="border-r border-line px-4 py-2.5 tabular-nums">
                          {formatMoney(Number(booking.total), booking.currency)}
                        </td>
                        <td className="px-4 py-2.5">
                          <ClickableStatusBadge
                            status={booking.status}
                            onStatusChange={(newStatus) => changeStatus(booking, newStatus)}
                            isChanging={saving}
                            disabledStatuses={statusRestrictions(booking)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile card list */}
              <ul className="flex flex-col gap-3 sm:hidden">
                {paginatedBookings.map((booking) => (
                  <li key={booking.id}>
                    {/* A <div> here, not a <button> — the status badge
                        below renders its own interactive <button>, and
                        buttons can't nest inside buttons in valid HTML. */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelected(booking)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelected(booking);
                        }
                      }}
                      className={`flex w-full cursor-pointer flex-col gap-2 rounded-lg border border-line bg-surface px-5 py-4 text-left transition active:bg-background ${
                        selected?.id === booking.id ? "bg-primary-50/60 border-primary-200" : "hover:bg-surface/80"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 truncate text-sm font-semibold">
                          {booking.full_name}
                        </p>
                        <span className="flex shrink-0 items-center gap-2">
                          <HomeBadge location={booking.service_location} />
                          <ClickableStatusBadge
                            status={booking.status}
                            onStatusChange={(newStatus) => changeStatus(booking, newStatus)}
                            isChanging={saving}
                            disabledStatuses={statusRestrictions(booking)}
                          />
                        </span>
                      </div>
                      <p className="truncate text-sm text-muted">
                        {booking.service_name} · {booking.staff_name}
                      </p>
                      <div className="flex items-center justify-between text-sm text-muted">
                        <span className="tabular-nums">
                          {formatDateLong(booking.booking_date)} ·{" "}
                          {booking.booking_time}
                        </span>
                        <span className="font-semibold tabular-nums text-foreground">
                          {formatMoney(Number(booking.total), booking.currency)}
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              {/* Pagination controls */}
              {visible.length > 0 && (
                <div className="flex items-center justify-between border-t border-line bg-surface-2 px-4 py-3 sm:px-6">
                  <p className="text-xs text-muted sm:text-sm">
                    Showing {Math.min((currentPage - 1) * itemsPerPage + 1, visible.length)}–{Math.min(currentPage * itemsPerPage, visible.length)} of {visible.length} appointments
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="rounded-md border border-line px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 hover:enabled:bg-background"
                    >
                      Previous
                    </button>
                    <div className="flex items-center gap-1 px-2 text-xs text-muted">
                      Page {currentPage} of {totalPages}
                    </div>
                    <button
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="rounded-md border border-line px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 hover:enabled:bg-background"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        {/* Desktop side panel */}
        <aside className="hidden w-full shrink-0 card p-5 xl:block xl:w-80">
          <h2 className="text-sm font-semibold">Appointment Details</h2>
          {!selected ? (
            <p className="mt-4 text-sm text-muted">
              Select an appointment to see details.
            </p>
          ) : (
            <DetailPanel
              booking={selected}
              saving={saving}
              saveError={saveError}
              onChangeStatus={changeStatus}
              canDelete={isSuperAdmin}
              onDelete={() => setDeleting(selected)}
            />
          )}
        </aside>
      </main>

      {/* Mobile / tablet detail sheet */}
      {selected && (
        <div className="fixed inset-0 z-40 xl:hidden">
          <button
            onClick={() => setSelected(null)}
            aria-label="Close details"
            className="animate-fade-in absolute inset-0 h-full w-full bg-black/40 backdrop-blur-[2px]"
          />
          <div className="animate-pop-in absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-3xl bg-surface p-5 shadow-[var(--shadow-xl)]">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line-strong" />
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Appointment Details</h2>
              <button
                onClick={() => setSelected(null)}
                className="text-xs font-medium text-muted"
              >
                Close
              </button>
            </div>
            <DetailPanel
              booking={selected}
              saving={saving}
              saveError={saveError}
              onChangeStatus={changeStatus}
              canDelete={isSuperAdmin}
              onDelete={() => setDeleting(selected)}
            />
          </div>
        </div>
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete this booking?"
          tone="danger"
          confirmLabel="Delete"
          message={
            <>
              <span className="font-medium text-foreground">
                {deleting.full_name}
              </span>
              &rsquo;s appointment for {deleting.service_name} on{" "}
              {formatDateLong(deleting.booking_date)} will be permanently
              deleted. This cannot be undone.
            </>
          }
          onClose={() => setDeleting(null)}
          onConfirm={handleDeleteBooking}
        />
      )}
    </>
  );
}

function DetailPanel({
  booking,
  saving,
  saveError,
  onChangeStatus,
  canDelete,
  onDelete,
}: {
  booking: Booking;
  saving: boolean;
  saveError: string | null;
  onChangeStatus: (booking: Booking, status: BookingStatus) => void;
  canDelete: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="mt-4 space-y-3 text-sm">
      <div>
        <p className="font-medium">{booking.full_name}</p>
        <p className="text-xs text-muted">{booking.email}</p>
        <p className="text-xs text-muted">{booking.mobile}</p>
      </div>

      {/* Surfaced above the rest of the details — the team needs this
          address to get to the job, not buried after the pricing lines. */}
      {booking.service_location === "home" && booking.address && (
        <div className="rounded-xl border border-primary-100 bg-primary-50 px-3 py-2.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary-dark">
            🚗 Home service address
          </p>
          <p className="mt-1 font-medium text-foreground">{booking.address}</p>
          <a
            href={`https://maps.google.com/?q=${encodeURIComponent(booking.address)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-block text-xs font-medium text-primary hover:underline"
          >
            Get directions →
          </a>
        </div>
      )}

      <Detail label="Service" value={booking.service_name} />
      <Detail label="Staff" value={booking.staff_name} />
      <Detail
        label="Date"
        value={`${formatDateLong(booking.booking_date)} · ${booking.booking_time}`}
      />
      <Detail label="Duration" value={`${booking.duration_minutes} min`} />
      <Detail
        label="Subtotal"
        value={formatMoney(Number(booking.subtotal), booking.currency)}
      />
      {Number(booking.discount) > 0 && (
        <Detail
          label="Discount"
          value={`−${formatMoney(Number(booking.discount), booking.currency)}`}
        />
      )}
      <Detail label="Tax" value={formatMoney(Number(booking.tax), booking.currency)} />
      <Detail
        label="Total"
        value={formatMoney(Number(booking.total), booking.currency)}
      />
      {/* Home bookings already show their address in the callout above. */}
      {booking.address && booking.service_location !== "home" && (
        <Detail label="Address" value={booking.address} />
      )}
      {booking.notes && <Detail label="Notes" value={booking.notes} />}
      {booking.voucher_code && (
        <Detail label="Voucher" value={booking.voucher_code} />
      )}
      <Detail
        label="Booked"
        value={new Date(booking.created_at).toLocaleString("en-US", {
          dateStyle: "medium",
          timeStyle: "short",
        })}
      />

      <div className="pt-2">
        <p className="mb-2 text-xs uppercase text-muted">Update Status</p>
        <div className="flex flex-wrap gap-1.5 rounded-xl border border-line bg-surface-2 p-1">
          {(["pending", "confirmed", "completed", "cancelled"] as const).map(
            (status) => {
              // "Completed" describes how the appointment went, so it's
              // locked out until its start time actually arrives — the
              // other statuses aren't time-gated.
              const tooFuture =
                status === "completed" &&
                !hasAppointmentStarted(booking.booking_date, booking.booking_time);
              return (
                <button
                  key={status}
                  disabled={saving || booking.status === status || tooFuture}
                  onClick={() => onChangeStatus(booking, status)}
                  title={
                    tooFuture
                      ? "Can't mark this until the appointment's start time arrives"
                      : undefined
                  }
                  className={`relative flex-1 min-w-[80px] rounded-lg px-2.5 py-2 text-xs font-medium capitalize transition-all duration-300 disabled:cursor-not-allowed ${
                    booking.status === status
                      ? "bg-gradient-to-br from-white/20 to-white/5 text-foreground shadow-sm shadow-black/10"
                      : "text-muted hover:text-foreground active:scale-95"
                  } ${
                    (saving || tooFuture) && "opacity-60"
                  }`}
                >
                  <span className="relative inline-flex items-center gap-1">
                    {booking.status === status && (
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    )}
                    {filterLabels[status]}
                  </span>
                </button>
              );
            }
          )}
        </div>
        {saveError && <ErrorBanner message={saveError} />}
      </div>

      {canDelete && (
        <div className="border-t border-line pt-3">
          <button
            onClick={onDelete}
            className="w-full rounded-lg border border-rose-200 px-3 py-2 text-xs font-medium text-rose-700 transition hover:bg-rose-50"
          >
            Delete booking permanently
          </button>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-xs uppercase text-muted">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
