import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const mocks = vi.hoisted(() => ({ request: vi.fn(), isAdmin: true }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: mocks.request }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "configured-admin", role: "user" }, isLoading: false }) }));
vi.mock("@/hooks/use-admin-status", () => ({ useAdminStatus: () => ({ data: { isAdmin: mocks.isAdmin }, isLoading: false }) }));
vi.mock("@/hooks/use-taxonomy", () => ({
  useTaxonomy: () => ({ data: [{
    id: 3, name: "Konstruksi", slug: "konstruksi", level: "sektor",
    parentId: null, isActive: true, children: [],
  }] }),
  useTaxonomyUsage: () => ({ data: {}, isSuccess: true }),
  useTaxonomyMutations: () => ({ create: {}, update: {}, remove: {} }),
}));
vi.mock("@/components/shared-header", () => ({ SharedHeader: () => <header>Header</header> }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import AdminTaxonomyPage from "@/pages/admin-taxonomy";
import { TaxonomyHistory } from "@/components/taxonomy-history";

const snapshot = { name: "Konstruksi lama", slug: "konstruksi", description: "Metadata kategori", level: "sektor", parentId: null, sortOrder: 0, isActive: true };
const entry = (id = 90) => ({
  id, taxonomyId: 3, actorId: "admin-stable-id", action: "update",
  before: snapshot, after: { ...snapshot, name: "Konstruksi baru", isActive: false },
  createdAt: "2026-10-18T10:00:00.000Z",
});
const clients: QueryClient[] = [];
function mount(content: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  return render(<QueryClientProvider client={client}>{content}</QueryClientProvider>);
}

describe("taxonomy history UI", () => {
  beforeEach(() => { mocks.request.mockReset(); mocks.isAdmin = true; });
  afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); });

  it("uses the effective admin grant and opens per-category metadata diffs", async () => {
    mocks.request.mockResolvedValue([entry()]);
    mount(<AdminTaxonomyPage />);
    expect(mocks.request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Riwayat Konstruksi" }));
    expect(await screen.findByText("Aktor (ID akun): admin-stable-id")).toBeInTheDocument();
    expect(mocks.request).toHaveBeenCalledWith("GET", "/api/taxonomy/3/history?");
    expect(screen.getAllByRole("definition")[0]).toHaveTextContent("Sebelum: Konstruksi lamaSesudah: Konstruksi baru");
    expect(screen.getAllByRole("definition")[1]).toHaveTextContent("Sebelum: YaSesudah: Tidak");
    expect(screen.queryByText("Slug", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("Metadata kategori")).not.toBeInTheDocument();
    expect(document.querySelector("time")).toHaveAttribute("datetime", "2026-10-18T10:00:00.000Z");
  });

  it("does not offer or request history to non-admin users", () => {
    mocks.isAdmin = false;
    mount(<AdminTaxonomyPage />);
    expect(screen.getByTestId("gate-admin-taxonomy")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cari riwayat kategori" })).not.toBeInTheDocument();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("finds deleted category snapshots by name and resets cursor on a new search", async () => {
    mocks.request.mockResolvedValueOnce([]).mockResolvedValueOnce([{
      ...entry(), action: "delete", after: null,
    }]).mockResolvedValueOnce([]);
    mount(<AdminTaxonomyPage />);
    fireEvent.click(screen.getByRole("button", { name: "Cari riwayat kategori" }));
    expect(await screen.findByText("Belum ada riwayat kategori yang cocok.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Cari nama/), { target: { value: "Konstruksi lama" } });
    fireEvent.click(screen.getByRole("button", { name: "Cari", exact: true }));
    expect(await screen.findByText("Dihapus · Konstruksi lama (#3)")).toBeInTheDocument();
    expect(mocks.request).toHaveBeenLastCalledWith("GET", "/api/taxonomy/audit?search=Konstruksi+lama");
    expect(screen.getAllByRole("definition")[2]).toHaveTextContent("Sebelum: Metadata kategori");
    fireEvent.change(screen.getByLabelText(/Cari nama/), { target: { value: "kosong" } });
    fireEvent.click(screen.getByRole("button", { name: "Cari", exact: true }));
    await waitFor(() => expect(mocks.request).toHaveBeenLastCalledWith("GET", "/api/taxonomy/audit?search=kosong"));
    expect(await screen.findByText("Belum ada riwayat kategori yang cocok.")).toBeInTheDocument();
    expect(screen.queryByText("Dihapus · Konstruksi lama (#3)")).not.toBeInTheDocument();
  });

  it("appends older pages with beforeId and retries a failed next page without losing entries", async () => {
    mocks.request.mockResolvedValueOnce(Array.from({ length: 50 }, (_, index) => entry(90 - index)))
      .mockRejectedValueOnce(new Error("network unavailable")).mockResolvedValueOnce([entry(40)]);
    mount(<TaxonomyHistory target={{ id: 3, name: "Konstruksi" }} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Muat riwayat lebih lama" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Riwayat kategori gagal dimuat");
    expect(screen.getAllByRole("article")).toHaveLength(50);
    expect(mocks.request).toHaveBeenLastCalledWith("GET", "/api/taxonomy/3/history?beforeId=41");
    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(51));
    expect(screen.queryByRole("button", { name: "Muat riwayat lebih lama" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows loading and a retryable error instead of an empty history on failure", async () => {
    let reject!: (error: Error) => void;
    mocks.request.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; })).mockResolvedValueOnce([]);
    mount(<TaxonomyHistory target={null} onClose={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Memuat riwayat");
    reject(new Error("403: Forbidden"));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("Belum ada riwayat kategori yang cocok.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(await screen.findByText("Belum ada riwayat kategori yang cocok.")).toBeInTheDocument();
  });
});
