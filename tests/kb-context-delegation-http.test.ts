import { prepareTestDatabase, testDbSkip } from "./test-database";
// Prove isolation before loading DB-backed production modules.
const ready = await prepareTestDatabase();

import { test } from "node:test";
import assert from "node:assert/strict";
import { startKBContextFixture, markers, owner, other } from "./fixtures/kb-context-http";

test("production delegation HTTP: every AI hop respects document access, including chunk fallback", {
  skip: ready ? false : testDbSkip,
  timeout: 120_000,
}, async () => {
  const fixture = await startKBContextFixture();
  const { storage, agentId, request, captures } = fixture;
  try {
    const parentIdentity = "FIXTURE_ORCHESTRATOR_HOP";
    const childIdentity = "FIXTURE_SPECIALIST_HOP";
    // Deliberately cross-owner, but public: invoking this specialist must
    // succeed without granting either agent owner's private document rights.
    const child = await storage.createAgent({
      name: "Isolated public specialist", userId: other, isPublic: true,
      systemPrompt: childIdentity, aiModel: "gpt-4o", ragEnabled: true,
    } as any);
    assert.equal(child.userId, other);
    assert.equal(child.isPublic, true);
    await storage.updateAgent(agentId, {
      systemPrompt: parentIdentity,
      agenticSubAgents: [{ agentId: Number(child.id), role: "Fixture specialist",
        description: "Summarize project references", outputFormat: "text" }],
    } as any);
    assert.equal((await storage.getAgent(agentId))?.agenticSubAgents?.length, 1);

    const subCurated = await storage.createKnowledgeBase({
      agentId: child.id, name: "Specialist platform fixture", type: "text",
      content: `${markers.subCurated} specialist curated reference.`,
      visibility: "platform", status: "active",
    } as any);
    // Use the real import route so both document owners and visibility are
    // stamped by production code, not inferred from a public-agent flag.
    async function importPrivate(id: string, actor: string, marker: string) {
      const response = await request("POST", `/api/agents/${id}/apply-import`, actor, {
        proposal: {}, mode: "fill_empty_only",
        knowledgeChunks: [{ name: "Private fixture reference", content: `${marker} private reference.` }],
      });
      const body = await response.json() as any;
      assert.equal(response.status, 200, JSON.stringify(body));
      assert.equal(body.knowledgeBasesCreated.length, 1);
      const kbId = body.knowledgeBasesCreated[0].id as string;
      const kb = (await storage.getKnowledgeBases(id)).find(item => item.id === kbId);
      assert.equal(kb?.visibility, "private");
      assert.equal(kb?.ownerUserId, actor);
      return kbId;
    }
    const privateId = await importPrivate(agentId, owner, markers.private);
    const subPrivateId = await importPrivate(child.id, other, markers.subPrivate);
    const sources = [
      { agentId, id: fixture.curatedId, marker: markers.curated },
      { agentId, id: privateId, marker: markers.private },
      { agentId: child.id, id: subCurated.id, marker: markers.subCurated },
      { agentId: child.id, id: subPrivateId, marker: markers.subPrivate },
    ];

    for (const mode of ["text", "chunks", "filtered-chunks"] as const) {
      if (mode === "chunks") {
        await storage.createChunks(sources.map(source => ({
          agentId: Number(source.agentId), knowledgeBaseId: Number(source.id),
          chunkIndex: 0, content: `${source.marker} stored delegation RAG chunk`,
          embedding: [], tokenCount: 8, metadata: {},
        })));
        assert.equal((await storage.getChunksByAgent(agentId)).length, 2);
        assert.equal((await storage.getChunksByAgent(child.id)).length, 2);
      } else if (mode === "filtered-chunks") {
        // Raw chunks still exist, but none are authorized at the internal
        // boundary, for either shared or local context. Both must fall back to
        // platform text, not resurrect private chunks or silently lose context.
        for (const source of [sources[0], sources[2]]) {
          await storage.deleteChunksByKnowledgeBase(source.id);
          const remaining = await storage.getChunksByAgent(source.agentId);
          assert.equal(remaining.length, 1);
          assert.equal(remaining[0].knowledgeBaseId, Number(source.agentId === agentId ? privateId : subPrivateId));
        }
      } else {
        assert.equal((await storage.getChunksByAgent(agentId)).length, 0);
        assert.equal((await storage.getChunksByAgent(child.id)).length, 0);
      }

      // A warms retrieval/history first; B and anonymous then reuse the same
      // external session name. Neither may inherit A's private source/answer.
      const turns = [owner, other, undefined].flatMap(actor => [0, 1].map(turn => ({ actor, turn })));
      for (const { actor, turn } of turns) {
        const label = `${mode}/${actor || "anonymous"}/turn${turn}`;
        const start = captures.length;
        const response = await request("POST", "/api/messages/stream", actor, {
          agentId, role: "user", content: turn === 0
            ? "DELEGATION_INITIAL_TURN: Ringkas referensi proyek bersama spesialis."
            : "Lanjutkan pembahasan sebelumnya bersama spesialis.",
          sessionId: `delegation-${mode}`,
        });
        const output = await response.text();
        assert.equal(response.status, 200, `${label}: ${output}`);
        assert.match(response.headers.get("content-type") || "", /text\/event-stream/);
        const events = output.split("\n").filter(line => line.startsWith("data: "))
          .map(line => JSON.parse(line.slice(6)));
        assert.ok(!events.some(event => ["error", "orchestration_error"].includes(event.type)),
          `${label}: ${output}`);
        for (const type of ["orchestrating_start", "sub_agent_start", "sub_agent_done", "aggregating", "complete"]) {
          assert.equal(events.filter(event => event.type === type).length, 1, `${label}: missing ${type}: ${output}`);
        }
        const aggregation = events.find(event => event.type === "aggregating");
        assert.equal(aggregation.count, 1, `${label}: one successful specialist`);
        assert.equal(aggregation.failed, 0, `${label}: no rejected specialist call`);
        const done = events.find(event => event.type === "sub_agent_done");
        assert.equal(String(done.agentId), child.id);
        assert.ok(done.preview.includes(markers.subCurated), `${label}: specialist must return actual AI output`);
        assert.ok(!done.preview.includes(markers.private), `${label}: specialist result must not contain A's private KB`);
        assert.ok(events.find(event => event.type === "complete").message.content.includes(markers.subCurated),
          `${label}: final AI answer must include the specialist's successful result`);

        const hops = captures.slice(start);
        assert.equal(hops.length, 2, `${label}: specialist AND synthesis must reach local AI, not fail early`);
        assert.ok(hops[0].messages[0].content.includes(childIdentity), `${label}: first hop is specialist`);
        assert.ok(hops[1].messages[0].content.includes(parentIdentity), `${label}: second hop is synthesis`);
        assert.notEqual(hops[0].stream, true, `${label}: internal non-stream call`);
        assert.equal(hops[1].stream, true, `${label}: final streaming call`);
        for (const [index, hop] of hops.entries()) {
          // Inspect ALL input messages: shared KB, local KB, forwarded history,
          // and specialist result injection are all possible leak paths.
          const prompt = JSON.stringify(hop.messages);
          assert.ok(prompt.includes(markers.curated), `${label}/hop${index}: shared platform positive control`);
          assert.ok(prompt.includes(markers.subCurated), `${label}/hop${index}: specialist platform positive control`);
          // Requester rights apply ONLY to final synthesis, never to the
          // cross-owner specialist, including when A initiated delegation.
          assert.equal(prompt.includes(markers.private), index === 1 && actor === owner,
            `${label}/hop${index}: A's private document must stay at the parent`);
          // An internal call has no independent viewer identity, even when B
          // (the specialist owner) made the original public request.
          assert.ok(!prompt.includes(markers.subPrivate), `${label}/hop${index}: private local specialist KB`);
        }
        assert.equal(output.includes(markers.private), actor === owner, `${label}: SSE document visibility`);
        assert.ok(!output.includes(markers.subPrivate), `${label}: SSE private specialist source`);
        if (turn === 1) {
          assert.ok(JSON.stringify(hops[0].messages).includes("DELEGATION_INITIAL_TURN"),
            `${label}: specialist still receives the user's earlier request`);
          const parentHistory = hops[1].messages.filter(message => message.role === "assistant");
          assert.ok(parentHistory.length > 0, `${label}: final synthesis really resumes saved AI history`);
          assert.equal(JSON.stringify(parentHistory).includes(markers.private), actor === owner,
            `${label}: authorized private history stays at the parent only`);
        }
        assert.ok(hops[0].messages[0].content.includes(`${markers.curated} ${mode === "chunks"
          ? "stored delegation RAG chunk" : "curated reference available"}`), `${label}: shared KB retrieval mode`);
        assert.ok(hops[0].messages[0].content.includes(`${markers.subCurated} ${mode === "chunks"
          ? "stored delegation RAG chunk" : "specialist curated reference"}`), `${label}: local KB fallback mode`);
      }
    }
  } finally {
    await fixture.close();
  }
});
