import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import AdminLegacyMemories from "../../../client/src/pages/admin-legacy-memories";
import { queryClient } from "../../../client/src/lib/queryClient";
import { Toaster } from "../../../client/src/components/ui/toaster";
import "../../../client/src/index.css";

queryClient.setDefaultOptions({
  queries: { ...queryClient.getDefaultOptions().queries, retry: false, refetchOnWindowFocus: false },
  mutations: { retry: false },
});
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <AdminLegacyMemories />
    <Toaster />
  </QueryClientProvider>,
);
