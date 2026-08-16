"use client";

import { useEffect, useMemo, useState } from "react";
import Modal from "./Modal";
import { checkoutBooking } from "@/lib/bookings";
import { fetchProducts } from "@/lib/inventory";
import { useServiceOptions } from "@/lib/services";
import { logActivity } from "@/lib/activity";
import { useAuth } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import type { BillAddon, Booking, Product } from "@/lib/types";

const methods = ["Cash", "Card", "Gift Card", "Online"];
const tipPresets = [0, 10, 15, 20];

export default function PosCheckout({
  booking,
  currency,
  taxRate,
  onClose,
  onPaid,
}: {
  booking: Booking;
  currency: string;
  taxRate: number;
  onClose: () => void;
  onPaid: () => void;
}) {
  const [addons, setAddons] = useState<BillAddon[]>(
    Array.isArray(booking.addons) ? booking.addons : []
  );
  const [products, setProducts] = useState<Product[]>([]);
  const services = useServiceOptions();
  const [tipPercent, setTipPercent] = useState<number | null>(0);
  const [customTip, setCustomTip] = useState("");
  const [method, setMethod] = useState(booking.payment_method ?? "Cash");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { session, role } = useAuth();
  const actor = session?.user.email ?? null;
  // Staff can look up a bill and see the breakdown but not actually take
  // payment — per the read-only-financials restriction (see navConfig.tsx
  // and the sibling gate in the Transactions/POS list views).
  const canCharge = role !== "staff";

  useEffect(() => {
    fetchProducts().then(
      (rows) => setProducts(rows.filter((row) => row.active)),
      () => {}
    );
  }, []);

  const servicePrice = Number(booking.price);
  const addonsTotal = useMemo(
    () => addons.reduce((sum, item) => sum + item.price * item.qty, 0),
    [addons]
  );

  const subtotal = servicePrice + addonsTotal;
  const tax = Math.round(subtotal * (taxRate / 100) * 100) / 100;

  // Tip is charged on the pre-tax subtotal, and never taxed.
  const tip =
    tipPercent === null
      ? Math.max(0, Number(customTip) || 0)
      : Math.round(subtotal * (tipPercent / 100) * 100) / 100;

  const total = Math.round((subtotal + tax + tip) * 100) / 100;

  function addItem(name: string, price: number) {
    setAddons((current) => {
      const existing = current.find((item) => item.name === name);
      if (existing) {
        return current.map((item) =>
          item.name === name ? { ...item, qty: item.qty + 1 } : item
        );
      }
      return [...current, { name, price, qty: 1 }];
    });
  }

  function changeQty(name: string, delta: number) {
    setAddons((current) =>
      current
        .map((item) =>
          item.name === name ? { ...item, qty: item.qty + delta } : item
        )
        .filter((item) => item.qty > 0)
    );
  }

  async function handlePay() {
    if (!canCharge) return;
    setBusy(true);
    setError(null);
    try {
      await checkoutBooking(booking.id, {
        addons,
        tip,
        subtotal,
        tax,
        total,
        payment_method: method,
      });
      logActivity({
        actor,
        entity: "booking",
        entity_id: booking.id,
        action: "checkout",
        summary: `Checked out ${booking.full_name}`,
        detail: `${method} · ${formatMoney(total, currency)}`,
      });
      onPaid();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed");
      setBusy(false);
    }
  }

  return (
    <Modal title={`Bill — ${booking.full_name}`} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <div className="rounded-xl bg-background px-4 py-3">
          <div className="flex justify-between">
            <span>{booking.service_name}</span>
            <span>{formatMoney(servicePrice, currency)}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {booking.staff_name} · {booking.booking_date} · {booking.booking_time}
          </p>
          {booking.service_location === "home" && booking.address && (
            <p className="mt-1.5 flex items-start gap-1 text-xs text-muted">
              🚗 <span className="text-foreground">{booking.address}</span>
            </p>
          )}
        </div>

        <section>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
            Add-ons
          </p>

          {addons.length > 0 && (
            <div className="mb-3 space-y-1.5">
              {addons.map((item) => (
                <div
                  key={item.name}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => changeQty(item.name, -1)}
                      className="btn-ghost h-6 w-6 text-xs hover:bg-background"
                    >
                      −
                    </button>
                    <span className="w-5 text-center">{item.qty}</span>
                    <button
                      onClick={() => changeQty(item.name, 1)}
                      className="btn-ghost h-6 w-6 text-xs hover:bg-background"
                    >
                      +
                    </button>
                  </div>
                  <span className="w-20 text-right">
                    {formatMoney(item.price * item.qty, currency)}
                  </span>
                </div>
              ))}
            </div>
          )}

          <select
            value=""
            onChange={(event) => {
              const [kind, id] = event.target.value.split(":");
              if (kind === "service") {
                const match = services.find((item) => item.id === id);
                if (match) addItem(match.name, match.price);
              } else if (kind === "product") {
                const match = products.find((item) => item.id === id);
                if (match) addItem(match.name, Number(match.price));
              }
            }}
            className="w-full rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-foreground"
          >
            <option value="">+ Add a service or product…</option>
            <optgroup label="Services">
              {services.map((item) => (
                <option key={item.id} value={`service:${item.id}`}>
                  {item.name} — {formatMoney(item.price, currency)}
                </option>
              ))}
            </optgroup>
            {products.length > 0 && (
              <optgroup label="Products">
                {products.map((item) => (
                  <option key={item.id} value={`product:${item.id}`}>
                    {item.name} — {formatMoney(Number(item.price), currency)}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </section>

        <section>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
            Tip
          </p>
          <div className="flex flex-wrap gap-2">
            {tipPresets.map((percent) => (
              <button
                key={percent}
                onClick={() => {
                  setTipPercent(percent);
                  setCustomTip("");
                }}
                className={`rounded-xl px-3 py-1.5 text-xs transition ${
                  tipPercent === percent
                    ? "bg-foreground text-white"
                    : "btn-ghost hover:bg-background"
                }`}
              >
                {percent === 0 ? "No tip" : `${percent}%`}
              </button>
            ))}
            <input
              value={customTip}
              onChange={(event) => {
                setCustomTip(event.target.value);
                setTipPercent(null);
              }}
              onFocus={() => setTipPercent(null)}
              placeholder="Custom"
              inputMode="decimal"
              className={`w-24 rounded-xl border px-3 py-1.5 text-xs outline-none ${
                tipPercent === null ? "border-foreground" : "border-line"
              }`}
            />
          </div>
        </section>

        <dl className="space-y-1 border-t border-line pt-3">
          <Row label="Service">{formatMoney(servicePrice, currency)}</Row>
          {addonsTotal > 0 && (
            <Row label="Add-ons">{formatMoney(addonsTotal, currency)}</Row>
          )}
          <Row label="Subtotal">{formatMoney(subtotal, currency)}</Row>
          <Row label={`Tax (${taxRate}%)`}>{formatMoney(tax, currency)}</Row>
          {tip > 0 && <Row label="Tip">{formatMoney(tip, currency)}</Row>}
          <div className="flex justify-between border-t border-line pt-2 text-base font-semibold">
            <span>Total</span>
            <span>{formatMoney(total, currency)}</span>
          </div>
        </dl>

        <select
          value={method}
          onChange={(event) => setMethod(event.target.value)}
          className="w-full rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-foreground"
        >
          {methods.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>

        {error && <p className="text-rose-700">{error}</p>}
        {!canCharge && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Staff accounts can look up bills but can&rsquo;t take payment —
            ask an admin.
          </p>
        )}

        <button
          onClick={handlePay}
          disabled={busy || !canCharge}
          className="btn-primary w-full py-3 text-sm hover:opacity-90 disabled:opacity-60"
        >
          {busy
            ? "Processing…"
            : `Charge ${formatMoney(total, currency)} · ${method}`}
        </button>
      </div>
    </Modal>
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
    <div className="flex justify-between">
      <dt className="text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
