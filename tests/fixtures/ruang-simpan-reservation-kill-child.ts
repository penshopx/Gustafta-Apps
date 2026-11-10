import assert from "node:assert/strict";
import { prepareTestDatabase } from "../test-database";

assert.ok(await prepareTestDatabase(), "Disposable PostgreSQL is required");
const { pool } = await import("../../server/db");
const connect = pool.connect.bind(pool);
pool.connect = ((callback?: any) => {
  if (callback) return connect(callback);
  return (async () => {
    const client = await connect();
    const query = client.query.bind(client);
    client.query = (async (input: any, values?: any) => {
      const result = await query(input, values);
      const text = typeof input === "string" ? input : input.text;
      if (text === "COMMIT") {
        // The real reservation has committed and is visible to the parent.
        // Do not permit continuation into Object Storage or any provider.
        process.send!({ event: "reservation-committed" });
        await new Promise<void>(() => {});
      }
      return result;
    }) as typeof client.query;
    return client;
  })();
}) as typeof pool.connect;

const { ingestRuangSimpanFile } = await import("../../server/ruang-simpan-routes");
assert.ok(process.env.FIXTURE_OWNER);
await ingestRuangSimpanFile(process.env.FIXTURE_OWNER, {
  originalname: "killed.txt", mimetype: "text/plain",
  size: 80, buffer: Buffer.alloc(80, "x"),
}, null, null);
throw new Error("Worker must be killed before ingestion returns");
