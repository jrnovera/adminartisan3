"use client";

import { useState } from "react";
import { IconRegister } from "./Icons";
import { withinPeriod } from "@/lib/dateRange";
import type { Booking } from "@/lib/types";

/**
 * Export controls shared by Appointments, Transactions and POS.
 *
 * `rows` is whatever the page's own filters have already narrowed down
 * (status, location, paid, search…) — "Export" additionally scopes that by
 * the from/to dates picked here. "Export all" ignores every filter on the
 * page, including these dates, and exports the full, unfiltered `allRows` —
 * for when someone wants the whole table regardless of what they're
 * currently looking at.
 */
export default function ExportBar({
  rows,
  allRows,
  onExport,
}: {
  rows: Booking[];
  allRows: Booking[];
  onExport: (rows: Booking[]) => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [exportMode, setExportMode] = useState<"filtered" | "all" | null>(null);

  const scoped = rows.filter((b) =>
    withinPeriod(b.booking_date, from || to ? { start: from || "0000-00-00", end: to || "9999-99-99" } : null)
  );

  const handleExportFiltered = () => {
    onExport(scoped);
    setExportMode(null);
    setFrom("");
    setTo("");
  };

  const handleExportAll = () => {
    onExport(allRows);
    setExportMode(null);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {exportMode === "filtered" && (
        <>
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <span className="hidden sm:inline">From</span>
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="rounded-lg border border-line px-2.5 py-1.5 text-xs outline-none transition focus:border-foreground/40 focus:ring-4 focus:ring-foreground/[0.06]"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <span className="hidden sm:inline">to</span>
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="rounded-lg border border-line px-2.5 py-1.5 text-xs outline-none transition focus:border-foreground/40 focus:ring-4 focus:ring-foreground/[0.06]"
            />
          </label>
          {(from || to) && (
            <button
              onClick={() => {
                setFrom("");
                setTo("");
              }}
              className="text-xs text-primary hover:underline"
            >
              Clear
            </button>
          )}
        </>
      )}

      {exportMode === "filtered" ? (
        <>
          <button
            onClick={handleExportFiltered}
            disabled={scoped.length === 0}
            className="btn-primary flex shrink-0 items-center gap-1.5 px-4 py-2 text-xs hover:btn-primary-hover disabled:opacity-50"
          >
            <IconRegister size={13} />
            <span>Export{scoped.length > 0 ? ` (${scoped.length})` : ""}</span>
          </button>
          <button
            onClick={() => {
              setExportMode(null);
              setFrom("");
              setTo("");
            }}
            className="text-xs text-muted hover:text-foreground"
          >
            Cancel
          </button>
        </>
      ) : (
        <>
          <button
            onClick={() => setExportMode("filtered")}
            disabled={rows.length === 0}
            className="btn-primary flex shrink-0 items-center gap-1.5 px-4 py-2 text-xs hover:btn-primary-hover disabled:opacity-50"
          >
            <IconRegister size={13} />
            <span>Export{rows.length > 0 ? ` (${rows.length})` : ""}</span>
          </button>
          <button
            onClick={handleExportAll}
            disabled={allRows.length === 0}
            className="btn-ghost flex shrink-0 items-center gap-1.5 px-4 py-2 text-xs hover:bg-background disabled:opacity-50"
          >
            <IconRegister size={13} />
            <span>Export all</span>
          </button>
        </>
      )}
    </div>
  );
}
