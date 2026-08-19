import type { Booking } from "./types";

function toCsvValue(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(filenamePrefix: string, header: string[], lines: string[]) {
  const csv = [header.map(toCsvValue).join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/** Payment-ledger export — used by Transactions and POS. */
export function exportTransactionsCsv(rows: Booking[]) {
  const header = [
    "Date",
    "Time",
    "Client",
    "Email",
    "Mobile",
    "Service",
    "Staff",
    "Location",
    "Subtotal",
    "Discount",
    "Tax",
    "Tip",
    "Total",
    "Currency",
    "Payment method",
    "Paid",
    "Status",
  ];
  const lines = rows.map((b) =>
    [
      b.booking_date,
      b.booking_time,
      b.full_name,
      b.email,
      b.mobile,
      b.service_name,
      b.staff_name,
      b.service_location === "home" ? "Home" : "Salon",
      Number(b.subtotal).toFixed(2),
      Number(b.discount).toFixed(2),
      Number(b.tax).toFixed(2),
      Number(b.tip ?? 0).toFixed(2),
      Number(b.total).toFixed(2),
      b.currency,
      b.payment_method ?? "",
      b.is_paid ? "Yes" : "No",
      b.status,
    ]
      .map(toCsvValue)
      .join(",")
  );
  downloadCsv("transactions", header, lines);
}

/** Full booking-record export — used by Appointments. */
export function exportBookingsCsv(rows: Booking[]) {
  const header = [
    "Date",
    "Time",
    "Client",
    "Email",
    "Mobile",
    "Address",
    "Service",
    "Staff",
    "Location",
    "Home service fee",
    "Duration (min)",
    "Subtotal",
    "Discount",
    "Voucher",
    "Tax",
    "Total",
    "Currency",
    "Status",
    "Paid",
    "Payment method",
    "Notes",
    "Booked at",
  ];
  const lines = rows.map((b) =>
    [
      b.booking_date,
      b.booking_time,
      b.full_name,
      b.email,
      b.mobile,
      b.address ?? "",
      b.service_name,
      b.staff_name,
      b.service_location === "home" ? "Home" : "Salon",
      Number(b.home_service_fee ?? 0).toFixed(2),
      b.duration_minutes,
      Number(b.subtotal).toFixed(2),
      Number(b.discount).toFixed(2),
      b.voucher_code ?? "",
      Number(b.tax).toFixed(2),
      Number(b.total).toFixed(2),
      b.currency,
      b.status,
      b.is_paid ? "Yes" : "No",
      b.payment_method ?? "",
      b.notes ?? "",
      b.created_at,
    ]
      .map(toCsvValue)
      .join(",")
  );
  downloadCsv("bookings", header, lines);
}
