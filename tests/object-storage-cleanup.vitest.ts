import { beforeEach, expect, it, vi } from "vitest";

const providerDelete = vi.hoisted(() => vi.fn());
vi.mock("@replit/object-storage", () => ({
  Client: class { delete = providerDelete; },
}));
const { deleteFileStrict, getStorageKey } = await import("../server/lib/object-storage");

beforeEach(() => { providerDelete.mockReset(); });

it("cleanup checks SDK result errors, not only thrown exceptions", async () => {
  providerDelete.mockResolvedValue({ ok: false, error: "unavailable" });
  await expect(deleteFileStrict("fixture/key")).rejects.toThrow("Object Storage delete gagal");
  expect(providerDelete).toHaveBeenCalledWith("fixture/key", { ignoreNotFound: true });
});

it("missing objects can be deleted repeatedly", async () => {
  providerDelete.mockResolvedValue({ ok: true, value: null });
  await deleteFileStrict("fixture/key");
  await deleteFileStrict("fixture/key");
  expect(providerDelete).toHaveBeenCalledTimes(2);
});

it("transport failure is observable by the retry queue", async () => {
  providerDelete.mockRejectedValue(new Error("transport failed"));
  await expect(deleteFileStrict("fixture/key")).rejects.toThrow("transport failed");
});

it("intent keys match upload keys, including escaped filenames", () => {
  expect(getStorageKey("owner", "id", "file #1.pdf")).toBe("ruang-simpan/owner/id/file%20%231.pdf");
});
