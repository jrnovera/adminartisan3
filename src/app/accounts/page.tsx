"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { EmptyState, ErrorBanner } from "@/components/Feedback";
import { IconUsers } from "@/components/Icons";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/lib/auth";
import { useRequireRole } from "@/lib/useRequireRole";
import {
  createAccount,
  deleteAccount,
  editAccountAuth,
  fetchUserAccounts,
  updateAccount,
  type UserAccount,
} from "@/lib/accounts";
import type { UserRole } from "@/lib/roles";

const roleLabels: Record<UserRole, string> = {
  staff: "Staff",
  admin: "Admin",
  superadmin: "Superadmin",
};

export default function AccountsPage() {
  useRequireRole({ superadminOnly: true });
  const toast = useToast();
  const { session } = useAuth();
  const [accounts, setAccounts] = useState<UserAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<UserAccount | null>(null);
  const [deleting, setDeleting] = useState<UserAccount | null>(null);

  const load = useCallback(() => {
    fetchUserAccounts().then(
      (data) => {
        setAccounts(data);
        setError(null);
        setLoading(false);
      },
      (err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load accounts");
        setLoading(false);
      }
    );
  }, []);

  useEffect(load, [load]);

  async function handleApprove(account: UserAccount) {
    setBusyId(account.user_id);
    try {
      await updateAccount(account.user_id, { approved: true });
      toast.success("Approved", `${account.email} can now sign in.`);
      load();
    } catch (err) {
      toast.error("Approval failed", err instanceof Error ? err.message : "Try again");
    } finally {
      setBusyId(null);
    }
  }

  async function handleRoleChange(account: UserAccount, role: UserRole) {
    setBusyId(account.user_id);
    try {
      await updateAccount(account.user_id, { role });
      toast.success("Role updated", `${account.email} is now ${roleLabels[role]}.`);
      load();
    } catch (err) {
      toast.error("Update failed", err instanceof Error ? err.message : "Try again");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(account: UserAccount) {
    setBusyId(account.user_id);
    try {
      await deleteAccount(account.user_id);
      toast.success("Account deleted", `${account.email} was removed.`);
      setDeleting(null);
      load();
    } catch (err) {
      toast.error("Delete failed", err instanceof Error ? err.message : "Try again");
    } finally {
      setBusyId(null);
    }
  }

  const pending = accounts.filter((a) => !a.approved);
  const approved = accounts.filter((a) => a.approved);

  return (
    <>
      <PageHeader
        title="Accounts"
        subtitle={`${accounts.length} account${accounts.length === 1 ? "" : "s"} · superadmin only`}
      />

      <main className="flex-1 space-y-6 p-4 sm:p-6">
        {error && <ErrorBanner message={error} />}

        <CreateAccountCard onCreated={load} />

        {!loading && pending.length > 0 && (
          <section className="card overflow-hidden border-amber-200">
            <h2 className="border-b border-amber-100 bg-amber-50 px-5 py-3 text-sm font-semibold text-amber-900">
              Waiting for approval ({pending.length})
            </h2>
            <ul className="divide-y divide-line">
              {pending.map((account) => (
                <li
                  key={account.user_id}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{account.email}</p>
                    <p className="text-xs text-muted">
                      Signed up as {roleLabels[account.role]}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleApprove(account)}
                      disabled={busyId === account.user_id}
                      className="btn-primary px-4 py-2 text-sm hover:btn-primary-hover disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => setDeleting(account)}
                      disabled={busyId === account.user_id}
                      className="rounded-lg border border-line px-3 py-2 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="card overflow-hidden">
          <h2 className="border-b border-line px-5 py-3 text-sm font-semibold">
            All accounts
          </h2>
          {loading ? (
            <p className="px-5 py-8 text-sm text-muted">Loading…</p>
          ) : approved.length === 0 ? (
            <EmptyState
              icon={<IconUsers size={22} />}
              title="No approved accounts yet"
              detail="Create one below, or wait for a signup to approve."
            />
          ) : (
            <ul className="divide-y divide-line">
              {approved.map((account) => (
                <li
                  key={account.user_id}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
                >
                  <p className="min-w-0 truncate font-medium">{account.email}</p>
                  <div className="flex items-center gap-2">
                    <select
                      value={account.role}
                      disabled={busyId === account.user_id}
                      onChange={(event) =>
                        handleRoleChange(account, event.target.value as UserRole)
                      }
                      className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm outline-none disabled:opacity-50"
                    >
                      <option value="staff">Staff</option>
                      <option value="admin">Admin</option>
                      <option value="superadmin">Superadmin</option>
                    </select>
                    <button
                      onClick={() => setEditing(account)}
                      disabled={busyId === account.user_id}
                      className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-surface-hover disabled:opacity-50"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setDeleting(account)}
                      disabled={
                        busyId === account.user_id ||
                        account.user_id === session?.user.id
                      }
                      title={
                        account.user_id === session?.user.id
                          ? "You can't delete your own account"
                          : undefined
                      }
                      className="rounded-lg border border-line px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      {editing && (
        <EditAccountModal
          account={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}

      {deleting && (
        <ConfirmDeleteModal
          account={deleting}
          busy={busyId === deleting.user_id}
          onClose={() => setDeleting(null)}
          onConfirm={() => handleDelete(deleting)}
        />
      )}
    </>
  );
}

function EditAccountModal({
  account,
  onClose,
  onSaved,
}: {
  account: UserAccount;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [email, setEmail] = useState(account.email);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmedEmail = email.trim();
    const emailChanged = trimmedEmail !== account.email;
    if (!emailChanged && !password) {
      setError("Change the email or set a new password first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await editAccountAuth({
        userId: account.user_id,
        ...(emailChanged ? { email: trimmedEmail } : {}),
        ...(password ? { password } : {}),
      });
      toast.success("Account updated", `${trimmedEmail} was saved.`);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update account");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-sm p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-sm font-semibold">Edit account</h2>
        <p className="mt-1 text-xs text-muted">
          Update the login email or set a new password. Leave the password
          blank to keep it unchanged.
        </p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">
              Email
            </label>
            <input
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-foreground"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">
              New password
            </label>
            <input
              type="password"
              minLength={6}
              placeholder="Leave blank to keep current password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-foreground"
            />
          </div>
          {error && <p className="text-sm text-rose-700">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-lg border border-line px-4 py-2 text-sm hover:bg-surface-hover disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="btn-primary px-4 py-2 text-sm hover:btn-primary-hover disabled:opacity-60"
            >
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CreateAccountCard({ onCreated }: { onCreated: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("staff");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createAccount({ email: email.trim(), password, role });
      toast.success("Account created", `${email.trim()} can sign in immediately.`);
      setEmail("");
      setPassword("");
      setRole("staff");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create account");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold">Create an account</h2>
      <p className="mt-1 text-xs text-muted">
        Skips the approval queue — the account can sign in right away, at
        whatever role you pick.
      </p>
      <form onSubmit={handleSubmit} className="mt-4 grid gap-3 sm:grid-cols-4">
        <input
          required
          type="email"
          placeholder="Email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-foreground sm:col-span-2"
        />
        <input
          required
          minLength={6}
          type="password"
          placeholder="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-foreground"
        />
        <select
          value={role}
          onChange={(event) => setRole(event.target.value as UserRole)}
          className="rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-foreground"
        >
          <option value="staff">Staff</option>
          <option value="admin">Admin</option>
          <option value="superadmin">Superadmin</option>
        </select>
        {error && (
          <p className="text-sm text-rose-700 sm:col-span-4">{error}</p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="btn-primary px-4 py-2 text-sm hover:btn-primary-hover disabled:opacity-60 sm:col-span-4"
        >
          {busy ? "Creating…" : "Create account"}
        </button>
      </form>
    </section>
  );
}

function ConfirmDeleteModal({
  account,
  busy,
  onClose,
  onConfirm,
}: {
  account: UserAccount;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-sm p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-sm font-semibold">Delete account</h2>
        <p className="mt-2 text-sm text-muted">
          This permanently deletes <span className="font-medium text-foreground">{account.email}</span>.
          They will no longer be able to sign in. This can&apos;t be undone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-line px-4 py-2 text-sm hover:bg-surface-hover disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-60"
          >
            {busy ? "Deleting…" : "Delete account"}
          </button>
        </div>
      </div>
    </div>
  );
}
