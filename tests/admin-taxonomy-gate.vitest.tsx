import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { role: "user", id: "granted-admin" }, isLoading: false }),
}));
vi.mock("@/hooks/use-admin-status", () => ({
  useAdminStatus: () => ({ data: { role: "admin", isAdmin: true }, isLoading: false, isError: false }),
}));
vi.mock("@/hooks/use-taxonomy", () => ({
  useTaxonomy: () => ({ data: [], isLoading: false, isError: false }),
  useTaxonomyUsage: () => ({ data: {}, isLoading: false, isError: false }),
  useTaxonomyMutations: () => ({
    create: { isPending: false }, update: { isPending: false }, remove: { isPending: false },
  }),
}));
vi.mock("@/components/shared-header", () => ({
  SharedHeader: () => <header>Header</header>,
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import AdminTaxonomyPage from "@/pages/admin-taxonomy";

describe("taxonomy admin authorization gate", () => {
  afterEach(cleanup);
  it("opens manager for a configured admin even when stored user role is user", () => {
    render(<AdminTaxonomyPage />);
    expect(screen.getByTestId("page-admin-taxonomy")).toBeInTheDocument();
    expect(screen.getByText("Belum ada kategori")).toBeInTheDocument();
    expect(screen.queryByTestId("gate-admin-taxonomy")).not.toBeInTheDocument();
  });
});
