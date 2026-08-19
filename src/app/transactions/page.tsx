"use client";

import { useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import PeriodFilter from "@/components/PeriodFilter";
import Pagination from "@/components/Pagination";
import ConfirmDialog from "@/components/ConfirmDialog";
import { EmptyState, ErrorBanner, TableSkeleton } from "@/components/Feedback";
import { IconCalendar, IconClose, IconRegister, IconSearch } from "@/components/Icons";
import { useBookings } from "@/lib/useBookings";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/lib/auth";
import { formatDateLong, formatMoney, toDateKey } from "@/lib/format";
import { resolvePeriod, withinPeriod, type PeriodKey } from "@/lib/dateRange";
import { usePagination } from "@/lib/usePagination";
import { deleteBooking } from "@/lib/bookings";
import { logActivity } from "@/lib/activity";
import type { Booking } from "@/lib/types";

const PAGE_SIZE = 10;

type SortKey = "date" | "client" | "method" | "total";
type PaidFilter = "all" | "paid" | "unpaid";

const columns: Array<{ key: SortKey | "index"; label: string; align?: "right" }> = [
  { key: "date", label: "Date" },
  { key: "client", label: "Client" },
  { key: "method", label: "Method" },
  { key: "total", label: "Total", align: "right" },
];

export default function TransactionsPage() {
  const { bookings, loading, error, reload } = useBookings();
  const toast = useToast();
  const { session, isSuperAdmin } = useAuth();
  const actor = session?.user.email ?? null;
  const [query, setQuery] = useState("");
  const [paidFilter, setPaidFilter] = useState<PaidFilter>("paid");
  const [period, setPeriod] = useState<PeriodKey>("all");
  // A specific calendar range, picked below. Set, it overrides the quick
  // period chips above so admins can jump to any window, not just the
  // canned ones.
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [deleting, setDeleting] = useState<Booking | null>(null);

  const hasCustomRange = Boolean(dateFrom || dateTo);

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    const bounds = hasCustomRange
      ? { start: dateFrom || "0000-00-00", end: dateTo || "9999-99-99" }
      : resolvePeriod(period);
    let list = bookings.filter(
      (b) => b.status !== "cancelled" && withinPeriod(b.booking_date, bounds)
    );
    if (paidFilter === "paid") list = list.filter((b) => b.is_paid);
    if (paidFilter === "unpaid") list = list.filter((b) => !b.is_paid);
    if (term) {
      list = list.filter(
        (b) =>
          b.full_name.toLowerCase().includes(term) ||
          b.email.toLowerCase().includes(term) ||
          b.service_name.toLowerCase().includes(term) ||
          (b.payment_method ?? "").toLowerCase().includes(term)
      );
    }

    const sorted = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "date") {
        cmp = `${a.booking_date}T${a.booking_time}`.localeCompare(
          `${b.booking_date}T${b.booking_time}`
        );
      } else if (sortKey === "client") {
        cmp = a.full_name.localeCompare(b.full_name);
      } else if (sortKey === "method") {
        cmp = (a.payment_method ?? "").localeCompare(b.payment_method ?? "");
      } else if (sortKey === "total") {
        cmp = Number(a.total) - Number(b.total);
      }
      return cmp * sortDir;
    });
    return sorted;
  }, [bookings, query, paidFilter, period, hasCustomRange, dateFrom, dateTo, sortKey, sortDir]);

  const { page, pageCount, pageItems, setPage, total } = usePagination(
    rows,
    PAGE_SIZE
  );

  const totals = useMemo(() => {
    return rows.reduce(
      (sum, b) => ({
        subtotal: sum.subtotal + Number(b.subtotal),
        discount: sum.discount + Number(b.discount),
        tax: sum.tax + Number(b.tax),
        tip: sum.tip + Number(b.tip ?? 0),
        total: sum.total + Number(b.total),
      }),
      { subtotal: 0, discount: 0, tax: 0, tip: 0, total: 0 }
    );
  }, [rows]);

  const currency = rows[0]?.currency ?? "AED";

  // Today's earnings — always paid, always today, regardless of whatever
  // filters the admin has applied to the table above.
  const todayEarnings = useMemo(() => {
    const todayKey = toDateKey(new Date());
    return bookings
      .filter(
        (b) =>
          b.status !== "cancelled" && b.is_paid && b.booking_date === todayKey
      )
      .reduce((sum, b) => sum + Number(b.total), 0);
  }, [bookings]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === 1 ? -1 : 1));
    } else {
      setSortKey(key);
      setSortDir(-1);
    }
  }

  async function handleDeleteTransaction() {
    if (!deleting || !isSuperAdmin) return;
    try {
      await deleteBooking(deleting.id);
      setDeleting(null);
      await reload();
      toast.success("Transaction deleted", `${deleting.full_name}'s record was permanently removed.`);
      logActivity({
        actor,
        entity: "booking",
        entity_id: deleting.id,
        action: "deleted",
        summary: `Deleted transaction for ${deleting.full_name}`,
        detail: `${formatMoney(Number(deleting.total), deleting.currency)} · ${
          deleting.payment_method ?? "no method"
        } · ${formatDateLong(deleting.booking_date)}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Delete failed";
      toast.error("Delete failed", message);
    }
  }

  return (
    <>
      <PageHeader
        title="Transactions"
        subtitle={
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span>
              {rows.length} transaction{rows.length === 1 ? "" : "s"} ·{" "}
              {formatMoney(totals.total, currency)} total
            </span>
            {period === "today" && !hasCustomRange && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300">
                Today: {formatMoney(todayEarnings, currency)}
              </span>
            )}
          </span>
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-40 shrink-0 sm:w-52">
              <IconSearch
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
              />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search"
                className="w-full rounded-xl border border-line py-2 pl-8 pr-3 text-sm outline-none transition focus:border-foreground/40 focus:ring-4 focus:ring-foreground/[0.06]"
              />
            </div>
          </div>
        }
      />

      <main className="flex-1 space-y-4 p-4 sm:p-6">
        {error && <ErrorBanner message={error} />}

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex w-fit gap-1 rounded-xl border border-line p-1">
            {(["all", "paid", "unpaid"] as PaidFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setPaidFilter(f)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition ${
                  paidFilter === f
                    ? "bg-foreground text-surface"
                    : "text-muted hover:bg-background"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <PeriodFilter
            value={period}
            onChange={(next) => {
              setDateFrom("");
              setDateTo("");
              setPeriod(next);
            }}
          />
        </div>

        {/* Pick any specific window on the calendar — overrides the quick
            chips above while a date is set. */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-2.5">
          <span className="flex shrink-0 items-center gap-1.5 pl-1 text-xs font-medium text-muted">
            <IconCalendar size={14} />
            Custom range
          </span>
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <span className="hidden sm:inline">From</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="rounded-lg border border-line px-2.5 py-1.5 text-xs outline-none transition focus:border-foreground/40 focus:ring-4 focus:ring-foreground/[0.06]"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <span className="hidden sm:inline">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="rounded-lg border border-line px-2.5 py-1.5 text-xs outline-none transition focus:border-foreground/40 focus:ring-4 focus:ring-foreground/[0.06]"
            />
          </label>
          {hasCustomRange && (
            <button
              onClick={() => {
                setDateFrom("");
                setDateTo("");
              }}
              className="text-xs text-primary hover:underline"
            >
              Clear
            </button>
          )}
        </div>

        <div className="overflow-hidden card">
          {loading ? (
            <TableSkeleton rows={6} cols={7} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<IconRegister size={22} />}
              title="No transactions yet"
              detail="Paid appointments will show up here as a spreadsheet-style ledger."
            />
          ) : (
            <>
              {/* Phones get a card list — a 12-column ledger behind a
                  horizontal scrollbar is unreadable at 375px. */}
              <ul className="divide-y divide-line sm:hidden">
                {pageItems.map((b) => (
                  <li key={b.id} className="flex flex-col gap-1.5 px-4 py-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate font-medium">
                        {b.full_name}
                      </p>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="font-semibold tabular-nums">
                          {formatMoney(Number(b.total), b.currency)}
                        </span>
                        {isSuperAdmin && (
                          <button
                            onClick={() => setDeleting(b)}
                            aria-label="Delete transaction"
                            className="grid h-6 w-6 place-items-center rounded-md text-rose-600 hover:bg-rose-50"
                          >
                            <IconClose size={13} />
                          </button>
                        )}
                      </span>
                    </div>
                    <p className="truncate text-xs text-muted">
                      {b.service_name} · {b.staff_name}
                    </p>
                    <div className="flex items-center justify-between gap-2 text-xs text-muted">
                      <span className="tabular-nums">
                        {formatDateLong(b.booking_date)} · {b.booking_time}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {b.payment_method ?? "—"}
                        <span
                          className={`rounded-full px-2 py-0.5 font-medium ${
                            b.is_paid
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {b.is_paid ? "Paid" : "Unpaid"}
                        </span>
                      </span>
                    </div>
                  </li>
                ))}
                <li className="flex items-center justify-between bg-surface-2 px-4 py-3 text-sm font-semibold">
                  <span>Total</span>
                  <span className="tabular-nums">
                    {formatMoney(totals.total, currency)}
                  </span>
                </li>
              </ul>

              {/* Bounded height gives this box real vertical overflow, which
                  is what lets the header row below actually stick. */}
              <div className="hidden max-h-[calc(100vh-19rem)] overflow-auto sm:block">
              {/* "Excel type" grid: dense rows, right-aligned numerics, sticky
                  header, zebra striping — reads like a spreadsheet ledger. */}
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-2 text-left text-xs uppercase text-muted">
                    <th className="sticky top-0 z-10 border-r border-line bg-surface-2 px-3 py-2.5 font-medium">
                      #
                    </th>
                    {columns.map((col) => (
                      <th
                        key={col.key}
                        onClick={() => toggleSort(col.key as SortKey)}
                        className={`sticky top-0 z-10 cursor-pointer select-none border-r border-line bg-surface-2 px-3 py-2.5 font-medium last:border-r-0 ${
                          col.align === "right" ? "text-right" : ""
                        }`}
                      >
                        {col.label}
                        {sortKey === col.key ? (sortDir === 1 ? " ▲" : " ▼") : ""}
                      </th>
                    ))}
                    <th className="sticky top-0 z-10 border-r border-line bg-surface-2 px-3 py-2.5 font-medium">
                      Service
                    </th>
                    <th className="sticky top-0 z-10 border-r border-line bg-surface-2 px-3 py-2.5 font-medium">
                      Staff
                    </th>
                    <th className="sticky top-0 z-10 border-r border-line bg-surface-2 px-3 py-2.5 text-right font-medium">
                      Subtotal
                    </th>
                    <th className="sticky top-0 z-10 border-r border-line bg-surface-2 px-3 py-2.5 text-right font-medium">
                      Discount
                    </th>
                    <th className="sticky top-0 z-10 border-r border-line bg-surface-2 px-3 py-2.5 text-right font-medium">
                      Tax
                    </th>
                    <th className="sticky top-0 z-10 border-r border-line bg-surface-2 px-3 py-2.5 text-right font-medium">
                      Tip
                    </th>
                    <th className="sticky top-0 z-10 bg-surface-2 px-3 py-2.5 font-medium">
                      Status
                    </th>
                    {isSuperAdmin && (
                      <th className="sticky top-0 z-10 bg-surface-2 px-3 py-2.5 font-medium" />
                    )}
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((b, i) => (
                    <tr
                      key={b.id}
                      className={`border-b border-line ${
                        i % 2 === 1 ? "bg-background/40" : ""
                      }`}
                    >
                      <td className="border-r border-line px-3 py-2 tabular-nums text-muted">
                        {(page - 1) * PAGE_SIZE + i + 1}
                      </td>
                      <td className="whitespace-nowrap border-r border-line px-3 py-2 tabular-nums">
                        {formatDateLong(b.booking_date)} · {b.booking_time}
                      </td>
                      <td className="border-r border-line px-3 py-2">
                        <p className="font-medium">{b.full_name}</p>
                        <p className="text-xs text-muted">{b.email}</p>
                      </td>
                      <td className="border-r border-line px-3 py-2">
                        {b.payment_method ?? "—"}
                      </td>
                      <td className="border-r border-line px-3 py-2 text-right font-medium tabular-nums">
                        {formatMoney(Number(b.total), b.currency)}
                      </td>
                      <td className="border-r border-line px-3 py-2">
                        {b.service_name}
                      </td>
                      <td className="border-r border-line px-3 py-2">
                        {b.staff_name}
                      </td>
                      <td className="border-r border-line px-3 py-2 text-right tabular-nums">
                        {formatMoney(Number(b.subtotal), b.currency)}
                      </td>
                      <td className="border-r border-line px-3 py-2 text-right tabular-nums">
                        {Number(b.discount) > 0
                          ? `−${formatMoney(Number(b.discount), b.currency)}`
                          : "—"}
                      </td>
                      <td className="border-r border-line px-3 py-2 text-right tabular-nums">
                        {formatMoney(Number(b.tax), b.currency)}
                      </td>
                      <td className="border-r border-line px-3 py-2 text-right tabular-nums">
                        {Number(b.tip ?? 0) > 0
                          ? formatMoney(Number(b.tip), b.currency)
                          : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            b.is_paid
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {b.is_paid ? "Paid" : "Unpaid"}
                        </span>
                      </td>
                      {isSuperAdmin && (
                        <td className="px-3 py-2">
                          <button
                            onClick={() => setDeleting(b)}
                            aria-label="Delete transaction"
                            className="grid h-6 w-6 place-items-center rounded-md text-rose-600 hover:bg-rose-50"
                          >
                            <IconClose size={13} />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-line bg-surface-2 text-sm font-semibold">
                    <td className="border-r border-line px-3 py-2.5" colSpan={4}>
                      Totals
                    </td>
                    <td className="border-r border-line px-3 py-2.5 text-right tabular-nums">
                      {formatMoney(totals.total, currency)}
                    </td>
                    <td className="border-r border-line px-3 py-2.5" colSpan={2} />
                    <td className="border-r border-line px-3 py-2.5 text-right tabular-nums">
                      {formatMoney(totals.subtotal, currency)}
                    </td>
                    <td className="border-r border-line px-3 py-2.5 text-right tabular-nums">
                      {totals.discount > 0
                        ? `−${formatMoney(totals.discount, currency)}`
                        : "—"}
                    </td>
                    <td className="border-r border-line px-3 py-2.5 text-right tabular-nums">
                      {formatMoney(totals.tax, currency)}
                    </td>
                    <td className="border-r border-line px-3 py-2.5 text-right tabular-nums">
                      {formatMoney(totals.tip, currency)}
                    </td>
                    <td className="px-3 py-2.5" />
                    {isSuperAdmin && <td className="px-3 py-2.5" />}
                  </tr>
                </tfoot>
              </table>
              </div>

              <Pagination
                page={page}
                pageCount={pageCount}
                total={total}
                pageSize={PAGE_SIZE}
                onChange={setPage}
              />
            </>
          )}
        </div>
      </main>

      {deleting && (
        <ConfirmDialog
          title="Delete this transaction?"
          tone="danger"
          confirmLabel="Delete"
          message={
            <>
              The{" "}
              <span className="font-medium text-foreground">
                {formatMoney(Number(deleting.total), deleting.currency)}
              </span>{" "}
              transaction for{" "}
              <span className="font-medium text-foreground">
                {deleting.full_name}
              </span>{" "}
              will be permanently deleted. This cannot be undone.
            </>
          }
          onClose={() => setDeleting(null)}
          onConfirm={handleDeleteTransaction}
        />
      )}
    </>
  );
}
