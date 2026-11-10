/**
 * Task #236 — Cart checkout memakai URL variant Scalev ketika item punya
 * scalevVariantId DAN produk asalnya juga punya paymentUrl.
 *
 * Menguji hook produksi useCart/CartProvider langsung (bukan replika):
 *   1. addItem produk dual-field → buildCheckoutUrl() = /c/checkout?variant_ids=…
 *      dan TIDAK pernah mengembalikan paymentUrl.
 *   2. Item tanpa scalevVariantId → buildCheckoutUrl() null (rute WA).
 *   3. Alur drawer: handleCheckout membuka URL hasil buildCheckoutUrl lewat
 *      window.open — diverifikasi bahwa URL yang dibuka adalah URL variant.
 */

import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/contact", () => ({
  useContactNumbers: () => ({
    primary: "6281287941900",
    secondary: "6282299417818",
  }),
}));

import { CartProvider, useCart } from "../client/src/hooks/use-cart";
import { CartDrawer } from "../client/src/components/cart-drawer";
import { PAYMENT_BASE_URL } from "../client/src/lib/payment-base";

const SAMPLE_VARIANT_ID = 99_001;
const SAMPLE_PAYMENT_URL = "https://checkout.example.com/pay/product-url";

function wrapper({ children }: { children: React.ReactNode }) {
  return <CartProvider>{children}</CartProvider>;
}

function CartHarness() {
  const { openCart } = useCart();
  return (
    <>
      <button onClick={openCart}>Buka keranjang</button>
      <CartDrawer />
    </>
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      items: [
        { id: "sp-1", scalevVariantId: SAMPLE_VARIANT_ID },
        { id: "sp-2", scalevVariantId: null },
      ],
    }),
  }));
});

describe("useCart buildCheckoutUrl — prioritas Scalev variant", () => {
  it("item dengan scalevVariantId (produk juga punya paymentUrl) → URL /c/checkout?variant_ids=, bukan paymentUrl", () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    act(() => {
      result.current.addItem({
        id: "sp-1",
        productId: 1,
        name: "Produk Dual Field",
        price: 199_000,
        emoji: "🤖",
        // Produk asal punya paymentUrl DAN scalevVariantId; cart flow harus
        // merutekan lewat variant Scalev. (paymentUrl memang tidak dibawa ke
        // CartItem — assert di bawah memastikan URL final bukan paymentUrl.)
        scalevVariantId: SAMPLE_VARIANT_ID,
      });
    });

    act(() => {
      result.current.updateQty("sp-1", 2);
    });

    const url = result.current.buildCheckoutUrl();
    expect(url).toBe(
      `${PAYMENT_BASE_URL}/c/checkout?variant_ids=${SAMPLE_VARIANT_ID}&qty=2`
    );
    expect(url).not.toContain(SAMPLE_PAYMENT_URL);
    expect(url).toContain("/c/checkout?variant_ids=");
  });

  it("item tanpa scalevVariantId → buildCheckoutUrl() null (tidak jatuh ke paymentUrl)", () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    act(() => {
      result.current.addItem({
        id: "sp-2",
        productId: 2,
        name: "Produk Tanpa Variant",
        price: 99_000,
        emoji: "📄",
        scalevVariantId: null,
      });
    });

    expect(result.current.buildCheckoutUrl()).toBeNull();
  });

  it("campuran: hanya item ber-scalevVariantId yang masuk URL variant", () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    act(() => {
      result.current.addItem({
        id: "sp-1",
        productId: 1,
        name: "Scalev",
        price: 199_000,
        emoji: "🤖",
        scalevVariantId: SAMPLE_VARIANT_ID,
      });
      result.current.addItem({
        id: "sp-2",
        productId: 2,
        name: "Non-Scalev",
        price: 99_000,
        emoji: "📄",
        scalevVariantId: null,
      });
    });

    const url = result.current.buildCheckoutUrl();
    expect(url).toBe(
      `${PAYMENT_BASE_URL}/c/checkout?variant_ids=${SAMPLE_VARIANT_ID}&qty=1`
    );
  });
});

describe("useCart revalidateCart — variant katalog terbaru", () => {
  it("meminta respons fresh tanpa memakai cache browser", async () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    await act(async () => {
      await result.current.revalidateCart();
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/store/catalog?limit=1000&fresh=1",
      expect.objectContaining({
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      }),
    );
  });

  it("mengganti variant stale sebelum URL checkout dibuat", async () => {
    const staleVariant = 12_345;
    const liveVariant = 67_890;
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [{
          id: "sp-1",
          name: "Produk Terkini",
          price: 249_000,
          emoji: "📦",
          scalevVariantId: liveVariant,
        }],
      }),
    } as Response);
    const { result } = renderHook(() => useCart(), { wrapper });

    act(() => {
      result.current.addItem({
        id: "sp-1",
        productId: 1,
        name: "Produk Lama",
        price: 199_000,
        emoji: "🤖",
        scalevVariantId: staleVariant,
      });
    });

    let validated: Awaited<ReturnType<typeof result.current.revalidateCart>>;
    await act(async () => {
      validated = await result.current.revalidateCart();
    });

    expect(validated!.items[0].scalevVariantId).toBe(liveVariant);
    expect(result.current.buildCheckoutUrl(validated!.items)).toContain(
      `variant_ids=${liveVariant}`,
    );
    expect(result.current.buildCheckoutUrl(validated!.items)).not.toContain(
      String(staleVariant),
    );
    await waitFor(() => {
      expect(result.current.items[0].scalevVariantId).toBe(liveVariant);
    });
  });

  it("menghapus variant stale ketika admin sudah mengosongkan variant produk", async () => {
    const staleVariant = 12_345;
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [{
          id: "sp-1",
          scalevVariantId: null,
        }],
      }),
    } as Response);
    const { result } = renderHook(() => useCart(), { wrapper });

    act(() => {
      result.current.addItem({
        id: "sp-1",
        productId: 1,
        name: "Produk Lama",
        price: 199_000,
        emoji: "🤖",
        scalevVariantId: staleVariant,
      });
    });

    let validated: Awaited<ReturnType<typeof result.current.revalidateCart>>;
    await act(async () => {
      validated = await result.current.revalidateCart();
    });

    expect(validated!.items[0].scalevVariantId).toBeNull();
    expect(result.current.buildCheckoutUrl(validated!.items)).toBeNull();
  });
});

