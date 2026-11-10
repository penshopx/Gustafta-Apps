import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ecosystemData = readFileSync(
  resolve(process.cwd(), "client/src/data/ecosystem-apps.ts"),
  "utf8",
);
const isoLanding = readFileSync(
  resolve(process.cwd(), "client/src/pages/solusi-konsultan-iso.tsx"),
  "utf8",
);
const projectLanding = readFileSync(
  resolve(process.cwd(), "client/src/pages/ruang-proyek-landing.tsx"),
  "utf8",
);

function arrayBlock(source: string, exportName: string): string {
  const start = source.indexOf(`export const ${exportName} = [`);
  assert.notEqual(start, -1, `${exportName} harus tetap diekspor`);
  const end = source.indexOf("] as const;", start);
  assert.notEqual(end, -1, `${exportName} harus tetap berupa daftar kanonik`);
  return source.slice(start, end);
}

function assertOrderedEntries(
  block: string,
  entries: ReadonlyArray<{ name: string; href: string; stage?: string }>,
) {
  let previousIndex = -1;

  for (const entry of entries) {
    const nameIndex = block.indexOf(`name: "${entry.name}"`);
    assert.ok(nameIndex > previousIndex, `${entry.name} harus ada dalam urutan yang benar`);
    assert.match(
      block.slice(nameIndex),
      new RegExp(`href: "${entry.href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`),
      `${entry.name} harus memakai URL eksternal kanonik`,
    );
    if (entry.stage) {
      assert.ok(
        block.lastIndexOf(`stage: "${entry.stage}"`, nameIndex) > previousIndex,
        `${entry.name} harus mempertahankan tahap ${entry.stage}`,
      );
    }
    previousIndex = nameIndex;
  }

  assert.equal(
    [...block.matchAll(/\bname:\s*"/g)].length,
    entries.length,
    "jumlah kartu aplikasi tidak boleh berubah tanpa memperbarui kontrak",
  );
}

function assertSecureExternalCardRenderer(
  source: string,
  collectionName: string,
  testIdPrefix: string,
) {
  const mapStart = source.indexOf(`{${collectionName}.map((app) => (`);
  assert.notEqual(mapStart, -1, `${collectionName} harus dirender sebagai kartu`);
  const mapEnd = source.indexOf("))}", mapStart);
  assert.notEqual(mapEnd, -1, `renderer ${collectionName} harus lengkap`);
  const renderer = source.slice(mapStart, mapEnd);

  assert.match(renderer, /<a[\s\S]*href=\{app\.href\}/);
  assert.match(renderer, /target="_blank"/);
  assert.match(renderer, /rel="noopener noreferrer"/);
  assert.match(renderer, new RegExp(`data-testid=\\{\\\`link-${testIdPrefix}-app-`));
}

test("dua kartu aplikasi Konsultan ISO tetap lengkap dan aman", () => {
  const block = arrayBlock(ecosystemData, "ISO_ECOSYSTEM_APPS");

  assertOrderedEntries(block, [
    { name: "ISO Hub", href: "https://iso-hub.gustafta.my.id" },
    { name: "SMAP–PANCEK", href: "https://smap-pancek.gustafta.my.id" },
  ]);
  assertSecureExternalCardRenderer(isoLanding, "ISO_ECOSYSTEM_APPS", "iso");
});

test("tiga kartu Ruang Proyek tetap mengikuti urutan siklus dan aman", () => {
  const block = arrayBlock(ecosystemData, "PROJECT_ECOSYSTEM_APPS");

  assertOrderedEntries(block, [
    {
      stage: "01 · RENCANAKAN",
      name: "Rancang–Bangun",
      href: "https://rancang-bangun.gustafta.my.id",
    },
    {
      stage: "02 · KENDALIKAN",
      name: "Sistem Informasi Proyek",
      href: "https://sistem-proyek.gustafta.my.id",
    },
    {
      stage: "03 · HUBUNGKAN",
      name: "TukangConnect",
      href: "https://tukang-connect.gustafta.my.id",
    },
  ]);
  assertSecureExternalCardRenderer(projectLanding, "PROJECT_ECOSYSTEM_APPS", "project");
});