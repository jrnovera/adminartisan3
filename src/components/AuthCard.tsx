"use client";

import Image from "next/image";
import { useShop } from "@/lib/shop";

// Fixed, hand-placed spread rather than randomized — random positions
// would reshuffle on every render/hydration and risk clustering or
// clipping. Colors are low-alpha so they stay a background texture even
// with the blur removed.
const bubbles = [
  { left: "8%", top: "14%", size: "120px", color: "rgba(236,72,153,0.14)", duration: "8s", delay: "0s" },
  { left: "82%", top: "10%", size: "90px", color: "rgba(59,130,246,0.14)", duration: "9.5s", delay: "1.2s" },
  { left: "70%", top: "68%", size: "150px", color: "rgba(245,158,11,0.12)", duration: "10s", delay: "0.6s" },
  { left: "14%", top: "72%", size: "100px", color: "rgba(16,185,129,0.13)", duration: "7.5s", delay: "2s" },
  { left: "45%", top: "4%", size: "70px", color: "rgba(139,92,246,0.14)", duration: "6.5s", delay: "0.8s" },
  { left: "92%", top: "42%", size: "80px", color: "rgba(244,63,94,0.12)", duration: "8.5s", delay: "1.6s" },
];

export default function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  // Same brand mark as the sidebar's top-left logo — an uploaded shop
  // logo if there is one, otherwise a gradient initial — so signing in
  // shows the same identity the rest of the dashboard does instead of a
  // generic, hardcoded "Artisan" sparkle.
  const { settings } = useShop();

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-background px-4">
      {/* Soft brand-colored glow on the light page background — replaces the
          previous near-black rail backdrop. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(50rem 34rem at 12% -8%, rgba(138,144,112,0.22), transparent 60%), radial-gradient(42rem 30rem at 108% 108%, rgba(109,115,86,0.16), transparent 60%)",
        }}
      />

      {/* Floating bubbles — a handful of soft, differently-tinted circles
          that lazily bob in place behind the card. Kept low-opacity and
          blurred so they read as ambient texture, not decoration you'd
          actually notice, and never intercept clicks. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        {bubbles.map((bubble, index) => (
          <span
            key={index}
            className="animate-float-bubble absolute rounded-full blur-xl"
            style={{
              left: bubble.left,
              top: bubble.top,
              width: bubble.size,
              height: bubble.size,
              background: bubble.color,
              "--float-duration": bubble.duration,
              "--float-delay": bubble.delay,
            } as React.CSSProperties}
          />
        ))}
      </div>

      <div className="animate-pop-in relative w-full max-w-sm rounded-3xl border border-line bg-surface p-8 shadow-[var(--shadow-xl)]">
        <div className="mb-6 flex items-center gap-3">
          {settings?.logo_url ? (
            <Image
              src={settings.logo_url}
              alt=""
              width={40}
              height={40}
              className="h-10 w-10 shrink-0 rounded-xl object-cover ring-1 ring-black/5"
              unoptimized
            />
          ) : (
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary-light to-primary text-lg font-semibold text-white shadow-lg shadow-primary/20">
              {(settings?.shop_name ?? "Artisan").slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-semibold text-foreground">
              {settings?.shop_name ?? "Artisan"}
            </p>
            <p className="truncate text-[11px] tracking-widest text-primary-dark">
              SALON &amp; SPA
            </p>
          </div>
        </div>

        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        <p className="mb-6 text-sm text-muted">{subtitle}</p>

        {children}

        {footer && (
          <p className="mt-6 text-center text-sm text-muted">{footer}</p>
        )}
      </div>
    </main>
  );
}
