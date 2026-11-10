import { DEFAULT_PAYMENT_BASE_URL } from "../../../shared/payment-base-url";

// Base URL toko pembayaran (Scalev storefront).
// Migrasi domain berikutnya cukup ganti env VITE_PAYMENT_BASE_URL — tanpa sentuh kode.
export const PAYMENT_BASE_URL =
  import.meta.env.VITE_PAYMENT_BASE_URL || DEFAULT_PAYMENT_BASE_URL;
