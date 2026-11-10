export function normalizeWaPhone(phone: string | null | undefined): string {
  const digits = phone?.replace(/\D/g, "") ?? "";
  return digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
}

export function isValidWaPhone(phone: string): boolean {
  return /^62\d{8,}$/.test(phone);
}

export function buildWaUrl(message: string): string;
export function buildWaUrl(message: string, phone: string | null): string | null;
export function buildWaUrl(
  message: string,
  phone?: string | null,
): string | null {
  const normalizedPhone = normalizeWaPhone(phone);

  if (!normalizedPhone) {
    return `https://wa.me/?text=${encodeURIComponent(message)}`;
  }

  if (!isValidWaPhone(normalizedPhone)) {
    return null;
  }

  return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`;
}