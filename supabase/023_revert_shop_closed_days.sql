-- Reverts the shop-wide closures feature (weekly day off + one-off blocked
-- dates) — the feature was removed from the app, so its schema goes too.
-- Safe to re-run.

drop view if exists public.shop_closed_dates_public;
drop table if exists public.shop_closed_dates;

alter table public.shop_settings
  drop constraint if exists shop_settings_closed_weekdays_check;

alter table public.shop_settings
  drop column if exists closed_weekdays;
