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
// A fixed, comfortably-readable row height rather than one shrunk to force
// the whole day into the viewport without scrolling — that made every
// appointment under ~45 minutes render too thin to read its own name. A
// busy 12-hour day now scrolls vertically (the staff header stays pinned),
// same as Google Calendar or Fresha; every card stays legible regardless of
// how long the day is. Slightly taller on tablet/desktop, where there's
// room to spare, than on a phone.
const SLOT_HEIGHT_DESKTOP = 48;
const SLOT_HEIGHT_MOBILE = 20;
const AXIS_WIDTH = 64;

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

  // All columns use the same consistent width for uniform booking visibility.
  // This ensures kanban cards show all details regardless of staff selection.
  // Fixed width allows for horizontal scroll when needed with multiple staff.
  const columnClass = "w-[16rem] shrink-0";
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
        <div className="min-w-max">
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
                  className={`${columnClass} flex flex-col items-center gap-1.5 px-2 py-3`}
                >
                  <Avatar name={member.name} src={member.avatar_url} size={38} />
                  <div className="min-w-0 w-full text-center leading-tight">
                    <p className="truncate text-[13px] font-medium">
                      {member.name}
                    </p>
                    {/* Role wraps onto a second line instead of truncating —
                        a long title like "Massage Therapist Expert &
                        Beautician" otherwise reads as clipped garbage on a
                        tablet-width column, or bleeds into the next one. */}
                    <p className="line-clamp-2 break-words text-[11px] text-muted">
                      {off ? "Day off" : member.role}
                    </p>
                  </div>
                </div>
              );
            })}
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
              const workStart = parseTimeToMinutes(member.work_start);
              const workEnd = parseTimeToMinutes(member.work_end);

              return (
                <div
                  key={member.id}
                  onDragOver={(event) => {
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
                  onDoubleClick={(event) =>
                    onCreate(
                      dateKey,
                      minutesFromPointer(event.clientY, event.currentTarget),
                      member.id
                    )
                  }
                  title="Double-click an empty slot to add a booking"
                  className={`relative border-l border-line ${columnClass} ${
                    off ? "bg-foreground/[0.035]" : ""
                  }`}
                  style={{ height: gridHeight }}
                >
                  {/* Hour and half-hour lines — the half-hour line is fainter
                      so the grid still reads as hour-by-hour at a glance. */}
                  {hourMarks.map((minutes) => (
                    <div
                      key={minutes}
                      className={`pointer-events-none absolute inset-x-0 border-t ${
                        minutes % 60 === 0 ? "border-line" : "border-line/50"
                      }`}
                      style={{
                        top:
                          ((minutes - dayStart) / SLOT_MINUTES) * slotHeight,
                      }}
                    />
                  ))}

                  {/* Outside this person's shift */}
                  {!off && workStart !== null && workStart > dayStart && (
                    <div
                      className="pointer-events-none absolute inset-x-0 top-0 bg-foreground/[0.045]"
                      style={{
                        height:
                          ((workStart - dayStart) / SLOT_MINUTES) * slotHeight,
                      }}
                    />
                  )}
                  {!off && workEnd !== null && workEnd < dayEnd && (
                    <div
                      className="pointer-events-none absolute inset-x-0 bg-foreground/[0.045]"
                      style={{
                        top: ((workEnd - dayStart) / SLOT_MINUTES) * slotHeight,
                        height:
                          ((dayEnd - workEnd) / SLOT_MINUTES) * slotHeight,
                      }}
                    />
                  )}

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
                    const roomy = height >= slotHeight * 2.5;
                    const verRoomy = height >= slotHeight * 4;

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
                        title={`${booking.full_name} — ${booking.service_name}${booking.mobile ? ` · ${booking.mobile}` : ""}`}
                        className={`absolute inset-x-1 z-[5] cursor-grab overflow-hidden rounded-md px-1.5 py-1 text-left leading-tight ring-1 ring-inset transition-all duration-200 hover:z-[20] hover:shadow-lg active:cursor-grabbing ${serviceColor(
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
                        style={{ top, height: Math.max(height, slotHeight * 3) }}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <p className="flex flex-1 items-center gap-1 text-xs font-medium tabular-nums opacity-70">
                            <span>{formatMinutes(start)}–{formatMinutes(end)}</span>
                            {booking.status === "pending" && (
                              <span className="rounded-full bg-amber-400 px-1 text-[9px] font-bold text-amber-950">
                                NEW
                              </span>
                            )}
                          </p>
                          {booking.status === "completed" && (
                            <IconCheck size={16} className="shrink-0 text-emerald-600" />
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          {booking.is_paid && (
                            <span
                              title="Paid"
                              className="h-2 w-2 rounded-full bg-emerald-500"
                            />
                          )}
                          {booking.service_location === "home" && (
                            <span
                              title="Home service"
                              className="h-2 w-2 rounded-full bg-blue-500"
                            />
                          )}
                        </div>
                        <p className="truncate text-sm font-bold">
                          {booking.full_name}
                        </p>
                        <p className="truncate text-xs opacity-75">
                          {booking.service_name}
                        </p>
                        {roomy && booking.mobile && (
                          <p className="truncate text-[11px] opacity-65">
                            {booking.mobile}
                          </p>
                        )}
                        {verRoomy && booking.notes && (
                          <p className="line-clamp-2 text-xs opacity-60 italic">
                            {booking.notes}
                          </p>
                        )}
                      </button>
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
