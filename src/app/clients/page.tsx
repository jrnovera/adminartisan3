"use client";

import { useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import ClientDrawer from "@/components/ClientDrawer";
import Pagination from "@/components/Pagination";
import { EmptyState, ErrorBanner, TableSkeleton } from "@/components/Feedback";
import { IconSearch, IconUsers } from "@/components/Icons";
import { deriveClients } from "@/lib/bookings";
import { formatDateLong, formatMoney } from "@/lib/format";
import { useBookings } from "@/lib/useBookings";
import { usePagination } from "@/lib/usePagination";
import type { Client } from "@/lib/types";

const PAGE_SIZE = 15;

export default function ClientsPage() {
  const { bookings, loading, error } = useBookings();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Client | null>(null);

  const clients = useMemo(() => {
    const all = deriveClients(bookings);
    const term = query.trim().toLowerCase();
    if (!term) return all;
    return all.filter(
      (client) =>
        client.full_name.toLowerCase().includes(term) ||
        client.email.toLowerCase().includes(term) ||
        client.mobile.includes(term)
    );
  }, [bookings, query]);

  const { page, pageCount, pageItems, setPage, total } = usePagination(
    clients,
    PAGE_SIZE
  );

  return (
    <>
      <PageHeader
        title="Clients"
        subtitle={`${clients.length} client${clients.length === 1 ? "" : "s"}`}
        action={
          <div className="relative w-full sm:w-64">
            <IconSearch
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, email or mobile"
              className="w-full rounded-xl border border-line py-2 pl-9 pr-3 text-sm outline-none transition focus:border-foreground/40 focus:ring-4 focus:ring-foreground/[0.06]"
            />
          </div>
        }
      />

      <main className="flex-1 p-4 sm:p-6">
        {error && (
          <div className="mb-4">
            <ErrorBanner message={error} />
          </div>
        )}

        <div className="overflow-hidden card">
          {loading ? (
            <TableSkeleton rows={5} cols={4} />
          ) : clients.length === 0 ? (
            <EmptyState
              icon={<IconUsers size={22} />}
              title="No clients yet"
              detail="Clients appear automatically after their first booking."
            />
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-line text-xs uppercase text-muted">
                    <tr>
                      <th className="px-5 py-3 font-medium">Client</th>
                      <th className="px-5 py-3 font-medium">Contact</th>
                      <th className="px-5 py-3 font-medium">Visits</th>
                      <th className="px-5 py-3 font-medium">Total Spent</th>
                      <th className="px-5 py-3 font-medium">Last Visit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {pageItems.map((client) => (
                      <tr
                        key={client.email}
                        onClick={() => setSelected(client)}
                        className="row-hover cursor-pointer hover:bg-background"
                      >
                        <td className="px-5 py-3.5 font-medium">
                          {client.full_name}
                        </td>
                        <td className="px-5 py-3.5">
                          <p>{client.email}</p>
                          <p className="text-xs text-muted">{client.mobile}</p>
                        </td>
                        <td className="px-5 py-3.5 tabular-nums">
                          {client.visits}
                        </td>
                        <td className="px-5 py-3.5 tabular-nums">
                          {formatMoney(client.totalSpent, client.currency)}
                        </td>
                        <td className="px-5 py-3.5">
                          {formatDateLong(client.lastVisit)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile card list */}
              <ul className="divide-y divide-line sm:hidden">
                {pageItems.map((client) => (
                  <li
                    key={client.email}
                    onClick={() => setSelected(client)}
                    className="flex cursor-pointer flex-col gap-1.5 px-4 py-3.5 active:bg-background"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate font-medium">
                        {client.full_name}
                      </p>
                      <span className="shrink-0 text-xs font-medium tabular-nums text-muted">
                        {client.visits} visit{client.visits === 1 ? "" : "s"}
                      </span>
                    </div>
                    <p className="truncate text-xs text-muted">
                      {client.email} · {client.mobile}
                    </p>
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span>Last: {formatDateLong(client.lastVisit)}</span>
                      <span className="font-medium tabular-nums text-foreground">
                        {formatMoney(client.totalSpent, client.currency)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>

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

      {selected && (
        <ClientDrawer
          client={selected}
          bookings={bookings}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
