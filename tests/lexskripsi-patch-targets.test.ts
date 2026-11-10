import { test } from "node:test";
import assert from "node:assert/strict";
import { selectLexSkripsiTargets } from "../server/lexskripsi-patch-targets";
import { removeLexSkripsiRoutingIds } from "../server/lexskripsi-routing-prompt";
import { readFileSync } from "node:fs";

const seriesSlug = "lexskripsi-asisten-skripsi-hukum";
const row = (id: number, name: string, seriesSlugValue: string | null = seriesSlug) => ({
  id, name, seriesSlug: seriesSlugValue, slug: null,
  description: "Sub-agent LexSkripsi", systemPrompt: "Kamu anggota tim LexSkripsi",
});

test("ID lama diisi agen lain: target dipilih dari seri dan peran, bukan nomor", () => {
  const candidates = [
    row(1362, "Unrelated", null), row(1363, "Unrelated", null),
    row(1364, "Unrelated", null), row(1365, "Unrelated", null),
    row(1376, "Unrelated", null), row(1447, "Unrelated", null),
    row(9001, "LexSkripsi"), row(9002, "AGENT-METODE"),
    row(9003, "AGENT-SUBSTANSI"), row(9004, "AGENT-LAPANGAN"),
    row(9005, "AGENT-SIDANG"),
    row(9006, "AGENT-NOTION"),
    row(777, "AGENT-METODE", "other-series"),
  ];
  const targets = selectLexSkripsiTargets(candidates, ["orchestrator", "metode", "substansi", "lapangan", "sidang", "notion"]);
  assert.deepEqual(
    Object.values(targets).map(({ id }) => id),
    [9001, 9002, 9003, 9004, 9005, 9006],
  );
});

test("target hilang, tidak berada dalam seri, atau duplikat: tolak sebelum mutasi", () => {
  assert.throws(() => selectLexSkripsiTargets([row(1362, "Other", null)], ["orchestrator"]), /tidak pasti/);
  assert.throws(() => selectLexSkripsiTargets([row(1, "AGENT-METODE", "other-series")], ["metode"]), /tidak pasti/);
  assert.throws(() => selectLexSkripsiTargets([row(1, "LexSkripsi"), row(2, "LexSkripsi")], ["orchestrator"]), /tidak pasti/);
  assert.throws(() => selectLexSkripsiTargets([{
    ...row(1447, "AGENT-NOTION"), systemPrompt: "Bukan agen LexSkripsi",
  }], ["notion"]), /tidak pasti/);
  assert.throws(() => selectLexSkripsiTargets([row(1447, "AGENT-NOTION", null)], ["notion"]), /tidak pasti/);
});

