import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

import { HubRow } from "../client/src/pages/hub-audit";

const hub = {
  hub_id: 17,
  hub_name: "Hub Tender",
  hub_slug: "hub-tender",
  toolbox_id: 3,
  toolbox_name: "Tender",
  series_id: "tender",
  prompt_len: 100,
  prompt_preview: "Prompt",
  agentic_sub_agents_raw: "[]",
  toolbox_is_orch: true,
  candidates: [
    { agent_id: 41, agent_name: "Estimator", is_orchestrator: false, toolbox_name: "Tender", toolbox_id: 3 },
    { agent_id: 42, agent_name: "Reviewer", is_orchestrator: false, toolbox_name: "Tender", toolbox_id: 3 },
  ],
};

function renderHubRow() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <HubRow hub={hub} />
    </QueryClientProvider>,
  );
}

async function selectAndConnect() {
  renderHubRow();
  fireEvent.click(screen.getByText("Hub Tender"));
  fireEvent.click(screen.getByRole("button", { name: "Pilih Semua" }));
  fireEvent.click(screen.getByTestId("btn-auto-connect-17"));
}

beforeEach(() => {
  toastSpy.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Hub Audit auto-connect toast", () => {
  it("menampilkan warning 207 dengan ID yang dilewati dan jumlah hasil wiring aktual", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 207,
      json: async () => ({
        agenticSubAgents: [{ agentId: 41 }],
        skipped: [42, 99],
      }),
    }));

    await selectAndConnect();

    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith({
      title: "⚠️ Sebagian kandidat dilewati",
      description: "1 agen terhubung. Dilewati (tidak ditemukan): #42, #99",
      variant: "destructive",
    }));
  });

  it("menampilkan toast sukses untuk respons 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        agenticSubAgents: [{ agentId: 41 }, { agentId: 42 }],
        skipped: [],
      }),
    }));

    await selectAndConnect();

    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith({
      title: "✅ Sub-agen terhubung!",
      description: "2 agen berhasil dikonfigurasi.",
    }));
  });
});