-- Makes booking tax follow the "Tax rate (%)" field on the Settings page
-- instead of a rate hardcoded in this trigger. Run in Supabase Dashboard >
-- SQL Editor. Safe to re-run (create or replace / drop-then-create).
--
-- Before this migration the trigger always charged a fixed 5% regardless of
-- what shop_settings.tax_rate was set to, so changing it in the admin app
-- had no effect on what customers were actually charged. This reads the
-- configured rate at insert time, same way home_service_fee already is.
-- ---------------------------------------------------------------
create or replace function public.bookings_apply_voucher()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_discount numeric(10, 2) := 0;
  v_code text;
  v_net numeric(10, 2);
  v_fee numeric(10, 2) := 0;
  v_enabled boolean := true;
  v_tax_rate numeric(5, 2) := 5;
begin
  if new.voucher_code is null or btrim(new.voucher_code) = '' then
    new.voucher_code := null;
    new.discount := 0;
  else
    select vv.code, vv.discount into v_code, v_discount
    from public.validate_voucher(new.voucher_code, new.subtotal) vv;

    -- Store the canonical code as configured in the admin app.
    new.voucher_code := v_code;
    new.discount := v_discount;

    update public.promos
    set times_used = times_used + 1
    where upper(code) = upper(v_code);
  end if;

  if new.service_location = 'home' then
    select s.home_service_enabled, s.home_service_fee, s.tax_rate
      into v_enabled, v_fee, v_tax_rate
    from public.shop_settings s
    where s.id is true;

    if not coalesce(v_enabled, false) then
      raise exception 'HOME_SERVICE_DISABLED' using errcode = 'P0001';
    end if;

    new.home_service_fee := round(coalesce(v_fee, 0), 2);
  else
    select s.tax_rate into v_tax_rate
    from public.shop_settings s
    where s.id is true;

    new.home_service_fee := 0;
  end if;

  -- Discount applies to the service only; the call-out fee is not
  -- discountable. VAT is charged on the fee as well as the service, so tax
  -- is taken after the fee is added rather than before.
  v_net := round(new.subtotal, 2) - new.discount + new.home_service_fee;
  new.tax := round(v_net * (coalesce(v_tax_rate, 5) / 100), 2);
  new.total := v_net + new.tax;
  return new;
end;
$$;

drop trigger if exists bookings_apply_voucher on public.bookings;
create trigger bookings_apply_voucher
  before insert on public.bookings
  for each row execute function public.bookings_apply_voucher();
