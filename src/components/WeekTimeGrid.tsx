"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { IconCheck } from "./Icons";
import { formatMinutes, parseTimeToMinutes, toDateKey } from "@/lib/format";
import type { Booking, StaffBlock } from "@/lib/types";

const SLOT_MINUTES = 15;
// Dragging snaps to the hour so appointments land on clean start times.
const SNAP_MINUTES = 60;
// Matches the day view's row height so switching views doesn't change how
// much of the day is visible at once, and a busy evening still fits the
// screen without scrolling.
const SLOT_HEIGHT = 26;
// Cards scale with the appointment's actual duration, but never render
// shorter than this — same floor as the day view — so a 15-minute
// booking still shows its time and name on two clean lines.
const MIN_CARD_HEIGHT = 30;
const AXIS_WIDTH = 56;

// Same pastel-fill palette as the day view, so a service reads as the same
// color whichever view you're looking at.
const palette = [
  "bg-sky-100 text-sky-950 ring-sky-200",
  "bg-orange-100 text-orange-950 ring-orange-200",
  "bg-pink-100 text-pink-950 ring-pink-200",
  "bg-teal-100 text-teal-950 ring-teal-200",
  "bg-violet-100 text-violet-950 ring-violet-200",
  "bg-amber-100 text-amber-950 ring-amber-200",
];

function serviceColor(serviceId: string) {
  let hash = 0;
  for (let index = 0; index < serviceId.length; index += 1) {
    hash = (hash * 31 + serviceId.charCodeAt(index)) >>> 0;
  }
  return palette[hash % palette.length];
}

type Placed = { booking: Booking; start: number; end: number };
type Cluster = { start: number; end: number; items: Placed[] };

/**
 * Groups a day's bookings into runs of overlapping appointments. In week view
 * the columns are far too narrow to show clashes side by side, so a cluster is
 * drawn as a stack instead: the layers behind stay visible at the edges and a
 * badge carries the count.
 */
function clusterByOverlap(list: Booking[]): Cluster[] {
  const placed: Placed[] = [];
  for (const booking of list) {
    const start = parseTimeToMinutes(booking.booking_time);
    if (start === null) continue;
    placed.push({
      booking,
      start,
      end: start + Math.max(booking.duration_minutes, SLOT_MINUTES),
    });
  }
  placed.sort((a, b) => a.start - b.start || a.end - b.end);

  const clusters: Cluster[] = [];
  for (const item of placed) {
    const current = clusters[clusters.length - 1];
    if (current && item.start < current.end) {
      current.items.push(item);
      current.end = Math.max(current.end, item.end);
    } else {
      clusters.push({ start: item.start, end: item.end, items: [item] });
    }
  }
  return clusters;
}

