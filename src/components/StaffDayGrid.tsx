"use client";

import { useMemo, useState } from "react";
import Avatar from "./Avatar";
import { IconCheck } from "./Icons";
import { formatMinutes, parseTimeToMinutes, toDateKey } from "@/lib/format";
import { isStaffOffOn } from "@/lib/staff";
import { useMediaQuery } from "@/lib/useMediaQuery";
import type { Booking, Staff, StaffBlock, StaffTimeOff } from "@/lib/types";

const SLOT_MINUTES = 15;
const SNAP_MINUTES = 15;
// Compact row height so a busy afternoon (e.g. 7pm–10pm) fits the viewport
// without vertical scrolling, while a full 12-hour day still scrolls past
// that point — the staff header stays pinned while it does. Booking cards
// are trimmed down to just time + name (see the button below) so they stay
// legible even at this shorter row height.
const SLOT_HEIGHT_DESKTOP = 26;
const SLOT_HEIGHT_MOBILE = 14;
// Cards scale with the appointment's actual duration, but never render
// shorter than this — a 15-minute booking still shows its time and name
// on two clean lines instead of being squeezed illegible.
const MIN_CARD_HEIGHT = 30;
const AXIS_WIDTH = 56;

/**
 * Fresha-style pastel fills — a solid tint per service rather than a bar with
 * a coloured edge, so a dense day still reads at a glance.
 */
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

