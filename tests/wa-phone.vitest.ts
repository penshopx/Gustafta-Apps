import { describe, expect, it } from "vitest";
import {
  buildWaUrl,
  isValidWaPhone,
  normalizeWaPhone,
} from "../client/src/lib/wa-phone";

describe("WA phone helper", () => {
  it("normalizes formatting and an Indonesian leading zero", () => {
    expect(normalizeWaPhone("+62 812-3456-789")).toBe("628123456789");
    expect(normalizeWaPhone("0812 3456 7890")).toBe("6281234567890");
  });

  it("uses the shared strict Indonesian phone validation", () => {
    expect(isValidWaPhone("628123456789")).toBe(true);
    expect(isValidWaPhone("6281")).toBe(false);
    expect(isValidWaPhone("128123456789")).toBe(false);
  });

  it("builds direct, text-only, and invalid-phone URLs", () => {
    expect(buildWaUrl("Halo dunia", "081234567890")).toBe(
      "https://wa.me/6281234567890?text=Halo%20dunia",
    );
    expect(buildWaUrl("Halo dunia")).toBe(
      "https://wa.me/?text=Halo%20dunia",
    );
    expect(buildWaUrl("Halo dunia", "6281")).toBeNull();
  });
});