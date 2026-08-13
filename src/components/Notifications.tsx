"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { fetchProducts, stockLevel } from "@/lib/inventory";
import { formatDateLong, toDateKey } from "@/lib/format";
import { useBookings } from "@/lib/useBookings";
import { useShop } from "@/lib/shop";
import { playNotificationSound } from "@/lib/notificationSound";
import type { Product } from "@/lib/types";

type Note = {
  id: string;
  href: string;
  title: string;
  detail: string;
  tone: "amber" | "rose" | "primary";
};

const toneStyles: Record<Note["tone"], string> = {
  amber: "bg-amber-100 text-amber-800",
  rose: "bg-rose-100 text-rose-700",
  primary: "bg-primary-100 text-primary-dark",
};

/** A booking counts as "just came in" for this long after it was created. */
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

export default function Notifications() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // Shared hook so the bell picks up realtime inserts like every other page.
  const { bookings, loading: bookingsLoading } = useBookings();
  const { settings } = useShop();
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoaded, setProductsLoaded] = useState(false);
  // `null` until the first fully-loaded snapshot of notes is captured — a
  // baseline to diff future snapshots against, not something to ring for.
  // Without this, bookings and products resolve at different times after a
  // refresh, notes.length jumps more than once before settling, and the bell
  // would ring on every reload even though nothing is actually new.
  const seenNoteIdsRef = useRef<Set<string> | null>(null);

  // Kept in state and ticked rather than read during render: notes derived from
  // the current time would otherwise freeze at whatever moment the dashboard
  // was opened, so a booking would sit under "New booking" indefinitely and the
  // "today" grouping would be wrong for anyone who leaves the tab open overnight.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    fetchProducts().then(setProducts, () => {}).finally(() => setProductsLoaded(true));
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // Memoize the notes early so we can use them in the effect below
  const notes = useMemo(() => {
    const today = toDateKey(new Date(now));
    const list: Note[] = [];
    // One note per booking — a brand-new pending booking would otherwise show
    // up twice (once as "new", once as "needs confirmation").
    const seen = new Set<string>();

    // Anything booked in the last day, whatever its status, so a fresh booking
    // from the public site is always visible here — not just pending ones.
    const recent = bookings
      .filter(
        (booking) =>
          now - new Date(booking.created_at).getTime() < RECENT_WINDOW_MS
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at));

    for (const booking of recent) {
      seen.add(booking.id);
      list.push({
        id: `new-${booking.id}`,
        href: "/appointments",
        title: `New booking: ${booking.full_name}`,
        detail: `${booking.service_name} · ${formatDateLong(
          booking.booking_date
        )} ${booking.booking_time}`,
        tone: booking.status === "pending" ? "amber" : "primary",
      });
    }

    for (const booking of bookings) {
      if (seen.has(booking.id)) continue;
      if (booking.status === "pending" && booking.booking_date >= today) {
        seen.add(booking.id);
        list.push({
          id: `pending-${booking.id}`,
          href: "/appointments",
          title: `${booking.full_name} needs confirmation`,
          detail: `${booking.service_name} · ${formatDateLong(
            booking.booking_date
          )} ${booking.booking_time}`,
          tone: "amber",
        });
      }
    }

    for (const booking of bookings) {
      if (seen.has(booking.id)) continue;
      if (booking.booking_date === today && booking.status === "confirmed") {
        list.push({
          id: `today-${booking.id}`,
          href: "/calendar",
          title: `Today: ${booking.full_name}`,
          detail: `${booking.service_name} at ${booking.booking_time}`,
          tone: "primary",
        });
      }
    }

    for (const product of products) {
      const level = stockLevel(product);
      if (level === "in") continue;
      list.push({
        id: `stock-${product.id}`,
        href: "/inventory",
        title:
          level === "out"
            ? `${product.name} is out of stock`
            : `${product.name} is running low`,
        detail: `${product.stock} left in stock`,
        tone: level === "out" ? "rose" : "amber",
      });
    }

    return list;
  }, [bookings, products, now]);

  // Ring the bell once per genuinely new notification, never on a refresh.
  // Bookings and products load at different times, so notes.length jumps
  // more than once before things settle — comparing raw counts would ring
  // on every page load. Instead: wait until both sources have loaded, take
  // that as the baseline, and only ring afterwards, and only when an id
  // shows up that wasn't in the previous snapshot.
  useEffect(() => {
    if (bookingsLoading || !productsLoaded) return;

    const currentIds = new Set(notes.map((note) => note.id));
    const previousIds = seenNoteIdsRef.current;

    if (previousIds) {
      const hasNew = [...currentIds].some((id) => !previousIds.has(id));
      if (hasNew && settings?.notification_sound_enabled !== false) {
        playNotificationSound();
      }
    }

    seenNoteIdsRef.current = currentIds;
  }, [notes, bookingsLoading, productsLoaded, settings?.notification_sound_enabled]);

  // Close on any tap/click outside the bell or its panel, and on Escape.
  // A ref-scoped listener (rather than a full-screen overlay button) so it
  // isn't at the mercy of stacking contexts created by the sticky header —
  // this is the same pattern ClickableStatusBadge uses for its menu.
  useEffect(() => {
    if (!open) return;

    function handleOutside(event: MouseEvent | TouchEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        onClick={() => setOpen((value) => !value)}
        className="relative grid h-9 w-9 place-items-center rounded-lg border border-line text-sm hover:bg-background"
        aria-label="Notifications"
      >
        🔔
        {notes.length > 0 && (
          <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">
            {notes.length > 9 ? "9+" : notes.length}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Dims the page and blocks clicks from reaching content underneath
              while the panel is open — closing itself is now handled by the
              outside-click listener above, not this button's onClick. */}
          <div
            className="fixed inset-0 z-40 cursor-default"
            aria-hidden="true"
          />
          <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden card shadow-lg">
            <p className="border-b border-line px-4 py-2.5 text-sm font-semibold">
              Notifications
            </p>

            {notes.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted">
                You are all caught up.
              </p>
            ) : (
              <ul className="max-h-96 divide-y divide-line overflow-y-auto">
                {notes.map((note) => (
                  <li key={note.id}>
                    <Link
                      href={note.href}
                      onClick={() => setOpen(false)}
                      className="flex gap-3 px-4 py-3 hover:bg-background"
                    >
                      <span
                        className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                          toneStyles[note.tone]
                        }`}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {note.title}
                        </span>
                        <span className="block truncate text-xs text-muted">
                          {note.detail}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