describe("CartDrawer — navigasi setelah validasi katalog", () => {
  it("membuka tab sinkron lalu menavigasikannya ke variant pengganti", async () => {
    const liveVariant = 67_890;
    localStorage.setItem("gustafta_cart_v1", JSON.stringify([{
      id: "sp-1",
      productId: 1,
      name: "Produk Lama",
      price: 199_000,
      emoji: "🤖",
      scalevVariantId: 12_345,
      qty: 1,
      selected: true,
    }]));
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [{
          id: "sp-1",
          name: "Produk Terkini",
          price: 249_000,
          emoji: "📦",
          scalevVariantId: liveVariant,
        }],
      }),
    } as Response);
    const popup = {
      location: { href: "about:blank" },
      close: vi.fn(),
    };
    const openSpy = vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);

    render(<CartProvider><CartHarness /></CartProvider>);
    fireEvent.click(screen.getByText("Buka keranjang"));
    const checkoutButton = await screen.findByRole("button", { name: /Checkout/ });
    await waitFor(() => expect(checkoutButton).not.toBeDisabled());
    fireEvent.click(checkoutButton);

    expect(openSpy).toHaveBeenCalledWith("about:blank", "_blank");
    await waitFor(() => {
      expect(popup.location.href).toContain(`variant_ids=${liveVariant}`);
    });
    expect(popup.location.href).not.toContain("12345");
  });

  it("tidak menavigasi ke variant lama setelah admin mengosongkannya", async () => {
    localStorage.setItem("gustafta_cart_v1", JSON.stringify([{
      id: "sp-1",
      productId: 1,
      name: "Produk Lama",
      price: 199_000,
      emoji: "🤖",
      scalevVariantId: 12_345,
      qty: 1,
      selected: true,
    }]));
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [{
          id: "sp-1",
          name: "Produk Terkini",
          price: 199_000,
          emoji: "📦",
          scalevVariantId: null,
        }],
      }),
    } as Response);
    const popup = {
      location: { href: "about:blank" },
      close: vi.fn(),
    };
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);

    render(<CartProvider><CartHarness /></CartProvider>);
    fireEvent.click(screen.getByText("Buka keranjang"));
    const checkoutButton = await screen.findByRole("button", { name: /Checkout/ });
    await waitFor(() => expect(checkoutButton).not.toBeDisabled());
    fireEvent.click(checkoutButton);

    await waitFor(() => {
      expect(popup.location.href).toContain("https://wa.me/");
    });
    expect(popup.location.href).not.toContain("12345");
    expect(popup.location.href).not.toContain("variant_ids");
  });
});

describe("alur checkout drawer — window.open menerima URL variant Scalev", () => {
  it("URL yang dibuka untuk item Scalev = hasil buildCheckoutUrl (bukan paymentUrl)", () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    act(() => {
      result.current.addItem({
        id: "sp-1",
        productId: 1,
        name: "Produk Dual Field",
        price: 199_000,
        emoji: "🤖",
        scalevVariantId: SAMPLE_VARIANT_ID,
      });
    });

    const openSpy = vi
      .spyOn(window, "open")
      .mockImplementation(() => null as any);

    // Replikasi minimal logika handleCheckout di cart-drawer.tsx
    // (guard statis di tests/store-catalog-scalev-variant.test.ts memastikan
    // drawer memang memfilter dengan scalevVariantId + memanggil buildCheckoutUrl()).
    const selected = result.current.items.filter((i) => i.selected);
    const scalevItems = selected.filter((i) => i.scalevVariantId);
    if (scalevItems.length > 0) {
      const url = result.current.buildCheckoutUrl() ?? PAYMENT_BASE_URL;
      window.open(url, "_blank");
    }

    expect(openSpy).toHaveBeenCalledTimes(1);
    const openedUrl = openSpy.mock.calls[0][0] as string;
    expect(openedUrl).toContain(`/c/checkout?variant_ids=${SAMPLE_VARIANT_ID}`);
    expect(openedUrl).not.toContain(SAMPLE_PAYMENT_URL);

    openSpy.mockRestore();
  });
});
