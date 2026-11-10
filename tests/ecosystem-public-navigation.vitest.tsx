import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router as WouterRouter } from "wouter";
import { memoryLocation } from "wouter/memory-location";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: null, isAuthenticated: false, isLoading: false }),
}));
vi.mock("@/hooks/use-partner-branding", () => ({
  usePartnerBranding: () => ({ partner: null }),
  toDirectImageUrl: (url: string) => url,
}));
vi.mock("@/lib/contact", () => ({
  useContactNumbers: () => ({ primary: "628000000000", secondary: "628000000001", display: "0800", display2: "0801" }),
}));

import { Router } from "../client/src/App";

const destinations = [
  {
    group: "Konsultan ISO",
    label: "Konsultan ISO",
    path: "/konsultan-iso",
    heading: "Pilih Ruang Kerja Sesuai Kebutuhan",
    cards: ["ISO Hub", "SMAP–PANCEK"],
  },
  {
    group: "Portal Proyek",
    label: "Ruang Proyek",
    path: "/ruang-proyek",
    heading: "Aplikasi untuk Setiap Tahap Siklus Proyek",
    cards: ["Rancang–Bangun", "Sistem Informasi Proyek", "TukangConnect"],
  },
] as const;

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});
afterEach(cleanup);

describe("navigasi publik ke halaman ekosistem", () => {
  it.each(destinations)("mencapai $label dari menu tanpa akun", async ({ group, label, path, heading, cards }) => {
    const location = memoryLocation({ path: "/", record: true });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <WouterRouter hook={location.hook}>
          <Router />
        </WouterRouter>
      </QueryClientProvider>,
    );
    // Nav desktop mengelompokkan aplikasi di dalam dropdown.
    fireEvent.pointerDown(screen.getByRole("button", { name: group }), { button: 0, ctrlKey: false, pointerType: "mouse" });
    const menu = await screen.findByRole("menu");
    const link = within(menu).getByRole("menuitem", { name: new RegExp(label) });
    expect(link).toHaveAttribute("href", path);
    fireEvent.click(link);

    await waitFor(() => expect(location.history.at(-1)).toBe(path));
    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    for (const name of cards) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
  });
});