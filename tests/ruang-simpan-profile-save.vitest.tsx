import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { apiMock, toastMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  toastMock: vi.fn(),
}));
vi.mock("@/lib/queryClient", () => ({ apiRequest: apiMock }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }));

import { RuangSimpanIntegrationPanel } from "../client/src/components/ruang-simpan-integration-panel";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Ruang Simpan profile save payload", () => {
  it.each([
    { revision: 0, updated_at: null, nib: "SAMPLE-NIB-001" },
    { revision: 0, updated_at: null, nib: "" },
    { revision: 4, updated_at: "2026-10-01T00:00:00.000Z", nib: "1234567890" },
    { revision: 4, updated_at: "2026-10-01T00:00:00.000Z", nib: "" },
  ])("saves NIB '$nib' at revision $revision without read-only metadata", async (initial) => {
    let stored = { name: "Usaha awal", nib: "NIB-LAMA", address: "Alamat awal",
      revision: initial.revision, updated_at: initial.updated_at };
    const clients: QueryClient[] = [];
    apiMock.mockImplementation(async (method: string, path: string, body?: Record<string, unknown>) => {
      if (method === "PUT") {
        // Mirror the strict server write contract: GET metadata is not writable.
        expect(Object.keys(body!).sort()).toEqual(["address", "name", "nib", "revision"]);
        expect(body!.revision).toBe(stored.revision);
        stored = { name: body!.name as string, nib: body!.nib as string,
          address: body!.address as string, revision: stored.revision + 1,
          updated_at: "2026-10-04T00:00:00.000Z" };
        return stored;
      }
      if (path.endsWith("/company-profile")) return stored;
      if (path.endsWith("/app-connections")) return { connections: [] };
      if (path.endsWith("/overview")) return { folders: [] };
      if (path.endsWith("/files")) return [];
      throw new Error(`Unexpected request: ${method} ${path}`);
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    clients.push(client);
    client.setQueryData(["/api/ruang-simpan/company-profile"], stored);
    client.setQueryData(["/api/ruang-simpan/app-connections"], { connections: [] });
    client.setQueryData(["/api/ruang-simpan/files"], []);
    client.setQueryData(["/api/ruang-simpan/overview"], { folders: [] });
    try {
      render(<QueryClientProvider client={client}><RuangSimpanIntegrationPanel /></QueryClientProvider>);
      await waitFor(() => expect((screen.getByLabelText("Nama badan usaha") as HTMLInputElement).value).toBe("Usaha awal"));
      fireEvent.change(screen.getByLabelText("Nama badan usaha"), { target: { value: "Usaha sampel" } });
      fireEvent.change(screen.getByLabelText("NIB"), { target: { value: initial.nib } });
      fireEvent.click(screen.getByRole("button", { name: "Simpan profil" }));
      await waitFor(() => expect(toastMock).toHaveBeenCalledWith({ title: "Profil perusahaan tersimpan" }));
      expect(apiMock).toHaveBeenCalledWith("PUT", "/api/ruang-simpan/company-profile", {
        name: "Usaha sampel", nib: initial.nib, address: "Alamat awal", revision: initial.revision,
      });
      await waitFor(() => expect(screen.getByText(`Versi data ${initial.revision + 1}`)).toBeTruthy());
      fireEvent.change(screen.getByLabelText("Alamat perusahaan"), { target: { value: "Alamat baru" } });
      fireEvent.click(screen.getByRole("button", { name: "Simpan profil" }));
      await waitFor(() => expect(screen.getByText(`Versi data ${initial.revision + 2}`)).toBeTruthy());
      expect(apiMock).toHaveBeenCalledWith("PUT", "/api/ruang-simpan/company-profile", {
        name: "Usaha sampel", nib: initial.nib, address: "Alamat baru", revision: initial.revision + 1,
      });
    } finally {
      cleanup();
      clients.forEach((queryClient) => queryClient.clear());
    }
  });
});