"use client";

import { useState } from "react";
import Modal from "./Modal";
import { createClient } from "@/lib/clients";
import { logActivity } from "@/lib/activity";
import { useAuth } from "@/lib/auth";
import type { ClientRow } from "@/lib/clients";

export default function ClientForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (client: ClientRow) => void;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { session } = useAuth();
  const actor = session?.user.email ?? null;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const payload = {
      full_name: fullName.trim(),
      email: email.trim().toLowerCase(),
      mobile: mobile.trim(),
      address: address.trim() || null,
      notes: notes.trim() || null,
    };

    try {
      const id = await createClient(payload);
      logActivity({
        actor,
        entity: "client",
        entity_id: id,
        action: "created",
        summary: `Added client ${payload.full_name}`,
      });
      onSaved({ id, created_at: new Date().toISOString(), ...payload });
    } catch (err) {
      setError(
        err instanceof Error && err.message.includes("duplicate")
          ? "A client with this email already exists."
          : err instanceof Error
          ? err.message
          : "Save failed"
      );
      setBusy(false);
    }
  }

  return (
    <Modal title="Add client" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <Field label="Full name" value={fullName} onChange={setFullName} required />
        <Field
          label="Email"
          value={email}
          onChange={setEmail}
          type="email"
          required
        />
        <Field label="Mobile" value={mobile} onChange={setMobile} type="tel" />
        <Field label="Address" value={address} onChange={setAddress} />
        <Field label="Notes" value={notes} onChange={setNotes} />

        {error && <p className="text-sm text-rose-700">{error}</p>}

        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            disabled={busy}
            className="btn-primary flex-1 py-2.5 text-sm hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost px-4 py-2.5 text-sm hover:bg-background"
          >
            Cancel
          </button>
        </div>
      </form>
    </Modal>
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
      <span className="mb-1 block text-xs uppercase tracking-wide text-muted">
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
