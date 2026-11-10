import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KBPublicationControl } from "../client/src/components/panels/kb-publication-control";
import type { KnowledgeBase } from "../shared/schema";

const mocks = vi.hoisted(() => ({ request: vi.fn(), user: { id: "owner" }, toast: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/lib/queryClient", () => ({
  apiRequest: mocks.request, queryClient: { invalidateQueries: vi.fn() },
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const source = (visibility = "private", ownerUserId = "owner", processingStatus = "completed") =>
  ({ id: "1", agentId: "7", name: "Dokumen rahasia", visibility, ownerUserId, processingStatus }) as KnowledgeBase;
function show(kb: KnowledgeBase) {
  return render(<QueryClientProvider client={new QueryClient()}>
    <KBPublicationControl source={kb} />
  </QueryClientProvider>);
}
describe("publication confirmation", () => {
  it("loads protected history on demand, displays actor/time/revision without source contents, and paginates", async () => {
    mocks.request.mockResolvedValueOnce({
      entries: [{ id: 9, sourceId: 1, actorId: "owner", action: "publish", reason: "consent",
        contentRevision: 2, createdAt: "2026-10-18T03:00:00Z" }], nextBefore: 9,
    }).mockResolvedValueOnce({
      entries: [{ id: 8, sourceId: 1, actorId: null, action: "revoke", reason: "content_edit",
        contentRevision: 1, createdAt: "2026-10-18T02:00:00Z" }], nextBefore: null,
    });
    show(source());
    expect(mocks.request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Riwayat publikasi"));
    await screen.findByText("Pelaku: Anda — owner");
    expect(screen.getByText("Sumber #1 · Revisi 2")).toBeTruthy();
    expect(document.querySelector('time[datetime="2026-10-18T03:00:00Z"]')).toBeTruthy();
    fireEvent.click(screen.getByText("Riwayat sebelumnya"));
    await screen.findByText("Publikasi dicabut otomatis karena sumber diedit");
    expect(screen.getByText("Pelaku: Sistem")).toBeTruthy();
    expect(mocks.request).toHaveBeenCalledWith("GET", "/api/knowledge-base/1/publication/history?before=9");
  });
  it("shows empty history and makes denied/error history explicit without rendering cached entries", async () => {
    mocks.request.mockResolvedValueOnce({ entries: [], nextBefore: null });
    const rendered = show(source());
    fireEvent.click(screen.getByText("Riwayat publikasi"));
    await screen.findByText(/Belum ada riwayat publikasi/);
    rendered.unmount();
    mocks.request.mockRejectedValueOnce(new Error("403: No edit access"));
    show(source());
    fireEvent.click(screen.getByText("Riwayat publikasi"));
    await screen.findByRole("alert");
    expect(screen.queryByTestId("kb-publication-history-list")).toBeNull();
    expect(screen.getByText("Coba lagi")).toBeTruthy();
  });
  it("does not publish on opening or cancelling, sends explicit consent only on confirmation", async () => {
    mocks.request.mockResolvedValue({ visibility: "published" });
    show(source());
    expect(screen.getByText("Privat")).toBeTruthy();
    fireEvent.click(screen.getByText("Publikasikan"));
    expect(screen.getByText(/Seluruh isi sumber/)).toBeTruthy();
    expect(mocks.request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Batal"));
    expect(mocks.request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Publikasikan"));
    fireEvent.click(screen.getByText("Saya setuju, publikasikan"));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith(
      "POST", "/api/knowledge-base/1/publication", { publish: true, confirmed: true },
    ));
  });
  it("confirms revocation and explains previously delivered answers cannot be recalled", async () => {
    mocks.request.mockResolvedValue({ visibility: "private" });
    show(source("published"));
    fireEvent.click(screen.getByText("Cabut publikasi"));
    expect(screen.getByText(/tidak dapat ditarik kembali/)).toBeTruthy();
    fireEvent.click(screen.getByText("Ya, cabut publikasi"));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith(
      "POST", "/api/knowledge-base/1/publication", { publish: false, confirmed: true },
    ));
  });
  it("hides controls for another document owner and platform sources, disables unfinished sources", () => {
    const rendered = show(source("private", "other"));
    expect(screen.queryByText("Publikasikan")).toBeNull();
    rendered.unmount();
    const platform = show(source("platform"));
    expect(screen.getByText("Kurasi platform")).toBeTruthy();
    expect(screen.queryByText("Publikasikan")).toBeNull();
    platform.unmount();
    show(source("private", "owner", "processing"));
    expect((screen.getByText("Publikasikan") as HTMLButtonElement).disabled).toBe(true);
  });
  it("reports failure without changing the privacy status", async () => {
    mocks.request.mockRejectedValue(new Error("No edit access"));
    show(source());
    fireEvent.click(screen.getByText("Publikasikan"));
    fireEvent.click(screen.getByText("Saya setuju, publikasikan"));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" })));
    expect(screen.getByText("Privat")).toBeTruthy();
  });
});
