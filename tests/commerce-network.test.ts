import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import "./fixtures/commerce-network";

test("commerce fixture never sends unmocked provider requests", async () => {
  for (const url of ["https://api.scalev.id/v3/orders", "https://example.com", "https://api.brevo.com/v3/contacts"]) {
    await assert.rejects(fetch(url), /belum di-mock/);
  }
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST", body: JSON.stringify({ to: [{ email: "fixture@example.test" }] }),
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { messageId: "disposable-commerce-email" });
});

test("commerce fixture keeps real loopback HTTP available", async () => {
  const server = createServer((_req, res) => res.end("real fixture HTTP"));
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}`);
    assert.equal(await response.text(), "real fixture HTTP");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
