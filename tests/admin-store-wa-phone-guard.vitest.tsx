/**
 * Store WA dialog: rendered coverage for customer-phone validation.
 *
 * This imports the real StoreWaDialogBody rendered by admin.tsx so the test
 * catches regressions in the button, window.open, and toast wiring—not merely
 * the presence of the shared phone-validation helper in source.
 */

import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

import { StoreWaDialogBody, type StoreWaOrder } from "../client/src/pages/admin";

function makeOrder(overrides: Partial<StoreWaOrder> = {}): StoreWaOrder {
  return {
    id: 1,
    productId: 42,
    customerName: "Budi",
    customerEmail: "budi@example.com",
    customerPhone: "628123456789",
    amount: 99000,
    status: "paid",
    midtransOrderId: "STORE-001",
    accessToken: "access-token",
    createdAt: new Date().toISOString(),
    downloadPath: null,
    productName: "AI Specialist Tender",
    ...overrides,
  };
}

function renderDialog(order: StoreWaOrder) {
  return render(
    <StoreWaDialogBody
      order={order}
      appUrl="https://gustafta.my.id"
      contactDisplay="0812-1111-2222"
      contactDisplay2="0812-3333-4444"
    />,
  );
}

let openSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  toastSpy.mockClear();
  openSpy = vi.fn();
  vi.stubGlobal("open", openSpy);
});

describe("Store WA dialog phone guard (real StoreWaDialogBody)", () => {
  it('nomor valid "628123456789" menampilkan "WA Langsung" dan membuka URL wa.me yang benar', () => {
    renderDialog(makeOrder());

    const button = screen.getByTestId("button-open-store-wa");
    expect(button).toHaveTextContent("WA Langsung");

    fireEvent.click(button);

    expect(openSpy).toHaveBeenCalledTimes(1);
    const [url, target] = openSpy.mock.calls[0];
    expect(url).toMatch(/^https:\/\/wa\.me\/628123456789\?text=/);
    expect(target).toBe("_blank");
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('nomor malformed "08abc" tidak membuka jendela dan menampilkan toast destruktif', () => {
    renderDialog(makeOrder({ customerPhone: "08abc" }));

    const button = screen.getByTestId("button-open-store-wa");
    expect(button).toHaveTextContent("Buka WA");
    expect(button).not.toHaveTextContent("WA Langsung");

    fireEvent.click(button);

    expect(openSpy).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Nomor tidak valid",
        description: expect.stringContaining("08abc"),
        variant: "destructive",
      }),
    );
  });
});