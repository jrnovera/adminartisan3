-- Keeps `clients` in sync with `bookings` automatically, on every booking,
-- from either app: the public booking site (anon key, INSERT-only on
-- bookings) or the admin's own "New appointment" modal.
--
-- Email is the identity check across both systems, matching how the app
-- already treats it everywhere else (mergeClientRows() in
-- src/lib/clients.ts merges bookings-derived clients with real `clients`
-- rows the same way). Emails are lowercased before matching/storing since
-- ClientForm.tsx already normalizes admin-created clients the same way —
-- otherwise "Jane@x.com" and "jane@x.com" would silently become two
-- different client accounts.
--
--   * New email  -> a `clients` row is created automatically. A first-time
--     booking is now enough to become a real client (with a real id), not
--     just a derived aggregate — see Client.id in src/lib/types.ts.
--   * Known email -> only mobile/address are refreshed from this latest
--     booking. full_name is deliberately left alone: someone else booking
--     under the same email (a partner, an assistant, a typo) must never
--     silently rename an existing client's account. `notes` is untouched
--     too — that's an admin-only field with no equivalent on a booking.
--
-- security definer lets this run despite `clients`' RLS (admin-only) even
-- though the booking that triggers it was inserted by the anon role — the
-- anon key still has no direct access to `clients`, only this one narrow,
-- automatic path. Wrapped in its own exception handler so a sync hiccup can
-- never roll back the booking itself.

create or replace function public.sync_client_from_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.clients (full_name, email, mobile, address)
  values (new.full_name, lower(trim(new.email)), new.mobile, new.address)
  on conflict (email) do update
    set mobile = excluded.mobile,
        address = coalesce(excluded.address, public.clients.address);
  return new;
exception
  when others then
    -- Visible in Postgres logs without failing the booking insert itself.
    raise warning 'sync_client_from_booking failed for booking %: %',
      new.id, sqlerrm;
    return new;
end;
$$;

drop trigger if exists trg_sync_client_from_booking on public.bookings;
create trigger trg_sync_client_from_booking
  after insert on public.bookings
  for each row
  execute function public.sync_client_from_booking();
