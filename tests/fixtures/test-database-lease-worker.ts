import { prepareTestDatabase } from "../test-database";
import pg from "pg";

process.send?.({ state: "attempting" });
try {
  if (!await prepareTestDatabase()) throw new Error("Test DB required");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const table = process.env.LEASE_PROBE_TABLE;
  let snapshot: unknown;
  try {
    if (process.env.LEASE_PROBE_SNAPSHOT === "1") {
      if (!table || !/^fixture_lease_probe_[a-f0-9]{32}$/.test(table)) throw new Error("Invalid probe table");
      const { rows } = await pool.query(`SELECT value FROM public.${table} ORDER BY kind`);
      snapshot = rows;
      await pool.query(`UPDATE public.${table} SET value = $1`, [process.env.LEASE_PROBE_LABEL]);
    }
    process.send?.({ state: "acquired", group: process.env.TEST_DATABASE_LEASE_GROUP });
    process.on("message", async (message: string) => {
      if (message !== "finish") return;
      try {
        if (snapshot) {
          const { rows } = await pool.query(`SELECT DISTINCT value FROM public.${table}`);
          if (rows.length !== 1 || rows[0].value !== process.env.LEASE_PROBE_LABEL) {
            throw new Error("Another suite changed a live fixture");
          }
          for (const [index, kind] of ["catalog", "config"].entries()) {
            await pool.query(`UPDATE public.${table} SET value = $1 WHERE kind = $2`,
              [(snapshot as { value: string }[])[index].value, kind]);
          }
        }
        await pool.end();
        process.disconnect?.();
      } catch {
        console.error("Fixture snapshot was overwritten");
        process.exit(1);
      }
    });
  } catch (error) {
    await pool.end();
    throw error;
  }
} catch {
  process.send?.({
    state: "rejected",
    blocked: process.env.DATABASE_URL?.includes("/test_guard_blocked"),
    pooledAbsent: !process.env.DATABASE_URL_POOLED,
  });
  process.exitCode = 1;
  process.disconnect?.();
}
