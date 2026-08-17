"use client";

import { useEffect, useState } from "react";
import StatusBadge from "./StatusBadge";
import HomeBadge from "./HomeBadge";
import { IconClose, IconPencil } from "./Icons";
import { rescheduleBooking, setBookingPaid, updateBookingStatus } from "@/lib/bookings";
import {
  formatDateLong,
  formatMinutes,
  formatMoney,
  hasAppointmentStarted,
  parseTimeToMinutes,
} from "@/lib/format";
import { useServiceOptions } from "@/lib/services";
import { logActivity } from "@/lib/activity";
import { useAuth } from "@/lib/auth";
import { useShop } from "@/lib/shop";
import type { Booking, BookingStatus, Staff } from "@/lib/types";

const statuses: BookingStatus[] = [
  "pending",
  "confirmed",
  "completed",
  "cancelled",
  "no_show",
];

const statusLabels: Record<BookingStatus, string> = {
  pending: "Pending",
  confirmed: "Accepted",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No show",
};

const methods = ["Cash", "Card", "Gift Card", "Online"];

/**
 * booking_time is stored throughout the app as a 12-hour label ("9:00 AM") —
 * the public booking site writes it that way, NewBookingModal's slot picker
 * writes it that way, and the SQL double-booking guard, Calendar and Reports
 * all read it that way. A native `<input type="time">` only accepts 24-hour
 * "HH:MM", though, so a manually-booked appointment's time silently failed
 * to display (and therefore to edit) here. These convert at the boundary —
 * the input itself still speaks 24-hour, but nothing else in the app has to.
 */
