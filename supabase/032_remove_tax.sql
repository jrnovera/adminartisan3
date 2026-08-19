-- Removes VAT/tax from booking pricing. Run in Supabase Dashboard > SQL
-- Editor (after booking-artisan/004_home_service.sql — this replaces the
-- same trigger body, dropping the 5% tax it added).
--
-- The trigger still stamps `tax` so the column (and every screen that reads
-- it) keeps working for historical bookings, but new bookings always get 0.
-- The tax_rate column on shop_settings is left in place but is no longer
-- read by the app — safe to drop separately later if desired.
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
    select s.home_service_enabled, s.home_service_fee
      into v_enabled, v_fee
    from public.shop_settings s
    where s.id is true;

    if not coalesce(v_enabled, false) then
      raise exception 'HOME_SERVICE_DISABLED' using errcode = 'P0001';
    end if;

    new.home_service_fee := round(coalesce(v_fee, 0), 2);
  else
    new.home_service_fee := 0;
  end if;

  -- Discount applies to the service only; the call-out fee is not discountable.
  v_net := round(new.subtotal, 2) - new.discount + new.home_service_fee;
  new.tax := 0;
  new.total := v_net;
  return new;
end;
$$;

drop trigger if exists bookings_apply_voucher on public.bookings;
create trigger bookings_apply_voucher
  before insert on public.bookings
  for each row execute function public.bookings_apply_voucher();
