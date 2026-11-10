import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { WorkroomSourcePanel } from "../client/src/components/workroom-source-panel";

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: api }));
const clients: QueryClient[] = [];
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.resetAllMocks(); });
const fileId = "00000000-0000-4000-8000-000000000001";
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  clients.push(client);
  client.setQueryData(["/api/workrooms", "7", "source-options"], [{ fileId, name: "Owned A" }]);
  const onSaved = vi.fn();
  const props = { workroomId: "7", reviewRevision: 12, reviewFingerprint: "f".repeat(64), sources: [], onSaved };
  const tree = (overrides: Record<string, any> = {}) => (
    <QueryClientProvider client={client}><WorkroomSourcePanel {...props} {...overrides} /></QueryClientProvider>
  );
  return { tree, onSaved };
}

it("selects an owned source and keeps the opening snapshot despite background refresh", async () => {
  const { tree, onSaved } = setup();
  api.mockRejectedValue(new Error("409: stale review"));
  const view = render(tree());
  fireEvent.click(screen.getByTestId("button-edit-sources"));
  fireEvent.click(screen.getByLabelText("Owned A"));
  view.rerender(tree({ reviewRevision: 13, reviewFingerprint: "a".repeat(64) }));
  fireEvent.click(screen.getByTestId("button-save-sources"));
  await waitFor(() => expect(api).toHaveBeenCalledWith("POST", "/api/workrooms/7/sources", {
    fileIds: [fileId], expectedReviewRevision: 12, expectedReviewFingerprint: "f".repeat(64),
  }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Tidak tersimpan"));
  expect(onSaved).toHaveBeenCalledTimes(1);
  expect(api).toHaveBeenCalledTimes(1);
});

it("lets the owner detach an unreadable source without opening a download", async () => {
  const { tree, onSaved } = setup();
  api.mockResolvedValue({});
  render(tree({ sources: [{ fileId, name: "Owned A", availability: "verification_failed", revision: "verification_failed" }] }));
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  fireEvent.click(screen.getByTestId("button-edit-sources"));
  expect(screen.getByLabelText("Owned A")).toBeChecked();
  fireEvent.click(screen.getByLabelText("Owned A"));
  fireEvent.click(screen.getByTestId("button-save-sources"));
  await waitFor(() => expect(api).toHaveBeenCalledWith("POST", "/api/workrooms/7/sources", {
    fileIds: [], expectedReviewRevision: 12, expectedReviewFingerprint: "f".repeat(64),
  }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
});