function to24Hour(label: string): string {
  const minutes = parseTimeToMinutes(label);
  if (minutes === null) return "";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function to12Hour(value: string): string {
  const minutes = parseTimeToMinutes(value);
  return minutes === null ? value : formatMinutes(minutes);
}

export default function BookingDrawer({
  booking,
  staff,
  onClose,
  onChanged,
}: {
  booking: Booking;
  staff: Staff[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { settings } = useShop();
  const { session, isAdminOrAbove } = useAuth();
  const actor = session?.user.email ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only admin and superadmin can edit bookings
  const canEdit = isAdminOrAbove;
  const [method, setMethod] = useState(booking.payment_method ?? "Cash");
  const [editing, setEditing] = useState(false);
  // Separate from `editing` above (which is scheduling only) — contact
  // details are a distinct concern with their own Edit/Save affordance, so
  // fixing a mistyped phone number doesn't require touching the service or
  // staff assignment at the same time.
  const [contactEditing, setContactEditing] = useState(false);
  const [statusConfirm, setStatusConfirm] = useState<BookingStatus | null>(null);

  // Draft fields for edit mode — seeded from the booking whenever it (or
  // edit mode) changes, so switching bookings never shows stale input.
  const [serviceId, setServiceId] = useState(booking.service_id);
  const [staffId, setStaffId] = useState(booking.staff_id);
  const [date, setDate] = useState(booking.booking_date);
  // Always 24-hour here, to match what the <input type="time"> below can
  // actually display — converted back to the app's 12-hour convention right
  // before it's sent anywhere. See to24Hour/to12Hour above.
  const [time, setTime] = useState(to24Hour(booking.booking_time));

  const [fullName, setFullName] = useState(booking.full_name);
  const [email, setEmail] = useState(booking.email);
  const [mobile, setMobile] = useState(booking.mobile);
  const [address, setAddress] = useState(booking.address ?? "");
  const [notes, setNotes] = useState(booking.notes ?? "");

  useEffect(() => {
    setServiceId(booking.service_id);
    setStaffId(booking.staff_id);
    setDate(booking.booking_date);
    setTime(to24Hour(booking.booking_time));
    setEditing(false);
    setFullName(booking.full_name);
    setEmail(booking.email);
    setMobile(booking.mobile);
    setAddress(booking.address ?? "");
    setNotes(booking.notes ?? "");
    setContactEditing(false);
  }, [booking]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  const services = useServiceOptions();
  const knownService = services.find((item) => item.id === booking.service_id);
  const selectedService =
    services.find((item) => item.id === serviceId) ?? knownService;
  const selectedStaff = staff.find((member) => member.id === staffId);
  const currency = settings?.currency ?? booking.currency;
  const taxRate = Number(settings?.tax_rate ?? 5) / 100;
  const appointmentStarted = hasAppointmentStarted(
    booking.booking_date,
    booking.booking_time
  );

  const changed =
    serviceId !== booking.service_id ||
    staffId !== booking.staff_id ||
    date !== booking.booking_date ||
    time !== to24Hour(booking.booking_time);

  // Preview the new total live as the admin edits, same math NewBookingModal
  // uses, so there are no surprises before Save is pressed.
  const previewSubtotal = selectedService
    ? selectedService.price
    : Number(booking.subtotal);
  const previewDiscount = Math.min(Number(booking.discount) || 0, previewSubtotal);
  const previewNet = previewSubtotal - previewDiscount;
  const previewTax = Math.round(previewNet * taxRate * 100) / 100;
  const previewTotal = Math.round((previewNet + previewTax) * 100) / 100;

  async function handleSave() {
    if (!selectedStaff) {
      setError("Pick a staff member.");
      return;
    }
    if (!date || !time) {
      setError("Pick a date and time.");
      return;
    }

    const serviceChanged =
      !!selectedService && selectedService.id !== booking.service_id;
    // Convert back to the app-wide 12-hour convention before this goes
    // anywhere else — Calendar, Reports, and the SQL double-booking guard
    // all expect "9:00 AM", not the input's "09:00".
    const timeLabel = to12Hour(time);

    await run(async () => {
      await rescheduleBooking(booking.id, {
        booking_date: date,
        booking_time: timeLabel,
        staff_id: selectedStaff.id,
        staff_name: selectedStaff.name,
        ...(serviceChanged && selectedService
          ? {
              service_id: selectedService.id,
              service_name: selectedService.name,
              duration_minutes: selectedService.duration,
              price: selectedService.price,
              subtotal: previewSubtotal,
              discount: previewDiscount,
              tax: previewTax,
              total: previewTotal,
            }
          : {}),
      });

      // Spell out exactly what moved, so the history is auditable later.
      const parts: string[] = [];
      if (serviceChanged && selectedService) {
        parts.push(`Service ${booking.service_name} → ${selectedService.name}`);
      }
      if (selectedStaff.id !== booking.staff_id) {
        parts.push(`Staff ${booking.staff_name} → ${selectedStaff.name}`);
      }
      if (date !== booking.booking_date || time !== to24Hour(booking.booking_time)) {
        parts.push(
          `When ${formatDateLong(booking.booking_date)} ${
            booking.booking_time
          } → ${formatDateLong(date)} ${timeLabel}`
        );
      }

      logActivity({
        actor,
        entity: "booking",
        entity_id: booking.id,
        action: "edited",
        summary: `Edited ${booking.full_name}'s appointment`,
        detail: parts.join(" · ") || null,
      });
    });
    setEditing(false);
  }

  const contactChanged =
    fullName.trim() !== booking.full_name ||
    email.trim() !== booking.email ||
    mobile.trim() !== booking.mobile ||
    address.trim() !== (booking.address ?? "") ||
    notes.trim() !== (booking.notes ?? "");

  async function handleSaveContact() {
    if (!fullName.trim() || !email.trim() || !mobile.trim()) {
      setError("Name, email and mobile can't be blank.");
      return;
    }

    await run(async () => {
      await rescheduleBooking(booking.id, {
        full_name: fullName.trim(),
        email: email.trim(),
        mobile: mobile.trim(),
        address: address.trim() || null,
        notes: notes.trim() || null,
      });

      const parts: string[] = [];
      if (fullName.trim() !== booking.full_name) parts.push("Name");
      if (email.trim() !== booking.email) parts.push("Email");
      if (mobile.trim() !== booking.mobile) parts.push("Mobile");
      if (address.trim() !== (booking.address ?? "")) parts.push("Address");
      if (notes.trim() !== (booking.notes ?? "")) parts.push("Notes");

      logActivity({
        actor,
        entity: "booking",
        entity_id: booking.id,
        action: "edited",
        summary: `Edited ${booking.full_name}'s contact details`,
        detail: parts.length ? `Changed: ${parts.join(", ")}` : null,
      });
    });
    setContactEditing(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-[2px]">
      <button
        className="animate-fade-in flex-1 cursor-default"
        onClick={onClose}
        aria-label="Close"
      />
      <aside className="animate-slide-in-right flex w-full max-w-sm flex-col overflow-y-auto bg-surface shadow-[var(--shadow-xl)]">
        <div className="flex items-start justify-between gap-3 px-6 pb-4 pt-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-semibold">
                {booking.full_name}
              </h2>
              <HomeBadge location={booking.service_location} />
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-background hover:text-foreground"
          >
            <IconClose size={16} />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 px-6">
          <StatusBadge status={booking.status} />
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              booking.is_paid
                ? "bg-emerald-100 text-emerald-800"
                : "bg-foreground/10 text-muted"
            }`}
          >
            {booking.is_paid
              ? `Paid${booking.payment_method ? ` · ${booking.payment_method}` : ""}`
              : "Unpaid"}
          </span>
        </div>

        {/* The team is traveling to this one — the address needs to be seen
            at a glance, not dug out of the Contact card below. */}
        {booking.service_location === "home" && booking.address && (
          <div className="mx-6 mt-4 rounded-2xl border border-primary-100 bg-primary-50 px-4 py-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary-dark">
              🚗 Home service address
            </p>
            <p className="mt-1 text-sm font-medium text-foreground">
              {booking.address}
            </p>
          </div>
        )}

        <section className="mx-6 mt-4 rounded-2xl border border-line">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              Contact
            </p>
            {!contactEditing && canEdit && (
              <button
                onClick={() => setContactEditing(true)}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-foreground transition hover:bg-background"
              >
                <IconPencil size={13} />
                Edit
              </button>
            )}
          </div>

          {contactEditing ? (
            <div className="space-y-3 p-4">
              <Field label="Name">
                <input
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  className="w-full rounded-xl border border-line px-3 py-2 text-sm outline-none transition focus:border-foreground/40 focus:ring-4 focus:ring-foreground/[0.06]"
                />
              </Field>
              <Field label="Email">
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full rounded-xl border border-line px-3 py-2 text-sm outline-none transition focus:border-foreground/40 focus:ring-4 focus:ring-foreground/[0.06]"
                />
              </Field>
              <Field label="Mobile">
                <input
                  type="tel"
                  value={mobile}
                  onChange={(event) => setMobile(event.target.value)}
                  className="w-full rounded-xl border border-line px-3 py-2 text-sm outline-none transition focus:border-foreground/40 focus:ring-4 focus:ring-foreground/[0.06]"
                />
              </Field>
              <Field label="Address">
                <input
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  placeholder={
                    booking.service_location === "home"
                      ? "Required for home service"
                      : "Optional"
                  }
                  className="w-full rounded-xl border border-line px-3 py-2 text-sm outline-none transition focus:border-foreground/40 focus:ring-4 focus:ring-foreground/[0.06]"
                />
              </Field>
              <Field label="Notes">
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={3}
                  className="w-full rounded-xl border border-line px-3 py-2 text-sm outline-none transition focus:border-foreground/40 focus:ring-4 focus:ring-foreground/[0.06]"
                />
              </Field>

              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleSaveContact}
                  disabled={busy || !contactChanged}
                  className="btn-primary flex-1 py-2.5 text-sm hover:btn-primary-hover disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Save changes"}
                </button>
                <button
                  onClick={() => {
                    setFullName(booking.full_name);
                    setEmail(booking.email);
                    setMobile(booking.mobile);
                    setAddress(booking.address ?? "");
                    setNotes(booking.notes ?? "");
                    setContactEditing(false);
                    setError(null);
                  }}
                  className="btn-ghost px-4 py-2.5 text-sm hover:bg-background"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <dl className="space-y-2 p-4 text-sm">
              <Row label="Email">{booking.email}</Row>
              <Row label="Mobile">{booking.mobile}</Row>
              {/* Home bookings already show their address in the callout
                  above, right under the header. */}
              {booking.address && booking.service_location !== "home" && (
                <Row label="Address">{booking.address}</Row>
              )}
              {booking.notes && <Row label="Notes">{booking.notes}</Row>}
            </dl>
          )}
        </section>

        <section className="mx-6 mt-4 rounded-2xl border border-line">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              Appointment
            </p>
            {!editing && canEdit && (
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-foreground transition hover:bg-background"
              >
                <IconPencil size={13} />
                Edit
              </button>
            )}
          </div>

          {editing ? (
            <div className="space-y-3 p-4">
              <Field label="Service">
                <select
                  value={serviceId}
                  onChange={(event) => setServiceId(event.target.value)}
                  className="w-full rounded-xl border border-line px-3 py-2 text-sm outline-none transition focus:border-foreground/40 focus:ring-4 focus:ring-foreground/[0.06]"
                >
                  {!knownService && (
                    <option value={booking.service_id}>
                      {booking.service_name} (current)
                    </option>
                  )}
                  {services.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.duration}min · {currency}{" "}
                      {item.price}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Staff">
                <select
                  value={staffId}
                  onChange={(event) => setStaffId(event.target.value)}
                  className="w-full rounded-xl border border-line px-3 py-2 text-sm outline-none transition focus:border-foreground/40 focus:ring-4 focus:ring-foreground/[0.06]"
                >
                  {!staff.some((member) => member.id === booking.staff_id) && (
                    <option value={booking.staff_id}>
                      {booking.staff_name} (current)
                    </option>
                  )}
                  {staff.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name} — {member.role}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Date">
                  <input
                    type="date"
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                    className="w-full rounded-xl border border-line px-3 py-2 text-sm outline-none transition focus:border-foreground/40 focus:ring-4 focus:ring-foreground/[0.06]"
                  />
                </Field>
                <Field label="Time">
                  <input
                    type="time"
                    value={time}
                    onChange={(event) => setTime(event.target.value)}
                    className="w-full rounded-xl border border-line px-3 py-2 text-sm outline-none transition focus:border-foreground/40 focus:ring-4 focus:ring-foreground/[0.06]"
                  />
                </Field>
              </div>

              {selectedService && selectedService.id !== booking.service_id && (
                <div className="rounded-xl bg-background px-3.5 py-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted">New subtotal</span>
                    <span className="tabular-nums">
                      {formatMoney(previewSubtotal, currency)}
                    </span>
                  </div>
                  {previewDiscount > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted">Discount</span>
                      <span className="tabular-nums">
                        −{formatMoney(previewDiscount, currency)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted">Tax</span>
                    <span className="tabular-nums">
                      {formatMoney(previewTax, currency)}
                    </span>
                  </div>
                  <div className="mt-1 flex justify-between border-t border-line pt-1 font-semibold">
                    <span>New total</span>
                    <span className="tabular-nums">
                      {formatMoney(previewTotal, currency)}
                    </span>
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleSave}
                  disabled={busy || !changed}
                  className="btn-primary flex-1 py-2.5 text-sm hover:btn-primary-hover disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Save changes"}
                </button>
                <button
                  onClick={() => {
                    setServiceId(booking.service_id);
                    setStaffId(booking.staff_id);
                    setDate(booking.booking_date);
                    setTime(to24Hour(booking.booking_time));
                    setEditing(false);
                    setError(null);
                  }}
                  className="btn-ghost px-4 py-2.5 text-sm hover:bg-background"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <dl className="space-y-2 p-4 text-sm">
              <Row label="Service">{booking.service_name}</Row>
              <Row label="Staff">{booking.staff_name}</Row>
              <Row label="Date">{formatDateLong(booking.booking_date)}</Row>
              <Row label="Time">
                {booking.booking_time} · {booking.duration_minutes} min
              </Row>
            </dl>
          )}
        </section>

        <dl className="mx-6 mt-4 space-y-2 border-t border-line pt-4 text-sm">
          <Row label="Subtotal">
            {formatMoney(Number(booking.subtotal), booking.currency)}
          </Row>
          {Number(booking.discount) > 0 && (
            <Row label="Discount">
              −{formatMoney(Number(booking.discount), booking.currency)}
            </Row>
          )}
          {Number(booking.home_service_fee) > 0 && (
            <Row label="Home service fee">
              {formatMoney(Number(booking.home_service_fee), booking.currency)}
            </Row>
          )}
          <Row label="Tax">
            {formatMoney(Number(booking.tax), booking.currency)}
          </Row>
          <Row label="Total">
            <span className="font-semibold">
              {formatMoney(Number(booking.total), booking.currency)}
            </span>
          </Row>
          {booking.voucher_code && (
            <Row label="Voucher">{booking.voucher_code}</Row>
          )}
        </dl>

        <section className="border-t border-line px-6 py-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
            Status
          </p>
          <div className="flex flex-wrap gap-2">
            {statuses.map((status) => {
              // Completed/no-show describe how the appointment went, so
              // they're locked out until its start time actually arrives —
              // pending, confirmed, and cancelled aren't time-gated.
              const needsStarted = status === "completed" || status === "no_show";
              const tooFuture = needsStarted && !appointmentStarted;
              return (
                <button
                  key={status}
                  disabled={busy || booking.status === status || !canEdit || tooFuture}
                  onClick={() => setStatusConfirm(status)}
                  title={
                    tooFuture
                      ? "Can't mark this until the appointment's start time arrives"
                      : undefined
                  }
                  className={`rounded-xl px-3 py-1.5 text-xs transition disabled:opacity-50 ${
                    booking.status === status
                      ? "bg-foreground text-white"
                      : "btn-ghost hover:bg-background"
                  }`}
                >
                  {statusLabels[status]}
                </button>
              );
            })}
          </div>
          {!appointmentStarted && (
            <p className="mt-2 text-xs text-muted">
              Completed and No show unlock once this appointment's start
              time arrives.
            </p>
          )}
        </section>

        <section className="border-t border-line px-6 py-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
            Payment
          </p>
          {!canEdit ? (
            <p className="text-sm text-muted">
              Only admins can manage payments.
            </p>
          ) : booking.is_paid ? (
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await setBookingPaid(booking.id, false, null);
                  logActivity({
                    actor,
                    entity: "booking",
                    entity_id: booking.id,
                    action: "unpaid",
                    summary: `Marked ${booking.full_name}'s bill as unpaid`,
                    detail: formatMoney(
                      Number(booking.total),
                      booking.currency
                    ),
                  });
                })
              }
              className="btn-ghost w-full py-2.5 text-sm hover:bg-background disabled:opacity-60"
            >
              Mark as unpaid
            </button>
          ) : (
            <div className="space-y-2">
              <select
                value={method}
                onChange={(event) => setMethod(event.target.value)}
                className="w-full rounded-xl border border-line px-3 py-2 text-sm outline-none transition focus:border-foreground/40 focus:ring-4 focus:ring-foreground/[0.06]"
              >
                {methods.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await setBookingPaid(booking.id, true, method);
                    logActivity({
                      actor,
                      entity: "booking",
                      entity_id: booking.id,
                      action: "paid",
                      summary: `Took payment from ${booking.full_name}`,
                      detail: `${formatMoney(
                        Number(booking.total),
                        booking.currency
                      )} · ${method}`,
                    });
                  })
                }
                className="btn-primary w-full py-2.5 text-sm hover:btn-primary-hover disabled:opacity-60"
              >
                Mark as paid ·{" "}
                {formatMoney(Number(booking.total), booking.currency)}
              </button>
            </div>
          )}
        </section>

        {error && (
          <p className="mx-6 mb-4 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}
      </aside>

      {/* Status Confirmation Modal */}
      {statusConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]">
          <div className="animate-pop-in w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl dark:bg-surface">
            <div className="flex items-center justify-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-100">
                <span className="text-xl">✓</span>
              </div>
            </div>

            <h3 className="mt-4 text-center text-lg font-semibold text-foreground">
              Change appointment status?
            </h3>

            <p className="mt-2 text-center text-sm text-muted">
              Mark <span className="font-medium">{booking.full_name}</span>'s appointment as{" "}
              <span className="font-semibold text-foreground">
                {statusLabels[statusConfirm].toLowerCase()}
              </span>
            </p>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setStatusConfirm(null)}
                disabled={busy}
                className="btn-ghost flex-1 py-2.5 text-sm hover:bg-background disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  run(async () => {
                    await updateBookingStatus(booking.id, statusConfirm);
                    logActivity({
                      actor,
                      entity: "booking",
                      entity_id: booking.id,
                      action: `status-${statusConfirm}`,
                      summary: `Marked ${booking.full_name} as ${statusLabels[
                        statusConfirm
                      ].toLowerCase()}`,
                      detail: `${statusLabels[booking.status]} → ${
                        statusLabels[statusConfirm]
                      } · ${booking.service_name} · ${formatDateLong(
                        booking.booking_date
                      )} ${booking.booking_time}`,
                    });
                    setStatusConfirm(null);
                  });
                }}
                disabled={busy}
                className="btn-primary flex-1 py-2.5 text-sm hover:btn-primary-hover disabled:opacity-60"
              >
                {busy ? "Updating…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wide text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
