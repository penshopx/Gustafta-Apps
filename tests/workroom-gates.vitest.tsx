import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const { api, toast } = vi.hoisted(() => ({ api: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/queryClient", () => ({
  apiRequest: api, queryClient: { invalidateQueries: vi.fn() },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("wouter", async () => ({
  ...await vi.importActual("wouter"), useParams: () => ({ id: "7" }),
}));
import WorkroomDetail from "../client/src/pages/workroom-detail";

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
  vi.clearAllMocks();
});
function mount(status: string, sources: any[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  clients.push(client);
  client.setQueryData(["/api/workrooms", "7", "analysis-budget"], {
    day: "2026-10-28", nextResetAt: "2026-10-28T17:00:00Z", timezone: "Asia/Jakarta",
    callsUsed: 0, callsLimit: 10, reservedMicroUsd: 0, accountLimitMicroUsd: 1_000_000,
    globalLimitMicroUsd: 10_000_000, available: true, reason: null,
  });
  client.setQueryData(["/api/workrooms", "7"], {
    id: 7, title: "Review internal", domain: "tender", status: "active", currentStage: 0,
    stages: [
      { key: "brief", label: "Brief", status: "active" },
      { key: "review", label: "Review", status: "pending" },
    ],
    context: {}, logs: [], sources, reviewRevision: 12, reviewFingerprint: "f".repeat(64),
    gates: [{ id: 3, question: "Setujui draf?", status, stageKey: "brief", note: "" }],
  });
  api.mockResolvedValue({});
  render(<QueryClientProvider client={client}><WorkroomDetail /></QueryClientProvider>);
  return client;
}

it("pending gate locks forward progress but leaves the current stage available", async () => {
  mount("pending");
  expect(screen.getByTestId("stage-brief")).toBeEnabled();
  expect(screen.getByTestId("stage-review")).toBeDisabled();
  fireEvent.click(screen.getByTestId("button-approve-3"));
  await waitFor(() => expect(api).toHaveBeenCalledWith("POST", "/api/workrooms/7/gate/3/decide", {
    status: "approved", expectedReviewRevision: 12, expectedReviewFingerprint: "f".repeat(64),
  }));
  expect(api).not.toHaveBeenCalledWith("PATCH", expect.anything(), expect.anything());
});

it("rejected gate can be reopened for a new human decision without advancing", async () => {
  mount("rejected");
  expect(screen.getByTestId("stage-review")).toBeDisabled();
  fireEvent.click(screen.getByTestId("button-reopen-gate-3"));
  await waitFor(() => expect(api).toHaveBeenCalledWith("POST", "/api/workrooms/7/gate/3/decide", {
    status: "pending", expectedReviewRevision: 12, expectedReviewFingerprint: "f".repeat(64),
  }));
  expect(screen.queryByTestId("button-approve-3")).not.toBeInTheDocument();
});

it("approved gate unlocks the stage and supports reopening the decision", async () => {
  mount("approved");
  expect(screen.getByTestId("stage-review")).toBeEnabled();
  expect(screen.getByTestId("button-reopen-gate-3")).toBeEnabled();
  fireEvent.click(screen.getByTestId("stage-review"));
  await waitFor(() => expect(api).toHaveBeenCalledWith("PATCH", "/api/workrooms/7", {
    currentStage: 1, expectedReviewRevision: 12, expectedReviewFingerprint: "f".repeat(64),
  }));
});

it("server conflict is visible and does not optimistically advance the room", async () => {
  const client = mount("approved");
  api.mockRejectedValueOnce(new Error("Gerbang manusia belum disetujui."));
  fireEvent.click(screen.getByTestId("stage-review"));
  await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
    description: "Gerbang manusia belum disetujui.", variant: "destructive",
  })));
  expect(client.getQueryData<any>(["/api/workrooms", "7"]).currentStage).toBe(0);
});

