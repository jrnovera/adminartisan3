"use client";

import { useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import PosCheckout from "@/components/PosCheckout";
import StatusBadge from "@/components/StatusBadge";
import HomeBadge from "@/components/HomeBadge";
import PeriodFilter from "@/components/PeriodFilter";
import ConfirmDialog from "@/components/ConfirmDialog";
import Pagination from "@/components/Pagination";
import { EmptyState, ErrorBanner, TableSkeleton } from "@/components/Feedback";
import { IconClose, IconRegister, IconSearch } from "@/components/Icons";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/lib/auth";
import { useBookings } from "@/lib/useBookings";
import { useShop } from "@/lib/shop";
import { formatDateLong, formatMoney } from "@/lib/format";
import { resolvePeriod, withinPeriod, type PeriodKey } from "@/lib/dateRange";
import { exportTransactionsCsv } from "@/lib/exportCsv";
import { deleteBooking } from "@/lib/bookings";
import { logActivity } from "@/lib/activity";
import { usePagination } from "@/lib/usePagination";
import type { Booking, ServiceLocation } from "@/lib/types";

const PAGE_SIZE = 20;

const locationFilters: Array<ServiceLocation | "all"> = ["all", "salon", "home"];

const locationLabels: Record<ServiceLocation | "all", string> = {
  all: "Everywhere",
  salon: "In salon",
  home: "Home service",
};

export default function PosPage() {
  const { bookings, loading, error, reload } = useBookings();
  const { settings } = useShop();
  const toast = useToast();
  const { session, isSuperAdmin } = useAuth();
  const actor = session?.user.email ?? null;
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Booking | null>(null);
  const [deleting, setDeleting] = useState<Booking | null>(null);
  const [showPaid, setShowPaid] = useState(false);
  const [period, setPeriod] = useState<PeriodKey>("all");
  // A specific day picked in the date input. Takes over from the period
  // presets when set — the two aren't meant to combine, just one active
  // date scope at a time.
  const [exactDate, setExactDate] = useState("");
  const [locationFilter, setLocationFilter] = useState<ServiceLocation | "all">(
    "all"
  );

  const currency = settings?.currency ?? "AED";

  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    const bounds = exactDate
      ? { start: exactDate, end: exactDate }
      : resolvePeriod(period);
    return bookings
      .filter((booking) => booking.status !== "cancelled")
      .filter((booking) => (showPaid ? true : !booking.is_paid))
      .filter((booking) => withinPeriod(booking.booking_date, bounds))
      .filter((booking) => {
        if (locationFilter === "all") return true;
        // Bookings made before home service existed have no value stored,
        // and those were all in-salon.
        return (booking.service_location ?? "salon") === locationFilter;
      })
      .filter((booking) =>
        term
          ? booking.full_name.toLowerCase().includes(term) ||
            booking.mobile.includes(term) ||
            booking.email.toLowerCase().includes(term)
          : true
      )
      .sort((a, b) => b.booking_date.localeCompare(a.booking_date));
  }, [bookings, query, showPaid, period, exactDate, locationFilter]);

  const { page, pageCount, pageItems, setPage, total } = usePagination(
    results,
    PAGE_SIZE
  );

  async function handleDeleteBill() {
    if (!deleting || !isSuperAdmin) return;
    try {
      await deleteBooking(deleting.id);
      if (selected?.id === deleting.id) setSelected(null);
      setDeleting(null);
      await reload();
      toast.success("Bill deleted", `${deleting.full_name}'s bill was permanently removed.`);
      logActivity({
        actor,
        entity: "booking",
        entity_id: deleting.id,
        action: "deleted",
        summary: `Deleted bill for ${deleting.full_name}`,
        detail: `${formatMoney(Number(deleting.total), deleting.currency)} · ${formatDateLong(
          deleting.booking_date
        )}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Delete failed";
      toast.error("Delete failed", message);
    }
  }

  return (
    <>
      <PageHeader
        title="POS / Checkout"
        subtitle="Look up a client's bill, add extras and take payment"
        action={
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => exportTransactionsCsv(results)}
              disabled={results.length === 0}
              className="btn-primary flex shrink-0 items-center gap-1.5 px-4 py-2 text-sm hover:btn-primary-hover disabled:opacity-50"
            >
              <IconRegister size={15} />
              <span className="hidden sm:inline">
                Export{results.length > 0 ? ` (${results.length})` : ""}
              </span>
            </button>
            <button
              onClick={() => exportTransactionsCsv(bookings)}
              disabled={bookings.length === 0}
              className="btn-ghost flex shrink-0 items-center gap-1.5 px-4 py-2 text-sm hover:bg-background disabled:opacity-50"
            >
              <IconRegister size={15} />
              <span className="hidden sm:inline">Export all</span>
            </button>
          </div>
        }
      />

      <main className="flex-1 space-y-4 p-4 sm:p-6">
        {error && <ErrorBanner message={error} />}

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-sm">
            <IconSearch
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name, mobile or email…"
              className="w-full rounded-xl border border-line py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-foreground/40 focus:ring-4 focus:ring-foreground/[0.06]"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-muted select-none">
            <input
              type="checkbox"
              checked={showPaid}
              onChange={(event) => setShowPaid(event.target.checked)}
              className="h-4 w-4 accent-foreground"
            />
            Include paid
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1.5">
            {locationFilters.map((option) => (
              <button
                key={option}
                onClick={() => setLocationFilter(option)}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition-all duration-150 ${
                  locationFilter === option
                    ? "bg-foreground text-white shadow-sm"
                    : "border border-line text-foreground/70 hover:bg-background"
                }`}
              >
                {locationLabels[option]}
              </button>
            ))}
          </div>
          <PeriodFilter
            value={period}
            onChange={(next) => {
              setExactDate("");
              setPeriod(next);
            }}
          />
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <span className="hidden sm:inline">or pick a date</span>
            <input
              type="date"
              value={exactDate}
              onChange={(event) => setExactDate(event.target.value)}
              className="rounded-lg border border-line px-2.5 py-1.5 text-xs outline-none transition focus:border-foreground/40 focus:ring-4 focus:ring-foreground/[0.06]"
            />
            {exactDate && (
              <button
                onClick={() => setExactDate("")}
                className="text-primary hover:underline"
              >
                Clear
              </button>
            )}
          </label>
        </div>

        {loading ? (
          <div className="card overflow-hidden">
            <TableSkeleton rows={4} cols={4} />
          </div>
        ) : results.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={<IconRegister size={22} />}
              title="No matching bills"
              detail="Try a different search, period or location — or include already-paid bills."
            />
          </div>
        ) : (
          <div className="grid gap-3">
            {pageItems.map((booking) => (
              <div
                key={booking.id}
                className="card-interactive hover:card-interactive-hover flex flex-wrap items-center justify-between gap-3 p-4 text-left cursor-pointer"
                onClick={() => setSelected(booking)}
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 font-semibold">
                    {booking.full_name}
                    <HomeBadge location={booking.service_location} />
                  </p>
                  <p className="truncate text-sm text-muted">
                    {booking.service_name} · {booking.staff_name}
                  </p>
                  <p className="text-xs text-muted">
                    {formatDateLong(booking.booking_date)} ·{" "}
                    {booking.booking_time}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={booking.status} />
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      booking.is_paid
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-amber-100 text-amber-900"
                    }`}
                  >
                    {booking.is_paid ? "Paid" : "Unpaid"}
                  </span>
                  <span className="font-semibold tabular-nums">
                    {formatMoney(Number(booking.total), booking.currency)}
                  </span>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelected(booking);
                    }}
                    className="shrink-0 rounded-lg bg-primary text-white px-3 py-1.5 text-xs font-semibold shadow-sm transition hover:bg-primary/90 active:bg-primary/80"
                  >
                    {booking.is_paid ? "View" : "Pay"}
                  </button>
                  {isSuperAdmin && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        event.stopPropagation();
                        setDeleting(booking);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.stopPropagation();
                          event.preventDefault();
                          setDeleting(booking);
                        }
                      }}
                      aria-label="Delete bill"
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-rose-600 hover:bg-rose-50"
                    >
                      <IconClose size={14} />
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && results.length > 0 && (
          <div className="card overflow-hidden">
            <Pagination
              page={page}
              pageCount={pageCount}
              total={total}
              pageSize={PAGE_SIZE}
              onChange={setPage}
            />
          </div>
        )}
      </main>

      {selected && (
        <PosCheckout
          booking={selected}
          currency={currency}
          onClose={() => setSelected(null)}
          onPaid={() => {
            setSelected(null);
            reload();
            toast.success("Payment recorded", "The bill has been marked paid.");
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete this bill?"
          tone="danger"
          confirmLabel="Delete"
          message={
            <>
              <span className="font-medium text-foreground">
                {deleting.full_name}
              </span>
              &rsquo;s bill for{" "}
              {formatMoney(Number(deleting.total), deleting.currency)} will be
              permanently deleted. This cannot be undone.
            </>
          }
          onClose={() => setDeleting(null)}
          onConfirm={handleDeleteBill}
        />
      )}
    </>
  );
}
