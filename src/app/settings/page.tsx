"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import PageHeader from "@/components/PageHeader";
import {
  fetchSettings,
  saveSettings,
  updateEmail,
  updatePassword,
} from "@/lib/settings";
import {
  activateLicenseKey,
  fetchIsLicenseActive,
  fetchLicenseKeys,
  generateLicenseKey,
  revokeLicenseKey,
} from "@/lib/license";
import RedeemLicenseForm from "@/components/RedeemLicenseForm";
import { uploadImage } from "@/lib/storage";
import { logActivity } from "@/lib/activity";
import { deleteAllBookings } from "@/lib/bookings";
import { formatDateLong, formatMinutes, toDateKey } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { useShop } from "@/lib/shop";
import { useRequireRole } from "@/lib/useRequireRole";
import type { LicenseKey } from "@/lib/types";

export default function SettingsPage() {
  useRequireRole({ blockStaff: true });
  const { session, isSuperAdmin, isDeveloper } = useAuth();
  const actor = session?.user.email ?? null;
  const { reload } = useShop();

  const [shopName, setShopName] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [currency, setCurrency] = useState("AED");
  const [taxRate, setTaxRate] = useState("5");
  const [openMinutes, setOpenMinutes] = useState(9 * 60);
  const [closeMinutes, setCloseMinutes] = useState(18 * 60);
  const [hasBreak, setHasBreak] = useState(false);
  const [breakStart, setBreakStart] = useState(13 * 60);
  const [breakEnd, setBreakEnd] = useState(14 * 60);
  const [homeServiceEnabled, setHomeServiceEnabled] = useState(false);
  const [homeServiceFee, setHomeServiceFee] = useState("0");
  const [notificationSoundEnabled, setNotificationSoundEnabled] = useState(true);

  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [shopStatus, setShopStatus] = useState<Status>(null);

  const [wipeConfirmText, setWipeConfirmText] = useState("");
  const [wiping, setWiping] = useState(false);
  const [wipeStatus, setWipeStatus] = useState<Status>(null);

  async function handleDeleteAllBookings() {
    if (wipeConfirmText !== "DELETE") return;
    setWiping(true);
    setWipeStatus(null);
    try {
      await deleteAllBookings();
      logActivity({
        actor,
        entity: "booking",
        entity_id: null,
        action: "deleted",
        summary: "Deleted all bookings, transactions and clients",
        detail: "Superadmin data wipe from Settings",
      });
      setWipeConfirmText("");
      setWipeStatus({
        kind: "ok",
        message:
          "All bookings, transactions, reports and clients have been permanently deleted.",
      });
    } catch (err) {
      setWipeStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Delete failed",
      });
    } finally {
      setWiping(false);
    }
  }

  // License keys — developer-only, RLS refuses this table to anyone else,
  // so this only ever loads when isDeveloper is true.
  const [licenseKeys, setLicenseKeys] = useState<LicenseKey[]>([]);
  const [licenseKeysLoading, setLicenseKeysLoading] = useState(true);
  const [licenseBusyId, setLicenseBusyId] = useState<string | null>(null);
  const [licenseStatus, setLicenseStatus] = useState<Status>(null);
  const [generating, setGenerating] = useState(false);
  const [newKeyNote, setNewKeyNote] = useState("");
  const [newKeyStart, setNewKeyStart] = useState(toDateKey(new Date()));
  const [newKeyEnd, setNewKeyEnd] = useState(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return toDateKey(d);
  });

  function loadLicenseKeys() {
    setLicenseKeysLoading(true);
    fetchLicenseKeys().then(
      (rows) => {
        setLicenseKeys(rows);
        setLicenseKeysLoading(false);
      },
      (err: unknown) => {
        setLicenseStatus({
          kind: "error",
          message: err instanceof Error ? err.message : "Failed to load",
        });
        setLicenseKeysLoading(false);
      }
    );
  }

  useEffect(() => {
    if (isDeveloper) loadLicenseKeys();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDeveloper]);

  async function handleActivateKey(licenseKey: LicenseKey) {
    setLicenseBusyId(licenseKey.id);
    setLicenseStatus(null);
    try {
      await activateLicenseKey(licenseKey.id);
      loadLicenseKeys();
      logActivity({
        actor,
        entity: "settings",
        action: "edited",
        summary: `Activated license key ${licenseKey.key}`,
      });
    } catch (err) {
      setLicenseStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Could not activate key",
      });
    } finally {
      setLicenseBusyId(null);
    }
  }

  async function handleRevokeKey(licenseKey: LicenseKey) {
    setLicenseBusyId(licenseKey.id);
    setLicenseStatus(null);
    try {
      await revokeLicenseKey(licenseKey.id);
      loadLicenseKeys();
      logActivity({
        actor,
        entity: "settings",
        action: "edited",
        summary: `Revoked license key ${licenseKey.key}`,
      });
    } catch (err) {
      setLicenseStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Could not revoke key",
      });
    } finally {
      setLicenseBusyId(null);
    }
  }

  async function handleGenerateKey(event: React.FormEvent) {
    event.preventDefault();
    setGenerating(true);
    setLicenseStatus(null);
    try {
      const key = await generateLicenseKey({
        startsAt: new Date(newKeyStart).toISOString(),
        expiresAt: new Date(newKeyEnd).toISOString(),
        note: newKeyNote.trim() || null,
      });
      setNewKeyNote("");
      loadLicenseKeys();
      logActivity({
        actor,
        entity: "settings",
        action: "edited",
        summary: `Generated license key ${key}`,
      });
    } catch (err) {
      setLicenseStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Could not generate key",
      });
    } finally {
      setGenerating(false);
    }
  }

  // Superadmin's own view of the license — just active/expired, never the
  // key list itself (RLS on license_keys stays developer-only). Loaded
  // separately from the developer's licenseKeys state above since a plain
  // superadmin can't reach that table at all.
  const [licenseActive, setLicenseActive] = useState<boolean | null>(null);

  function loadLicenseActive() {
    fetchIsLicenseActive().then(setLicenseActive, () => setLicenseActive(null));
  }

  useEffect(() => {
    if (isSuperAdmin && !isDeveloper) loadLicenseActive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperAdmin, isDeveloper]);

  // null until edited, so the signed-in address shows without an effect.
  const [emailDraft, setEmailDraft] = useState<string | null>(null);
  const [emailStatus, setEmailStatus] = useState<Status>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [passwordStatus, setPasswordStatus] = useState<Status>(null);

  useEffect(() => {
    fetchSettings().then(
      (row) => {
        if (row) {
          setShopName(row.shop_name);
          setLogoUrl(row.logo_url);
          setEmail(row.email ?? "");
          setPhone(row.phone ?? "");
          setAddress(row.address ?? "");
          setCurrency(row.currency);
          setTaxRate(String(row.tax_rate));
          setOpenMinutes(row.open_minutes ?? 9 * 60);
          setCloseMinutes(row.close_minutes ?? 18 * 60);
          const hasStoredBreak =
            row.break_start_minutes != null && row.break_end_minutes != null;
          setHasBreak(hasStoredBreak);
          if (hasStoredBreak) {
            setBreakStart(row.break_start_minutes as number);
            setBreakEnd(row.break_end_minutes as number);
          }
          setHomeServiceEnabled(row.home_service_enabled ?? false);
          setHomeServiceFee(String(row.home_service_fee ?? 0));
          setNotificationSoundEnabled(row.notification_sound_enabled ?? true);
        }
        setLoading(false);
      },
      (err: unknown) => {
        setShopStatus({
          kind: "error",
          message: err instanceof Error ? err.message : "Failed to load",
        });
        setLoading(false);
      }
    );
  }, []);

  async function saveShop(event: React.FormEvent) {
    event.preventDefault();
    setShopStatus(null);
    try {
      await saveSettings({
        shop_name: shopName.trim(),
        logo_url: logoUrl,
        email: email.trim() || null,
        phone: phone.trim() || null,
        address: address.trim() || null,
        currency: currency.trim() || "AED",
        tax_rate: Number(taxRate) || 0,
        open_minutes: openMinutes,
        close_minutes: closeMinutes,
        break_start_minutes: hasBreak ? breakStart : null,
        break_end_minutes: hasBreak ? breakEnd : null,
        home_service_enabled: homeServiceEnabled,
        home_service_fee: Math.max(0, Number(homeServiceFee) || 0),
        notification_sound_enabled: notificationSoundEnabled,
      });
      reload();
      setShopStatus({ kind: "ok", message: "Business details saved." });
      logActivity({
        actor,
        entity: "settings",
        action: "edited",
        summary: "Updated business settings",
        detail: `Hours ${formatMinutes(openMinutes)}–${formatMinutes(
          closeMinutes
        )}${
          hasBreak
            ? ` · Break ${formatMinutes(breakStart)}–${formatMinutes(breakEnd)}`
            : ""
        } · Tax ${taxRate}% · Home service ${
          homeServiceEnabled ? `on (${homeServiceFee})` : "off"
        }`,
      });
    } catch (err) {
      setShopStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Save failed",
      });
    }
  }

  const accountEmail = emailDraft ?? session?.user.email ?? "";

  async function saveEmail(event: React.FormEvent) {
    event.preventDefault();
    setEmailStatus(null);
    try {
      await updateEmail(accountEmail.trim());
      setEmailStatus({
        kind: "ok",
        message: "Check your inbox to confirm the new address.",
      });
      logActivity({
        actor,
        entity: "settings",
        action: "edited",
        summary: "Requested account email change",
        detail: accountEmail.trim(),
      });
    } catch (err) {
      setEmailStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Update failed",
      });
    }
  }

  async function savePassword(event: React.FormEvent) {
    event.preventDefault();
    setPasswordStatus(null);

    if (password !== confirm) {
      setPasswordStatus({ kind: "error", message: "Passwords do not match." });
      return;
    }

    try {
      await updatePassword(password);
      setPassword("");
      setConfirm("");
      setPasswordStatus({ kind: "ok", message: "Password updated." });
      logActivity({
        actor,
        entity: "settings",
        action: "edited",
        summary: "Changed account password",
      });
    } catch (err) {
      setPasswordStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Update failed",
      });
    }
  }

  return (
    <>
      <PageHeader title="Settings" subtitle="Business and account configuration" />

      <main className="flex-1 space-y-5 p-4 sm:space-y-6 sm:p-6">
        {loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (
          <Section
            title="Business information"
            description="Shown on your booking page and receipts."
          >
            <form onSubmit={saveShop} className="space-y-4">
              <div className="flex flex-wrap items-center gap-4">
                {logoUrl ? (
                  <Image
                    src={logoUrl}
                    alt="Shop logo"
                    width={64}
                    height={64}
                    unoptimized
                    className="h-16 w-16 rounded-2xl object-cover"
                  />
                ) : (
                  <span className="grid h-16 w-16 place-items-center rounded-2xl bg-background text-xl">
                    ✦
                  </span>
                )}
                <div>
                  <label className="btn-ghost inline-block cursor-pointer px-3 py-1.5 text-xs hover:bg-background">
                    {uploading ? "Uploading…" : logoUrl ? "Change logo" : "Upload logo"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={uploading}
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        setUploading(true);
                        setShopStatus(null);
                        try {
                          setLogoUrl(await uploadImage("shop-assets", file));
                        } catch (err) {
                          setShopStatus({
                            kind: "error",
                            message:
                              err instanceof Error
                                ? err.message
                                : "Upload failed",
                          });
                        } finally {
                          setUploading(false);
                        }
                      }}
                    />
                  </label>
                  {logoUrl && (
                    <button
                      type="button"
                      onClick={() => setLogoUrl(null)}
                      className="ml-2 text-xs text-rose-700 hover:underline"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>

              <Field label="Shop name" value={shopName} onChange={setShopName} required />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Contact email" value={email} onChange={setEmail} type="email" />
                <Field label="Phone" value={phone} onChange={setPhone} />
              </div>
              <Field label="Address" value={address} onChange={setAddress} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Currency" value={currency} onChange={setCurrency} />
                <Field label="Tax rate (%)" value={taxRate} onChange={setTaxRate} type="number" />
              </div>

              <div className="border-t border-line pt-4">
                <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">
                  Home service
                </p>
                <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    checked={homeServiceEnabled}
                    onChange={(e) => setHomeServiceEnabled(e.target.checked)}
                    className="h-4 w-4 accent-[var(--primary)]"
                  />
                  Let clients book a visit at their own address
                </label>
                {homeServiceEnabled && (
                  <div className="mt-3 sm:max-w-[50%]">
                    <Field
                      label={`Call-out fee (${currency})`}
                      value={homeServiceFee}
                      onChange={setHomeServiceFee}
                      type="number"
                    />
                    <p className="mt-1.5 text-xs text-muted">
                      Added to every home booking, before tax. Set 0 to charge
                      nothing extra.
                    </p>
                  </div>
                )}
              </div>

              <div className="border-t border-line pt-4">
                <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">
                  Opening hours
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <TimeSelect
                    label="Opens at"
                    value={openMinutes}
                    onChange={(next) => {
                      setOpenMinutes(next);
                      if (next >= closeMinutes) {
                        setCloseMinutes(Math.min(next + 60, 1440));
                      }
                    }}
                  />
                  <TimeSelect
                    label="Closes at"
                    value={closeMinutes}
                    onChange={setCloseMinutes}
                    min={openMinutes + 15}
                  />
                </div>

                <label className="mt-4 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={hasBreak}
                    onChange={(event) => setHasBreak(event.target.checked)}
                  />
                  Daily break (staff unavailable, e.g. lunch)
                </label>

                {hasBreak && (
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <TimeSelect
                      label="Break starts"
                      value={breakStart}
                      onChange={(next) => {
                        setBreakStart(next);
                        if (next >= breakEnd) {
                          setBreakEnd(Math.min(next + 60, 1440));
                        }
                      }}
                    />
                    <TimeSelect
                      label="Break ends"
                      value={breakEnd}
                      onChange={setBreakEnd}
                      min={breakStart + 15}
                    />
                  </div>
                )}
              </div>

              <Status status={shopStatus} />
              <button className="btn-primary w-full px-5 py-2.5 text-sm hover:btn-primary-hover sm:w-auto">
                Save changes
              </button>
            </form>
          </Section>
        )}

        <Section
          title="Notifications"
          description="Control how you receive alerts about new bookings."
        >
          <label className="flex cursor-pointer items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={notificationSoundEnabled}
              onChange={(e) => {
                setNotificationSoundEnabled(e.target.checked);
                // Also save immediately
                saveSettings({
                  notification_sound_enabled: e.target.checked,
                }).then(
                  () => {
                    logActivity({
                      actor,
                      entity: "settings",
                      action: "edited",
                      summary: `${e.target.checked ? "Enabled" : "Disabled"} notification sound`,
                    });
                  },
                  (err) => {
                    setShopStatus({
                      kind: "error",
                      message: err instanceof Error ? err.message : "Save failed",
                    });
                  }
                );
              }}
              className="h-4 w-4 accent-[var(--primary)]"
            />
            Play sound when new bookings arrive
          </label>
        </Section>

        <Section
          title="Account email"
          description="Used to sign in to this dashboard."
        >
          <form onSubmit={saveEmail} className="space-y-4">
            <Field
              label="Email"
              value={accountEmail}
              onChange={setEmailDraft}
              type="email"
              required
            />
            <Status status={emailStatus} />
            <button className="btn-primary w-full px-5 py-2.5 text-sm hover:btn-primary-hover sm:w-auto">
              Update email
            </button>
          </form>
        </Section>

        <Section title="Password" description="Use at least 6 characters.">
          <form onSubmit={savePassword} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="New password"
                value={password}
                onChange={setPassword}
                type="password"
                required
              />
              <Field
                label="Confirm password"
                value={confirm}
                onChange={setConfirm}
                type="password"
                required
              />
            </div>
            <Status status={passwordStatus} />
            <button className="btn-primary w-full px-5 py-2.5 text-sm hover:btn-primary-hover sm:w-auto">
              Update password
            </button>
          </form>
        </Section>

        {isSuperAdmin && !isDeveloper && (
          <Section
            title="License"
            description="Enter the code the developer gave you to activate or renew this dashboard."
          >
            <div className="mb-4 flex items-center gap-2 text-sm">
              <span className="text-muted">Status:</span>
              {licenseActive === null ? (
                <span className="text-muted">Checking…</span>
              ) : licenseActive ? (
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                  Active
                </span>
              ) : (
                <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-semibold text-rose-700">
                  Expired
                </span>
              )}
            </div>
            <RedeemLicenseForm onActivated={loadLicenseActive} />
          </Section>
        )}

        {isDeveloper && (
          <Section
            title="License keys"
            description="Developer only. One active key keeps the app unlocked app-wide — see the freeze screen everyone else gets once it lapses."
          >
            <div className="mt-2">
              <Status status={licenseStatus} />
            </div>

            {licenseKeysLoading ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : licenseKeys.length === 0 ? (
              <p className="text-sm text-muted">
                No keys yet — generate one below.
              </p>
            ) : (
              <ul className="space-y-2">
                {licenseKeys.map((k) => {
                  const expired = new Date(k.expires_at) <= new Date();
                  return (
                    <li
                      key={k.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-medium">{k.key}</span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                              k.status === "active"
                                ? "bg-emerald-100 text-emerald-800"
                                : k.status === "revoked"
                                ? "bg-rose-100 text-rose-700"
                                : "bg-foreground/10 text-muted"
                            }`}
                          >
                            {k.status === "active"
                              ? "Active"
                              : k.status === "revoked"
                              ? "Revoked"
                              : "Available"}
                          </span>
                          {expired && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                              Expired
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-muted">
                          {formatDateLong(k.starts_at.slice(0, 10))} –{" "}
                          {formatDateLong(k.expires_at.slice(0, 10))}
                          {k.note ? ` · ${k.note}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {k.status !== "active" && k.status !== "revoked" && (
                          <button
                            onClick={() => handleActivateKey(k)}
                            disabled={licenseBusyId === k.id}
                            className="btn-primary px-3 py-1.5 text-xs hover:btn-primary-hover disabled:opacity-60"
                          >
                            {licenseBusyId === k.id ? "…" : "Activate"}
                          </button>
                        )}
                        {k.status !== "revoked" && (
                          <button
                            onClick={() => handleRevokeKey(k)}
                            disabled={licenseBusyId === k.id}
                            className="rounded-lg border border-line px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                          >
                            Revoke
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <form
              onSubmit={handleGenerateKey}
              className="mt-4 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-end"
            >
              <label className="block sm:w-40">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">
                  Starts
                </span>
                <input
                  type="date"
                  value={newKeyStart}
                  onChange={(e) => setNewKeyStart(e.target.value)}
                  required
                  className="w-full rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-foreground"
                />
              </label>
              <label className="block sm:w-40">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">
                  Expires
                </span>
                <input
                  type="date"
                  value={newKeyEnd}
                  onChange={(e) => setNewKeyEnd(e.target.value)}
                  required
                  className="w-full rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-foreground"
                />
              </label>
              <label className="block flex-1">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">
                  Note (optional)
                </span>
                <input
                  value={newKeyNote}
                  onChange={(e) => setNewKeyNote(e.target.value)}
                  placeholder="Renewal 2027, client copy…"
                  className="w-full rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-foreground"
                />
              </label>
              <button
                type="submit"
                disabled={generating}
                className="btn-primary shrink-0 px-5 py-2.5 text-sm hover:btn-primary-hover disabled:opacity-60"
              >
                {generating ? "Generating…" : "Generate key"}
              </button>
            </form>
          </Section>
        )}

        {isDeveloper && (
          <Section
            title="Danger Zone"
            description="Developer only. These actions cannot be undone."
          >
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
              <p className="text-sm font-medium text-rose-900">
                Delete all bookings
              </p>
              <p className="mt-1 text-sm text-rose-800">
                Permanently deletes every booking. Appointments, Transactions,
                Reports and Clients all read from the same records, so this
                clears all four screens at once — there is no undo and no
                trash to recover from.
              </p>
              <label className="mt-3 block text-xs font-medium uppercase tracking-wide text-rose-800">
                Type DELETE to confirm
              </label>
              <input
                value={wipeConfirmText}
                onChange={(event) => setWipeConfirmText(event.target.value)}
                placeholder="DELETE"
                className="mt-1 w-full rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm outline-none focus:border-rose-500 sm:w-64"
              />
              <div className="mt-3">
                <button
                  onClick={handleDeleteAllBookings}
                  disabled={wipeConfirmText !== "DELETE" || wiping}
                  className="rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-medium text-white shadow-[var(--shadow-xs)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {wiping ? "Deleting…" : "Delete all bookings"}
                </button>
              </div>
              <div className="mt-2">
                <Status status={wipeStatus} />
              </div>
            </div>
          </Section>
        )}
      </main>
    </>
  );
}

type Status = { kind: "ok" | "error"; message: string } | null;

function Status({ status }: { status: Status }) {
  if (!status) return null;
  return (
    <p
      className={`text-sm ${
        status.kind === "ok" ? "text-emerald-700" : "text-rose-700"
      }`}
    >
      {status.message}
    </p>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card max-w-2xl p-5 sm:p-6">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mb-5 mt-0.5 text-sm text-muted">{description}</p>
      {children}
    </section>
  );
}

function TimeSelect({
  label,
  value,
  onChange,
  min = 0,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
}) {
  const options = Array.from({ length: (24 * 60) / 15 + 1 }, (_, i) => i * 15)
    .filter((minutes) => minutes >= min)
    .filter((minutes) => minutes <= 24 * 60);

  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full rounded-xl border border-line px-3 py-2.5 text-sm outline-none focus:border-foreground"
      >
        {options.map((minutes) => (
          <option key={minutes} value={minutes}>
            {formatMinutes(minutes === 24 * 60 ? 0 : minutes)}
          </option>
        ))}
      </select>
    </label>
  );
}

function Field({
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
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </span>
      <input
        type={type}
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-line px-3 py-2.5 text-sm outline-none focus:border-foreground"
      />
    </label>
  );
}
