import assert from "node:assert/strict";
import { prepareTestDatabase } from "../test-database";
import { startPaymentMigrationFixture, oldOrigin, confirmation } from "./payment-url-migration";

assert.ok(await prepareTestDatabase(), "Abort worker needs a proven disposable database");
const fixture = await startPaymentMigrationFixture();
const plan = await (await fixture.request("preview", "admin")).json();
const applied = await fixture.request("apply", "admin", { oldOrigin, confirmation, fingerprint: plan.fingerprint });
assert.equal(applied.status, 200);
assert.deepEqual((await applied.json()).updated, { agents: 1, store_products: 1 });
process.send!({ committed: true });
// Deliberately keep the committed schema, recovery record and run lock alive
// until the parent sends SIGKILL. Teardown cannot run after that signal.