export default function StaffDayGrid({
  date,
  staff,
  bookings,
  blocks,
  timeOff,
  dayStart,
  dayEnd,
  onMove,
  onSelect,
  onCreate,
  onSelectBlock,
}: {
  date: Date;
  staff: Staff[];
  bookings: Booking[];
  blocks: StaffBlock[];
  timeOff: StaffTimeOff[];
  dayStart: number;
  dayEnd: number;
  onMove: (
    booking: Booking,
    dateKey: string,
    startMinutes: number,
    staffId: string,
    staffName: string
  ) => void;
  onSelect: (booking: Booking) => void;
  onCreate: (dateKey: string, startMinutes: number, staffId: string) => void;
  onSelectBlock: (block: StaffBlock) => void;
}) {
  const [dragging, setDragging] = useState<Booking | null>(null);
  const [hint, setHint] = useState<{
    staffId: string;
    minutes: number;
  } | null>(null);

  const dateKey = toDateKey(date);
  const rows = Math.max(1, Math.ceil((dayEnd - dayStart) / SLOT_MINUTES));

  const isTablet = useMediaQuery("(min-width: 640px)");
  const slotHeight = isTablet ? SLOT_HEIGHT_DESKTOP : SLOT_HEIGHT_MOBILE;
  const gridHeight = rows * slotHeight;

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

  // Every 15-minute row gets its own faint line — an empty column then reads
  // as a plain ruled grid, like a spreadsheet, rather than blank whitespace.
  const cellMarks = useMemo(() => {
    const marks: number[] = [];
    for (let minutes = dayStart; minutes <= dayEnd; minutes += SLOT_MINUTES) {
      marks.push(minutes);
    }
    return marks;
  }, [dayStart, dayEnd]);

  const byStaff = useMemo(() => {
    const map = new Map<string, Booking[]>();
    for (const booking of bookings) {
      if (booking.booking_date !== dateKey) continue;
      const list = map.get(booking.staff_id) ?? [];
      list.push(booking);
      map.set(booking.staff_id, list);
    }
    return map;
  }, [bookings, dateKey]);

  const blocksByStaff = useMemo(() => {
    const map = new Map<string, StaffBlock[]>();
    for (const block of blocks) {
      if (block.block_date !== dateKey) continue;
      // Shop-wide breaks carry no staff id — show them in every column.
      const key = block.staff_id || "__all";
      const list = map.get(key) ?? [];
      list.push(block);
      map.set(key, list);
    }
    return map;
  }, [blocks, dateKey]);

  function minutesFromPointer(clientY: number, element: HTMLElement) {
    const rect = element.getBoundingClientRect();
    const raw = dayStart + ((clientY - rect.top) / slotHeight) * SLOT_MINUTES;
    const snapped = Math.round(raw / SNAP_MINUTES) * SNAP_MINUTES;
    return Math.min(Math.max(snapped, dayStart), dayEnd - SNAP_MINUTES);
  }

  if (staff.length === 0) {
    return (
      <div className="card px-6 py-14 text-center text-sm text-muted">
        No active staff to show. Add team members on the Staff page.
      </div>
    );
  }

  // Columns grow to fill the available width (so 10 or fewer staff always
  // fill the screen edge-to-edge with no dead space) but never shrink past
  // a legible minimum — once more than ~10 columns would need to fit, that
  // minimum kicks in and the grid scrolls right instead of squeezing further.
  const columnClass = "min-w-[92px] max-w-[160px] flex-1";
  // Center single staff column for better use of space
  const isSingleStaff = staff.length === 1;

  return (
    <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Sized by the flex parent so it uses whatever room the page gives
          it, but rows keep a fixed, readable height (see slotHeight above)
          — a long day scrolls vertically rather than squeezing every card
          down to illegibility. The staff header stays pinned while it
          scrolls, in both directions. */}
      <div className="min-h-0 flex-1 overflow-auto">
        {/* No min-w-max here — the row fills the available width (letting
            flex-1 columns grow to use it) when there's room, and only
            overflows into horizontal scroll once the columns' own minimum
            widths need more space than that. */}
        <div>
          {/* Staff header: avatar over name, like Fresha */}
          <div className="sticky top-0 z-20 flex border-b border-line bg-surface">
            {/* Pinned left so the corner stays opaque while columns scroll. */}
            <div
              className="sticky left-0 z-10 shrink-0 border-r border-line bg-surface"
              style={{ width: AXIS_WIDTH }}
              aria-hidden="true"
            />
            {staff.map((member) => {
              const off = isStaffOffOn(member, dateKey, timeOff);
              return (
                <div
                  key={member.id}
                  className={`${columnClass} flex flex-col items-center gap-1 px-1.5 py-2`}
                >
                  <Avatar name={member.name} src={member.avatar_url} size={28} />
                  <div className="min-w-0 w-full text-center leading-tight">
                    <p className="truncate text-[12px] font-medium">
                      {member.name}
                    </p>
                    {/* Single line only — narrower columns don't have room
                        for a second, and the full role is still a title
                        attribute away via the avatar/name above. */}
                    <p className="truncate text-[10px] text-muted">
                      {off ? "Day off" : member.role}
                    </p>
                  </div>
                </div>
              );
            })}
            {/* Blank filler so the ruled grid below still extends the full
                width even past the last staff member, instead of leaving
                bare whitespace to the right on a wide screen. */}
            <div className="min-w-0 flex-1" aria-hidden="true" />
          </div>

          {/* Time axis + one column per staff member */}
          <div className="flex">
            {/* Pinned left so the hour labels survive horizontal scrolling —
                on a phone the staff columns always overflow. */}
            <div
              className="sticky left-0 z-10 shrink-0 border-r border-line bg-surface-2"
              style={{ width: AXIS_WIDTH, height: gridHeight }}
            >
              {hourMarks.map((minutes, index) => (
                <span
                  key={minutes}
                  className={`absolute right-2 tabular-nums ${
                    // The first mark sits flush with the grid's top edge —
                    // centering it would push half the label above the
                    // boundary, under the sticky header, and clip it.
                    index === 0 ? "" : "-translate-y-1/2"
                  } ${
                    // On the hour reads bold and dark; the half-hour between
                    // is a lighter, smaller label so the axis doesn't turn
                    // into a wall of equally-loud text.
                    minutes % 60 === 0
                      ? "text-[11px] font-medium text-muted"
                      : "text-[10px] text-muted/60"
                  }`}
                  style={{
                    top: ((minutes - dayStart) / SLOT_MINUTES) * slotHeight,
                  }}
                >
                  {formatMinutes(minutes)}
                </span>
              ))}
            </div>

            {staff.map((member) => {
              const memberBookings = byStaff.get(member.id) ?? [];
              const memberBlocks = [
                ...(blocksByStaff.get(member.id) ?? []),
                ...(blocksByStaff.get("__all") ?? []),
              ];
              const off = isStaffOffOn(member, dateKey, timeOff);

              return (
                <div
                  key={member.id}
                  onDragOver={(event) => {
                    // A staff member who's off can't take a dropped
                    // appointment either — no hint, no drop.
                    if (off) return;
                    event.preventDefault();
                    setHint({
                      staffId: member.id,
                      minutes: minutesFromPointer(
                        event.clientY,
                        event.currentTarget
                      ),
                    });
                  }}
                  onDragLeave={() => setHint(null)}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (off) {
                      setDragging(null);
                      return;
                    }
                    const minutes = minutesFromPointer(
                      event.clientY,
                      event.currentTarget
                    );
                    setHint(null);
                    if (dragging) {
                      onMove(dragging, dateKey, minutes, member.id, member.name);
                    }
                    setDragging(null);
                  }}
                  onDoubleClick={(event) => {
                    // Can't book someone in who isn't working that day.
                    if (off) return;
                    onCreate(
                      dateKey,
                      minutesFromPointer(event.clientY, event.currentTarget),
                      member.id
                    );
                  }}
                  title={
                    off
                      ? `${member.name} is off — pick another staff member to book`
                      : "Double-click an empty slot to add a booking"
                  }
                  className={`relative border-l border-line ${columnClass} ${
                    off ? "cursor-not-allowed bg-foreground/[0.035]" : ""
                  }`}
                  style={{ height: gridHeight }}
                >
                  {/* Every 15-minute cell gets a ruled line — an empty
                      column then reads as a plain spreadsheet grid rather
                      than blank whitespace. Hour lines are darkest,
                      half-hour lines medium, and the quarter lines in
                      between are faintest. */}
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
                          ((minutes - dayStart) / SLOT_MINUTES) * slotHeight,
                      }}
                    />
                  ))}

                  {hint?.staffId === member.id && (
                    <div
                      className="pointer-events-none absolute inset-x-1 z-10 rounded-lg border-2 border-dashed border-foreground/40 bg-foreground/[0.07]"
                      style={{
                        top:
                          ((hint.minutes - dayStart) / SLOT_MINUTES) *
                          slotHeight,
                        height:
                          ((dragging?.duration_minutes ?? 30) / SLOT_MINUTES) *
                          slotHeight,
                      }}
                    >
                      <span className="px-2 text-[11px] font-semibold">
                        {formatMinutes(hint.minutes)}
                      </span>
                    </div>
                  )}

                  {memberBlocks.map((block) => {
                    const top =
                      ((block.start_minutes - dayStart) / SLOT_MINUTES) *
                      slotHeight;
                    const height =
                      ((block.end_minutes - block.start_minutes) /
                        SLOT_MINUTES) *
                      slotHeight;
                    return (
                      <button
                        key={`${member.id}-${block.id}`}
                        onClick={() => onSelectBlock(block)}
                        title={
                          block.reason
                            ? `Blocked: ${block.reason}`
                            : "Blocked — click to remove"
                        }
                        className="absolute inset-x-1 z-[5] overflow-hidden rounded-lg border border-dashed border-foreground/25 bg-[repeating-linear-gradient(135deg,rgba(0,0,0,0.05)_0px,rgba(0,0,0,0.05)_6px,transparent_6px,transparent_12px)] px-2 py-1 text-left leading-tight text-foreground/60 transition hover:border-foreground/40"
                        style={{ top, height: Math.max(height, slotHeight) }}
                      >
                        <p className="truncate text-[11px] font-semibold">
                          {block.reason || "Blocked"}
                        </p>
                      </button>
                    );
                  })}

                  {memberBookings.map((booking) => {
                    const start = parseTimeToMinutes(booking.booking_time);
                    if (start === null) return null;
                    const end = start + booking.duration_minutes;
                    const top =
                      ((start - dayStart) / SLOT_MINUTES) * slotHeight;
                    const height =
                      (booking.duration_minutes / SLOT_MINUTES) * slotHeight;
                    const cardHeight = Math.max(height, MIN_CARD_HEIGHT);
                    // Extra detail only shows up once the card is tall
                    // enough to hold it without crowding the time + name.
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
                        title={`${booking.full_name} — ${booking.service_name}${booking.mobile ? ` · ${booking.mobile}` : ""}${
                          booking.service_location === "home" && booking.address
                            ? ` · 🚗 ${booking.address}`
                            : ""
                        }`}
                        className={`absolute inset-x-1 z-[5] cursor-grab overflow-hidden rounded-md px-1.5 py-0.5 text-left leading-tight ring-1 ring-inset transition-all duration-200 hover:z-[20] hover:shadow-lg active:cursor-grabbing ${serviceColor(
                          booking.service_id
                        )} ${
                          booking.status === "cancelled"
                            ? "opacity-50 line-through"
                            : ""
                        } ${
                          booking.status === "completed"
                            ? "opacity-60"
                            : ""
                        } ${
                          booking.status === "pending"
                            ? "ring-2 ring-amber-400"
                            : ""
                        } ${dragging?.id === booking.id ? "opacity-40" : ""}`}
                        style={{ top, height: cardHeight }}
                      >
                        <p className="truncate text-[10px] font-medium tabular-nums opacity-70">
                          {formatMinutes(start)}–{formatMinutes(end)}
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
                        {verRoomy &&
                          (booking.service_location === "home" && booking.address
                            ? (
                              <p className="truncate text-[10px] opacity-60">
                                {booking.address}
                              </p>
                            )
                            : booking.mobile && (
                              <p className="truncate text-[10px] opacity-60">
                                {booking.mobile}
                              </p>
                            ))}
                      </button>
                    );
                  })}
                </div>
              );
            })}

            {/* Same blank filler as the header, ruled with the same grid so
                the empty stretch past the last staff member still reads as
                part of the sheet rather than dead whitespace. */}
            <div
              className="relative min-w-0 flex-1 border-l border-line"
              style={{ height: gridHeight }}
              aria-hidden="true"
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
                    top: ((minutes - dayStart) / SLOT_MINUTES) * slotHeight,
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
