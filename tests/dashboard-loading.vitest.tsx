import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

const loaded = vi.hoisted(() => ({ chat: vi.fn(), knowledge: vi.fn(), create: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "fixture", firstName: "User", role: "user" }, isAuthenticated: true, isLoading: false }),
}));
vi.mock("@/hooks/use-partner-branding", () => ({
  usePartnerBranding: () => ({ partner: null }),
  toDirectImageUrl: (url: string) => url,
}));
vi.mock("@/hooks/use-feature-access", () => ({
  useFeatureAccess: () => ({ planInfo: { plan: "pro", tier: 3, config: { name: "Pro" } } }),
}));
vi.mock("@/components/panels/chat-console-panel", () => {
  loaded.chat();
  return { ChatConsolePanel: ({ agent }: { agent: { name: string } }) => {
    const [draft, setDraft] = useState("");
    return <input aria-label={`Pesan ${agent.name}`} value={draft} onChange={e => setDraft(e.target.value)} />;
  } };
});
vi.mock("@/components/panels/knowledge-base-panel", () => {
  loaded.knowledge();
  return { KnowledgeBasePanel: ({ agent }: { agent: { name: string } }) => <div>KB {agent.name}</div> };
});
vi.mock("@/components/dialogs/create-agent-dialog", () => {
  loaded.create();
  return { CreateAgentDialog: ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) =>
    open ? <div role="dialog" aria-label="Buat alat bantu"><button onClick={() => onOpenChange(false)}>Tutup formulir</button></div> : null };
});

import Dashboard from "../client/src/pages/dashboard";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("dashboard deferred integration", () => {
  it("opens Persona, loads tabs and the creation dialog on demand, and retains chat across tabs", async () => {
    const agent = {
      id: "agent-a", name: "Fixture Agen", toolboxId: 3, description: "Fixture",
      persona: "Asisten", language: "id", aiModel: "gpt-4o-mini",
      systemPrompt: "Fixture", capabilities: [], limitations: [], isActive: true,
      temperature: 0.7, maxTokens: 2048,
    };
    const idea = { id: 2, seriesId: 1, name: "Modul Fixture" };
    const toolbox = { id: 3, bigIdeaId: 2, seriesId: 1, name: "Chatbot Fixture", isOrchestrator: false };
    const client = new QueryClient({ defaultOptions: { queries: {
      retry: false, staleTime: Infinity, gcTime: Infinity,
      queryFn: async () => null,
    } } });
    // Seed hierarchy queries to avoid transient [] identities during initial effects.
    for (const [key, value] of [
      [["/api/series"], [{ id: 1, name: "Series Fixture" }]],
      [["/api/domains"], []],
      [["/api/big-ideas"], [idea]],
      [["/api/big-ideas/active"], idea],
      [["/api/toolboxes", { bigIdeaId: "2" }], [toolbox]],
      [["/api/toolboxes"], [toolbox]],
      [["/api/toolboxes/active"], toolbox],
      [["/api/toolboxes/orchestrator"], null],
      [["/api/agents"], [agent]],
      [["/api/agents", { toolboxId: "3" }], [agent]],
      [["/api/agents/active"], agent],
      [["/api/admin/me"], { isAdmin: false, isSuperAdmin: false }],
      [["/api/agents/demo"], null],
      [["/api/messages", "agent-a"], []],
      [["/api/profile", "fixture"], null],
      [["/api/legal-agents"], []],
      [["/api/trial/status"], { hasActiveTrial: false, dialogCompleted: true }],
      [["/api/notifications"], { items: [], unread: 0 }],
    ] as [unknown[], unknown][]) client.setQueryData(key, value);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })));
    const location = memoryLocation({ path: "/dashboard" });
    render(<QueryClientProvider client={client}><Router hook={location.hook}><Dashboard /></Router></QueryClientProvider>);
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Chat Console" })[0]).toBeEnabled());
    expect(loaded.chat).not.toHaveBeenCalled();
    expect(loaded.knowledge).not.toHaveBeenCalled();
    expect(loaded.create).not.toHaveBeenCalled();
    expect(screen.getAllByText("Fixture Agen").length).toBeGreaterThan(0);
    expect(screen.queryByPlaceholderText("Ketik pesan Anda...")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Chat Console" })[0]);
    const draft = await screen.findByRole("textbox", { name: "Pesan Fixture Agen" });
    fireEvent.change(draft, { target: { value: "Belum dikirim" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Knowledge Base" })[0]);
    expect(await screen.findByText("KB Fixture Agen")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Chat Console" })[0]);
    expect(screen.getByRole("textbox", { name: "Pesan Fixture Agen" })).toHaveValue("Belum dikirim");
    expect(loaded.chat).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getAllByRole("button", { name: "Alat Bantu Baru" })[0]);
    expect(await screen.findByRole("dialog", { name: "Buat alat bantu" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tutup formulir" }));
    expect(screen.queryByRole("dialog", { name: "Buat alat bantu" })).not.toBeInTheDocument();
    expect(loaded.create).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Buka chat agen" }));
    const popupDraft = await screen.findByPlaceholderText("Ketik pesan Anda...");
    fireEvent.change(popupDraft, { target: { value: "Draft popup" } });
    fireEvent.click(screen.getByRole("button", { name: "Tutup chat agen" }));
    fireEvent.click(screen.getByRole("button", { name: "Buka chat agen" }));
    expect(screen.getByPlaceholderText("Ketik pesan Anda...")).toHaveValue("Draft popup");
    client.clear();
  });
});