it("approval carries the clicked snapshot even when newer data arrives", async () => {
  const client = mount("pending");
  expect(screen.getByTestId("text-review-version")).toHaveTextContent("Versi tinjauan 12");
  fireEvent.click(screen.getByTestId("button-approve-3"));
  act(() => client.setQueryData(["/api/workrooms", "7"], (old: any) => ({
    ...old, reviewRevision: 13, reviewFingerprint: "a".repeat(64),
  })));
  await waitFor(() => expect(api).toHaveBeenCalledWith("POST", "/api/workrooms/7/gate/3/decide", {
    status: "approved", expectedReviewRevision: 12, expectedReviewFingerprint: "f".repeat(64),
  }));
});

it("conflicting approval is not retried and remains visibly pending", async () => {
  mount("pending");
  api.mockRejectedValueOnce(new Error("409: Versi tinjauan sudah berubah."));
  fireEvent.click(screen.getByTestId("button-approve-3"));
  await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
    description: "409: Versi tinjauan sudah berubah.", variant: "destructive",
  })));
  expect(api).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("stage-review")).toBeDisabled();
  expect(screen.getByTestId("button-approve-3")).toBeEnabled();
});

it("unverified sources lock approval, forward progress and AI analysis", () => {
  mount("pending", [{ fileId: "00000000-0000-4000-8000-000000000001", name: "Owned A",
    availability: "verification_failed", revision: "verification_failed" }]);
  expect(screen.getByTestId("button-approve-3")).toBeDisabled();
  expect(screen.getByTestId("stage-review")).toBeDisabled();
  expect(screen.getByTestId("stage-brief")).toBeEnabled();
  expect(screen.getByText("Jalankan Analisis").closest("button")).toBeDisabled();
  expect(screen.queryByText("Buka dokumen untuk ditinjau")).not.toBeInTheDocument();
});

it("analysis submits the clicked review without approving gates or advancing", async () => {
  const client = mount("pending");
  fireEvent.click(screen.getByTestId("button-analyze"));
  await waitFor(() => expect(api).toHaveBeenCalledWith("POST", "/api/workrooms/7/analyze", {
    expectedReviewRevision: 12, expectedReviewFingerprint: "f".repeat(64),
  }, { signal: expect.any(AbortSignal), headers: { "Idempotency-Key": expect.any(String) } }));
  await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Analisis selesai" })));
  expect((client.getQueryData(["/api/workrooms", "7"]) as any).gates[0].status).toBe("pending");
  expect(api).toHaveBeenCalledTimes(1);
});

it("analysis cancellation aborts the request, refreshes history and never reports success or retries", async () => {
  const client = mount("pending");
  api.mockImplementation((_method, _url, _body, options) => new Promise((_resolve, reject) => {
    const stop = () => reject(new DOMException("Aborted", "AbortError"));
    if (options.signal.aborted) stop();
    else options.signal.addEventListener("abort", stop, { once: true });
  }));
  fireEvent.click(screen.getByTestId("button-analyze"));
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  act(() => client.setQueryData(["/api/workrooms", "7"], (old: any) => ({ ...old, reviewRevision: 13 })));
  expect(api.mock.calls[0][2].expectedReviewRevision).toBe(12);
  fireEvent.click(screen.getByTestId("button-cancel-analysis"));
  await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Permintaan dihentikan" })));
  expect(api.mock.calls[0][3].signal.aborted).toBe(true);
  expect(api).toHaveBeenCalledTimes(1);
  expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Analisis selesai" }));
});

it("finished Workroom does not offer another analysis", async () => {
  const client = mount("approved");
  act(() => client.setQueryData(["/api/workrooms", "7"], (old: any) => ({ ...old, status: "done" })));
  await waitFor(() => expect(screen.getByTestId("button-analyze")).toBeDisabled());
});

