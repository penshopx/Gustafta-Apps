import assert from "node:assert/strict";
import test from "node:test";
import { toMulticlawAdminAgent } from "../server/lib/multiclaw-admin-agent";

test("MultiClaw Admin reload receives the saved greeting and conversation starters", () => {
  const response = toMulticlawAdminAgent({
    id: 42,
    name: "Fixture Claw",
    slug: "fixture-claw",
    greetingMessage: "Selamat datang, apa yang ingin dibahas?",
    conversationStarters: ["Periksa profil perusahaan", "Tinjau dokumen"],
  });

  assert.equal(response.greetingMessage, "Selamat datang, apa yang ingin dibahas?");
  assert.deepEqual(response.conversationStarters, ["Periksa profil perusahaan", "Tinjau dokumen"]);
});

test("MultiClaw Admin reload safely normalizes absent or malformed UX fields", () => {
  const response = toMulticlawAdminAgent({
    id: 43,
    name: "Fixture Claw",
    slug: "fixture-claw-2",
    greetingMessage: null,
    conversationStarters: JSON.stringify(["not", "an", "array"]),
  });

  assert.equal(response.greetingMessage, "");
  assert.deepEqual(response.conversationStarters, []);
});
