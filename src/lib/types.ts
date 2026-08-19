export type ServiceLocation = "salon" | "home";

export type BookingStatus =
  | "pending"
  | "confirmed"
  | "cancelled"
  | "completed"
  | "no_show";

export type Booking = {
  id: string;
  created_at: string;
  service_id: string;
  service_name: string;
  duration_minutes: number;
  price: number;
  staff_id: string;
  staff_name: string;
  booking_date: string;
  booking_time: string;
  subtotal: number;
  tax: number;
  total: number;
  discount: number;
  currency: string;
  full_name: string;
  email: string;
  mobile: string;
  address: string | null;
  notes: string | null;
  voucher_code: string | null;
  locale: string;
  /** Where the appointment happens — see booking-artisan/supabase/004_home_service.sql. */
  service_location: ServiceLocation;
  /** Flat call-out fee stamped by the insert trigger; 0 for salon bookings. */
  home_service_fee: number;
  status: BookingStatus;
  is_paid: boolean;
  payment_method: string | null;
  paid_at: string | null;
  tip: number;
  addons: BillAddon[];
};

export type BillAddon = { name: string; price: number; qty: number };

export type Client = {
  /** Set when this client has a row in `clients` (created explicitly, or
   *  edited); null when it exists only as an aggregate of their bookings. */
  id: string | null;
  email: string;
  full_name: string;
  mobile: string;
  address: string | null;
  notes: string | null;
  visits: number;
  totalSpent: number;
  firstVisit: string;
  lastVisit: string;
  currency: string;
};

export type Staff = {
  id: string;
  created_at: string;
  name: string;
  role: string;
  email: string | null;
  phone: string | null;
  active: boolean;
  work_start: string;
  work_end: string;
  days_off: number[];
  avatar_url: string | null;
};

export type StaffTimeOff = {
  id: string;
  created_at: string;
  staff_id: string;
  start_date: string;
  end_date: string;
  reason: string | null;
};

export type StaffBlock = {
  id: string;
  created_at: string;
  staff_id: string;
  block_date: string;
  start_minutes: number;
  end_minutes: number;
  reason: string | null;
};

export type Product = {
  id: string;
  created_at: string;
  name: string;
  sku: string | null;
  category: string;
  price: number;
  cost: number;
  stock: number;
  low_stock_at: number;
  active: boolean;
};

export type Promo = {
  id: string;
  created_at: string;
  code: string;
  description: string | null;
  discount_type: "percent" | "fixed";
  discount_value: number;
  starts_on: string | null;
  ends_on: string | null;
  usage_limit: number | null;
  times_used: number;
  active: boolean;
};

export type ServiceCategory = {
  id: string;
  created_at: string;
  name: string;
  name_ar: string | null;
  image_url: string | null;
  sort_order: number;
  active: boolean;
};

export type Service = {
  id: string;
  created_at: string;
  category_id: string | null;
  name: string;
  name_ar: string | null;
  description: string | null;
  duration_minutes: number;
  price: number;
  image_url: string | null;
  is_package: boolean;
  active: boolean;
  sort_order: number;
  /** Where this service can be booked — see supabase/016_home_services.sql. */
  available_at: "both" | "salon" | "home";
};

/** A row from public.license_keys — developer-only, see
 * supabase/025_license_keys.sql. */
export type LicenseKey = {
  id: string;
  key: string;
  starts_at: string;
  expires_at: string;
  status: "available" | "active" | "revoked";
  note: string | null;
  created_at: string;
  activated_at: string | null;
};

export type ShopSettings = {
  id: boolean;
  updated_at: string;
  shop_name: string;
  logo_url: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  currency: string;
  open_minutes: number;
  close_minutes: number;
  break_start_minutes: number | null;
  break_end_minutes: number | null;
  /** Whether the booking site offers home visits at all. */
  home_service_enabled: boolean;
  /** Flat call-out fee added to every home booking. */
  home_service_fee: number;
  /** Whether to play a notification sound when new bookings arrive. */
  notification_sound_enabled: boolean;
};