it("uncertain durable execution locks new analysis and requires an explicit risk acknowledgment", async () => {
  const client = mount("pending");
  const execution = { id: "00000000-0000-4000-8000-000000000001", status: "uncertain",
    startedAt: "2026-10-28T01:00:00Z", model: "gpt-4o" };
  act(() => client.setQueryData(["/api/workrooms", "7"], (old: any) => ({ ...old, analysisExecutions: [execution] })));
  await waitFor(() => expect(screen.getByTestId("button-analyze")).toBeDisabled());
  expect(screen.getByText("Perlu tinjauan · gpt-4o")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId(`button-review-execution-${execution.id}`));
  expect(screen.getByRole("alertdialog")).toHaveTextContent("mungkin sudah diproses atau ditagihkan");
  expect(api).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Batal"));
  expect(api).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId(`button-review-execution-${execution.id}`));
  fireEvent.click(screen.getByTestId("button-confirm-execution-uncertainty"));
  await waitFor(() => expect(api).toHaveBeenCalledWith("POST",
    `/api/workrooms/7/analysis-executions/${execution.id}/acknowledge`, { acknowledgeUncertain: true }));
  expect(api).toHaveBeenCalledTimes(1);
  expect(api.mock.calls.some(call => call[1].endsWith("/analyze"))).toBe(false);
});

it("running durable execution locks analysis after reload and cannot be released early in UI", async () => {
  const client = mount("pending");
  act(() => client.setQueryData(["/api/workrooms", "7"], (old: any) => ({ ...old,
    analysisExecutions: [{ id: "running-fixture", status: "running", startedAt: "2026-10-28T01:00:00Z", model: "gpt-4o" }] })));
  await waitFor(() => expect(screen.getByTestId("button-analyze")).toBeDisabled());
  expect(screen.getByText("Berjalan · gpt-4o")).toBeInTheDocument();
  expect(screen.queryByText("Tinjau ketidakpastian")).not.toBeInTheDocument();
  fireEvent.click(screen.getByTestId("button-analyze"));
  expect(api).not.toHaveBeenCalled();
});

it.each([
  ["account_calls", "Batas jumlah analisis akun tercapai."],
  ["account_estimate", "Sisa anggaran estimasi akun tidak mencukupi."],
  ["platform_estimate", "Sisa anggaran estimasi Workroom gabungan tidak mencukupi."],
])("daily budget locks model calls for %s and refresh never starts a model", async (reason, message) => {
  const client = mount("pending");
  act(() => client.setQueryData(["/api/workrooms", "7", "analysis-budget"], (old: any) => ({
    ...old, callsUsed: reason === "account_calls" ? 10 : 8, reservedMicroUsd: 982_441, available: false, reason,
  })));
  await waitFor(() => expect(screen.getByTestId("button-analyze")).toBeDisabled());
  expect(screen.getByRole("alert")).toHaveTextContent(message);
  expect(screen.getByText(/Reset 00.00 WIB/)).toBeInTheDocument();
  expect(screen.getByText(/Estimasi dicadangkan: USD 0.9824/)).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("button-refresh-analysis-budget"));
  fireEvent.click(screen.getByTestId("button-analyze"));
  expect(api).not.toHaveBeenCalled();
});

it("unverifiable budget disables analysis even with stale available data but does not lock human review", async () => {
  const client = mount("pending");
  act(() => client.getQueryCache().find({ queryKey: ["/api/workrooms", "7", "analysis-budget"], exact: true })!
    .setState({ status: "error", error: new Error("fixture budget unavailable"), fetchStatus: "idle" }));
  await waitFor(() => expect(screen.getByTestId("button-analyze")).toBeDisabled());
  expect(screen.getByRole("alert")).toHaveTextContent("Batas harian belum dapat diverifikasi");
  expect(screen.getByTestId("stage-brief")).toBeEnabled();
  expect(screen.getByTestId("button-approve-3")).toBeEnabled();
  expect(api).not.toHaveBeenCalled();
});
