import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { WorkroomSourceVersions } from "../client/src/components/workroom-source-versions";

const { api, navigate } = vi.hoisted(() => ({ api: vi.fn(), navigate: vi.fn() }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: api }));
vi.mock("wouter", () => ({ useLocation: () => ["/workroom/7", navigate] }));
const clients: QueryClient[] = [];
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.resetAllMocks(); });
const version = {
  versionId: "00000000-0000-4000-8000-000000000001", reviewRevision: 12, reviewFingerprint: "f".repeat(64),
  createdAt: "2026-10-27T10:00:00Z",
  files: [{ fileId: "00000000-0000-4000-8000-000000000002", name: "Old evidence.pdf",
    mimeType: "application/pdf", sizeBytes: 1, sha256: "a".repeat(64) }],
};
function setup(overrides: Record<string, any> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  clients.push(client);
  client.setQueryData(["/api/workrooms", "7", "source-versions"], [version]);
  const onRefresh = vi.fn();
  const props = { workroomId: "7", hasSources: true, reviewRevision: 12, reviewFingerprint: "f".repeat(64), onRefresh, ...overrides };
  const tree = (more: Record<string, any> = {}) => <QueryClientProvider client={client}>
    <WorkroomSourceVersions {...props} {...more} />
  </QueryClientProvider>;
  api.mockImplementation(async method => method === "GET" ? [version] : version);
  return { tree, onRefresh };
}

it("capture submits the clicked review and history links to the immutable copy, not the live source", async () => {
  const { tree } = setup();
  const view = render(tree());
  fireEvent.click(screen.getByTestId("button-capture-source-version"));
  view.rerender(tree({ reviewRevision: 13, reviewFingerprint: "b".repeat(64) }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("POST", "/api/workrooms/7/source-versions", {
    expectedReviewRevision: 12, expectedReviewFingerprint: "f".repeat(64),
  }));
  await waitFor(() => expect(screen.getByRole("link")).toHaveAttribute("href",
    `/api/workrooms/7/source-versions/${version.versionId}/files/${version.files[0].fileId}`));
});

it("failed capture is explicit and is not automatically retried", async () => {
  const { tree, onRefresh } = setup();
  api.mockRejectedValue(new Error("503: capture failed"));
  render(tree());
  fireEvent.click(screen.getByTestId("button-capture-source-version"));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Versi belum tersimpan"));
  expect(api).toHaveBeenCalledTimes(1);
  expect(onRefresh).toHaveBeenCalledTimes(1);
  expect(navigate).not.toHaveBeenCalled();
});

it("deletion requires confirmation, preserves a visible failure and can be retried", async () => {
  const { tree, onRefresh } = setup();
  const view = render(tree());
  fireEvent.click(screen.getByTestId("button-delete-workroom"));
  expect(screen.getByRole("alertdialog")).toHaveTextContent("Dokumen asli Ruang Simpan tetap ada");
  expect(api).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Batal"));
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByTestId("button-delete-workroom"));
  api.mockRejectedValueOnce(new Error("503: deletion incomplete"));
  fireEvent.click(screen.getByTestId("button-confirm-delete-workroom"));
  await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  expect(navigate).not.toHaveBeenCalled();
  view.rerender(tree({ deletionPending: true }));
  expect(screen.getByRole("status")).toHaveTextContent("Akses arsip dikunci");
  expect(screen.queryByTestId("button-capture-source-version")).not.toBeInTheDocument();
  fireEvent.click(screen.getByTestId("button-delete-workroom"));
  fireEvent.click(screen.getByTestId("button-confirm-delete-workroom"));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith("/workroom"));
  expect(api.mock.calls.filter(call => call[0] === "DELETE")).toHaveLength(2);
});

it("history remains accessible after live sources were unlinked", async () => {
  const { tree } = setup({ hasSources: false });
  render(tree());
  expect(screen.getByTestId("button-capture-source-version")).toBeDisabled();
  fireEvent.click(screen.getByTestId("button-source-history"));
  expect(await screen.findByText("Unduh salinan: Old evidence.pdf")).toBeInTheDocument();
});
