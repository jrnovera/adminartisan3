"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import StatusBadge from "@/components/StatusBadge";
import WeekTimeGrid from "@/components/WeekTimeGrid";
import StaffDayGrid from "@/components/StaffDayGrid";
import BookingDrawer from "@/components/BookingDrawer";
import NewBookingModal from "@/components/NewBookingModal";
import BlockTimeModal from "@/components/BlockTimeModal";
import Modal from "@/components/Modal";
import { rescheduleBooking } from "@/lib/bookings";
import { fetchBlocks, deleteBlock } from "@/lib/blocks";
import {
  addDays,
  formatDateLong,
  formatMinutes,
  parseTimeToMinutes,
  startOfWeek,
  toDateKey,
} from "@/lib/format";
import { fetchStaff, fetchTimeOff, isStaffOffOn } from "@/lib/staff";
import { useShop } from "@/lib/shop";
import { useAuth } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { useBookings } from "@/lib/useBookings";
import { useVisibleDayCount } from "@/lib/useMediaQuery";
import { useToast } from "@/components/Toast";
import {
  IconBan,
  IconCalendar,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconCollapse,
  IconExpand,
  IconInfo,
  IconPlus,
} from "@/components/Icons";
import type { Booking, Staff, StaffBlock, StaffTimeOff } from "@/lib/types";

const ALL = "__all";
const UNASSIGNED = "__unassigned";

