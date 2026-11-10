import { prepareTestDatabase, testDbSkip } from "./test-database";
// Validate and block the app DB before any DB-backed production imports.
const ready = await prepareTestDatabase();

import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { startKBContextFixture, markers, owner, other } from "./fixtures/kb-context-http";

test("production HTTP: private import is isolated in chat, SSE, DocGen and exports", {
  skip: ready ? false : testDbSkip,
  timeout: 120_000,
}, async () => {
  const fixture = await startKBContextFixture();
  const { agentId, request, captures } = fixture;
  try {
    const importBody = {
      proposal: {}, mode: "fill_empty_only",
      knowledgeChunks: [{
        name: "Private A import", content: `${markers.private} confidential project reference owned only by A.`,
        // Client-supplied publication/owner must not override importer identity.
        visibility: "platform", ownerUserId: other,
      }],
    };
    for (const actor of [undefined, other]) {
      const denied = await request("POST", `/api/agents/${agentId}/apply-import`, actor, importBody);
      assert.equal(denied.status, actor ? 403 : 401, await denied.text());
    }
    const imported = await request("POST", `/api/agents/${agentId}/apply-import`, owner, importBody);
    const importedBody = await imported.json() as any;
    assert.equal(imported.status, 200, JSON.stringify(importedBody));
    assert.equal(importedBody.knowledgeBasesCreated.length, 1);
    const privateId = importedBody.knowledgeBasesCreated[0].id;
    const kbs = await fixture.storage.getKnowledgeBases(agentId);
    const privateKB = kbs.find(kb => kb.id === privateId);
    assert.equal(privateKB?.visibility, "private");
    assert.equal(privateKB?.ownerUserId, owner);

    // Exercise both fallback KB text and actual stored RAG chunks. Empty
    // embeddings make retrieval deterministic without external embedding API.
    for (const withChunks of [false, true]) {
      if (withChunks) {
        await fixture.storage.createChunks([
          { agentId: Number(agentId), knowledgeBaseId: Number(fixture.curatedId),
            chunkIndex: 0, content: `${markers.curated} stored RAG chunk`, embedding: [], tokenCount: 8, metadata: {} },
          { agentId: Number(agentId), knowledgeBaseId: Number(privateId),
            chunkIndex: 0, content: `${markers.private} stored RAG chunk`, embedding: [], tokenCount: 8, metadata: {} },
        ]);
        assert.equal((await fixture.storage.getChunksByAgent(agentId)).length, 2);
      }
      // A goes first, warming any cache before B/anonymous try the same agent.
      for (const actor of [owner, other, undefined]) {
        for (const path of ["/api/messages", "/api/messages/stream", `/api/agents/${agentId}/docgen/generate`]) {
          const captureCount = captures.length;
          const docgen = path.endsWith("/generate");
          const response = await request("POST", path, actor, docgen ? {
            docType: "Checklist", context: "Susun checklist pekerjaan proyek fixture.",
          } : {
            agentId, role: "user", content: "Susun ringkasan referensi proyek.",
            sessionId: `isolated-${withChunks}-${actor || "anon"}-${path}`,
          });
          const output = await response.text();
          assert.equal(response.status, path === "/api/messages" ? 201 : 200, `${actor} ${path}: ${output}`);
          assert.equal(captures.length, captureCount + 1, `${path} must reach the local AI, not fail early`);
          const prompt = JSON.stringify(captures[captureCount].messages);
          assert.ok(prompt.includes(markers.curated), `${path}: missing positive platform control`);
          assert.equal(prompt.includes(markers.private), actor === owner, `${actor} ${path}: AI input visibility`);
          assert.equal(output.includes(markers.private), actor === owner, `${actor} ${path}: response visibility`);
          assert.ok(output.includes(markers.curated), `${path}: missing successful output`);
          if (!docgen) {
            const sessionId = `isolated-${withChunks}-${actor || "anon"}-${path}`;
            // The original HTTP history/export handlers must not treat a
            // caller-chosen (or leaked) conversation name as authorization.
            for (const reader of [owner, other, undefined]) {
              const history = await request("GET",
                `/api/messages/${agentId}/session/${encodeURIComponent(sessionId)}`, reader);
              const messages = await history.json() as any[];
              assert.equal(history.status, 200, JSON.stringify(messages));
              assert.equal(messages.length, reader === actor ? 2 : 0, "only the creating principal can resume");
              assert.equal(JSON.stringify(messages).includes(markers.private), reader === owner && actor === owner);
              if (messages.length) assert.equal(messages[1].sessionId, sessionId, "keep external conversation names");
              assert.equal(history.headers.get("cache-control"), "private, no-store");
            }
          }
          if (path !== "/api/messages") {
            assert.match(response.headers.get("content-type") || "", /text\/event-stream/);
            assert.doesNotMatch(output, /"type":"error"|"error":/);
          }
          if (withChunks && !docgen) assert.ok(prompt.includes("stored RAG chunk"), "must exercise chunk retrieval");
          if (!withChunks && !docgen) assert.ok(prompt.includes("curated reference"), "must exercise text fallback");
        }
      }
    }

    // Account-wide history and both exports must exclude other users' answers,
    // including when no session is supplied or A's exact session is reused.
    for (const emailSession of [false, true]) {
      for (const actor of [owner, other, undefined]) {
        for (const suffix of ["", "/export/json", "/export/csv"]) {
          for (const query of ["", `?sessionId=${encodeURIComponent("isolated-false-" + owner + "-/api/messages")}`]) {
            const response = await request("GET", `/api/messages/${agentId}${suffix}${query}`, actor, undefined, emailSession);
            const text = await response.text();
            assert.equal(response.status, !actor && suffix ? 401 : 200, text);
            assert.equal(text.includes(markers.private), actor === owner, `${actor} ${suffix}${query}`);
          }
        }
      }
    }

    // Unowned historical rows cannot be attributed by guessing their old ID.
    await fixture.storage.createMessage({
      agentId, sessionId: "legacy-unowned", role: "assistant",
      content: "LEGACY_PRIVATE_ANSWER", reasoning: "", sources: [],
    });
    for (const actor of [owner, other, undefined]) {
      for (const suffix of ["", "/session/legacy-unowned", "/export/json", "/export/csv"]) {
        const response = await request("GET", `/api/messages/${agentId}${suffix}`, actor);
        assert.ok(!(await response.text()).includes("LEGACY_PRIVATE_ANSWER"));
      }
    }

    const storedA = (await fixture.storage.getMessages(agentId)).find(message =>
      message.role === "assistant" && message.content.includes(markers.private));
    assert.ok(storedA?.sessionId);
    for (const actor of [owner, other, undefined]) {
      const response = await request("GET",
        `/api/messages/${agentId}/session/${encodeURIComponent(storedA.sessionId)}`, actor);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), [], "even a leaked internal session key is not a bearer credential");
    }

    // Reusing A's session in a send must not inject A's saved answer into B's
    // model context. Missing sessionId is also scoped, never agent-wide.
    for (const actor of [other, undefined]) {
      for (const path of ["/api/messages", "/api/messages/stream"]) {
        for (const sessionId of [`isolated-false-${owner}-/api/messages`, undefined]) {
          const index = captures.length;
          const response = await request("POST", path, actor, {
            agentId, role: "user", content: "Lanjutkan percakapan.", ...(sessionId ? { sessionId } : {}),
          });
          const output = await response.text();
          assert.equal(response.status, path === "/api/messages" ? 201 : 200, output);
          assert.equal(captures.length, index + 1);
          assert.ok(!JSON.stringify(captures[index]).includes(markers.private));
          assert.ok(!output.includes(markers.private));
          assert.ok(!JSON.stringify(captures[index]).includes("LEGACY_PRIVATE_ANSWER"));
        }
      }
    }

    // Two anonymous browsers choosing the same conversation name remain
    // separate; a saved server cookie permits the original browser to resume.
    for (const browser of ["guest-a", "guest-b"]) {
      const response = await request("POST", "/api/messages", undefined, {
        agentId, role: "user", content: `ONLY_${browser}`, sessionId: "same-public-session",
      }, false, browser);
      assert.equal(response.status, 201, await response.text());
      assert.match(response.headers.get("set-cookie") || "", /HttpOnly/i);
    }
    for (const browser of ["guest-a", "guest-b", "new-browser"]) {
      const response = await request("GET", `/api/messages/${agentId}/session/same-public-session`,
        undefined, undefined, false, browser);
      const messages = await response.json() as any[];
      assert.equal(response.status, 200);
      assert.equal(messages.length, browser === "new-browser" ? 0 : 2);
      assert.equal(JSON.stringify(messages).includes(`ONLY_${browser}`), browser !== "new-browser");
      assert.ok(!JSON.stringify(messages).includes(browser === "guest-a" ? "ONLY_guest-b" : "ONLY_guest-a"));
    }
    const resumeIndex = captures.length;
    const resumed = await request("POST", "/api/messages/stream", undefined, {
      agentId, role: "user", content: "Lanjutkan sesi saya.", sessionId: "same-public-session",
    }, false, "guest-a");
    assert.equal(resumed.status, 200, await resumed.text());
    assert.equal(captures.length, resumeIndex + 1);
    assert.ok(JSON.stringify(captures[resumeIndex]).includes("ONLY_guest-a"), "same visitor resumes model context");
    assert.ok(!JSON.stringify(captures[resumeIndex]).includes("ONLY_guest-b"));
    const resumedHistory = await request("GET", `/api/messages/${agentId}/session/same-public-session`,
      undefined, undefined, false, "guest-a");
    assert.equal((await resumedHistory.json() as any[]).length, 4);

    // The default (omitted) conversation name also has an owner and can resume.
    for (const path of ["/api/messages", "/api/messages/stream"]) {
      const response = await request("POST", path, owner, {
        agentId, role: "user", content: "PRIVATE_DEFAULT_A_TURN",
      });
      assert.equal(response.status, path === "/api/messages" ? 201 : 200, await response.text());
    }
    for (const actor of [owner, other, undefined]) {
      const response = await request("GET", `/api/messages/${agentId}`, actor);
      const history = await response.text();
      assert.equal(response.status, 200);
      assert.equal(history.includes("PRIVATE_DEFAULT_A_TURN"), actor === owner);
    }

    // Exports use stricter guards than public generation: JSON forbidden to B,
    // DocGen HTML permitted but without raw KB. Anonymous exports require auth.
    for (const actor of [owner, other, undefined]) {
      for (const format of ["", "/docgen"]) {
        const response = await request("GET", `/api/agents/${agentId}/export${format}`, actor);
        const text = await response.text();
        assert.equal(response.status, !actor ? 401 : actor === other && !format ? 403 : 200, text);
        assert.equal(text.includes(markers.private), actor === owner, `${actor} export${format}: private KB`);
        assert.equal(text.includes(markers.curated), actor === owner, `${actor} export${format}: raw platform KB`);
      }
    }

    // Agent edit permission is NOT document-owner permission. B can now export
    // the public agent, which must still exclude A's private imported source.
    await fixture.storage.addOrUpdateCollaborator({
      agentId, userId: other, role: "editor", invitedBy: owner,
    });
    for (const format of ["", "/docgen"]) {
      const response = await request("GET", `/api/agents/${agentId}/export${format}`, other);
      const text = await response.text();
      assert.equal(response.status, 200, text);
      assert.ok(text.includes(markers.curated), "authorized export must include platform sources");
      assert.ok(!text.includes(markers.private), "agent editor must not export A's private document");
    }

    // Email-session users take a separate auth branch in production.
    for (const actor of [owner, other]) {
      for (const path of ["/api/messages", "/api/messages/stream", `/api/agents/${agentId}/docgen/generate`]) {
        const index = captures.length;
        const response = await request("POST", path, actor, path.endsWith("/generate")
          ? { docType: "Checklist", context: "Susun checklist untuk sesi email fixture." }
          : { agentId, role: "user", content: "Ringkas referensi.", sessionId: `email-${actor}-${path}` }, true);
        const text = await response.text();
        assert.equal(response.status, path === "/api/messages" ? 201 : 200, text);
        assert.equal(captures.length, index + 1);
        assert.equal(JSON.stringify(captures[index].messages).includes(markers.private), actor === owner);
      }
    }

    // Clearing public history is also principal-scoped, not agent-wide.
    const aBeforeClear = await (await request("GET", `/api/messages/${agentId}`, owner)).json();
    const cleared = await request("DELETE", `/api/messages/${agentId}`, other);
    assert.equal(cleared.status, 204);
    assert.deepEqual(await (await request("GET", `/api/messages/${agentId}`, other)).json(), []);
    assert.deepEqual(await (await request("GET", `/api/messages/${agentId}`, owner)).json(), aBeforeClear);
    assert.ok((await fixture.storage.getMessagesBySession(agentId, "legacy-unowned")).length,
      "unowned rows remain retained, not silently deleted");

    // Exercise the production history wiring with both supported login types.
    const publicationPath = `/api/knowledge-base/${privateId}/publication`;
    assert.equal((await request("POST", publicationPath, owner, { publish: true, confirmed: true })).status, 200);
    for (const emailSession of [false, true]) {
      for (const actor of [owner, other, undefined]) {
        const response = await request("GET", `${publicationPath}/history`, actor, undefined, emailSession);
        assert.equal(response.status, actor === owner ? 200 : actor ? 403 : 401);
        if (actor === owner) {
          const history = await response.json() as any;
          assert.equal(history.entries.length, 1);
          assert.equal(history.entries[0].actorId, owner);
          assert.equal(history.entries[0].action, "publish");
          assert.equal(history.entries[0].contentRevision, 1);
          assert.ok(!JSON.stringify(history).includes(markers.private));
        }
      }
    }
    assert.equal((await request("POST", publicationPath, owner, { publish: false, confirmed: true })).status, 200);
    const revoked = await (await request("GET", `${publicationPath}/history`, owner)).json() as any;
    assert.deepEqual(revoked.entries.map((entry: any) => entry.action), ["revoke", "publish"]);
  } finally {
    await fixture.close();
  }
});

