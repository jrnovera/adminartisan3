export function formatMoney(amount: number, currency = "AED") {
  const formatted = amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency} ${formatted}`;
}

export function parseTimeToMinutes(time: string) {
  const match = time.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3]?.toUpperCase();
  if (meridiem === "PM" && hours !== 12) hours += 12;
  if (meridiem === "AM" && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

export function formatMinutes(totalMinutes: number) {
  const hours24 = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const meridiem = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${String(minutes).padStart(2, "0")} ${meridiem}`;
}

export function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function startOfWeek(date: Date) {
  const result = new Date(date);
  const dayOfWeek = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - dayOfWeek);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function formatDateLong(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Whether a booking's scheduled start time has arrived — "Completed" and
 * "No show" describe how an appointment actually went, so neither makes
 * sense to set before it's even started. Cancelling, confirming, and
 * taking payment all stay available regardless of the clock; only those
 * two outcomes wait on this.
 */
export function hasAppointmentStarted(dateKey: string, timeLabel: string) {
  const minutes = parseTimeToMinutes(timeLabel);
  if (minutes === null) return true; // Can't parse the time — fail open.
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) return true;
  const start = new Date(year, month - 1, day, Math.floor(minutes / 60), minutes % 60);
  return new Date() >= start;
}