export default function CalendarPage() {
  const { bookings, loading, error, reload } = useBookings();
  const { settings } = useShop();
  const toast = useToast();
  const { session, isAdminOrAbove } = useAuth();
  const actor = session?.user.email ?? null;
  const dayCount = useVisibleDayCount();

  // Only admin and superadmin can edit the calendar
  const canEdit = isAdminOrAbove;
  const [staff, setStaff] = useState<Staff[]>([]);
  const [timeOff, setTimeOff] = useState<StaffTimeOff[]>([]);
  const [blocks, setBlocks] = useState<StaffBlock[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<string>(ALL);
  const [locationFilter, setLocationFilter] = useState<
    "all" | "salon" | "home"
  >("all");
  const [cursor, setCursor] = useState(() => new Date());
  const [view, setView] = useState<"day" | "week">("day");
  // Takes the grid over the whole browser viewport — the sidebar, topbar,
  // and page padding all disappear behind it — for when the admin wants
  // the maximum room to see a busy day at a glance.
  const [fullscreen, setFullscreen] = useState(false);
  const [hideHeader, setHideHeader] = useState(false);
  const [showHelpTip, setShowHelpTip] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const helpRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!fullscreen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setFullscreen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [fullscreen]);

  useEffect(() => {
    const mainElement = mainRef.current;
    if (!mainElement) return;

    let prevScrollY = 0;
    const handleScroll = () => {
      const scrollY = mainElement.scrollTop;
      // Hide when scrolling down (scrollY > prevScrollY)
      setHideHeader(scrollY > prevScrollY && scrollY > 50);
      prevScrollY = scrollY;
    };

    mainElement.addEventListener("scroll", handleScroll);
    return () => mainElement.removeEventListener("scroll", handleScroll);
  }, []);

  // Close help tooltip on escape or click outside
  useEffect(() => {
    if (!showHelpTip) return;

    function handleClickOutside(event: MouseEvent) {
      if (helpRef.current && !helpRef.current.contains(event.target as Node)) {
        setShowHelpTip(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setShowHelpTip(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showHelpTip]);

  const [moveError, setMoveError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Booking | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<StaffBlock | null>(null);
  const [overlap, setOverlap] = useState<{
    bookings: Booking[];
    startMinutes: number;
  } | null>(null);
  const [moveConfirm, setMoveConfirm] = useState<{
    booking: Booking;
    dateKey: string;
    startMinutes: number;
    staffId?: string;
    staffName?: string;
  } | null>(null);
  const [creating, setCreating] = useState<{
    dateKey: string;
    minutes: number;
    staffId?: string;
  } | null>(null);
  const [blocking, setBlocking] = useState<{
    dateKey: string;
    minutes: number;
  } | null>(null);
  const [pending, setPending] = useState<Record<string, Partial<Booking>>>({});

  const reloadBlocks = useCallback(() => {
    fetchBlocks().then(setBlocks, () => {});
  }, []);

  useEffect(() => {
    Promise.all([fetchStaff(), fetchTimeOff()]).then(
      ([staffRows, timeOffRows]) => {
        setStaff(staffRows);
        setTimeOff(timeOffRows);
      },
      () => {}
    );
    reloadBlocks();
  }, [reloadBlocks]);

  // A full week has room on a desktop; narrower screens show three days or a
  // single day anchored on the cursor rather than squeezing seven columns.
  const weekDays = useMemo(() => {
    const start = dayCount === 7 ? startOfWeek(cursor) : cursor;
    return Array.from({ length: dayCount }, (_, index) => addDays(start, index));
  }, [cursor, dayCount]);

  // Bookings carry free-text staff ids from the public site; resolve them onto
  // real staff rows by id, then by name, so filtering lines up.
  const resolved = useMemo(() => {
    const byId = new Map(staff.map((member) => [member.id, member]));
    const byName = new Map(
      staff.map((member) => [member.name.toLowerCase(), member])
    );

    return bookings.map((booking) => {
      const patch = pending[booking.id];
      const merged = patch ? { ...booking, ...patch } : booking;
      const match =
        byId.get(merged.staff_id) ?? byName.get(merged.staff_name.toLowerCase());
      return { ...merged, staff_id: match ? match.id : UNASSIGNED };
    });
  }, [bookings, staff, pending]);

  const activeStaff = useMemo(
    () => staff.filter((member) => member.active),
    [staff]
  );

  const currentStaff = useMemo(
    () => activeStaff.find((member) => member.id === selectedStaff) ?? null,
    [activeStaff, selectedStaff]
  );

  const weekKeys = useMemo(() => weekDays.map(toDateKey), [weekDays]);

  // Bookings made before home service existed have no value stored, and those
  // were all in-salon.
  const matchesLocation = useCallback(
    (booking: Booking) =>
      locationFilter === "all" ||
      (booking.service_location ?? "salon") === locationFilter,
    [locationFilter]
  );

  const visible = useMemo(
    () =>
      resolved.filter((booking) => {
        if (!weekKeys.includes(booking.booking_date)) return false;
        if (!matchesLocation(booking)) return false;
        if (selectedStaff === ALL) return true;
        return booking.staff_id === selectedStaff;
      }),
    [resolved, weekKeys, selectedStaff, matchesLocation]
  );

  // The day view gets the unwindowed list, so it needs the filter applied too.
  const dayVisible = useMemo(
    () => resolved.filter(matchesLocation),
    [resolved, matchesLocation]
  );

  const visibleBlocks = useMemo(
    () =>
      blocks.filter((block) => {
        if (!weekKeys.includes(block.block_date)) return false;
        if (selectedStaff === ALL) return true;
        return block.staff_id === selectedStaff;
      }),
    [blocks, weekKeys, selectedStaff]
  );

  // The grid spans the shop's opening hours, widened if any staff member
  // works outside them.
  const { dayStart, dayEnd } = useMemo(() => {
    const pool = currentStaff ? [currentStaff] : activeStaff;
    const starts = pool
      .map((member) => parseTimeToMinutes(member.work_start))
      .filter((value): value is number => value !== null);
    const ends = pool
      .map((member) => parseTimeToMinutes(member.work_end))
      .filter((value): value is number => value !== null);

    if (typeof settings?.open_minutes === "number") {
      starts.push(settings.open_minutes);
    }
    if (typeof settings?.close_minutes === "number") {
      ends.push(settings.close_minutes);
    }

    // Always run the grid through to midnight, even if every staff member's
    // shift and the shop's posted hours end earlier — late walk-ins and
    // manually-added evening bookings still need somewhere to land.
    const computedEnd = ends.length ? Math.max(...ends) : 18 * 60;
    return {
      dayStart: starts.length ? Math.min(...starts) : 9 * 60,
      dayEnd: Math.max(computedEnd, 24 * 60),
    };
  }, [currentStaff, activeStaff, settings]);

  // The shop-wide break shows on every day of the week as a blocked band.
  const breakBlocks = useMemo(() => {
    if (
      typeof settings?.break_start_minutes !== "number" ||
      typeof settings?.break_end_minutes !== "number"
    ) {
      return [];
    }
    return weekKeys.map((dateKey) => ({
      id: `break-${dateKey}`,
      created_at: "",
      staff_id: selectedStaff === ALL ? "" : selectedStaff,
      block_date: dateKey,
      start_minutes: settings.break_start_minutes as number,
      end_minutes: settings.break_end_minutes as number,
      reason: "Shop break",
    }));
  }, [settings, weekKeys, selectedStaff]);

  // Grey out the selected member's weekly days off and any booked time off.
  const daysOff = useMemo(() => {
    if (!currentStaff) return [];
    const weekly = [...currentStaff.days_off];
    for (const day of weekDays) {
      if (isStaffOffOn(currentStaff, toDateKey(day), timeOff)) {
        weekly.push(day.getDay());
      }
    }
    return weekly;
  }, [currentStaff, weekDays, timeOff]);

  const applyMove = useCallback(
    async (booking: Booking, changes: Partial<Booking>) => {
      setMoveError(null);
      setPending((current) => ({ ...current, [booking.id]: changes }));
      try {
        await rescheduleBooking(booking.id, changes);
        reload();
        const toDate = changes.booking_date ?? booking.booking_date;
        const toTime = changes.booking_time ?? booking.booking_time;
        const reassigned =
          changes.staff_name && changes.staff_name !== booking.staff_name;
        toast.success(
          "Appointment rescheduled",
          `${booking.full_name} · ${formatDateLong(toDate)} at ${toTime}`
        );
        logActivity({
          actor,
          entity: "booking",
          entity_id: booking.id,
          action: reassigned ? "reassigned" : "rescheduled",
          summary: reassigned
            ? `Moved ${booking.full_name} to ${changes.staff_name}`
            : `Rescheduled ${booking.full_name}`,
          detail: `${formatDateLong(booking.booking_date)} ${
            booking.booking_time
          } → ${formatDateLong(toDate)} ${toTime}${
            reassigned ? ` · ${booking.staff_name} → ${changes.staff_name}` : ""
          }`,
        });
      } catch (err) {
        setPending((current) => {
          const next = { ...current };
          delete next[booking.id];
          return next;
        });
        const message =
          err instanceof Error ? err.message : "Could not move appointment";
        setMoveError(message);
        toast.error("Reschedule failed", message);
      }
    },
    [reload, toast, actor]
  );

  // Dragging only proposes a move; nothing is written until the admin
  // confirms it in a dialog that spells out the change and any clashes.
  const handleMove = useCallback(
    (booking: Booking, dateKey: string, startMinutes: number) => {
      const nextTime = formatMinutes(startMinutes);
      if (dateKey === booking.booking_date && nextTime === booking.booking_time) {
        return;
      }
      setMoveError(null);
      setMoveConfirm({ booking, dateKey, startMinutes });
    },
    []
  );

  // Day view adds a second axis: dragging sideways reassigns the appointment
  // to another team member, so the confirm dialog has to spell that out too.
  const handleStaffMove = useCallback(
    (
      booking: Booking,
      dateKey: string,
      startMinutes: number,
      staffId: string,
      staffName: string
    ) => {
      const nextTime = formatMinutes(startMinutes);
      const sameSlot =
        dateKey === booking.booking_date && nextTime === booking.booking_time;
      if (sameSlot && staffId === booking.staff_id) return;
      setMoveError(null);
      setMoveConfirm({ booking, dateKey, startMinutes, staffId, staffName });
    },
    []
  );

  // Wrap handlers with permission checks
  const permittedHandleMove = useCallback(
    (booking: Booking, dateKey: string, startMinutes: number) => {
      if (!canEdit) {
        toast.error(
          "Permission denied",
          "Only admins can reschedule appointments"
        );
        return;
      }
      handleMove(booking, dateKey, startMinutes);
    },
    [canEdit, handleMove, toast]
  );

  const permittedHandleStaffMove = useCallback(
    (
      booking: Booking,
      dateKey: string,
      startMinutes: number,
      staffId: string,
      staffName: string
    ) => {
      if (!canEdit) {
        toast.error(
          "Permission denied",
          "Only admins can reassign appointments"
        );
        return;
      }
      handleStaffMove(booking, dateKey, startMinutes, staffId, staffName);
    },
    [canEdit, handleStaffMove, toast]
  );

  const permittedHandleCreate = useCallback(
    (dateKey: string, minutes: number, staffId?: string) => {
      if (!canEdit) {
        toast.error(
          "Permission denied",
          "Only admins can create appointments"
        );
        return;
      }
      setCreating({ dateKey, minutes, staffId });
    },
    [canEdit, toast]
  );

  // Day view steps a day at a time; week view by the span on screen.
  const step = view === "day" ? 1 : dayCount;

  // In day view the columns are people, so the picker narrows which people
  // are shown rather than which bookings.
  const dayViewStaff = useMemo(
    () =>
      selectedStaff === ALL
        ? activeStaff
        : activeStaff.filter((member) => member.id === selectedStaff),
    [activeStaff, selectedStaff]
  );

  return (
    <div
      className={
        fullscreen
          ? "fixed inset-0 z-50 flex flex-col overflow-hidden bg-background"
          : // Fills the shell column exactly — the grid below is flex-sized
            // against this, so nothing overflows and the page never gets a
            // stray scrollbar to fight with.
            "flex min-h-0 flex-1 flex-col overflow-hidden"
      }
    >
      <div className={`border-b border-line bg-surface px-4 py-3 transition-all duration-300 sm:px-6 ${hideHeader ? "-translate-y-full" : ""}`}>
        <div className="flex flex-wrap items-center gap-2">
          {/* Primary action leads on mobile so it's reachable without
              scrolling the toolbar; falls back to trailing on larger
              screens where everything already fits. */}
          <button
            onClick={() =>
              setCreating({ dateKey: toDateKey(cursor), minutes: dayStart })
            }
            disabled={!canEdit}
            title={!canEdit ? "Only admins can create appointments" : "New appointment"}
            aria-label="New appointment"
            className="btn-primary order-first grid h-9 w-9 shrink-0 place-items-center rounded-xl hover:btn-primary-hover disabled:opacity-60 sm:order-none"
          >
            <IconPlus size={16} />
          </button>

          {/* Segmented prev / today / next, stepping by the visible span */}
          <div className="flex shrink-0 items-center rounded-xl border border-line bg-surface p-0.5 shadow-[var(--shadow-xs)]">
            <button
              onClick={() => setCursor((date) => addDays(date, -step))}
              aria-label="Previous"
              className="grid h-8 w-8 place-items-center rounded-lg text-muted transition hover:bg-background hover:text-foreground"
            >
              <IconChevronLeft size={16} />
            </button>
            <button
              onClick={() => setCursor(new Date())}
              aria-label="Jump to today"
              title="Today"
              className="grid h-8 w-8 place-items-center rounded-lg text-muted transition hover:bg-background hover:text-foreground"
            >
              <IconCalendar size={16} />
            </button>
            <button
              onClick={() => setCursor((date) => addDays(date, step))}
              aria-label="Next"
              className="grid h-8 w-8 place-items-center rounded-lg text-muted transition hover:bg-background hover:text-foreground"
            >
              <IconChevronRight size={16} />
            </button>
          </div>

          {/* Home visits need travel time between them, so seeing them on
              their own is how you spot an impossible run of appointments. */}
          <div className="flex shrink-0 gap-1.5">
            {(["all", "salon", "home"] as const).map((option) => (
              <button
                key={option}
                onClick={() => setLocationFilter(option)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-150 ${
                  locationFilter === option
                    ? "bg-foreground text-white shadow-sm"
                    : "border border-line text-foreground/70 hover:bg-background"
                }`}
              >
                {option === "all"
                  ? "Everywhere"
                  : option === "salon"
                  ? "In salon"
                  : "Home service"}
              </button>
            ))}
          </div>

          <input
            type="date"
            aria-label="Jump to date"
            value={toDateKey(cursor)}
            onChange={(event) => {
              if (!event.target.value) return;
              const [year, month, day] = event.target.value
                .split("-")
                .map(Number);
              setCursor(new Date(year, month - 1, day));
            }}
            className="btn-ghost shrink-0 px-3 py-2 text-sm shadow-[var(--shadow-xs)] hover:bg-background"
          />

          {/* Day = staff columns (Fresha style) · Week = day columns */}
          <div className="flex shrink-0 items-center rounded-xl border border-line bg-surface p-0.5 shadow-[var(--shadow-xs)]">
            {(["day", "week"] as const).map((option) => (
              <button
                key={option}
                onClick={() => setView(option)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition ${
                  view === option
                    ? "bg-foreground text-white shadow-sm"
                    : "text-muted hover:bg-background hover:text-foreground"
                }`}
              >
                {option}
              </button>
            ))}
          </div>

          <button
            onClick={() =>
              setBlocking({ dateKey: toDateKey(cursor), minutes: dayStart })
            }
            disabled={!canEdit}
            title={!canEdit ? "Only admins can block time" : "Block time"}
            aria-label="Block time"
            className="btn-ghost grid h-9 w-9 shrink-0 place-items-center rounded-xl shadow-[var(--shadow-xs)] hover:bg-background disabled:opacity-60"
          >
            <IconBan size={15} />
          </button>

          <button
            onClick={() => setFullscreen((value) => !value)}
            title={fullscreen ? "Exit full screen (Esc)" : "Full screen"}
            aria-label={fullscreen ? "Exit full screen" : "Full screen"}
            className="btn-ghost grid h-9 w-9 shrink-0 place-items-center rounded-xl shadow-[var(--shadow-xs)] hover:bg-background"
          >
            {fullscreen ? (
              <IconCollapse size={15} />
            ) : (
              <IconExpand size={15} />
            )}
          </button>

          {/* Help tip button */}
          <div ref={helpRef} className="relative">
            <button
              onClick={() => setShowHelpTip((prev) => !prev)}
              title="View tips"
              aria-label="View tips"
              className="btn-ghost grid h-9 w-9 shrink-0 place-items-center rounded-xl shadow-[var(--shadow-xs)] hover:bg-background text-muted"
            >
              <IconInfo size={15} />
            </button>
            {showHelpTip && (
              <div className="absolute left-0 top-full mt-2 w-72 rounded-xl border border-line bg-surface p-3 text-xs text-muted shadow-[var(--shadow-lg)] z-40">
                <p className="font-medium text-foreground mb-1.5">Tips:</p>
                <p>
                  {view === "day"
                    ? "• Drag an appointment to another time or team member to reassign it"
                    : "• Drag an appointment to another day or time to reschedule"}
                </p>
                <p className="mt-1">
                  {view === "day"
                    ? "• Double-click an empty slot to book"
                    : "• Switch to Day view to add a booking"}
                </p>
              </div>
            )}
          </div>

          {/* Compact staff picker trails the toolbar — narrower than the
              rest so it doesn't compete with the date/view controls. */}
          <StaffDropdown
            staff={activeStaff}
            value={selectedStaff}
            onChange={setSelectedStaff}
          />
        </div>
      </div>

      <main ref={mainRef} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-6">
        {error && (
          <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </p>
        )}
        {moveError && (
          <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {moveError}
          </p>
        )}

        {loading && <p className="text-sm text-muted">Loading…</p>}

        {activeStaff.length === 0 && !loading && (
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
            No staff yet — add team members on the Staff page to filter the
            calendar per person.
          </p>
        )}

        {view === "day" ? (
          <StaffDayGrid
            date={cursor}
            staff={dayViewStaff}
            bookings={dayVisible}
            blocks={[...blocks, ...breakBlocks]}
            timeOff={timeOff}
            dayStart={dayStart}
            dayEnd={dayEnd}
            onMove={permittedHandleStaffMove}
            onSelect={setSelected}
            onCreate={permittedHandleCreate}
            onSelectBlock={(block) => {
              if (block.id.startsWith("break-")) return;
              setSelectedBlock(block);
            }}
          />
        ) : (
          <WeekTimeGrid
            days={weekDays}
            bookings={visible}
            blocks={[...visibleBlocks, ...breakBlocks]}
            dayStart={dayStart}
            dayEnd={dayEnd}
            daysOff={daysOff}
            onMove={permittedHandleMove}
            onSelect={setSelected}
            onSelectBlock={(block) => {
              // Shop-break bands are derived from Settings, not real rows.
              if (block.id.startsWith("break-")) return;
              setSelectedBlock(block);
            }}
            onSelectGroup={(group, startMinutes) =>
              setOverlap({ bookings: group, startMinutes })
            }
          />
        )}
      </main>

      {selected && (
        <BookingDrawer
          booking={selected}
          staff={activeStaff}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null);
            reload();
            toast.success("Appointment updated");
          }}
        />
      )}

      {creating && (
        <NewBookingModal
          staff={activeStaff}
          bookings={bookings}
          timeOff={timeOff}
          defaultStaffId={creating.staffId ?? currentStaff?.id ?? null}
          defaultDate={creating.dateKey}
          defaultMinutes={creating.minutes}
          onClose={() => setCreating(null)}
          onCreated={(created) => {
            setCreating(null);
            reload();
            toast.success("Appointment booked", "It is now on the calendar.");
            logActivity({
              actor,
              entity: "booking",
              action: "created",
              summary: `Booked ${created.clientName}`,
              detail: `${created.serviceName} · ${created.staffName} · ${formatDateLong(
                created.date
              )} ${created.time}`,
            });
          }}
        />
      )}

      {blocking && (
        <BlockTimeModal
          staff={activeStaff}
          defaultStaffId={currentStaff?.id ?? null}
          defaultDate={blocking.dateKey}
          defaultMinutes={blocking.minutes}
          onClose={() => setBlocking(null)}
          onCreated={() => {
            setBlocking(null);
            reloadBlocks();
            toast.success("Time blocked", "That slot is no longer bookable.");
            logActivity({
              actor,
              entity: "block",
              action: "blocked",
              summary: "Blocked time on the calendar",
              detail: formatDateLong(blocking.dateKey),
            });
          }}
        />
      )}

      {moveConfirm && (
        <Modal title="Move appointment?" onClose={() => setMoveConfirm(null)}>
          <div className="space-y-3 text-sm">
            <p>
              <span className="font-semibold">
                {moveConfirm.booking.full_name}
              </span>{" "}
              — {moveConfirm.booking.service_name} ·{" "}
              {moveConfirm.booking.staff_name}
            </p>

            <div className="rounded-xl bg-background px-4 py-3">
              <div className="flex justify-between gap-3">
                <span className="text-muted">From</span>
                <span>
                  {formatDateLong(moveConfirm.booking.booking_date)} ·{" "}
                  {moveConfirm.booking.booking_time}
                </span>
              </div>
              <div className="mt-1 flex justify-between gap-3 font-semibold">
                <span className="font-normal text-muted">To</span>
                <span>
                  {formatDateLong(moveConfirm.dateKey)} ·{" "}
                  {formatMinutes(moveConfirm.startMinutes)}
                </span>
              </div>
              {moveConfirm.staffName &&
                moveConfirm.staffId !== moveConfirm.booking.staff_id && (
                  <div className="mt-1 flex justify-between gap-3 font-semibold">
                    <span className="font-normal text-muted">Staff</span>
                    <span>
                      {moveConfirm.booking.staff_name} → {moveConfirm.staffName}
                    </span>
                  </div>
                )}
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <button
                onClick={() => {
                  const reassigning =
                    moveConfirm.staffId &&
                    moveConfirm.staffId !== moveConfirm.booking.staff_id;
                  applyMove(moveConfirm.booking, {
                    booking_date: moveConfirm.dateKey,
                    booking_time: formatMinutes(moveConfirm.startMinutes),
                    ...(reassigning
                      ? {
                          staff_id: moveConfirm.staffId,
                          staff_name: moveConfirm.staffName,
                        }
                      : {}),
                  });
                  setMoveConfirm(null);
                }}
                className="btn-primary py-2.5 text-sm hover:opacity-90"
              >
                {moveConfirm.staffId &&
                moveConfirm.staffId !== moveConfirm.booking.staff_id
                  ? "Yes, move & reassign"
                  : moveConfirm.dateKey === moveConfirm.booking.booking_date
                  ? "Yes, change the time"
                  : "Yes, change date & time"}
              </button>

              {moveConfirm.dateKey !== moveConfirm.booking.booking_date && (
                <button
                  onClick={() => {
                    applyMove(moveConfirm.booking, {
                      booking_time: formatMinutes(moveConfirm.startMinutes),
                    });
                    setMoveConfirm(null);
                  }}
                  className="btn-ghost py-2.5 text-sm hover:bg-background"
                >
                  Change time only (keep{" "}
                  {formatDateLong(moveConfirm.booking.booking_date)})
                </button>
              )}

              <button
                onClick={() => setMoveConfirm(null)}
                className="btn-ghost py-2.5 text-sm text-muted hover:bg-background"
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}

      {overlap && (
        <Modal
          title={`${overlap.bookings.length} appointments at ${formatMinutes(
            overlap.startMinutes
          )}`}
          onClose={() => setOverlap(null)}
        >
          <ul className="divide-y divide-line">
            {overlap.bookings.map((booking) => (
              <li key={booking.id}>
                <button
                  onClick={() => {
                    setOverlap(null);
                    setSelected(booking);
                  }}
                  className="flex w-full items-start justify-between gap-3 py-3 text-left transition hover:bg-background"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {booking.full_name}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {booking.service_name} · {booking.staff_name}
                    </p>
                    <p className="mt-0.5 text-xs tabular-nums text-muted">
                      {booking.booking_time} · {booking.duration_minutes} min
                    </p>
                  </div>
                  <StatusBadge status={booking.status} />
                </button>
              </li>
            ))}
          </ul>
          <p className="pt-3 text-xs text-muted">
            Select an appointment to open it, reschedule it or change who it is
            assigned to.
          </p>
        </Modal>
      )}

      {selectedBlock && (
        <RemoveBlockModal
          block={selectedBlock}
          staffName={
            staff.find((member) => member.id === selectedBlock.staff_id)?.name ??
            "Staff"
          }
          onClose={() => setSelectedBlock(null)}
          onRemoved={() => {
            const removed = selectedBlock;
            setSelectedBlock(null);
            reloadBlocks();
            toast.success("Block removed", "The slot is bookable again.");
            logActivity({
              actor,
              entity: "block",
              entity_id: removed.id,
              action: "unblocked",
              summary: "Removed a blocked slot",
              detail: `${formatDateLong(removed.block_date)} · ${formatMinutes(
                removed.start_minutes
              )}–${formatMinutes(removed.end_minutes)}`,
            });
          }}
        />
      )}
    </div>
  );
}

function RemoveBlockModal({
  block,
  staffName,
  onClose,
  onRemoved,
}: {
  block: StaffBlock;
  staffName: string;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRemove() {
    setBusy(true);
    setError(null);
    try {
      await deleteBlock(block.id);
      onRemoved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove block");
      setBusy(false);
    }
  }

  return (
    <Modal title="Blocked time" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p>
          <span className="font-semibold">{staffName}</span> is blocked{" "}
          {formatMinutes(block.start_minutes)} – {formatMinutes(block.end_minutes)}{" "}
          on {block.block_date}.
        </p>
        {block.reason && <p className="text-muted">Reason: {block.reason}</p>}
        {error && <p className="text-rose-700">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button
            onClick={handleRemove}
            disabled={busy}
            className="btn-primary flex-1 py-2.5 text-sm hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Removing…" : "Remove block"}
          </button>
          <button
            onClick={onClose}
            className="btn-ghost px-4 py-2.5 text-sm hover:bg-background"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}

function StaffDropdown({
  staff,
  value,
  onChange,
}: {
  staff: Staff[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const current = staff.find((member) => member.id === value) ?? null;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="btn-ghost flex max-w-[9rem] shrink-0 items-center gap-1.5 rounded-xl px-2 py-1.5 text-xs shadow-[var(--shadow-xs)] hover:bg-background sm:max-w-[10rem]"
      >
        {current ? (
          <Avatar name={current.name} src={current.avatar_url} size={20} />
        ) : (
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-foreground/10 text-[10px]">
            All
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-left">
          {current ? current.name : "All staff"}
        </span>
        <IconChevronDown
          size={13}
          className={`shrink-0 text-muted transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute z-40 mt-1 max-h-80 w-56 overflow-y-auto overflow-x-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-lg)]"
        >
          <li>
            <button
              type="button"
              role="option"
              aria-selected={value === ALL}
              onClick={() => {
                onChange(ALL);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition ${
                value === ALL
                  ? "bg-foreground text-white"
                  : "hover:bg-background"
              }`}
            >
              <span
                className={`grid h-8 w-8 place-items-center rounded-full text-xs ${
                  value === ALL ? "bg-white/15" : "bg-foreground/10"
                }`}
              >
                All
              </span>
              All staff
            </button>
          </li>
          {staff.map((member) => {
            const active = value === member.id;
            return (
              <li key={member.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(member.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition ${
                    active ? "bg-foreground text-white" : "hover:bg-background"
                  }`}
                >
                  <Avatar name={member.name} src={member.avatar_url} size={32} />
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate">{member.name}</span>
                    <span
                      className={`block truncate text-[11px] ${
                        active ? "text-white/70" : "text-muted"
                      }`}
                    >
                      {member.role}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
