import { manageTestDatabase } from "./integration-test-database";
import { prepareTestDatabase } from "../tests/test-database";

const action = process.argv[2];
let stage = "validasi";
try {
  if (action !== "setup" && action !== "teardown") throw new Error("Gunakan setup atau teardown");
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL wajib diset");
  if (action === "teardown" && process.argv[3] !== "--confirm-disposable") {
    throw new Error("Teardown memerlukan --confirm-disposable");
  }
  stage = "schema";
  await manageTestDatabase(action, url);
  if (action === "setup") {
    if (!await prepareTestDatabase()) throw new Error("Validasi database gagal");
    // Import only after the guard has redirected BOTH database connection paths.
    const { pool } = await import("../server/db");
    try {
      const { seedDesainProyekClaw } = await import("../server/seed-desain-proyek-claw");
      const { seedRencanaProyekClaw } = await import("../server/seed-rencana-proyek-claw");
      const { seedStudiKelayakanClaw } = await import("../server/seed-studi-kelayakan-claw");
      const { seedPersiapanProyekMulticlaw } = await import("../server/seed-persiapan-proyek-multiclaw");
      await seedDesainProyekClaw();
      await seedRencanaProyekClaw();
      await seedStudiKelayakanClaw();
      await seedPersiapanProyekMulticlaw();
      const { seedStoreProducts } = await import("../server/seed-store-products");
      const { seedCashflowPackages } = await import("../server/seed-cashflow-packages");
      const { seedSbuSkkEbook } = await import("../server/seed-sbu-skk-ebook");
      const { seedContractorLadder } = await import("../server/sales-ladder-seed");
      stage = "seed-store";
      await seedStoreProducts();
      stage = "seed-cashflow";
      await seedCashflowPackages();
      stage = "seed-ebook";
      await seedContractorLadder();
      await seedSbuSkkEbook();
      stage = "verifikasi-produk";
      // Product seeds must never create customers, payments or orders.
      for (const table of ["users", "store_orders", "subscriptions_new", "product_entitlements"]) {
        const result = await pool.query(`SELECT count(*)::int AS n FROM "${table}"`);
        if (result.rows[0].n !== 0) throw new Error("Seed memuat data non-produk");
      }
    } finally {
      await pool.end();
    }
  }
  console.log(`Database integrasi: ${action} selesai`);
} catch (error) {
  // Do not print pg errors, SQL parameters, connection strings, or credentials.
  const code = (error as { code?: string }).code;
  console.error(`Lifecycle database integrasi gagal (${stage}${code && /^[0-9A-Z]{5}$/.test(code) ? `, SQLSTATE ${code}` : ""}). Periksa URL terpisah, identitas, database kosong/penanda, schema, dan aset produk kanonik. Buang database lokal bila setup terputus.`);
  process.exitCode = 1;
}
