-- Artisan Admin: standalone clients table.
-- Run in Supabase Dashboard > SQL Editor.
--
-- Clients were previously derived entirely from `bookings` (see
-- deriveClients() in src/lib/bookings.ts) — there was no way to add someone
-- before their first appointment. This table lets an admin pre-register a
-- client (walk-in, phone enquiry, etc). The Clients page merges these rows
-- with the ones still derived from bookings, matched by email — see
-- mergeClientRows() in src/lib/clients.ts.

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  full_name text not null,
  email text not null unique,
  mobile text not null default '',
  address text,
  notes text
);

alter table public.clients enable row level security;

drop policy if exists "Admins manage clients" on public.clients;
create policy "Admins manage clients" on public.clients
  for all to authenticated using (true) with check (true);
