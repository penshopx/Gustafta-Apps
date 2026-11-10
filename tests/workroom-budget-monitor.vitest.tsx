import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminWorkroomBudgetMonitor } from "../client/src/components/admin-workroom-budget-monitor";
import type { WorkroomBudgetMonitor } from "../shared/workroom-budget-monitor";

const path = "/api/admin/workroom-analysis-budget";
const clients: QueryClient[] = [];
const sample: WorkroomBudgetMonitor = {
  day: "2026-10-28", timezone: "Asia/Jakarta", nextResetAt: "2026-10-28T17:00:00.000Z",
  model: "gpt-4o", pricingVersion: "workroom-budget-v1", pricingCheckedOn: "2026-10-28",
  callsReserved: 3, activeAccounts: 2, reservedMicroUsd: 250_000, remainingMicroUsd: 9_750_000,
  globalLimitMicroUsd: 10_000_000, accountCallLimit: 10, accountLimitMicroUsd: 1_000_000,
  rejections: { total: 6, accountCalls: 1, accountEstimate: 2, platformEstimate: 3,
    firstRecordedAt: "2026-10-28T01:00:00Z", lastRecordedAt: "2026-10-28T02:00:00Z" },
};
const response = (data = sample, status = 200) => new Response(JSON.stringify(data), { status });
function mount(enabled = true, cached?: WorkroomBudgetMonitor) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  clients.push(client);
  if (cached) client.setQueryData([path], cached);
  const tree = (permission: boolean) => <QueryClientProvider client={client}>
    <AdminWorkroomBudgetMonitor enabled={permission} />
  </QueryClientProvider>;
  const view = render(tree(enabled));
  return { client, ...view, tree };
}
afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("effective admin permission controls visibility and requests, including already cached data", () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const { container } = mount(false, sample);
  expect(container).toBeEmptyDOMElement();
  expect(fetcher).not.toHaveBeenCalled();
});

it("loads real aggregate data with a no-store authenticated GET and shows estimates rather than invoices", async () => {
  const fetcher = vi.fn().mockResolvedValue(response()); vi.stubGlobal("fetch", fetcher);
  mount();
  await screen.findByTestId("workroom-budget-calls-reserved");
  expect(fetcher).toHaveBeenCalledWith(path, { credentials: "include", cache: "no-store" });
  expect(screen.getByTestId("workroom-budget-calls-reserved")).toHaveTextContent("3");
  expect(screen.getByTestId("workroom-budget-active-accounts")).toHaveTextContent("2");
  expect(screen.getByTestId("workroom-budget-reserved")).toHaveTextContent("USD 0.2500");
  expect(screen.getByTestId("workroom-budget-reserved")).toHaveTextContent("USD 9.7500");
  expect(screen.getByTestId("workroom-budget-global-limit")).toHaveTextContent("USD 10.0000");
  expect(screen.getByTestId("workroom-budget-rejections-total")).toHaveTextContent("6");
  expect(screen.getByTestId("workroom-budget-rejections-account-calls")).toHaveTextContent("1");
  expect(screen.getByTestId("workroom-budget-rejections-account-estimate")).toHaveTextContent("2");
  expect(screen.getByTestId("workroom-budget-rejections-platform-estimate")).toHaveTextContent("3");
  expect(screen.getByTestId("workroom-budget-period")).toHaveTextContent("WIB");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("refresh is read-only, prevents duplicate requests and updates the displayed totals", async () => {
  let resolve!: (value: Response) => void;
  const fetcher = vi.fn().mockResolvedValueOnce(response()).mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
  vi.stubGlobal("fetch", fetcher);
  mount();
  await screen.findByTestId("workroom-budget-calls-reserved");
  fireEvent.click(screen.getByTestId("button-refresh-workroom-budget"));
  await waitFor(() => expect(screen.getByTestId("button-refresh-workroom-budget")).toBeDisabled());
  fireEvent.click(screen.getByTestId("button-refresh-workroom-budget"));
  expect(fetcher).toHaveBeenCalledTimes(2);
  await act(async () => resolve(response({ ...sample, callsReserved: 4 })));
  await waitFor(() => expect(screen.getByTestId("workroom-budget-calls-reserved")).toHaveTextContent("4"));
  expect(fetcher.mock.calls.every(([url, options]) => url === path && !options.method && !options.body)).toBe(true);
});

it("failed refresh hides cached figures and retry is manual, not an automatic model or network retry", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response("unavailable", { status: 503 })).mockResolvedValueOnce(response());
  vi.stubGlobal("fetch", fetcher);
  mount(true, sample);
  fireEvent.click(screen.getByTestId("button-refresh-workroom-budget"));
  await screen.findByTestId("workroom-budget-error");
  expect(screen.queryByTestId("workroom-budget-calls-reserved")).not.toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByTestId("button-retry-workroom-budget"));
  await screen.findByTestId("workroom-budget-calls-reserved");
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("loading does not invent a zero and a genuine empty day is explicitly zero recorded", async () => {
  let resolve!: (value: Response) => void;
  const fetcher = vi.fn().mockImplementation(() => new Promise<Response>(done => { resolve = done; }));
  vi.stubGlobal("fetch", fetcher);
  mount();
  expect(screen.getByTestId("workroom-budget-loading")).toBeInTheDocument();
  expect(screen.queryByTestId("workroom-budget-rejections-total")).not.toBeInTheDocument();
  await act(async () => resolve(response({ ...sample, callsReserved: 0, activeAccounts: 0,
    reservedMicroUsd: 0, remainingMicroUsd: 10_000_000,
    rejections: { total: 0, accountCalls: 0, accountEstimate: 0, platformEstimate: 0, firstRecordedAt: null, lastRecordedAt: null } })));
  expect(await screen.findByTestId("workroom-budget-rejections-total")).toHaveTextContent("Total tercatat: 0");
  expect(screen.getAllByText("Belum ada catatan")).toHaveLength(2);
});

it("losing effective permission hides previously visible data and stops requests", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const view = mount(true, sample);
  expect(screen.getByTestId("workroom-budget-monitor")).toBeInTheDocument();
  view.rerender(view.tree(false));
  expect(view.container).toBeEmptyDOMElement();
  expect(fetcher).not.toHaveBeenCalled();
});
