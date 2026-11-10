import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  KEPDIRJEN_281_CANONICAL,
  KEPDIRJEN_281_SHORT,
  KEPDIRJEN_281_TABLES,
  reconcileKepdirjen281,
  transformKepdirjen281Text,
  transformKepdirjen281Value,
} from "../server/lib/kepdirjen-281-reconciler";

describe("Kepdirjen 281 persisted-content transform", () => {
  test("uses the exact canonical long wording", () => {
    const old =
      "Keputusan Direktur Jenderal Bina Konstruksi Kementerian Pekerjaan Umum Nomor 37/KPTS/DK/2025";
    assert.equal(transformKepdirjen281Text(old), KEPDIRJEN_281_CANONICAL);
  });

  test("is idempotent", () => {
    const once = transformKepdirjen281Text(
      "Komponen wajib LKUT sesuai SK Dirjen BK No. 37/2025.",
    );
    assert.equal(transformKepdirjen281Text(once), once);
    assert.equal((once.match(new RegExp(KEPDIRJEN_281_SHORT.replaceAll("/", "\\/"), "g")) ?? []).length, 2);
  });

  test("replaces mixed-case and no-No. persisted variants", () => {
    const output = transformKepdirjen281Text(
      "Sesuai SK Dirjen 37/KPTS/Dk/2025, Kepdirjen 37/2025, SK 37/2025, dan referensi 37/KPTS/DK/2025.",
    );

    assert.doesNotMatch(output, /37\/(?:KPTS\/DK\/)?2025/i);
    assert.match(output, /281\/KPTS\/DK\/2026/);
  });

  test("qualifies SKK as personnel/PJ support rather than direct regulation", () => {
    const transformed = transformKepdirjen281Text(
      "SK Dirjen BK No. 37/2025 menjadi acuan standar sertifikasi SKK.",
    );
    assert.match(transformed, /tidak mengatur sertifikasi SKK secara langsung/);
    assert.match(transformed, /dukungan personel bersertifikat\/PJ bagi BUJK\/SBU/);
  });

  test("leaves unrelated text unchanged", () => {
    const unrelated =
      "UU No. 2 Tahun 2017 mengatur jasa konstruksi; proyek memiliki 37 personel.";
    assert.equal(transformKepdirjen281Text(unrelated), unrelated);
  });

  test("preserves nested JSON shape while updating only string leaves", () => {
    const input = {
      rules: ["SK Dirjen Binakon 37/2025", { active: true, count: 37 }],
      unrelated: null,
    };
    const output = transformKepdirjen281Value(input) as any;
    assert.deepEqual(Object.keys(output), Object.keys(input));
    assert.equal(output.rules.length, 2);
    assert.equal(output.rules[1].active, true);
    assert.equal(output.rules[1].count, 37);
    assert.equal(output.unrelated, null);
    assert.equal(output.rules[0], KEPDIRJEN_281_SHORT);
  });
});

describe("Kepdirjen 281 startup reconciliation transaction", () => {
  test("updates existing rows by ID in one transaction and commits", async () => {
    const statements: Array<{ sql: string; params?: unknown[] }> = [];
    const client = {
      async query(sql: string, params?: unknown[]) {
        statements.push({ sql, params });
        if (sql.startsWith("SELECT id")) {
          const table = KEPDIRJEN_281_TABLES.find((item) =>
            sql.includes(`FROM "${item.table}"`),
          );
          const row: Record<string, unknown> = { id: 71 };
          for (const column of table?.columns ?? []) row[column] = null;
          if (table?.table === "series") {
            row.description = "Acuan SK Dirjen Binakon 37/2025.";
            row.tags = ["SK Dirjen Binakon 37/2025", "sbu"];
          }
          return { rows: [row], rowCount: 1 };
        }
        if (sql.startsWith("SELECT to_regclass")) {
          return { rows: [{ table_name: "public.sbu_skk_tutor_sources" }], rowCount: 1 };
        }
        return { rows: [], rowCount: sql.startsWith("UPDATE") ? 1 : null };
      },
      release() {},
    };
    const counts = await reconcileKepdirjen281(
      { connect: async () => client } as any,
      () => undefined,
    );

    assert.equal(statements[0].sql, "BEGIN");
    assert.equal(statements.at(-1)?.sql, "COMMIT");
    const selects = statements.filter((entry) => entry.sql.startsWith("SELECT id"));
    assert.ok(selects.every((entry) => entry.sql.includes("WHERE CONCAT_WS")));
    assert.ok(
      selects.every((entry) => {
        const isPrimarySourceTable =
          entry.sql.includes('FROM "knowledge_bases"') ||
          entry.sql.includes('FROM "knowledge_chunks"');
        return entry.params?.length === (isPrimarySourceTable ? 2 : 1);
      }),
    );
    assert.match(
      selects.find((entry) => entry.sql.includes('FROM "knowledge_bases"'))?.sql ?? "",
      /description.*NOT LIKE/,
    );
    assert.match(
      selects.find((entry) => entry.sql.includes('FROM "knowledge_chunks"'))?.sql ?? "",
      /metadata->>'sourceSha256'/,
    );
    assert.equal(counts.series, 1);
    assert.equal(counts.agents, 0);
    const update = statements.find((entry) => entry.sql.startsWith("UPDATE"));
    assert.match(update?.sql ?? "", /UPDATE "series".*WHERE id = \$3/);
    assert.equal(
      update?.params?.[1],
      JSON.stringify([KEPDIRJEN_281_SHORT, "sbu"]),
    );
    assert.deepEqual(update?.params?.at(-1), 71);
    assert.equal(statements.some((entry) => /\b(DELETE|INSERT)\b/.test(entry.sql)), false);
  });

  test("rolls back and rejects when any table fails", async () => {
    const statements: string[] = [];
    const client = {
      async query(sql: string) {
        statements.push(sql);
        if (sql.startsWith("SELECT")) throw new Error("forced read failure");
        return { rows: [], rowCount: null };
      },
      release() {},
    };

    await assert.rejects(
      reconcileKepdirjen281(
        { connect: async () => client } as any,
        () => undefined,
      ),
      /forced read failure/,
    );
    assert.deepEqual(statements, ["BEGIN", statements[1], "ROLLBACK"]);
    assert.match(statements[1], /^SELECT id/);
    assert.equal(statements.includes("COMMIT"), false);
  });
});

test("seed SBU inti tidak menghapus hierarchy yang sudah ada", () => {
  for (const file of [
    "server/seed-sbu-coach.ts",
    "server/seed-sbu-master.ts",
    "server/seed-sbu-terintegrasi.ts",
    "server/seed-personel-manajerial-bujk.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /storage\.delete(?:Agent|Toolbox|BigIdea|Series)\(/);
    assert.match(source, /preserving hierarchy and IDs/);
  }
});