export default function WeekTimeGrid({
  days,
  bookings,
  blocks,
  dayStart,
  dayEnd,
  daysOff,
  onMove,
  onSelect,
  onSelectBlock,
  onSelectGroup,
}: {
  days: Date[];
  bookings: Booking[];
  blocks: StaffBlock[];
  dayStart: number;
  dayEnd: number;
  daysOff: number[];
  onMove: (booking: Booking, dateKey: string, startMinutes: number) => void;
  onSelect: (booking: Booking) => void;
  onSelectBlock: (block: StaffBlock) => void;
  onSelectGroup: (bookings: Booking[], startMinutes: number) => void;
}) {
  const [dragging, setDragging] = useState<Booking | null>(null);
  const [hint, setHint] = useState<{ dateKey: string; minutes: number } | null>(
    null
  );
  const [now, setNow] = useState(() => new Date());
  const scrollRef = useRef<HTMLDivElement>(null);

  const rows = Math.max(1, Math.ceil((dayEnd - dayStart) / SLOT_MINUTES));
  const gridHeight = rows * SLOT_HEIGHT;
  const todayKey = toDateKey(now);

  // Keep the "now" line honest without re-rendering constantly.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // Half-hour marks so the axis reads "9:00, 9:30, 10:00…" instead of
  // jumping a full hour at a time — 30 minutes is the shortest a service on
  // this site runs, so that's the finest grain worth labeling.
  const hourMarks = useMemo(() => {
    const marks: number[] = [];
    const firstHalfHour = Math.ceil(dayStart / 30) * 30;
    for (let minutes = firstHalfHour; minutes <= dayEnd; minutes += 30) {
      marks.push(minutes);
    }
    return marks;
  }, [dayStart, dayEnd]);

  // Every 15-minute row gets its own faint line — same as the day view —
  // so an empty stretch of the week reads as a ruled spreadsheet grid
  // rather than blank whitespace.
  const cellMarks = useMemo(() => {
    const marks: number[] = [];
    for (let minutes = dayStart; minutes <= dayEnd; minutes += SLOT_MINUTES) {
      marks.push(minutes);
    }
    return marks;
  }, [dayStart, dayEnd]);

  const byDay = useMemo(() => {
    const map = new Map<string, Booking[]>();
    for (const booking of bookings) {
      const list = map.get(booking.booking_date) ?? [];
      list.push(booking);
      map.set(booking.booking_date, list);
    }
    return map;
  }, [bookings]);

  const blocksByDay = useMemo(() => {
    const map = new Map<string, StaffBlock[]>();
    for (const block of blocks) {
      const list = map.get(block.block_date) ?? [];
      list.push(block);
      map.set(block.block_date, list);
    }
    return map;
  }, [blocks]);

  function minutesFromPointer(clientY: number, element: HTMLElement) {
    const rect = element.getBoundingClientRect();
    const raw = dayStart + ((clientY - rect.top) / SLOT_HEIGHT) * SLOT_MINUTES;
    const snapped = Math.round(raw / SNAP_MINUTES) * SNAP_MINUTES;
    return Math.min(Math.max(snapped, dayStart), dayEnd - SNAP_MINUTES);
  }

  // With few columns the grid fills the width; with a full week it scrolls.
  // Every day column shares the available width equally, so a full week
  // fits the card without ever needing a horizontal scroll to reach Sunday.
  const columnClass = "min-w-0 flex-1";

  return (
    <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Bounded so this box actually has vertical overflow — otherwise the
          day header below can never stick and slides under the page chrome. */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
      >
        <div>
          {/* Day headers — sticky so the date stays visible while scrolling. */}
          <div className="sticky top-0 z-20 flex border-b border-line bg-surface/95 backdrop-blur-sm">
            <div
              className="shrink-0"
              style={{ width: AXIS_WIDTH }}
              aria-hidden="true"
            />
            {days.map((day) => {
              const key = toDateKey(day);
              const isToday = key === todayKey;
              const off = daysOff.includes(day.getDay());
              return (
                <div
                  key={key}
                  className={`${columnClass} border-l border-line px-2 py-2.5 text-center`}
                >
                  <p
                    className={`text-[10px] font-semibold uppercase tracking-wider ${
                      isToday ? "text-primary-dark" : "text-muted"
                    }`}
                  >
                    {day.toLocaleDateString("en-US", { weekday: "short" })}
                  </p>
                  <p
                    className={`mx-auto mt-1 grid h-8 w-8 place-items-center rounded-full text-sm font-semibold transition ${
                      isToday
                        ? "bg-foreground text-white shadow-sm"
                        : "text-foreground"
                    }`}
                  >
                    {day.getDate()}
                  </p>
                  {off && (
                    <p className="mt-0.5 text-[9px] font-medium uppercase tracking-wide text-muted">
                      Day off
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Time axis + day columns */}
          <div className="relative flex">
            <div
              className="relative shrink-0 border-r border-line bg-surface-2"
              style={{ width: AXIS_WIDTH, height: gridHeight }}
            >
              {hourMarks.map((minutes, index) => (
                <span
                  key={minutes}
                  className={`absolute right-2 tabular-nums ${
                    // Same fix as the day view: the first mark sits at the
                    // grid's top edge, so centering it would clip half the
                    // label under the sticky header above.
                    index === 0 ? "" : "-translate-y-1/2"
                  } ${
                    minutes % 60 === 0
                      ? "text-[10px] font-medium text-muted"
                      : "text-[9px] text-muted/60"
                  }`}
                  style={{
                    top: ((minutes - dayStart) / SLOT_MINUTES) * SLOT_HEIGHT,
                  }}
                >
                  {formatMinutes(minutes)}
                </span>
              ))}
            </div>

            {days.map((day) => {
              const key = toDateKey(day);
              const dayBookings = byDay.get(key) ?? [];
              const dayBlocks = blocksByDay.get(key) ?? [];
              const off = daysOff.includes(day.getDay());

              return (
                <div
                  key={key}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setHint({
                      dateKey: key,
                      minutes: minutesFromPointer(
                        event.clientY,
                        event.currentTarget
                      ),
                    });
                  }}
                  onDragLeave={() => setHint(null)}
                  onDrop={(event) => {
                    event.preventDefault();
                    const minutes = minutesFromPointer(
                      event.clientY,
                      event.currentTarget
                    );
                    setHint(null);
                    if (dragging) onMove(dragging, key, minutes);
                    setDragging(null);
                  }}
                  className={`group/col relative border-l border-line transition-colors ${columnClass} ${
                    off
                      ? "bg-foreground/[0.035]"
                      : key === todayKey
                      ? "bg-primary-50/50"
                      : "hover:bg-background/60"
                  }`}
                  style={{ height: gridHeight }}
                >
                  {cellMarks.map((minutes) => (
                    <div
                      key={minutes}
                      className={`pointer-events-none absolute inset-x-0 border-t ${
                        minutes % 60 === 0
                          ? "border-line"
                          : minutes % 30 === 0
                          ? "border-line/50"
                          : "border-line/20"
                      }`}
                      style={{
                        top:
                          ((minutes - dayStart) / SLOT_MINUTES) * SLOT_HEIGHT,
                      }}
                    />
                  ))}

                  {hint?.dateKey === key && (
                    <div
                      className="pointer-events-none absolute inset-x-1 z-10 rounded-lg border-2 border-dashed border-foreground/40 bg-foreground/[0.07]"
                      style={{
                        top:
                          ((hint.minutes - dayStart) / SLOT_MINUTES) *
                          SLOT_HEIGHT,
                        height:
                          ((dragging?.duration_minutes ?? 30) / SLOT_MINUTES) *
                          SLOT_HEIGHT,
                      }}
                    >
                      <span className="px-2 text-[11px] font-semibold">
                        {formatMinutes(hint.minutes)}
                      </span>
                    </div>
                  )}

                  {dayBlocks.map((block) => {
                    const top =
                      ((block.start_minutes - dayStart) / SLOT_MINUTES) *
                      SLOT_HEIGHT;
                    const height =
                      ((block.end_minutes - block.start_minutes) /
                        SLOT_MINUTES) *
                      SLOT_HEIGHT;
                    return (
                      <button
                        key={block.id}
                        onClick={() => onSelectBlock(block)}
                        title={
                          block.reason
                            ? `Blocked: ${block.reason}`
                            : "Blocked — click to remove"
                        }
                        className="absolute inset-x-1 z-[5] overflow-hidden rounded-lg border border-dashed border-foreground/25 bg-[repeating-linear-gradient(135deg,rgba(0,0,0,0.05)_0px,rgba(0,0,0,0.05)_6px,transparent_6px,transparent_12px)] px-2 py-1 text-left leading-tight text-foreground/60 transition hover:border-foreground/40 hover:bg-foreground/[0.06]"
                        style={{ top, height: Math.max(height, SLOT_HEIGHT) }}
                      >
                        <p className="truncate text-[11px] font-semibold">
                          Blocked
                        </p>
                        {block.reason && (
                          <p className="truncate text-[10px] opacity-80">
                            {block.reason}
                          </p>
                        )}
                      </button>
                    );
                  })}

                  {clusterByOverlap(dayBookings).map((cluster) => {
                    const top =
                      ((cluster.start - dayStart) / SLOT_MINUTES) * SLOT_HEIGHT;
                    const height =
                      ((cluster.end - cluster.start) / SLOT_MINUTES) *
                      SLOT_HEIGHT;
                    const count = cluster.items.length;
                    const front = cluster.items[0];

                    // A single appointment keeps the plain card, scaled to
                    // its actual duration (with a legible floor) — same
                    // look as the day view.
                    if (count === 1) {
                      const { booking, start } = front;
                      const cardHeight = Math.max(height, MIN_CARD_HEIGHT);
                      const roomy = cardHeight >= MIN_CARD_HEIGHT * 1.8;
                      const verRoomy = cardHeight >= MIN_CARD_HEIGHT * 3;
                      return (
                        <button
                          key={booking.id}
                          draggable
                          onDragStart={() => setDragging(booking)}
                          onDragEnd={() => {
                            setDragging(null);
                            setHint(null);
                          }}
                          onClick={() => onSelect(booking)}
                          title={`${booking.full_name} — ${booking.service_name} · ${booking.staff_name}${booking.mobile ? ` · ${booking.mobile}` : ""}${
                            booking.service_location === "home" && booking.address
                              ? ` · 🚗 ${booking.address}`
                              : ""
                          }`}
                          className={`absolute inset-x-1 z-[5] cursor-grab overflow-hidden rounded-md px-1.5 py-0.5 text-left leading-tight ring-1 ring-inset transition-all duration-200 hover:z-[20] hover:shadow-lg active:cursor-grabbing ${serviceColor(
                            booking.service_id
                          )} ${
                            booking.status === "cancelled"
                              ? "opacity-50 line-through"
                              : booking.status === "completed"
                              ? "opacity-60"
                              : booking.status === "pending"
                              ? "ring-2 ring-amber-400"
                              : ""
                          } ${
                            dragging?.id === booking.id ? "opacity-40" : ""
                          }`}
                          style={{ top, height: cardHeight }}
                        >
                          <p className="truncate text-[10px] font-medium tabular-nums opacity-70">
                            {formatMinutes(start)}
                            {booking.status === "completed" && (
                              <IconCheck
                                size={10}
                                className="ml-1 inline-block shrink-0 text-emerald-600 align-text-top"
                              />
                            )}
                          </p>
                          <p className="truncate text-xs font-bold">
                            {booking.service_location === "home" && (
                              <span title="Home service">🚗 </span>
                            )}
                            {booking.full_name}
                          </p>
                          {/* Longer bookings earn a little more detail —
                              everything else stays in the title tooltip. */}
                          {roomy && (
                            <p className="truncate text-[11px] opacity-75">
                              {booking.service_name}
                            </p>
                          )}
                          {verRoomy && (
                            <p className="truncate text-[10px] opacity-60">
                              {booking.staff_name}
                            </p>
                          )}
                        </button>
                      );
                    }

                    // Overlapping: draw the others as offset layers peeking
                    // out behind the front card, then a count badge on top —
                    // scaled to the overlap's combined span like a single
                    // card, with the same legible floor.
                    const clusterHeight = Math.max(height, MIN_CARD_HEIGHT);
                    const peeks = cluster.items.slice(1, 4);

                    return (
                      <div
                        key={`cluster-${key}-${cluster.start}`}
                        className="absolute inset-x-1"
                        style={{ top, height: clusterHeight }}
                      >
                        {peeks.map((peek, index) => (
                          <div
                            key={peek.booking.id}
                            aria-hidden="true"
                            className={`pointer-events-none absolute rounded-md ring-1 ring-inset shadow-sm ${serviceColor(
                              peek.booking.service_id
                            )}`}
                            style={{
                              inset: 0,
                              transform: `translate(${(index + 1) * 4}px, ${
                                (index + 1) * -3
                              }px)`,
                              zIndex: peeks.length - index,
                            }}
                          />
                        ))}

                        <button
                          onClick={() =>
                            onSelectGroup(
                              cluster.items.map((item) => item.booking),
                              cluster.start
                            )
                          }
                          title={`${count} appointments overlap here — click to see all`}
                          className={`absolute inset-0 z-10 overflow-hidden rounded-md px-1.5 py-0.5 text-left leading-tight ring-1 ring-inset shadow-sm transition-all duration-200 hover:z-[20] hover:shadow-lg ${serviceColor(
                            front.booking.service_id
                          )}`}
                        >
                          <p className="truncate pr-4 text-[10px] font-medium tabular-nums opacity-70">
                            {formatMinutes(cluster.start)}
                          </p>
                          <p className="truncate pr-4 text-xs font-bold">
                            {front.booking.full_name}
                          </p>
                          {clusterHeight >= MIN_CARD_HEIGHT * 1.8 && (
                            <p className="truncate pr-4 text-[11px] opacity-75">
                              +{count - 1} more booking
                              {count - 1 === 1 ? "" : "s"}
                            </p>
                          )}

                          <span className="absolute right-1 top-1/2 grid h-[16px] min-w-[16px] -translate-y-1/2 place-items-center rounded-full bg-foreground px-1 text-[9px] font-bold text-white shadow-sm">
                            {count}
                          </span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
