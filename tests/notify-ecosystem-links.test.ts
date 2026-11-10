import assert from "node:assert/strict";
import test from "node:test";
import { notifyBrowserUnavailable, notifyEcosystemFailures, notifyEcosystemRecovery, notifyNetworkUnavailable } from "../scripts/notify-ecosystem-links";

test("ketidakpastian saat Brevo timeout atau 5xx tidak boleh otomatis mengulang pemulihan", async () => {
  let ambiguous = 0;
  const config = {
    apiKey: "test", recipient: "ops@example.test",
    onAmbiguous: () => { ambiguous++; },
  };
  assert.equal(await notifyEcosystemRecovery(["ISO Hub"], config,
    async () => new Response("", { status: 503 })), false);
  assert.equal(await notifyEcosystemRecovery(["ISO Hub"], config,
    async () => { throw new Error("secret error body"); }), false);
  assert.equal(ambiguous, 2);
  assert.equal(await notifyEcosystemRecovery(["ISO Hub"], config,
    async () => new Response("", { status: 400 })), false);
  assert.equal(ambiguous, 2);
});

const config = { apiKey: "test-key", recipient: "ops@example.test" };

test("email kegagalan berisi nama aplikasi dan status saja", async () => {
  let payload: any;
  const sent = await notifyEcosystemFailures(["ISO Hub: HTTP 503", "SMAP–PANCEK: redirect HTTP 302"], config, async (url, init) => {
    assert.equal(url, "https://api.brevo.com/v3/smtp/email");
    assert.equal((init?.headers as Record<string, string>)["api-key"], config.apiKey);
    payload = JSON.parse(init?.body as string);
    return new Response(null, { status: 201 });
  });
  assert.equal(sent, true);
  assert.equal(payload.to[0].email, config.recipient);
  assert.match(payload.textContent, /ISO Hub: HTTP 503/);
  assert.match(payload.textContent, /SMAP–PANCEK: redirect HTTP 302/);
  assert.match(payload.htmlContent, /SMAP–PANCEK: redirect HTTP 302/);
  assert.doesNotMatch(JSON.stringify(payload), /test-key|https:\/\/iso-hub/);
});

test("pemulihan mengirim hanya nama aplikasi yang dikenal tanpa URL atau kredensial", async () => {
  let payload: any;
  const sent = await notifyEcosystemRecovery(["ISO Hub"], config, async (_url, init) => {
    payload = JSON.parse(init?.body as string);
    return new Response(null, { status: 201 });
  });
  assert.equal(sent, true);
  assert.match(payload.subject, /Pemulihan/);
  assert.match(payload.textContent, /ISO Hub/);
  assert.doesNotMatch(JSON.stringify(payload), /test-key|https?:\/\//);
  assert.equal(await notifyEcosystemRecovery([], config, async () => {
    throw new Error("Tidak boleh mengirim ulang");
  }), true);
});

test("laporan tidak dikenal tidak boleh masuk email", async () => {
  const neverSend = async () => { throw new Error("Tidak boleh mengirim"); };
  assert.equal(await notifyEcosystemFailures(
    ["ISO Hub: https://example.test?token=rahasia: HTTP 503"], config, neverSend), false);
  assert.equal(await notifyEcosystemRecovery(
    ["ISO Hub: https://example.test?token=rahasia"], config, neverSend), false);
  assert.equal(await notifyEcosystemFailures(
    ["ISO Hub: browser pemeriksa tidak tersedia"], config, neverSend), false);
});

test("gangguan browser dikirim tersendiri tanpa mengklaim aplikasi gagal", async () => {
  let payload: any;
  assert.equal(await notifyBrowserUnavailable(config, async (_url, init) => {
    payload = JSON.parse(init?.body as string);
    return new Response(null, { status: 201 });
  }), true);
  assert.match(payload.subject, /browser pemeriksa/);
  assert.match(payload.textContent, /belum dapat dipastikan/);
  assert.doesNotMatch(JSON.stringify(payload), /ISO Hub|test-key|https?:\/\//);
});

test("gangguan konektivitas pemeriksa dikirim tersendiri tanpa URL atau nama aplikasi", async () => {
  let payload: any;
  assert.equal(await notifyNetworkUnavailable(config, async (_url, init) => {
    payload = JSON.parse(init?.body as string);
    return new Response(null, { status: 201 });
  }), true);
  assert.match(payload.subject, /konektivitas pemeriksa/);
  assert.match(payload.textContent, /belum dapat dipastikan/);
  assert.doesNotMatch(JSON.stringify(payload), /ISO Hub|test-key|https?:\/\//);
  assert.equal(await notifyNetworkUnavailable({}, async () => {
    throw new Error("Tidak boleh menghubungi Brevo");
  }), false);
});

test("konfigurasi hilang dan respons Brevo gagal tidak dianggap terkirim atau mencetak body", async () => {
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args) => { errors.push(args.join(" ")); };
  try {
    assert.equal(await notifyEcosystemFailures(["ISO Hub: HTTP 503"], {}, async () => {
      throw new Error("Tidak boleh menghubungi Brevo");
    }), false);
    assert.equal(await notifyEcosystemFailures(["ISO Hub: HTTP 503"], config, async () =>
      new Response("private-token-in-error", { status: 401 })), false);
    assert.match(errors.join("\n"), /belum dikonfigurasi/);
    assert.match(errors.join("\n"), /HTTP 401/);
    assert.doesNotMatch(errors.join("\n"), /private-token-in-error|test-key/);
  } finally {
    console.error = original;
  }
});