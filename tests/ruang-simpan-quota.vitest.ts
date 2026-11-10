import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, it, vi } from "vitest";

// Prove isolation before importing routes or registering any fixture hooks.
// Never load the real DB/auth/storage modules or call external providers.
vi.mock("../server/db", async () => {
  const { prepareTestDatabase } = await import("./test-database");
  if (!await prepareTestDatabase()) throw new Error("Database uji terisolasi wajib tersedia");
  const { default: pg } = await import("pg");
  return { pool: new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 8 }) };
});
vi.mock("../server/replit_integrations/auth", () => ({
  isAuthenticated: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const id = req.get("X-Test-Owner");
    if (!id) return res.sendStatus(401);
    (req as any).user = { id };
    next();
  },
}));
vi.mock("../server/lib/object-storage", async () => ({
  ...await vi.importActual("../server/lib/object-storage"),
  uploadFile: vi.fn(),
  downloadFile: vi.fn(),
  deleteFile: vi.fn(),
  deleteFileStrict: vi.fn(),
}));
vi.mock("../server/lib/file-processing", () => ({
  extractCloudDriveContent: vi.fn(),
}));

const { pool } = await import("../server/db");
const { registerRuangSimpanRoutes, ingestRuangSimpanFile, getUsedBytes } = await import("../server/ruang-simpan-routes");
const { uploadFile, deleteFileStrict, getStorageKey } = await import("../server/lib/object-storage");
const { reconcileUploadCleanup } = await import("../server/lib/ruang-simpan-upload-cleanup");
const { extractCloudDriveContent } = await import("../server/lib/file-processing");
const storage = vi.mocked(uploadFile);
const cleanup = vi.mocked(deleteFileStrict);
const extract = vi.mocked(extractCloudDriveContent);
const QUOTA = 15 * 1024 * 1024;
let server: ReturnType<typeof createServer> | undefined;
let base = "";

async function until(check: () => Promise<boolean>) {
  const deadline = Date.now() + 5000;
  while (!await check()) {
    assert.ok(Date.now() < deadline, "kondisi PostgreSQL tidak tercapai");
    await delay(10);
  }
}

async function ownerWithRemaining(bytes: number) {
  const id = randomUUID();
  await pool.query("INSERT INTO users (id) VALUES ($1)", [id]);
  await pool.query(
    `INSERT INTO ruang_simpan_files (user_id, original_name, size_bytes, kb_status)
     VALUES ($1,'existing.txt',$2,'ready')`, [id, QUOTA - bytes],
  );
  return id;
}

function importUrl(owner: string, body: object = {}) {
  return fetch(base + "/import-from-url", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Test-Owner": owner },
    body: JSON.stringify({ url: "https://example.org/document", ...body }),
  });
}

function upload(owner: string, content = "é".repeat(40)) {
  const form = new FormData();
  form.append("file", new Blob([content], { type: "text/plain" }), "upload.txt");
  return fetch(base + "/upload", { method: "POST", headers: { "X-Test-Owner": owner }, body: form });
}

async function files(owner: string) {
  return (await pool.query(
    "SELECT * FROM ruang_simpan_files WHERE user_id=$1 AND original_name <> 'existing.txt'", [owner],
  )).rows;
}

async function waitForIndex(owner: string) {
  await until(async () => {
    const rows = await files(owner);
    return rows.length > 0 && rows.every(row => row.kb_status === "ready");
  });
}

