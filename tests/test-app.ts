import type { Server } from "node:http";
import { prepareTestDatabase } from "./test-database";

/** Never send mutating tests to the existing workspace/published server. */
export async function startIsolatedTestApp() {
  if (!await prepareTestDatabase()) throw new Error("Database uji belum divalidasi");
  const { default: express } = await import("express");
  const { createServer } = await import("node:http");
  const { registerRoutes } = await import("../server/routes");
  const app = express();
  app.use(express.json({ verify: (req: any, _res, buf) => { req.rawBody = buf; } }));
  const server: Server = createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Alamat server uji tidak tersedia");
  return {
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close(error => error ? reject(error) : resolve()));
    },
  };
}
