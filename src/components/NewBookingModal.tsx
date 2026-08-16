"use client";

import { useEffect, useMemo, useState } from "react";
import Modal from "./Modal";
import { createBooking } from "@/lib/bookings";
import { logActivity } from "@/lib/activity";
import { useAuth } from "@/lib/auth";
import { formatDateLong, formatMinutes, parseTimeToMinutes } from "@/lib/format";
import {
  fetchCatalogServices,
  fetchServiceCategories,
} from "@/lib/serviceCatalog";
import { fetchStaffCategoryMap, isStaffOffOn } from "@/lib/staff";
import { useShop } from "@/lib/shop";
import type {
  Booking,
  Service,
  ServiceCategory,
  ServiceLocation,
  Staff,
  StaffTimeOff,
} from "@/lib/types";

const SLOT_STEP = 15;

/** Why a staff member can't take this slot — null when they can. */
type Unavailable =
  | "Doesn't offer this"
  | "Day off"
  | "Outside shift"
  | "Already booked";

export default function NewBookingModal({
  staff,
  bookings,
  timeOff,
  defaultStaffId,
  defaultDate,
  defaultMinutes,
  onClose,
  onCreated,
}: {
  staff: Staff[];
  /** Existing bookings, used to rule out staff who are already busy. */
  bookings: Booking[];
  timeOff: StaffTimeOff[];
  defaultStaffId: string | null;
  defaultDate: string;
  defaultMinutes: number;
  onClose: () => void;
  onCreated: (created: {
    clientName: string;
    serviceName: string;
    staffName: string;
    date: string;
    time: string;
  }) => void;
}) {
  const { settings } = useShop();
  const { session } = useAuth();
  const actor = session?.user.email ?? null;

  // The catalogue is loaded live rather than read from a hardcoded list, so
  // this modal always offers exactly what Services & Packages holds.
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [catalog, setCatalog] = useState<Service[]>([]);
  const [staffCategoryMap, setStaffCategoryMap] = useState<
    Map<string, Set<string>>
  >(new Map());
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [location, setLocation] = useState<ServiceLocation>("salon");
  // Each picker holds only what the admin *chose*; the value actually used is
  // derived below and falls back to the first valid option. Deriving rather
  // than syncing via an effect means a location change can never leave a
  // service selected that isn't on the menu, not even for one render.
  const [pickedCategoryId, setPickedCategoryId] = useState("");
  const [pickedServiceId, setPickedServiceId] = useState("");
  const [pickedStaffId, setPickedStaffId] = useState(defaultStaffId ?? "");
  const [date, setDate] = useState("");
  const [minutes, setMinutes] = useState(defaultMinutes);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [markPaid, setMarkPaid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([
      fetchServiceCategories(),
      fetchCatalogServices(),
      // Expertise only narrows the staff list; if it fails everyone stays
      // selectable rather than the modal becoming unusable.
      fetchStaffCategoryMap().catch(() => new Map<string, Set<string>>()),
    ]).then(
      ([cats, svcs, catMap]) => {
        setCategories(cats.filter((c) => c.active));
        setCatalog(svcs.filter((s) => s.active));
        setStaffCategoryMap(catMap);
        setCatalogLoading(false);
      },
      (err: unknown) => {
        setCatalogError(
          err instanceof Error ? err.message : "Could not load services"
        );
        setCatalogLoading(false);
      }
    );
  }, []);

  const homeEnabled = settings?.home_service_enabled ?? false;
  const currency = settings?.currency ?? "AED";

  // Salon ↔ home changes what's on the menu, so the catalogue is narrowed by
  // location before the category tabs get a say.
  const locationServices = useMemo(
    () =>
      catalog.filter((s) => {
        const at = s.available_at ?? "both";
        return at === "both" || at === location;
      }),
    [catalog, location]
  );

  // Only categories that actually have something bookable here.
  const visibleCategories = useMemo(
    () =>
      categories.filter((c) =>
        locationServices.some((s) => s.category_id === c.id)
      ),
    [categories, locationServices]
  );

  // Falls back to the first category still on the menu after a location
  // switch, rather than holding a pick that no longer exists.
  const categoryId =
    pickedCategoryId && visibleCategories.some((c) => c.id === pickedCategoryId)
      ? pickedCategoryId
      : visibleCategories[0]?.id ?? "";

  const categoryServices = useMemo(
    () =>
      categoryId
        ? locationServices.filter((s) => s.category_id === categoryId)
        : [],
    [locationServices, categoryId]
  );

  const serviceId =
    pickedServiceId && categoryServices.some((s) => s.id === pickedServiceId)
      ? pickedServiceId
      : categoryServices[0]?.id ?? "";

  const service = catalog.find((s) => s.id === serviceId) ?? null;
  const duration = service?.duration_minutes ?? 30;

  // Bookable start times across the shop's opening hours. Cheap enough to
  // recompute each render — the React Compiler memoizes it for us.
  const openMinutes = settings?.open_minutes ?? 9 * 60;
  const closeMinutes = settings?.close_minutes ?? 18 * 60;
  const shopSlots: number[] = [];
  for (let m = openMinutes; m + duration <= closeMinutes; m += SLOT_STEP) {
    shopSlots.push(m);
  }
  // Keep whatever the admin double-clicked selectable even if it sits outside
  // shop hours — they clicked that spot deliberately.
  const slots = shopSlots.includes(defaultMinutes)
    ? shopSlots
    : [defaultMinutes, ...shopSlots];

  /** Everything that would stop this person taking the slot, in the order an
   * admin would think about it. */
  function unavailableReason(member: Staff): Unavailable | null {
    if (service?.category_id) {
      const cats = staffCategoryMap.get(member.id);
      // No expertise on file means "does everything" — see
      // supabase/021_staff_categories.sql.
      if (cats && cats.size > 0 && !cats.has(service.category_id)) {
        return "Doesn't offer this";
      }
    }
    if (date && isStaffOffOn(member, date, timeOff)) return "Day off";

    if (date) {
      const start = minutes;
      const end = start + duration;
      const shiftStart = parseTimeToMinutes(member.work_start);
      const shiftEnd = parseTimeToMinutes(member.work_end);
      if (shiftStart !== null && start < shiftStart) return "Outside shift";
      if (shiftEnd !== null && end > shiftEnd) return "Outside shift";

      const clash = bookings.some((b) => {
        if (b.staff_id !== member.id) return false;
        if (b.booking_date !== date) return false;
        if (b.status === "cancelled") return false;
        const bStart = parseTimeToMinutes(b.booking_time);
        if (bStart === null) return false;
        const bEnd = bStart + (b.duration_minutes ?? 30);
        return start < bEnd && end > bStart;
      });
      if (clash) return "Already booked";
    }

    return null;
  }

  const staffOptions = useMemo(
    () =>
      staff.map((member) => ({
        member,
        reason: unavailableReason(member),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [staff, service, date, minutes, duration, bookings, timeOff, staffCategoryMap]
  );

  const availableStaff = staffOptions.filter((o) => o.reason === null);

  // Never leave an unavailable person selected — silently booking over
  // someone's day off is exactly the mistake this screen should prevent.
  const staffId =
    pickedStaffId && availableStaff.some((o) => o.member.id === pickedStaffId)
      ? pickedStaffId
      : availableStaff[0]?.member.id ?? "";

  const member = staff.find((item) => item.id === staffId) ?? null;
  const taxRate = Number(settings?.tax_rate ?? 5) / 100;
  const subtotal = Number(service?.price ?? 0);
  const fee = location === "home" ? Number(settings?.home_service_fee ?? 0) : 0;
  const tax = Math.round((subtotal + fee) * taxRate * 100) / 100;
  const total = Math.round((subtotal + fee + tax) * 100) / 100;

  const time = formatMinutes(minutes);
  const needsAddress = location === "home" && address.trim() === "";

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!service) {
      setError("Pick a service.");
      return;
    }
    if (!member) {
      setError("No staff member is available for this slot.");
      return;
    }
    if (needsAddress) {
      setError("A home visit needs an address to send the team to.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const bookingId = await createBooking({
        service_id: service.id,
        service_name: service.name,
        duration_minutes: duration,
        price: subtotal,
        staff_id: member.id,
        staff_name: member.name,
        booking_date: date,
        booking_time: time,
        subtotal,
        // The insert trigger recomputes fee, tax and total from
        // shop_settings; these are a best-effort preview only.
        tax,
        total,
        currency,
        full_name: fullName.trim(),
        email: email.trim(),
        mobile: mobile.trim(),
        address: address.trim() || null,
        notes: notes.trim() || null,
        // Manually-created bookings still need a human to accept them —
        // same as ones coming in from the public site — rather than
        // landing pre-confirmed just because an admin typed it in.
        status: "pending",
        is_paid: markPaid,
        service_location: location,
      });
      logActivity({
        actor,
        entity: "booking",
        entity_id: bookingId,
        action: "created",
        summary: `Created appointment for ${fullName.trim()}`,
        detail: `${service.name} · ${member.name} · ${formatDateLong(
          date
        )} ${time}${location === "home" ? " · Home service" : ""}`,
      });
      onCreated({
        clientName: fullName.trim(),
        serviceName: service.name,
        staffName: member.name,
        date,
        time,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create booking");
      setBusy(false);
    }
  }

  return (
    <Modal title="New appointment" onClose={onClose}>
      {catalogLoading ? (
        <p className="py-6 text-center text-sm text-muted">Loading services…</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          {catalogError && (
            <p className="text-sm text-rose-700">{catalogError}</p>
          )}

          {/* 1 — where. Narrows the whole menu below it. */}
          <div>
            <span className="mb-1 block text-xs uppercase tracking-wide text-muted">
              Location
            </span>
            <div className="flex gap-2">
              <LocationToggle
                label="In salon"
                active={location === "salon"}
                onClick={() => setLocation("salon")}
              />
              <LocationToggle
                label="Home service"
                active={location === "home"}
                disabled={!homeEnabled}
                title={
                  homeEnabled
                    ? undefined
                    : "Home service is switched off in Settings"
                }
                onClick={() => setLocation("home")}
              />
            </div>
          </div>

          {/* 2 — category, then 3 — service within it. */}
          {visibleCategories.length === 0 ? (
            <p className="rounded-xl border border-line px-3 py-2.5 text-sm text-muted">
              Nothing is bookable{" "}
              {location === "home" ? "as a home visit" : "in the salon"} yet.
            </p>
          ) : (
            <>
              <Select
                label="Category"
                value={categoryId}
                onChange={setPickedCategoryId}
                options={visibleCategories.map((c) => ({
                  value: c.id,
                  label: c.name,
                }))}
              />
              <Select
                label="Service"
                value={serviceId}
                onChange={setPickedServiceId}
                options={categoryServices.map((s) => ({
                  value: s.id,
                  label: `${s.name} · ${s.duration_minutes}min · ${currency} ${Number(
                    s.price
                  ).toFixed(2)}`,
                }))}
              />
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Text
              label="Date"
              value={date}
              onChange={setDate}
              type="date"
              required
            />
            <Select
              label="Time"
              value={String(minutes)}
              onChange={(value) => setMinutes(Number(value))}
              options={slots.map((m) => ({
                value: String(m),
                label: formatMinutes(m),
              }))}
            />
          </div>

          {/* 4 — only whoever can actually take it. */}
          <div>
            <span className="mb-1 block text-xs uppercase tracking-wide text-muted">
              Staff
            </span>
            {availableStaff.length === 0 ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                Nobody is free for this service at {time} on{" "}
                {formatDateLong(date)}. Try another time, or a different day.
              </p>
            ) : (
              <select
                value={staffId}
                onChange={(event) => setPickedStaffId(event.target.value)}
                className="w-full rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-foreground"
              >
                {availableStaff.map(({ member: m }) => (
                  <option key={m.id} value={m.id}>
                    {m.name} — {m.role}
                  </option>
                ))}
              </select>
            )}
            {/* Saying *why* someone is missing beats silently dropping them. */}
            {staffOptions.some((o) => o.reason !== null) && (
              <p className="mt-1.5 text-xs text-muted">
                Unavailable:{" "}
                {staffOptions
                  .filter((o) => o.reason !== null)
                  .map((o) => `${o.member.name} (${o.reason})`)
                  .join(" · ")}
              </p>
            )}
          </div>

          <Text
            label="Client name"
            value={fullName}
            onChange={setFullName}
            required
          />
          <div className="grid grid-cols-2 gap-3">
            <Text
              label="Email"
              value={email}
              onChange={setEmail}
              type="email"
              required
            />
            <Text label="Mobile" value={mobile} onChange={setMobile} required />
          </div>
          <Text
            label={location === "home" ? "Address (required)" : "Address"}
            value={address}
            onChange={setAddress}
            required={location === "home"}
          />
          <Text label="Notes" value={notes} onChange={setNotes} />

          <div className="rounded-xl bg-background px-4 py-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Subtotal</span>
              <span>
                {currency} {subtotal.toFixed(2)}
              </span>
            </div>
            {fee > 0 && (
              <div className="flex justify-between">
                <span className="text-muted">Home service fee</span>
                <span>
                  {currency} {fee.toFixed(2)}
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted">Tax ({settings?.tax_rate ?? 5}%)</span>
              <span>
                {currency} {tax.toFixed(2)}
              </span>
            </div>
            <div className="mt-1 flex justify-between border-t border-line pt-1 font-semibold">
              <span>Total</span>
              <span>
                {currency} {total.toFixed(2)}
              </span>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={markPaid}
              onChange={(event) => setMarkPaid(event.target.checked)}
            />
            Mark as paid
          </label>

          {error && <p className="text-sm text-rose-700">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={busy || !service || availableStaff.length === 0}
              className="btn-primary flex-1 py-2.5 text-sm hover:opacity-90 disabled:opacity-60"
            >
              {busy ? "Creating…" : "Create appointment"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="btn-ghost px-4 py-2.5 text-sm hover:bg-background"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function LocationToggle({
  label,
  active,
  disabled,
  title,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "border-foreground bg-foreground text-surface"
          : "border-line text-muted hover:bg-background"
      }`}
    >
      {label}
    </button>
  );
}

function Text({
  label,
  value,
  onChange,
  type = "text",
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wide text-muted">
        {label}
      </span>
      <input
        type={type}
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-foreground"
      />
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wide text-muted">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-foreground"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
