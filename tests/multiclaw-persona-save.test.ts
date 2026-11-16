import assert from "node:assert/strict";
import test from "node:test";
import { saveAndVerifyMulticlawPersona } from "../client/src/lib/multiclaw-persona-save";

const payload = {
  greetingMessage: "Sapaan yang diperbarui",
  conversationStarters: ["Tinjau kebutuhan proyek", "Periksa dokumen"],
  isEnabled: true,
};

test("persona save only succeeds after a fresh read returns every requested value", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const savedAgent = { id: 73, slug: "manprojakclaw-orchestrator", ...payload };
  const request: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return calls.length === 1
      ? Response.json(savedAgent)
      : Response.json(savedAgent, { headers: { "Cache-Control": "private, no-store" } });
  };

  const result = await saveAndVerifyMulticlawPersona(savedAgent.slug, payload, request);

  assert.equal(result.greetingMessage, payload.greetingMessage);
  assert.deepEqual(result.conversationStarters, payload.conversationStarters);
  assert.equal(result.isEnabled, payload.isEnabled);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "/api/multiclaw/agent/manprojakclaw-orchestrator");
  assert.equal(calls[0].init?.credentials, "include");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), payload);
  assert.equal(calls[1].url, calls[0].url);
  assert.equal(calls[1].init?.cache, "no-store");
});

test("persona save reports the server's authorization or validation error", async () => {
  const request: typeof fetch = async () => Response.json(
    { error: "Forbidden: bukan pemilik agen" },
    { status: 403 },
  );

  await assert.rejects(
    saveAndVerifyMulticlawPersona("manprojakclaw-orchestrator", payload, request),
    /Forbidden: bukan pemilik agen/,
  );
});

test("persona save does not claim success when the server readback differs", async () => {
  let calls = 0;
  const request: typeof fetch = async () => {
    calls += 1;
    return calls === 1
      ? Response.json({ ok: true })
      : Response.json({
          id: 73,
          slug: "manprojakclaw-orchestrator",
          greetingMessage: "Nilai lama",
          conversationStarters: [],
          isEnabled: true,
        });
  };

  await assert.rejects(
    saveAndVerifyMulticlawPersona("manprojakclaw-orchestrator", payload, request),
    /penyimpanan belum terverifikasi/,
  );
});
