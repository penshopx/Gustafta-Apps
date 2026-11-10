import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { KnowledgeTaxonomyTreeNode } from "@shared/schema";
import { selectActiveTaxonomy, useTaxonomy } from "@/hooks/use-taxonomy";
import { KnowledgeTaxonomySelect } from "@/components/panels/knowledge-taxonomy-select";

function node(id: number, name: string, isActive = true, children: KnowledgeTaxonomyTreeNode[] = []): KnowledgeTaxonomyTreeNode {
  return {
    id, name, slug: `category-${id}`, isActive, children,
    level: "sektor", parentId: null, createdAt: "", description: "", sortOrder: id,
  };
}

const tree = [
  node(1, "Konstruksi", true, [
    node(2, "Bangunan"),
    node(3, "Jalan nonaktif", false, [node(4, "Topik aktif di jalan nonaktif")]),
    node(5, "Jembatan", true, [node(6, "Topik nonaktif", false), node(7, "Topik aktif")]),
  ]),
  node(8, "Induk nonaktif", false, [node(9, "Anak aktif dari induk nonaktif")]),
  node(10, "Sektor kosong", true, [node(11, "Anak nonaktif", false)]),
];

function setup(data: KnowledgeTaxonomyTreeNode[] | undefined = tree) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  if (data) client.setQueryData(["/api/taxonomy"], data);
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

function Draft({ initialId = null }: { initialId?: number | null }) {
  const [taxonomyId, setTaxonomyId] = useState<number | null>(initialId);
  return <>
    <KnowledgeTaxonomySelect taxonomyId={taxonomyId} onChange={setTaxonomyId} />
    <output data-testid="draft-taxonomy">{taxonomyId ?? "none"}</output>
  </>;
}

function open(testId: string) {
  fireEvent.pointerDown(screen.getByTestId(testId), { button: 0, ctrlKey: false, pointerType: "mouse" });
}

describe("KB taxonomy choices and historical references", () => {
  afterEach(cleanup);

  it("prunes inactive branches recursively without changing the original tree", () => {
    const original = JSON.stringify(tree);
    const active = selectActiveTaxonomy(tree);
    expect(active.map((entry) => entry.id)).toEqual([1, 10]);
    expect(active[0].children.map((entry) => entry.id)).toEqual([2, 5]);
    expect(active[0].children[1].children.map((entry) => entry.id)).toEqual([7]);
    expect(active[1].children).toEqual([]);
    expect(JSON.stringify(tree)).toBe(original);
    expect(active[0]).not.toBe(tree[0]);
  });

  it("keeps inactive labels and IDs for references/admin in the same cache", () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(() => ({
      references: useTaxonomy(),
      choices: useTaxonomy(true, { activeOnly: true }),
    }), { wrapper });
    expect(result.current.choices.data?.some((entry) => entry.id === 8)).toBe(false);
    expect(result.current.references.data?.find((entry) => entry.id === 8)?.children[0].name)
      .toBe("Anak aktif dari induk nonaktif");
    expect(result.current.references.data?.[0].children.find((entry) => entry.id === 3)?.name)
      .toBe("Jalan nonaktif");
    expect(client.getQueryData(["/api/taxonomy"])).toEqual(tree);
  });

  it("only offers active sectors and cascaded subsectors and supports clearing", async () => {
    const { wrapper } = setup();
    render(<Draft />, { wrapper });
    expect(screen.getByTestId("select-kb-subsektor")).toBeDisabled();
    open("select-kb-sektor");
    expect(screen.queryByRole("option", { name: "Induk nonaktif" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Konstruksi" }));
    expect(screen.getByTestId("draft-taxonomy")).toHaveTextContent("1");
    open("select-kb-subsektor");
    expect(screen.queryByRole("option", { name: "Jalan nonaktif" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Bangunan" }));
    expect(screen.getByTestId("draft-taxonomy")).toHaveTextContent("2");
    open("select-kb-subsektor");
    fireEvent.click(screen.getByRole("option", { name: "— Sektor Saja —" }));
    expect(screen.getByTestId("draft-taxonomy")).toHaveTextContent("1");
    open("select-kb-sektor");
    fireEvent.click(screen.getByRole("option", { name: "— Tanpa Taksonomi —" }));
    await waitFor(() => expect(screen.getByTestId("draft-taxonomy")).toHaveTextContent("none"));
  });

  it("resets the child when a different sector is chosen and disables empty branches", () => {
    const { wrapper } = setup();
    render(<Draft initialId={2} />, { wrapper });
    open("select-kb-sektor");
    fireEvent.click(screen.getByRole("option", { name: "Sektor kosong" }));
    expect(screen.getByTestId("draft-taxonomy")).toHaveTextContent("10");
    expect(screen.getByTestId("select-kb-subsektor")).toBeDisabled();
  });

  it.each([1, 2, 3, 9])("clears draft %i after its own category or parent is deactivated", async (id) => {
    const { client, wrapper } = setup();
    render(<Draft initialId={id} />, { wrapper });
    act(() => client.setQueryData(["/api/taxonomy"], tree.map((entry) =>
      entry.id === 1 ? { ...entry, isActive: false } : entry
    )));
    await waitFor(() => expect(screen.getByTestId("draft-taxonomy")).toHaveTextContent("none"));
    expect(client.getQueryData<KnowledgeTaxonomyTreeNode[]>(["/api/taxonomy"])?.[0].children[0].id).toBe(2);
  });

  it("refreshes choices on deactivation and reactivation without dropping reference labels", async () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(() => ({
      references: useTaxonomy(),
      choices: useTaxonomy(true, { activeOnly: true }),
    }), { wrapper });
    act(() => client.setQueryData(["/api/taxonomy"], tree.map((entry) =>
      entry.id === 8 ? { ...entry, isActive: true } : entry
    )));
    await waitFor(() => expect(result.current.choices.data?.find((entry) => entry.id === 8)?.children[0].id).toBe(9));
    act(() => client.setQueryData(["/api/taxonomy"], tree));
    await waitFor(() => expect(result.current.choices.data?.some((entry) => entry.id === 8)).toBe(false));
    expect(result.current.references.data?.find((entry) => entry.id === 8)?.name).toBe("Induk nonaktif");
  });

  it("does not erase a draft before taxonomy has loaded", () => {
    const { client, wrapper } = setup();
    client.removeQueries({ queryKey: ["/api/taxonomy"] });
    client.setQueryDefaults(["/api/taxonomy"], { queryFn: () => new Promise(() => {}) });
    const onChange = vi.fn();
    render(<KnowledgeTaxonomySelect taxonomyId={2} onChange={onChange} />, { wrapper });
    expect(onChange).not.toHaveBeenCalled();
  });
});
