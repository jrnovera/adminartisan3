"use client";

import { usePathname } from "next/navigation";
import Notifications from "./Notifications";
import { IconMenu } from "./Icons";
import { titleForPath } from "./navConfig";

export default function Topbar({ onOpenNav }: { onOpenNav: () => void }) {
  const pathname = usePathname();
  const isCalendar = pathname === "/calendar";

  // Get today's date in the same format as calendar
  const today = new Date();
  const todayLabel = today.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <header className="sticky top-0 z-30 flex min-h-16 items-center gap-3 border-b border-line bg-surface/85 px-4 py-2.5 backdrop-blur-md sm:px-6">
      <button
        onClick={onOpenNav}
        aria-label="Open navigation menu"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line text-foreground transition hover:bg-background lg:hidden"
      >
        <IconMenu size={18} />
      </button>

      {/* On phones the rail is hidden, so the bar carries the page name and date if calendar. */}
      <div className="min-w-0 flex-1 lg:hidden">
        <p className="truncate text-sm font-semibold">
          {titleForPath(pathname)}
        </p>
        {isCalendar && (
          <p className="truncate text-xs text-muted">Today: {todayLabel}</p>
        )}
      </div>
      <div className="hidden flex-1 lg:flex lg:items-center lg:gap-3">
        <p className="truncate text-sm font-semibold">
          {titleForPath(pathname)}
        </p>
        {isCalendar && (
          <p className="truncate text-sm text-muted">Today: {todayLabel}</p>
        )}
      </div>

      <Notifications />
    </header>
  );
}
