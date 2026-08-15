"use client";

import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import type { BookingStatus } from "@/lib/types";
import { IconChevronDown } from "./Icons";

const styles: Record<BookingStatus, string> = {
  pending: "bg-amber-100 text-amber-800",
  confirmed: "bg-emerald-100 text-emerald-800",
  completed: "bg-primary-100 text-primary-dark",
  cancelled: "bg-rose-100 text-rose-700",
  no_show: "bg-foreground/10 text-muted",
};

// Ring color shown while the menu is open — matches the badge's own hue
// instead of a generic focus ring, so "this control is active" reads at a
// glance.
const ringStyles: Record<BookingStatus, string> = {
  pending: "ring-amber-400/50",
  confirmed: "ring-emerald-400/50",
  completed: "ring-primary/40",
  cancelled: "ring-rose-400/50",
  no_show: "ring-foreground/20",
};

const labels: Record<BookingStatus, string> = {
  pending: "Pending",
  confirmed: "Accepted",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No show",
};

interface ClickableStatusBadgeProps {
  status: BookingStatus;
  onStatusChange?: (status: BookingStatus) => Promise<void>;
  disabled?: boolean;
  isChanging?: boolean;
  // Statuses to gray out in the menu — e.g. "Completed" before the
  // appointment's start time has arrived. Still shown, just unclickable,
  // with a tooltip explaining why.
  disabledStatuses?: Partial<Record<BookingStatus, string>>;
}

const MENU_WIDTH = 152; // matches min-w-[9.5rem] below
const MENU_MAX_HEIGHT = 256; // matches max-h-64 below

export default function ClickableStatusBadge({
  status,
  onStatusChange,
  disabled = false,
  isChanging = false,
  disabledStatuses,
}: ClickableStatusBadgeProps) {
  const [open, setOpen] = useState(false);
  // Flips true for a moment right after a successful change, driving a
  // one-shot flash so the badge visibly confirms the update landed.
  const [justChanged, setJustChanged] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Position computed from the button's actual on-screen location and
  // rendered through a portal — see note below on why.
  const [menuPos, setMenuPos] = useState<{
    top: number;
    left: number;
    openUpward: boolean;
  } | null>(null);

  const updatePosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUpward =
      spaceBelow < MENU_MAX_HEIGHT && rect.top > spaceBelow;
    setMenuPos({
      top: openUpward ? rect.top - 6 : rect.bottom + 6,
      left: Math.min(
        Math.max(rect.right - MENU_WIDTH, 8),
        window.innerWidth - MENU_WIDTH - 8
      ),
      openUpward,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        buttonRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    }

    // A table with many rows scrolls internally, and the page itself can
    // scroll too — the menu is rendered in a portal outside both, so it has
    // to close (rather than drift out of place) whenever either happens.
    function handleScrollOrResize() {
      setOpen(false);
    }

    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [open]);

  // Re-triggers the flash whenever the confirmed status actually changes
  // (not on every re-render).
  useEffect(() => {
    setJustChanged(true);
    const timer = setTimeout(() => setJustChanged(false), 700);
    return () => clearTimeout(timer);
  }, [status]);

  async function handleStatusChange(newStatus: BookingStatus) {
    if (
      newStatus === status ||
      !onStatusChange ||
      disabled ||
      isChanging ||
      disabledStatuses?.[newStatus]
    )
      return;

    try {
      await onStatusChange(newStatus);
      setOpen(false);
    } catch (error) {
      console.error("Failed to update status:", error);
    }
  }

  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((value) => !value);
        }}
        disabled={disabled || isChanging}
        className={`group inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-semibold sm:text-sm transition-all duration-200 ${
          styles[status]
        } ${open ? `ring-2 ring-offset-2 ring-offset-surface ${ringStyles[status]} shadow-md` : ""} ${
          justChanged ? "scale-110" : "scale-100"
        } hover:shadow-lg hover:shadow-black/15 hover:-translate-y-0.5 hover:brightness-95 active:scale-95 active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none ${
          !disabled && "cursor-pointer"
        }`}
        title="Click to change status"
      >
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full bg-current transition-transform duration-500 ${
            justChanged ? "scale-150" : "scale-100"
          } ${isChanging ? "animate-pulse" : ""}`}
        />
        {labels[status]}
        {onStatusChange && (
          <IconChevronDown
            size={13}
            className={`shrink-0 transition-transform duration-300 ${
              open ? "rotate-180" : ""
            }`}
          />
        )}
      </button>

      {open &&
        onStatusChange &&
        menuPos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: "fixed",
              top: menuPos.openUpward ? undefined : menuPos.top,
              bottom: menuPos.openUpward
                ? window.innerHeight - menuPos.top
                : undefined,
              left: menuPos.left,
              width: MENU_WIDTH,
              maxHeight: MENU_MAX_HEIGHT,
            }}
            className="animate-fade-in z-50 overflow-y-auto rounded-xl border border-line bg-surface shadow-lg"
          >
            {(["pending", "confirmed", "completed", "cancelled"] as const).map(
              (s) => {
                const blockedReason = disabledStatuses?.[s];
                return (
                  <button
                    key={s}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleStatusChange(s);
                    }}
                    disabled={s === status || isChanging || !!blockedReason}
                    title={blockedReason}
                    className={`flex w-full items-center gap-2.5 px-3.5 py-2.5 text-sm font-medium transition-colors ${
                      s === status
                        ? "bg-foreground/10 text-foreground"
                        : "text-foreground hover:bg-background active:bg-background/70"
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full transition-colors ${
                        s === status ? "bg-emerald-400" : "bg-foreground/20"
                      }`}
                    />
                    {labels[s]}
                  </button>
                );
              }
            )}
          </div>,
          document.body
        )}
    </div>
  );
}
