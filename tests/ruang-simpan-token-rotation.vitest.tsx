import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const { apiMock, toastMock } = vi.hoisted(() => ({ apiMock: vi.fn(), toastMock: vi.fn() }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: apiMock }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }));
import { RuangSimpanIntegrationPanel } from "../client/src/components/ruang-simpan-integration-panel";

afterEach(() => { cleanup(); vi.resetAllMocks(); });

function mount() {
  const connection = {
    id: "connection-a", revision: 7, name: "Portal Proyek", scopes: ["files:read"],
    file_ids: ["file-a"], folder_ids: ["folder-a"],
    created_at: "2026-01-01", expires_at: "2099-01-01", revoked_at: null,
  };
  const connections = [connection,
    { ...connection, id: "revoked", name: "Dicabut A", revoked_at: "2026-02-01" },
    { ...connection, id: "expired", name: "Berakhir A", expires_at: "2020-01-01" },
  ];
  const profile = { name: "", nib: "", address: "", revision: 0 };
  apiMock.mockImplementation(async (method: string, path: string) => {
    if (method === "POST") return { connection, token: "gst_rs_NEW_ONCE" };
    if (path.endsWith("/company-profile")) return profile;
    if (path.endsWith("/app-connections")) return { connections };
    if (path.endsWith("/history")) return { history: [] };
    if (path.endsWith("/files")) return [];
    if (path.endsWith("/overview")) return { folders: [] };
    throw new Error("Unexpected request");
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(["/api/ruang-simpan/company-profile"], profile);
  client.setQueryData(["/api/ruang-simpan/app-connections"], { connections });
  client.setQueryData(["/api/ruang-simpan/app-connections/history"], { history: [] });
  client.setQueryData(["/api/ruang-simpan/files"], []);
  client.setQueryData(["/api/ruang-simpan/overview"], { folders: [] });
  const view = render(<QueryClientProvider client={client}><RuangSimpanIntegrationPanel /></QueryClientProvider>);
  return { client, view };
}

it("rotasi meminta konfirmasi, mempertahankan pilihan, menampilkan token sekali dan menghapusnya saat ditutup", async () => {
  const { client, view } = mount();
  try {
    expect(screen.getAllByRole("button", { name: "Ganti token" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Ganti token" }));
    expect(screen.getByRole("dialog").textContent).toContain("Pilihan file/folder, izin, dan tanggal kedaluwarsa tidak berubah");
    fireEvent.click(screen.getByRole("button", { name: "Batal" }));
    expect(apiMock.mock.calls.filter(call => call[0] === "POST")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Ganti token" }));
    fireEvent.click(screen.getByRole("button", { name: "Ganti token sekarang" }));
    await waitFor(() => expect(screen.getByLabelText("Token akses baru, salin dan simpan sekarang")).toHaveValue("gst_rs_NEW_ONCE"));
    expect(apiMock).toHaveBeenCalledWith("POST", "/api/ruang-simpan/app-connections/connection-a/rotate-token", { revision: 7 });
    expect(screen.getByText(/Token untuk Portal Proyek/)).toBeTruthy();
    expect(screen.getAllByText("1 file · 1 folder dipilih")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Ganti token" })).toBeDisabled();
    expect(JSON.stringify(client.getQueryCache().getAll().map(query => query.state.data))).not.toContain("gst_rs_NEW_ONCE");
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
    fireEvent.click(screen.getByRole("button", { name: "Salin token akses" }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith("gst_rs_NEW_ONCE"));
    fireEvent.click(screen.getByRole("button", { name: /Sudah saya simpan, tutup token/ }));
    expect(screen.queryByLabelText("Token akses baru, salin dan simpan sekarang")).toBeNull();
    await waitFor(() => expect(client.getMutationCache().getAll().every(mutation => !mutation.state.data)).toBe(true));
    view.unmount();
    render(<QueryClientProvider client={client}><RuangSimpanIntegrationPanel /></QueryClientProvider>);
    expect(screen.queryByLabelText("Token akses baru, salin dan simpan sekarang")).toBeNull();
  } finally { cleanup(); client.clear(); }
});

it("riwayat menampilkan waktu, pelaku dan ID koneksi, lalu diperbarui setelah rotasi", async () => {
  const { client } = mount();
  try {
    await waitFor(() => expect(client.isFetching()).toBe(0));
    const entry = {
      id: "1", actor_user_id: "owner-fixture", connection_id: "connection-a",
      changed_at: "2026-10-28T08:42:15Z", action: "created",
    };
    client.setQueryData(["/api/ruang-simpan/app-connections/history"], { history: [entry] });
    await screen.findByText("Akses dibuat");
    expect(screen.getByText("Pelaku: owner-fixture")).toBeInTheDocument();
    expect(screen.getByText("ID koneksi: connection-a")).toBeInTheDocument();
    expect(document.querySelector("time")?.getAttribute("dateTime")).toBe(entry.changed_at);
    const original = apiMock.getMockImplementation()!;
    apiMock.mockImplementation(async (method: string, path: string) => {
      if (path.endsWith("/history")) return { history: [{ ...entry, id: "2", action: "token_rotated" }] };
      return original(method, path);
    });
    fireEvent.click(screen.getByRole("button", { name: "Ganti token" }));
    fireEvent.click(screen.getByRole("button", { name: "Ganti token sekarang" }));
    await screen.findByText("Token diganti");
    const region = screen.getByRole("region", { name: "Riwayat akses aplikasi" });
    expect(region.textContent).not.toContain("gst_rs_NEW_ONCE");
  } finally { cleanup(); client.clear(); }
});

it("riwayat membedakan kosong dan gagal serta bisa dimuat ulang", async () => {
  const { client } = mount();
  try {
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(screen.getByText("Belum ada perubahan akses yang tercatat.")).toBeInTheDocument();
    const original = apiMock.getMockImplementation()!;
    apiMock.mockImplementation(async (method: string, path: string) => {
      if (path.endsWith("/history")) throw new Error("503");
      return original(method, path);
    });
    fireEvent.click(screen.getByRole("button", { name: "Muat ulang riwayat" }));
    await screen.findByText("Riwayat belum dapat dimuat. Coba muat ulang riwayat.");
    apiMock.mockImplementation(async (method: string, path: string) => {
      if (path.endsWith("/history")) return { history: [] };
      return original(method, path);
    });
    fireEvent.click(screen.getByRole("button", { name: "Muat ulang riwayat" }));
    await waitFor(() => expect(screen.queryByText("Riwayat belum dapat dimuat. Coba muat ulang riwayat.")).toBeNull());
    expect(screen.getByText("Belum ada perubahan akses yang tercatat.")).toBeInTheDocument();
  } finally { cleanup(); client.clear(); }
});

it("gagal rotasi tidak menampilkan token atau melakukan retry otomatis", async () => {
  const { client } = mount();
  try {
    apiMock.mockImplementation(async (method: string, path: string) => {
      if (method === "POST") throw new Error("503: Token belum dapat diganti");
      return client.getQueryData([path]);
    });
    fireEvent.click(screen.getByRole("button", { name: "Ganti token" }));
    fireEvent.click(screen.getByRole("button", { name: "Ganti token sekarang" }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Token baru tidak diterima", variant: "destructive" })));
    expect(screen.queryByLabelText("Token akses baru, salin dan simpan sekarang")).toBeNull();
    expect(apiMock.mock.calls.filter(call => call[0] === "POST")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Ganti token sekarang" })).toBeNull();
    expect(screen.getByRole("button", { name: "Ganti token" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Muat ulang daftar aplikasi" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Ganti token" })).not.toBeDisabled());
  } finally { cleanup(); client.clear(); }
});

it("konflik tidak menerbitkan token; muat ulang harus berhasil sebelum konfirmasi dengan revisi baru", async () => {
  const { client } = mount();
  try {
    const revision = 8;
    let failReload = true;
    apiMock.mockImplementation(async (method: string, path: string, body?: { revision: number }) => {
      if (method === "POST") {
        if (body?.revision === 7) throw new Error("409: Koneksi telah berubah. Muat ulang.");
        return { connection: { name: "Portal Proyek", revision }, token: "gst_rs_AFTER_RELOAD" };
      }
      if (path.endsWith("/app-connections")) {
        if (failReload) throw new Error("503: Daftar belum dapat dibaca");
        const data = client.getQueryData<{ connections: any[] }>([path])!;
        return { connections: data.connections.map(connection => ({ ...connection, revision })) };
      }
      return client.getQueryData([path]);
    });
    fireEvent.click(screen.getByRole("button", { name: "Ganti token" }));
    fireEvent.click(screen.getByRole("button", { name: "Ganti token sekarang" }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: "Token baru tidak diterima", description: expect.stringContaining("Muat ulang"),
    })));
    expect(screen.queryByLabelText("Token akses baru, salin dan simpan sekarang")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "Muat ulang daftar aplikasi" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Muat ulang daftar aplikasi" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Muat ulang daftar aplikasi" })).not.toBeDisabled());
    expect(apiMock.mock.calls.filter(call => call[0] === "POST")).toHaveLength(1);
    failReload = false;
    fireEvent.click(screen.getByRole("button", { name: "Muat ulang daftar aplikasi" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Ganti token" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Ganti token" }));
    fireEvent.click(screen.getByRole("button", { name: "Ganti token sekarang" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      "POST", "/api/ruang-simpan/app-connections/connection-a/rotate-token", { revision: 8 },
    ));
    await waitFor(() => expect(screen.getByLabelText("Token akses baru, salin dan simpan sekarang")).toHaveValue("gst_rs_AFTER_RELOAD"));
  } finally { cleanup(); client.clear(); }
});

it("konfirmasi menyimpan revisi saat dibuka, bukan menggantinya saat daftar diperbarui di latar", async () => {
  const { client } = mount();
  try {
    fireEvent.click(screen.getByRole("button", { name: "Ganti token" }));
    const data = client.getQueryData<{ connections: any[] }>(["/api/ruang-simpan/app-connections"])!;
    client.setQueryData(["/api/ruang-simpan/app-connections"], {
      connections: data.connections.map(connection => ({ ...connection, revision: 9 })),
    });
    fireEvent.click(screen.getByRole("button", { name: "Ganti token sekarang" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      "POST", "/api/ruang-simpan/app-connections/connection-a/rotate-token", { revision: 7 },
    ));
  } finally { cleanup(); client.clear(); }
});

it("pencabutan mengirim revisi yang dikonfirmasi dan konflik meminta muat ulang tanpa retry", async () => {
  const { client } = mount();
  try {
    apiMock.mockImplementation(async (method: string, path: string) => {
      if (method === "DELETE") throw new Error("409: Koneksi telah berubah. Muat ulang sebelum mencoba lagi.");
      return client.getQueryData([path]);
    });
    // The fixture also includes an expired connection, which may still be revoked.
    fireEvent.click(screen.getAllByRole("button", { name: "Cabut akses" })[0]);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cabut akses" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      "DELETE", "/api/ruang-simpan/app-connections/connection-a", { revision: 7 },
    ));
    await waitFor(() => expect(screen.getByRole("button", { name: "Muat ulang daftar aplikasi" })).toBeTruthy());
    expect(apiMock.mock.calls.filter(call => call[0] === "DELETE")).toHaveLength(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByLabelText("Token akses baru, salin dan simpan sekarang")).toBeNull();
  } finally { cleanup(); client.clear(); }
});
