import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { TAXONOMY_SLUG_CONFLICT } from "../shared/taxonomy-slug";

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { role: "user", id: "admin" }, isLoading: false }),
}));
vi.mock("@/hooks/use-admin-status", () => ({
  useAdminStatus: () => ({ data: { isAdmin: true }, isLoading: false, isError: false }),
}));
vi.mock("@/hooks/use-taxonomy", () => ({
  useTaxonomy: () => ({ data: [{
    id: 1, name: "Existing", slug: "existing", level: "sektor", parentId: null,
    description: "Keep description", sortOrder: 3, isActive: true, children: [],
  }], isLoading: false, isError: false }),
  useTaxonomyUsage: () => ({ data: {}, isSuccess: true }),
  useTaxonomyMutations: () => ({
    create: { isPending: false, mutate: mocks.create },
    update: { isPending: false, mutate: mocks.update },
    remove: { isPending: false },
  }),
}));
vi.mock("@/components/shared-header", () => ({ SharedHeader: () => <header>Header</header> }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
import AdminTaxonomyPage from "@/pages/admin-taxonomy";

describe("taxonomy slug form conflict", () => {
  beforeEach(() => {
    mocks.create.mockReset();
    mocks.update.mockReset();
    const fail = (_data: unknown, callbacks: any) => callbacks.onError(new Error(
      `409: ${JSON.stringify({ code: "TAXONOMY_SLUG_CONFLICT", field: "slug", error: TAXONOMY_SLUG_CONFLICT })}`,
    ));
    mocks.create.mockImplementation(fail);
    mocks.update.mockImplementation(fail);
  });
  afterEach(cleanup);

  it.each(["create", "edit"])("keeps the %s form open, explains global conflict and lets admin correct the slug", (mode) => {
    render(<AdminTaxonomyPage />);
    if (mode === "create") {
      fireEvent.click(screen.getByTestId("button-add-taxonomy"));
      fireEvent.change(screen.getByLabelText("Nama kategori"), { target: { value: "New category" } });
    } else {
      fireEvent.click(screen.getByRole("button", { name: "Edit Existing" }));
    }
    const name = screen.getByLabelText("Nama kategori") as HTMLInputElement;
    const description = screen.getByLabelText("Deskripsi") as HTMLTextAreaElement;
    const draftName = name.value;
    const draftDescription = description.value;
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "taken" } });
    const submitName = mode === "create" ? "Buat kategori" : "Simpan perubahan";
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(TAXONOMY_SLUG_CONFLICT);
    expect(screen.getByRole("alert")).not.toHaveTextContent("409:");
    expect(name.value).toBe(draftName);
    expect(description.value).toBe(draftDescription);
    expect(screen.getByLabelText("Slug")).toHaveValue("taken");
    expect(screen.getByLabelText("Slug")).toHaveAttribute("aria-invalid", "true");

    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "available-sector" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Slug")).toHaveAttribute("aria-invalid", "false");
    const mutation = mode === "create" ? mocks.create : mocks.update;
    mutation.mockImplementationOnce((_data, callbacks) => callbacks.onSuccess());
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    const payload = mutation.mock.calls[1][0];
    expect(mode === "create" ? payload.slug : payload.data.slug).toBe("available-sector");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
