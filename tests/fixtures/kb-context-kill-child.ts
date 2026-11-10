import { prepareTestDatabase } from "../test-database";
import assert from "node:assert/strict";
import { startKBContextFixture, markers, owner } from "./kb-context-http";

assert.ok(await prepareTestDatabase(), "Abort fixture needs a proven isolated database");
const fixture = await startKBContextFixture();
const response = await fixture.request("POST", `/api/agents/${fixture.agentId}/apply-import`, owner, {
  proposal: {}, knowledgeChunks: [{
    name: "Abort-only private import",
    content: `${markers.private} private reference must disappear on SIGKILL.`,
  }],
});
assert.equal(response.status, 200);
const imported = await response.json() as any;
const kbId = imported.knowledgeBasesCreated[0].id;
const { rows } = await fixture.query(
  "SELECT count(*)::int AS n FROM knowledge_bases WHERE id = $1 AND visibility = 'private' AND owner_user_id = $2",
  [kbId, owner],
);
const chat = await fixture.request("POST", "/api/messages", owner, {
  agentId: fixture.agentId, role: "user", content: "Ringkas referensi.", sessionId: "abort-fixture",
});
assert.equal(chat.status, 201);
await chat.text();
process.send!({ agentId: fixture.agentId, kbId, privateCount: rows[0].n });
// Parent sends SIGKILL while the SQL transaction and HTTP server are alive.
