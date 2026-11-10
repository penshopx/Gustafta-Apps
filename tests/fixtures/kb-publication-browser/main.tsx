import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { KBPublicationControl } from "../../../client/src/components/panels/kb-publication-control";
import { queryClient } from "../../../client/src/lib/queryClient";
import { Toaster } from "../../../client/src/components/ui/toaster";
import type { KnowledgeBase } from "../../../shared/schema";
import "../../../client/src/index.css";

queryClient.setQueryData(["/api/auth/user"], { id: "owner" });
queryClient.setDefaultOptions({ queries: { retry: false, refetchOnWindowFocus: false } });
function Fixture() {
  const { data = [] } = useQuery<KnowledgeBase[]>({ queryKey: ["/api/knowledge-base", "7"] });
  return <main className="mx-auto max-w-3xl p-8 space-y-4">
    <h1 className="text-2xl font-bold">Uji publikasi KB terisolasi</h1>
    <p>Tidak menggunakan database atau akun pelanggan.</p>
    {data.map(source => <section className="border rounded-lg p-4 flex items-center gap-3" key={source.id}>
      <h2>{source.name}</h2><KBPublicationControl source={source} />
    </section>)}
  </main>;
}
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}><Fixture /><Toaster /></QueryClientProvider>,
);