test("SIGKILL of production HTTP fixture leaves no private documents or accounts", {
  skip: ready ? false : testDbSkip, timeout: 30_000,
}, async () => {
  const probe = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
  const seedBefore = await probe.query("SELECT count(*)::int AS n FROM sales_ladders");
  const child = fork(fileURLToPath(new URL("./fixtures/kb-context-kill-child.ts", import.meta.url)), {
    execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let stderr = "";
  child.stderr?.on("data", chunk => { stderr += chunk; });
  try {
    const readyMessage = await Promise.race([
      once(child, "message", { signal: AbortSignal.timeout(20_000) }).then(([message]) => message),
      once(child, "exit").then(() => { throw new Error(`Abort fixture exited before ready: ${stderr}`); }),
    ]) as { agentId: string; kbId: string; privateCount: number };
    assert.equal(readyMessage.privateCount, 1, "child proves imported KB exists inside its transaction");
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    const [, signal] = await exited;
    assert.equal(signal, "SIGKILL");
    const accounts = await probe.query("SELECT id FROM users WHERE id IN ($1, $2)", [owner, other]);
    assert.equal(accounts.rowCount, 0, "all fixture accounts rolled back");
    assert.equal((await probe.query("SELECT id FROM agents WHERE id = $1", [readyMessage.agentId])).rowCount, 0);
    assert.equal((await probe.query("SELECT id FROM knowledge_bases WHERE id = $1", [readyMessage.kbId])).rowCount, 0);
    assert.equal((await probe.query("SELECT id FROM agent_messages WHERE agent_id = $1", [readyMessage.agentId])).rowCount, 0);
    assert.equal((await probe.query("SELECT count(*)::int AS n FROM sales_ladders")).rows[0].n,
      seedBefore.rows[0].n, "startup transaction commits must not escape the fixture");
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }
    await probe.end();
  }
});
