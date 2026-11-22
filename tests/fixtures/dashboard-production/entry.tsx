// Real dashboard, hooks, lazy imports and providers; only server data is fixture-owned.
// No application server, database, provider credentials or customer accounts are used.
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { Route, Router, Switch } from "wouter";
import Dashboard from "../../../client/src/pages/dashboard";
import AiBuilderPage from "../../../client/src/pages/ai-builder";
import BlueprintBuilderPage from "../../../client/src/pages/blueprint-builder";
import OrganizationBuilderPage from "../../../client/src/pages/organization-builder";
import { queryClient } from "../../../client/src/lib/queryClient";
import { ThemeProvider } from "../../../client/src/lib/theme-provider";
import { MultiClawProvider } from "../../../client/src/contexts/multiclaw-context";
import { TooltipProvider } from "../../../client/src/components/ui/tooltip";
import { PLAN_CONFIGS } from "../../../shared/feature-plans";
import "../../../client/src/index.css";

const admin = new URLSearchParams(location.search).get("admin") !== "false";
const agent = {
  id: "dashboard-fixture", userId: "dashboard-fixture-user", name: "Dashboard Fixture Agent",
  toolboxId: 3, description: "Isolated fixture", persona: "Asisten", language: "id",
  aiModel: "gpt-4o-mini", systemPrompt: "Fixture only", capabilities: [], limitations: [],
  isActive: true, temperature: 0.7, maxTokens: 2048,
};
const idea = { id: 2, seriesId: 1, name: "Fixture Module" };
const toolbox = { id: 3, bigIdeaId: 2, seriesId: 1, name: "Fixture Toolbox", isOrchestrator: false };
queryClient.setDefaultOptions({ queries: { retry: false, staleTime: Infinity, gcTime: Infinity } });
// Preseed hierarchy data: avoids fresh [] identities during dashboard loading effects.
for (const [key, value] of [
  [["/api/auth/user"], { id: "dashboard-fixture-user", firstName: "Fixture", role: admin ? "admin" : "user" }],
  [["/api/subscriptions/my"], { plan: "bisnis", tier: PLAN_CONFIGS.bisnis.tier, status: "active", config: PLAN_CONFIGS.bisnis }],
  [["/api/series"], [{ id: 1, name: "Fixture Series" }]],
  [["/api/domains"], []],
  [["/api/big-ideas"], [idea]],
  [["/api/big-ideas/active"], idea],
  [["/api/toolboxes", { bigIdeaId: "2" }], [toolbox]],
  [["/api/toolboxes"], [toolbox]],
  [["/api/toolboxes/active"], toolbox],
  [["/api/toolboxes/orchestrator", "1"], null],
  [["/api/agents"], [agent]],
  [["/api/agents", { toolboxId: "3" }], [agent]],
  [["/api/agents/active"], agent],
  [["/api/admin/me"], { isAdmin: admin, isSuperAdmin: false, role: admin ? "admin" : "user" }],
  [["/api/agents/demo"], null],
  [["/api/messages", agent.id], []],
  [["/api/profile", "dashboard-fixture-user"], { displayName: "Fixture Profile", bio: "Isolated" }],
  [["/api/legal-agents"], []],
  [["/api/trial/status"], { hasActiveTrial: false, dialogCompleted: true }],
  [["/api/notifications"], { items: [], unread: 0 }],
] as [unknown[], unknown][]) queryClient.setQueryData(key, value);

createRoot(document.getElementById("root")!).render(
  <ThemeProvider defaultTheme="dark"><QueryClientProvider client={queryClient}>
    <TooltipProvider><MultiClawProvider>
      <Router><Switch>
        <Route path="/ai-builder" component={AiBuilderPage} />
        <Route path="/blueprint-builder" component={BlueprintBuilderPage} />
        <Route path="/organization-builder" component={OrganizationBuilderPage} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/" component={Dashboard} />
        <Route component={Dashboard} />
      </Switch></Router>
    </MultiClawProvider></TooltipProvider>
  </QueryClientProvider></ThemeProvider>,
);