test("keempat patch memverifikasi target dan tidak menulis lewat ID agen lama", () => {
  for (const file of [
    "complete-v5", "fixsubagets", "notion-agent", "notion-orchestrator-fix",
  ]) {
    const source = readFileSync(new URL(`../server/patch-lexskripsi-${file}.ts`, import.meta.url), "utf8");
    // Transactional patches verify rows on their transaction client using the
    // same selector instead of resolving on the global pool outside the transaction.
    assert.match(source, /(?:resolveLexSkripsiTargets|selectLexSkripsiTargets)\(/, file);
    assert.doesNotMatch(source, /(?:agentId|agents\.id|AGENT_NOTION_ID|ORCHESTRATOR_ID)\s*[:,=]\s*["']?(?:1362|1363|1364|1365|1376|1447)\b/, file);
  }
});

test("seluruh patch LexSkripsi lainnya memilih target sebelum penulisan, bukan ID lama", () => {
  for (const file of [
    "level4-upgrade", "onboarding-v3", "persona-v4", "kb-final",
    "prompt-v2", "features", "mini-apps", "project-brain",
  ]) {
    const source = readFileSync(new URL(`../server/patch-lexskripsi-${file}.ts`, import.meta.url), "utf8");
    const runner = source.slice(source.indexOf("export async function patchLexSkripsi"));
    assert.match(runner, /(?:resolveLexSkripsiTargets|runLexSkripsiAtomicPatch)\(/, file);
    assert.ok(
      (runner.includes("runLexSkripsiAtomicPatch(") ||
        runner.indexOf("resolveLexSkripsiTargets(") < runner.search(/(?:storage\.updateAgent|storage\.createKnowledgeBase|UPDATE agents|INSERT INTO (?:mini_apps|project_brain_templates))/)),
      `${file}: target harus diverifikasi sebelum mutasi`,
    );
    assert.doesNotMatch(runner, /agentId:\s*["'](?:1362|1363|1364|1365|1376|1447)["']|WHERE id = (?:1362|1363|1364|1365|1376|1447)\b|^\s*(?:1362|1363|1364|1365|1376|1447),\s*$/m, file);
  }
});

test("ID lama bergeser pada patch KB dan prompt: semua peran wajib terverifikasi sekaligus", () => {
  const rows = [
    row(1362, "Other", null), row(1363, "Other", null),
    row(1364, "Other", null), row(1365, "Other", null),
    row(1376, "Other", null),
    row(9001, "LexSkripsi"), row(9002, "AGENT-METODE"),
    row(9003, "AGENT-SUBSTANSI"), row(9004, "AGENT-LAPANGAN"),
    row(9005, "AGENT-SIDANG"),
  ];
  const roles = ["orchestrator", "metode", "substansi", "lapangan", "sidang"] as const;
  const targets = selectLexSkripsiTargets(rows, roles);
  assert.deepEqual(roles.map((role) => targets[role].id), [9001, 9002, 9003, 9004, 9005]);
  assert.throws(() => selectLexSkripsiTargets(rows.filter((r) => r.id !== 9005), roles), /tidak pasti/);
  assert.throws(() => selectLexSkripsiTargets([...rows, row(9006, "AGENT-METODE")], roles), /tidak pasti/);
});

test("routing prompt tetap menunjuk peran LexSkripsi saat ID lama ditempati agen lain", () => {
  const rows = [
    row(1363, "Unrelated", null), row(1364, "Unrelated", null),
    row(1365, "Unrelated", null), row(1376, "Unrelated", null),
    row(1447, "Unrelated", null),
    row(9001, "LexSkripsi"), row(9002, "AGENT-METODE"),
    row(9003, "AGENT-SUBSTANSI"), row(9004, "AGENT-LAPANGAN"),
    row(9005, "AGENT-SIDANG"), row(9006, "AGENT-NOTION"),
  ];
  const roles = ["metode", "substansi", "lapangan", "sidang"] as const;
  const targets = selectLexSkripsiTargets(rows, ["orchestrator", ...roles, "notion"]);

  for (const file of ["level4-upgrade", "onboarding-v3", "persona-v4", "prompt-v2"]) {
    const source = readFileSync(new URL(`../server/patch-lexskripsi-${file}.ts`, import.meta.url), "utf8");
    const prompt = source.match(/const ORCHESTRATOR_(?:L4|V3|V4|PROMPT_V2) = `([\s\S]*?)`;/)?.[1];
    assert.ok(prompt, `${file}: prompt orchestrator harus ada`);
    const routing = prompt.match(/## ── ROUTING DISPATCH[^\n]*\n([\s\S]*?)(?=\n## |$)/)?.[1];
    assert.ok(routing, `${file}: bagian routing harus ada`);
    assert.match(routing, /berdasarkan nama peran, bukan nomor ID agen/, file);
    for (const role of roles) {
      assert.match(routing, new RegExp(`→ ${targets[role].name}\\s+:`), `${file}: ${role} harus dirutekan berdasarkan peran terverifikasi`);
    }
    if (file === "level4-upgrade") {
      assert.match(routing, new RegExp(`→ ${targets.notion.name}\\s+:`));
    }
    assert.doesNotMatch(prompt, /AGENT-(?:METODE|SUBSTANSI|LAPANGAN|SIDANG|NOTION)\s*\(\d+\)/, `${file}: ID agen lama tidak boleh muncul dalam prompt`);
  }
});

test("prompt tersimpan dengan marker lama dibersihkan hanya pada baris delegasi, tanpa menimpa edit lain", () => {
  const targets = selectLexSkripsiTargets([
    row(1363, "Other", null), row(1447, "Other", null),
    row(9001, "LexSkripsi"), row(9002, "AGENT-METODE"),
    row(9006, "AGENT-NOTION"),
  ], ["orchestrator", "metode", "notion"]);
  const oldPrompt = `Catatan buatan pengguna: penting.\n` +
    `→ ${targets.metode.name} (1363)    : metodologi\n` +
    `• ${targets.notion.name} (1447) : Notion\n` +
    `Pasal 1365 KUHPerdata tetap berlaku.\n`;
  const repaired = removeLexSkripsiRoutingIds(oldPrompt);
  assert.equal(repaired, `Catatan buatan pengguna: penting.\n` +
    `→ ${targets.metode.name}    : metodologi\n` +
    `• ${targets.notion.name} : Notion\n` +
    `Pasal 1365 KUHPerdata tetap berlaku.\n`);
  assert.equal(removeLexSkripsiRoutingIds(repaired), repaired);
});