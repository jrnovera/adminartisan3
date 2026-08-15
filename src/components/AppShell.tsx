"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Sidebar from "./Sidebar";
import MobileNav from "./MobileNav";
import Topbar from "./Topbar";
import { ToastProvider } from "./Toast";
import SignOutConfirmDialog from "./SignOutConfirmDialog";
import RedeemLicenseForm from "./RedeemLicenseForm";
import { useAuth } from "@/lib/auth";
import { fetchIsLicenseActive } from "@/lib/license";
import { unlockNotificationSound } from "@/lib/notificationSound";

const publicRoutes = ["/login", "/register"];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const {
    session,
    loading,
    roleLoading,
    isPendingApproval,
    isSuperAdmin,
    isDeveloper,
    signOut,
  } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const isPublic = publicRoutes.includes(pathname);
  // null = not checked yet. Fails open (stays null → treated as active)
  // rather than locking out the whole business over a transient network
  // error — same stance role-fetch failures take elsewhere in this app.
  const [licenseActive, setLicenseActive] = useState<boolean | null>(null);

  async function handleSignOut() {
    setShowSignOutConfirm(false);
    await signOut();
  }

  // Browsers won't let a page play audio until it has seen a user gesture.
  // A new booking can arrive over the realtime channel at any moment —
  // including before anyone has clicked anything — so grab that permission
  // on the very first interaction and keep it for the rest of the session.
  useEffect(() => {
    function unlockOnce() {
      unlockNotificationSound();
      window.removeEventListener("pointerdown", unlockOnce);
      window.removeEventListener("keydown", unlockOnce);
    }
    window.addEventListener("pointerdown", unlockOnce);
    window.addEventListener("keydown", unlockOnce);
    return () => {
      window.removeEventListener("pointerdown", unlockOnce);
      window.removeEventListener("keydown", unlockOnce);
    };
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!session && !isPublic) router.replace("/login");
    if (session && isPublic) router.replace("/");
  }, [session, loading, isPublic, router]);

  function refreshLicense() {
    fetchIsLicenseActive().then(setLicenseActive, () => setLicenseActive(true));
  }

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    fetchIsLicenseActive().then(
      (active) => {
        if (!cancelled) setLicenseActive(active);
      },
      () => {
        if (!cancelled) setLicenseActive(true);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [session]);

  if (loading) return <SplashMessage>Loading your workspace…</SplashMessage>;

  if (isPublic) {
    return <ToastProvider>{children}</ToastProvider>;
  }

  if (!session) return <SplashMessage>Redirecting to sign in…</SplashMessage>;

  // A self-signup that hasn't been accepted yet by a superadmin — signed in,
  // but shown nothing except this and a way back out. Checked after the
  // role fetch settles so an approved account never flashes this by mistake.
  if (!roleLoading && isPendingApproval) {
    return (
      <ToastProvider>
        <div className="grid min-h-screen place-items-center bg-background px-4">
          <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 text-center shadow-[var(--shadow-lg)]">
            <p className="text-lg font-semibold">Waiting for approval</p>
            <p className="mt-2 text-sm text-muted">
              Your account has been created, but a superadmin needs to
              approve it before you can sign in. Check back soon, or ask them
              directly.
            </p>
            <button
              onClick={() => setShowSignOutConfirm(true)}
              className="btn-ghost mt-5 px-4 py-2 text-sm hover:bg-background"
            >
              Sign out
            </button>
          </div>
        </div>
        <SignOutConfirmDialog
          open={showSignOutConfirm}
          onConfirm={handleSignOut}
          onCancel={() => setShowSignOutConfirm(false)}
        />
      </ToastProvider>
    );
  }

  // The license has lapsed — every role except developer is locked out from
  // here on, regardless of what page they were on. Checked after the role
  // fetch settles, same as isPendingApproval above, so a developer never
  // gets bounced during the brief window before their role loads — and
  // `licenseActive === false` (not just falsy) so the still-loading `null`
  // state never briefly reads as expired.
  if (!roleLoading && licenseActive === false && !isDeveloper) {
    // isSuperAdmin here can only mean "role === superadmin" — a developer
    // would already have returned above, before this block. A plain
    // superadmin gets a code field right here, since Settings itself is
    // unreachable while frozen; staff/admin get the message only.
    return (
      <ToastProvider>
        <div className="grid min-h-screen place-items-center bg-background px-4">
          <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 text-center shadow-[var(--shadow-lg)]">
            <p className="text-lg font-semibold">License expired</p>
            <p className="mt-2 text-sm text-muted">
              {isSuperAdmin
                ? "Enter the license key the developer gave you to reactivate this dashboard."
                : "This dashboard’s license period has ended. Contact the developer to renew access."}
            </p>
            {isSuperAdmin && (
              <div className="mt-4 text-left">
                <RedeemLicenseForm onActivated={refreshLicense} />
              </div>
            )}
            <button
              onClick={() => setShowSignOutConfirm(true)}
              className="btn-ghost mt-5 px-4 py-2 text-sm hover:bg-background"
            >
              Sign out
            </button>
          </div>
        </div>
        <SignOutConfirmDialog
          open={showSignOutConfirm}
          onConfirm={handleSignOut}
          onCancel={() => setShowSignOutConfirm(false)}
        />
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <MobileNav open={navOpen} onClose={() => setNavOpen(false)} />

        {/* This column owns the scrollbar — the rail and topbar stay put. */}
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <Topbar onOpenNav={() => setNavOpen(true)} />
          {children}
        </div>
      </div>
    </ToastProvider>
  );
}

function SplashMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-primary-light to-primary text-lg font-semibold text-white shadow-lg">
          A
        </span>
        <p className="text-sm text-muted">{children}</p>
      </div>
    </div>
  );
}