beforeAll(async () => {
  await pool.query("CREATE TABLE users (id text PRIMARY KEY, storage_plan text, storage_plan_ends_at timestamptz)");
  const app = express();
  app.use(express.json());
  await registerRuangSimpanRoutes(app);
  server = createServer(app);
  await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}/api/ruang-simpan`;
});

beforeEach(() => {
  storage.mockReset().mockResolvedValue("fixture/object.txt");
  cleanup.mockReset().mockResolvedValue(undefined);
  extract.mockReset().mockResolvedValue({ content: "é".repeat(40), title: "Cloud: Imported", sourceType: "cloud_drive" });
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
  await pool.end();
});

describe("reservasi kuota lintas jalur HTTP dengan PostgreSQL nyata", () => {
  it("SIGKILL setelah COMMIT: reservasi muda tetap dihitung, reservasi tua dipulihkan", async () => {
    const owner = await ownerWithRemaining(80);
    const child = fork(new URL("./fixtures/ruang-simpan-reservation-kill-child.ts", import.meta.url), [], {
      execArgv: ["--import", "tsx"], stdio: ["ignore", "pipe", "pipe", "ipc"],
      env: {
        PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "test",
        TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
        TEST_DATABASE_LEASE_GROUP: process.env.TEST_DATABASE_LEASE_GROUP,
        TEST_DATABASE_APP_NAMES: process.env.TEST_DATABASE_APP_NAMES,
        FIXTURE_OWNER: owner,
      },
    });
    let stderr = "";
    child.stderr!.on("data", chunk => { stderr += chunk; });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Worker timeout: ${stderr}`)), 10000);
        child.once("error", error => { clearTimeout(timer); reject(error); });
        child.once("exit", (code, signal) => {
          clearTimeout(timer);
          reject(new Error(`Worker exited before COMMIT (${code ?? signal}): ${stderr}`));
        });
        child.once("message", (message: any) => {
          clearTimeout(timer);
          assert.equal(message.event, "reservation-committed");
          resolve();
        });
      });
      const [orphan] = await files(owner);
      assert.equal(orphan.kb_status, "pending");
      assert.equal(orphan.storage_key, null);
      assert.equal(orphan.file_content, null);
      const exit = once(child, "exit");
      child.kill("SIGKILL");
      assert.deepEqual(await exit, [null, "SIGKILL"]);
      assert.equal((await upload(owner)).status, 402, "reservasi baru belum boleh dipulihkan");
      await pool.query("UPDATE ruang_simpan_files SET created_at=now()-interval '2 hours' WHERE id=$1", [orphan.id]);
      assert.equal((await upload(owner)).status, 201, "unggahan berikutnya mendapatkan kuota kembali");
      await waitForIndex(owner);
      const rows = await files(owner);
      assert.equal(rows.length, 1);
      assert.notEqual(rows[0].id, orphan.id);
      assert.equal((await pool.query(
        "SELECT count(*)::int AS n FROM ruang_simpan_files WHERE user_id=$1 AND original_name='existing.txt'", [owner],
      )).rows[0].n, 1, "dokumen lama tidak terhapus");
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exit = once(child, "exit");
        child.kill("SIGKILL");
        await exit;
      }
    }
  });

  it("unggahan aktif yang melewati batas usia tetap terkunci dan memakai kuota", async () => {
    const owner = await ownerWithRemaining(80);
    // Backdate at INSERT, before the active writer takes its row lock.
    await pool.query(`
      CREATE FUNCTION backdate_fixture_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN NEW.created_at := now()-interval '2 hours'; RETURN NEW; END $$;
      CREATE TRIGGER backdate_fixture_reservation BEFORE INSERT ON ruang_simpan_files
        FOR EACH ROW EXECUTE FUNCTION backdate_fixture_reservation();
    `);
    let release!: () => void;
    let entered!: () => void;
    const storing = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    storage.mockImplementationOnce(async () => {
      entered();
      await gate;
      return "fixture/active.txt";
    });
    const active = upload(owner);
    try {
      await storing;
      const [row] = await files(owner);
      const probe = await pool.connect();
      try {
        await probe.query("BEGIN");
        await assert.rejects(probe.query(
          "SELECT id FROM ruang_simpan_files WHERE id=$1 FOR UPDATE NOWAIT", [row.id],
        ), (error: any) => error.code === "55P03");
      } finally {
        await probe.query("ROLLBACK");
        probe.release();
      }
      assert.equal((await upload(owner)).status, 402, "pemulihan melewati penulis aktif tanpa menunggu");
      assert.equal((await files(owner))[0].id, row.id);
    } finally {
      release();
      await active;
      await pool.query("DROP TRIGGER backdate_fixture_reservation ON ruang_simpan_files; DROP FUNCTION backdate_fixture_reservation()");
    }
    assert.equal((await active).status, 201);
    await waitForIndex(owner);
    const [row] = await files(owner);
    assert.equal(row.storage_key, getStorageKey(owner, row.id, "upload.txt"));
  });

  it("pemulihan hanya menghapus reservasi tua kosong milik akun tersebut", async () => {
    const owner = await ownerWithRemaining(1000);
    const other = await ownerWithRemaining(80);
    const ids: string[] = [];
    for (const [key, content, text, status, chunkCount] of [
      ["fixture/valid", null, null, "pending", 0],
      [null, Buffer.alloc(0), null, "pending", 0],
      [null, null, "hasil ekstraksi", "pending", 0],
      [null, null, null, "ready", 0],
      [null, null, null, "pending", 1],
    ]) {
      const { rows: [row] } = await pool.query(
        `INSERT INTO ruang_simpan_files
         (user_id, original_name, size_bytes, storage_key, file_content, extracted_text, kb_status, kb_chunk_count, created_at)
         VALUES ($1,'valid.txt',1,$2,$3,$4,$5,$6,now()-interval '2 hours') RETURNING id`,
        [owner, key, content, text, status, chunkCount],
      );
      ids.push(row.id);
    }
    const { rows: [indexed] } = await pool.query(
      `INSERT INTO ruang_simpan_files (user_id,original_name,size_bytes,created_at)
       VALUES ($1,'has-chunk.txt',1,now()-interval '2 hours') RETURNING id`, [owner],
    );
    ids.push(indexed.id);
    await pool.query(
      "INSERT INTO ruang_simpan_chunks (file_id,user_id,chunk_index,content) VALUES ($1,$2,0,'valid chunk')", [indexed.id, owner],
    );
    for (const user of [owner, other]) {
      const { rows: [row] } = await pool.query(
        "INSERT INTO ruang_simpan_files (user_id,original_name,size_bytes) VALUES ($1,'fresh.txt',1) RETURNING id", [user],
      );
      ids.push(row.id);
      if (user === other) await pool.query(
        "UPDATE ruang_simpan_files SET created_at=now()-interval '2 hours' WHERE id=$1", [row.id],
      );
    }
    const { rows: [orphan] } = await pool.query(
      `INSERT INTO ruang_simpan_files (user_id,original_name,size_bytes,created_at)
       VALUES ($1,'abandoned.txt',900,now()-interval '2 hours') RETURNING id`, [owner],
    );
    assert.equal((await importUrl(owner)).status, 201);
    await until(async () => (await pool.query(
      "SELECT kb_status FROM ruang_simpan_files WHERE user_id=$1 AND original_name='Imported.txt'", [owner],
    )).rows[0]?.kb_status === "ready");
    assert.equal((await pool.query("SELECT id FROM ruang_simpan_files WHERE id=$1", [orphan.id])).rowCount, 0);
    assert.equal((await pool.query("SELECT id FROM ruang_simpan_files WHERE id=ANY($1::uuid[])", [ids])).rowCount, ids.length);
    assert.equal((await pool.query("SELECT content FROM ruang_simpan_chunks WHERE file_id=$1", [indexed.id])).rows[0].content, "valid chunk");
  });

  it.each([
    ["URL/URL", importUrl, importUrl],
    ["URL/file", importUrl, upload],
    ["file/URL", upload, importUrl],
  ] as const)("%s: hanya satu permintaan lolos ketika total melebihi kuota", async (_name, first, second) => {
    const owner = await ownerWithRemaining(100);
    const gate = await pool.connect();
    let requests: Promise<Response>[] = [];
    try {
      await gate.query("BEGIN");
      await gate.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`rs-upload:${owner}`]);
      requests = [first(owner), second(owner)];
      // Both handlers must reach the SAME database lock before releasing it.
      // Without the URL reservation the old route returns early and this fails.
      await until(async () => {
        const { rows } = await pool.query(
          `SELECT count(*)::int AS count FROM pg_stat_activity
           WHERE datname=current_database() AND wait_event='advisory'
             AND query LIKE '%pg_advisory_xact_lock%'`,
        );
        return rows[0].count === 2;
      });
      await gate.query("COMMIT");
      const responses = await Promise.all(requests);
      assert.deepEqual(responses.map(r => r.status).sort(), [201, 402]);
      const rejected = await responses.find(r => r.status === 402)!.json() as any;
      assert.equal(rejected.quota_exceeded, true);
      assert.equal(rejected.quota_bytes, QUOTA);
      assert.equal(rejected.used_bytes, QUOTA - 20);
      const rows = await files(owner);
      assert.equal(rows.length, 1);
      assert.equal(Number(rows[0].size_bytes), 80, "kuota memakai byte UTF-8, bukan jumlah karakter");
      assert.equal(storage.mock.calls.length, 1, "impor ditolak sebelum penyimpanan eksternal");
      const usage = await pool.query("SELECT SUM(size_bytes)::bigint AS used FROM ruang_simpan_files WHERE user_id=$1", [owner]);
      assert.equal(Number(usage.rows[0].used), QUOTA - 20);
      await waitForIndex(owner);
    } finally {
      await gate.query("ROLLBACK");
      gate.release();
      await Promise.allSettled(requests);
    }
  });

  it("unggah campuran tepat di batas tetap diterima", async () => {
    const owner = await ownerWithRemaining(160);
    const responses = await Promise.all([importUrl(owner), upload(owner)]);
    assert.deepEqual(responses.map(r => r.status), [201, 201]);
    assert.equal((await files(owner)).length, 2);
    const usage = await pool.query("SELECT SUM(size_bytes)::bigint AS used FROM ruang_simpan_files WHERE user_id=$1", [owner]);
    assert.equal(Number(usage.rows[0].used), QUOTA);
    await waitForIndex(owner);
  });

  it("impor menjaga nama, folder, deskripsi, sumber, fallback DB dan indeks AI", async () => {
    const owner = await ownerWithRemaining(80);
    const { rows: [folder] } = await pool.query(
      "INSERT INTO ruang_simpan_folders (user_id,name) VALUES ($1,'Milik saya') RETURNING id", [owner],
    );
    storage.mockRejectedValue(new Error("fixture storage offline"));
    const response = await importUrl(owner, { folder_id: folder.id, description: "Catatan sumber" });
    assert.equal(response.status, 201);
    const result = await response.json() as any;
    assert.equal(result.imported_from, "example.org");
    assert.equal(result.original_name, "Imported.txt");
    assert.equal(result.mime_type, "text/plain");
    assert.equal(Number(result.size_bytes), 80);
    assert.equal(result.folder_id, folder.id);
    await waitForIndex(owner);
    const [row] = await files(owner);
    assert.equal(row.description, "Catatan sumber");
    assert.equal(row.storage_key, null);
    assert.deepEqual(row.file_content, Buffer.from("é".repeat(40)));
    const chunks = await pool.query("SELECT content FROM ruang_simpan_chunks WHERE file_id=$1", [row.id]);
    assert.equal(chunks.rows[0].content, "é".repeat(40));
  });

  it("folder akun lain ditolak tanpa reservasi atau penyimpanan", async () => {
    const owner = await ownerWithRemaining(80);
    const other = await ownerWithRemaining(80);
    const { rows: [folder] } = await pool.query(
      "INSERT INTO ruang_simpan_folders (user_id,name) VALUES ($1,'Privat') RETURNING id", [other],
    );
    assert.equal((await importUrl(owner, { folder_id: folder.id })).status, 403);
    assert.equal((await files(owner)).length, 0);
    assert.equal(storage.mock.calls.length, 0);
  });

  it("kegagalan menyimpan konten membebaskan reservasi untuk unggah berikutnya", async () => {
    const owner = await ownerWithRemaining(80);
    await pool.query(`
      CREATE FUNCTION reject_fixture_content() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'fixture content write failure'; END $$;
      CREATE TRIGGER reject_fixture_content BEFORE UPDATE OF file_content
        ON ruang_simpan_files FOR EACH ROW EXECUTE FUNCTION reject_fixture_content();
    `);
    storage.mockRejectedValue(new Error("fixture storage offline"));
    try {
      assert.equal((await importUrl(owner)).status, 500);
      assert.equal((await files(owner)).length, 0, "reservasi gagal tidak memakan kuota");
    } finally {
      await pool.query("DROP TRIGGER reject_fixture_content ON ruang_simpan_files; DROP FUNCTION reject_fixture_content()");
    }
    const response = await upload(owner);
    assert.equal(response.status, 201);
    assert.equal((await files(owner)).length, 1);
    await waitForIndex(owner);
  });

  it.each([false, true])("UPDATE storage_key gagal: fallback bytea tetap dapat diunduh, cleanup gagal=%s", async (cleanupFails) => {
    const owner = await ownerWithRemaining(80);
    await pool.query(`
      CREATE FUNCTION reject_fixture_key() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.storage_key IS NOT NULL THEN RAISE EXCEPTION 'fixture metadata write failure'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER reject_fixture_key BEFORE UPDATE OF storage_key
        ON ruang_simpan_files FOR EACH ROW EXECUTE FUNCTION reject_fixture_key();
    `);
    if (cleanupFails) cleanup.mockRejectedValue(new Error("fixture delete offline"));
    try {
      const response = await upload(owner);
      assert.equal(response.status, 201, "pembersihan tidak mengubah keberhasilan fallback");
      assert.equal(storage.mock.calls.length, 1);
      await waitForIndex(owner);
      const [row] = await files(owner);
      const key = getStorageKey(owner, row.id, "upload.txt");
      assert.equal(row.storage_key, null);
      assert.deepEqual(row.file_content, Buffer.from("é".repeat(40)));
      assert.equal(await getUsedBytes(owner), QUOTA);
      assert.equal((await upload(owner)).status, 402);
      const download = await fetch(`${base}/files/${row.id}/download`, { headers: { "X-Test-Owner": owner } });
      assert.equal(download.status, 200);
      assert.equal(await download.text(), "é".repeat(40));
      assert.deepEqual(cleanup.mock.calls, [[key]]);
      const pending = await pool.query("SELECT * FROM ruang_simpan_upload_cleanup WHERE storage_key=$1", [key]);
      assert.equal(pending.rowCount, cleanupFails ? 1 : 0);
      if (cleanupFails) {
        assert.equal(pending.rows[0].attempts, 1);
        cleanup.mockResolvedValue(undefined);
        await pool.query("UPDATE ruang_simpan_upload_cleanup SET next_attempt_at=now() WHERE storage_key=$1", [key]);
        await Promise.all([reconcileUploadCleanup(key), reconcileUploadCleanup(key)]);
        assert.equal(cleanup.mock.calls.length, 2, "hanya satu pekerja mengulang penghapusan");
        await reconcileUploadCleanup(key);
        assert.equal(cleanup.mock.calls.length, 2, "rekonsiliasi ulang idempoten");
        assert.equal((await files(owner))[0].id, row.id, "fallback sah tidak dihapus");
      }
    } finally {
      await pool.query("DROP TRIGGER reject_fixture_key ON ruang_simpan_files; DROP FUNCTION reject_fixture_key()");
    }
  });

  it.each([false, true])("UPDATE dan fallback gagal: HTTP 500, kuota kembali meski cleanup gagal=%s", async (cleanupFails) => {
    const owner = await ownerWithRemaining(80);
    await pool.query(`
      CREATE FUNCTION reject_fixture_all_content() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'fixture all content writes fail'; END $$;
      CREATE TRIGGER reject_fixture_all_content BEFORE UPDATE OF file_content
        ON ruang_simpan_files FOR EACH ROW EXECUTE FUNCTION reject_fixture_all_content();
    `);
    if (cleanupFails) cleanup.mockRejectedValue(new Error("fixture delete offline"));
    try {
      assert.equal((await upload(owner)).status, 500);
      assert.equal(storage.mock.calls.length, 1, "objek sudah berhasil diunggah");
      assert.equal((await files(owner)).length, 0);
      assert.equal(await getUsedBytes(owner), QUOTA - 80);
      const key = getStorageKey(owner, storage.mock.calls[0][1], "upload.txt");
      assert.deepEqual(cleanup.mock.calls, [[key]]);
      assert.equal((await pool.query("SELECT * FROM ruang_simpan_upload_cleanup WHERE storage_key=$1", [key])).rowCount,
        cleanupFails ? 1 : 0);
      if (cleanupFails) {
        cleanup.mockResolvedValue(undefined);
        await pool.query("UPDATE ruang_simpan_upload_cleanup SET next_attempt_at=now() WHERE storage_key=$1", [key]);
        await reconcileUploadCleanup(key);
        assert.equal((await pool.query("SELECT * FROM ruang_simpan_upload_cleanup WHERE storage_key=$1", [key])).rowCount, 0);
      }
    } finally {
      await pool.query("DROP TRIGGER reject_fixture_all_content ON ruang_simpan_files; DROP FUNCTION reject_fixture_all_content()");
    }
    assert.equal((await upload(owner)).status, 201);
    await waitForIndex(owner);
    assert.equal(cleanup.mock.calls.length, cleanupFails ? 2 : 1, "dokumen baru yang sah tidak dibersihkan");
  });

  it("rekonsiliasi melewati penulis aktif dan menjaga objek setelah COMMIT", async () => {
    const owner = await ownerWithRemaining(80);
    let release!: () => void;
    let entered!: () => void;
    const storing = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    storage.mockImplementationOnce(async (_owner, id, filename) => {
      entered();
      await gate;
      return getStorageKey(owner, id, filename);
    });
    const response = upload(owner);
    try {
      await storing;
      const [row] = await files(owner);
      const key = getStorageKey(owner, row.id, "upload.txt");
      assert.equal((await pool.query("SELECT * FROM ruang_simpan_upload_cleanup WHERE storage_key=$1", [key])).rowCount, 1,
        "intent harus sudah committed sebelum upload");
      // Outlasting the grace must still never permit deletion of active bytes.
      await pool.query("UPDATE ruang_simpan_upload_cleanup SET next_attempt_at=now() WHERE storage_key=$1", [key]);
      await reconcileUploadCleanup(key);
      assert.equal(cleanup.mock.calls.length, 0);
      assert.equal((await files(owner))[0].id, row.id);
      assert.equal(await getUsedBytes(owner), QUOTA);
    } finally {
      release();
      assert.equal((await response).status, 201);
    }
    await waitForIndex(owner);
    const [row] = await files(owner);
    await reconcileUploadCleanup(getStorageKey(owner, row.id, "upload.txt"));
    assert.equal(cleanup.mock.calls.length, 0);
    assert.equal((await pool.query("SELECT * FROM ruang_simpan_upload_cleanup WHERE user_id=$1", [owner])).rowCount, 0);
  });

  it("kegagalan audit sesudah COMMIT tidak menghapus dokumen dan objek yang sah", async () => {
    const owner = await ownerWithRemaining(80);
    await pool.query(`
      CREATE FUNCTION reject_fixture_upload_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'fixture audit failure'; END $$;
      CREATE TRIGGER reject_fixture_upload_audit BEFORE INSERT ON ruang_simpan_access_log
        FOR EACH ROW EXECUTE FUNCTION reject_fixture_upload_audit();
    `);
    try {
      await assert.rejects(ingestRuangSimpanFile(owner, {
        originalname: "app.txt", mimetype: "text/plain", size: 80, buffer: Buffer.alloc(80, "a"),
      }, null, null, randomUUID()), /fixture audit failure/);
      const [row] = await files(owner);
      assert.equal(row.storage_key, getStorageKey(owner, row.id, "app.txt"));
      assert.equal(cleanup.mock.calls.length, 0);
      assert.equal(await getUsedBytes(owner), QUOTA);
    } finally {
      await pool.query("DROP TRIGGER reject_fixture_upload_audit ON ruang_simpan_access_log; DROP FUNCTION reject_fixture_upload_audit()");
    }
  });

  it("COMMIT sukses tetapi balasannya hilang: objek dan kuota tetap sah", async () => {
    const owner = await ownerWithRemaining(80);
    const connect = pool.connect.bind(pool);
    const restores: (() => void)[] = [];
    const instrumented = new WeakSet<object>();
    let failed = false;
    const connectSpy = vi.spyOn(pool, "connect").mockImplementation(((callback?: any) => {
      // Ordinary pool.query uses the callback overload; preserve it unchanged.
      if (callback) return connect(callback);
      return (async () => {
        const client = await connect();
        if (instrumented.has(client)) return client;
        instrumented.add(client);
        const query = client.query.bind(client);
        let wroteReference = false;
        const spy = vi.spyOn(client, "query").mockImplementation(((...args: any[]) => {
          if (typeof args.at(-1) === "function") return (query as any)(...args);
          return (async () => {
            const result = await (query as any)(...args);
            const text = typeof args[0] === "string" ? args[0] : args[0].text;
            if (text === "BEGIN") wroteReference = false;
            if (text.includes("SET storage_key = $1, file_content")) wroteReference = true;
            if (text === "COMMIT" && wroteReference && !failed) {
              failed = true;
              throw new Error("fixture committed acknowledgement lost");
            }
            return result;
          })();
        }) as typeof client.query);
        restores.push(() => spy.mockRestore());
        return client;
      })();
    }) as typeof pool.connect);
    try {
      assert.equal((await upload(owner)).status, 500, "hasil commit yang tidak jelas tidak dilaporkan sukses");
      assert.equal(failed, true);
      const [row] = await files(owner);
      assert.equal(row.storage_key, getStorageKey(owner, row.id, "upload.txt"));
      assert.equal(cleanup.mock.calls.length, 0, "pembersihan wajib memeriksa hasil commit nyata");
      assert.equal(await getUsedBytes(owner), QUOTA);
      assert.equal((await upload(owner)).status, 402);
    } finally {
      connectSpy.mockRestore();
      restores.forEach(restore => restore());
    }
  });

  it("catatan pembersihan gagal: jangan membuat objek tanpa jejak, gunakan fallback DB", async () => {
    const owner = await ownerWithRemaining(80);
    await pool.query(`
      CREATE FUNCTION reject_fixture_intent() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'fixture intent unavailable'; END $$;
      CREATE TRIGGER reject_fixture_intent BEFORE INSERT ON ruang_simpan_upload_cleanup
        FOR EACH ROW EXECUTE FUNCTION reject_fixture_intent();
    `);
    try {
      assert.equal((await upload(owner)).status, 201);
      await waitForIndex(owner);
      const [row] = await files(owner);
      assert.equal(row.storage_key, null);
      assert.deepEqual(row.file_content, Buffer.from("é".repeat(40)));
      assert.equal(storage.mock.calls.length, 0, "tidak membuat objek tanpa intent durable");
      assert.equal(cleanup.mock.calls.length, 0);
      assert.equal(await getUsedBytes(owner), QUOTA);
    } finally {
      await pool.query("DROP TRIGGER reject_fixture_intent ON ruang_simpan_upload_cleanup; DROP FUNCTION reject_fixture_intent()");
    }
  });

  it("unggahan sebanyak kapasitas pool tetap berjalan tanpa meminta koneksi kedua", async () => {
    const owners = await Promise.all(Array.from({ length: 8 }, () => ownerWithRemaining(80)));
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let entered = 0;
    storage.mockImplementation(async (owner, id, name) => {
      entered++;
      await gate;
      return getStorageKey(owner, id, name);
    });
    const requests = owners.map(owner => upload(owner));
    try {
      await until(async () => entered === 8);
    } finally {
      release();
      const responses = await Promise.all(requests);
      assert.deepEqual(responses.map(response => response.status), Array(8).fill(201));
      await Promise.all(owners.map(waitForIndex));
    }
  });

  it("reservasi terputus dibersihkan, tetapi referensi sah pada baris lain tetap dipertahankan", async () => {
    const owner = await ownerWithRemaining(80);
    const { rows: [row] } = await pool.query(
      `INSERT INTO ruang_simpan_files (user_id,original_name,size_bytes)
       VALUES ($1,'interrupted.txt',80) RETURNING id`, [owner],
    );
    const key = getStorageKey(owner, row.id, "interrupted.txt");
    await pool.query("INSERT INTO ruang_simpan_upload_cleanup (storage_key,file_id,user_id) VALUES ($1,$2,$3)",
      [key, row.id, owner]);
    await reconcileUploadCleanup(key);
    assert.equal((await files(owner)).length, 0);
    assert.equal(await getUsedBytes(owner), QUOTA - 80);
    assert.deepEqual(cleanup.mock.calls, [[key]]);
    await pool.query("INSERT INTO ruang_simpan_upload_cleanup (storage_key,file_id,user_id) VALUES ($1,$2,$3)",
      [key, row.id, owner]);
    await pool.query(
      `INSERT INTO ruang_simpan_files (user_id,original_name,size_bytes,storage_key)
       VALUES ($1,'valid.txt',80,$2)`, [owner, key],
    );
    await reconcileUploadCleanup(key);
    assert.equal(cleanup.mock.calls.length, 1, "referensi sah selalu diperiksa sebelum delete");
    assert.equal(await getUsedBytes(owner), QUOTA);
  });
});
