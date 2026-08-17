-- Fires the sync-to-sheets Edge Function on every insert into each listed
-- table, via pg_net — same pattern as 014_push_trigger.sql.
--
-- This file is a template: the deployed version has the real
-- SUPABASE_SERVICE_ROLE_KEY and SHEETS_WEBHOOK_SECRET substituted in place
-- of the placeholders below, applied directly via the Management API —
-- those values are deliberately NOT committed here. If you ever need to
-- recreate these triggers, swap in the real values from
-- `supabase secrets list` / Project Settings > API before running it.

create extension if not exists pg_net with schema extensions;

create or replace function public.notify_sync_to_sheets()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://sdticckqzxmgjbmbqlaj.supabase.co/functions/v1/sync-to-sheets',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
      'x-webhook-secret', '<SHEETS_WEBHOOK_SECRET>'
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', TG_TABLE_NAME,
      'record', to_jsonb(NEW)
    )
  );
  return NEW;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'bookings',
    'products',
    'promos',
    'staff',
    'staff_categories',
    'services',
    'service_categories',
    'staff_blocks',
    'staff_time_off',
    'shop_settings',
    'activity_log',
    'license_keys',
    'push_subscriptions',
    'user_roles'
  ]
  loop
    execute format(
      'drop trigger if exists trg_sync_to_sheets on public.%I;
       create trigger trg_sync_to_sheets
         after insert on public.%I
         for each row
         execute function public.notify_sync_to_sheets();',
      t, t
    );
  end loop;
end $$;
