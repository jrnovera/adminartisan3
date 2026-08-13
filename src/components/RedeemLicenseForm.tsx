"use client";

import { useState } from "react";
import { redeemLicenseKey } from "@/lib/license";

/**
 * Superadmin-facing "type the code the developer gave you" form. Used in
 * two places: Settings (while the app is unlocked, e.g. renewing early) and
 * the freeze screen in AppShell (once the license has actually lapsed and
 * Settings itself is unreachable) — kept as one component so the two never
 * drift apart.
 */
export default function RedeemLicenseForm({
  onActivated,
}: {
  onActivated?: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<
    { kind: "ok" | "error"; message: string } | null
  >(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setStatus(null);
    try {
      await redeemLicenseKey(code);
      setCode("");
      setStatus({ kind: "ok", message: "License activated." });
      onActivated?.();
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Could not activate",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">
          License key
        </span>
        <input
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder="ARTS-XXXX-XXXX-XXXX"
          className="w-full rounded-xl border border-line px-3 py-2.5 text-sm font-mono outline-none focus:border-foreground"
        />
      </label>
      {status && (
        <p
          className={`text-sm ${
            status.kind === "ok" ? "text-emerald-700" : "text-rose-700"
          }`}
        >
          {status.message}
        </p>
      )}
      <button
        type="submit"
        disabled={busy || !code.trim()}
        className="btn-primary w-full py-2.5 text-sm hover:btn-primary-hover disabled:opacity-60"
      >
        {busy ? "Activating…" : "Activate"}
      </button>
    </form>
  );
}
