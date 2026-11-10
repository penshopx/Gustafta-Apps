import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import { createServer as createViteServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { registerKBPublicationRoutes } from "../../../server/kb-publication-routes";
import { makeAgentAccessGuards } from "../../../server/lib/agent-access-guards";
import { selectContextKB } from "../../../server/lib/kb-context-access";
import type { KnowledgeBase } from "../../../shared/schema";

// In-memory fixture only. Never imports customer storage, database or app boot.
const sources = [
  { id: "1", name: "Salinan Ruang Simpan", ownerUserId: "owner", visibility: "private", processingStatus: "completed" },
  { id: "2", name: "Dokumen milik editor", ownerUserId: "editor", visibility: "published", processingStatus: "completed" },
  { id: "3", name: "Regulasi kurasi platform", ownerUserId: null, visibility: "platform", processingStatus: "completed" },
  { id: "4", name: "Dokumen sedang diproses", ownerUserId: "owner", visibility: "private", processingStatus: "processing" },
].map(row => ({ ...row, agentId: "7", content: "Konten uji", status: "active" })) as KnowledgeBase[];
const app = express();
app.use(express.json());
app.use((req: any, _res, next) => {
  req.user = { id: req.headers["x-fixture-user"] || "owner" };
  next();
});
const guards = makeAgentAccessGuards({
  getDbRole: async () => "user",
  getCollaboratorRole: async (_agentId, userId) => userId === "editor" ? "editor" : null,
  adminUserIds: () => [],
});
app.get("/api/auth/user", (req: any, res) => res.json(req.user));
app.get("/api/knowledge-base/7", (_req, res) => res.json(sources));
app.get("/api/fixture/context", (req, res) => res.json(
  selectContextKB(sources, typeof req.query.viewer === "string" ? req.query.viewer : undefined).map(row => row.id),
));
registerKBPublicationRoutes(app, {
  authenticate: (_req, _res, next) => next(),
  userId: req => req.user.id,
  getAgent: async () => ({ id: "7", userId: "owner", isPublic: true }),
  canManage: guards.assertCanMutateAgent,
  async withLockedSource(id, fn) {
    const source = sources.find(row => row.id === String(id));
    return fn(source ? { ...source, id, agentId: 7 } : undefined, async visibility => {
      if (source) source.visibility = visibility;
    });
  },
});
const server = createServer(app);
const root = path.resolve(import.meta.dirname, "../../..");
const vite = await createViteServer({
  configFile: false, root: import.meta.dirname, plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared") } },
  server: { middlewareMode: true, hmr: { server }, allowedHosts: true, fs: { allow: [root] } },
  appType: "spa",
});
app.use(vite.middlewares);
server.listen(8101, "0.0.0.0", () => console.log("Isolated KB publication fixture ready on port 8101"));
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => {
  void vite.close().then(() => server.close(() => process.exit(0)));
});
