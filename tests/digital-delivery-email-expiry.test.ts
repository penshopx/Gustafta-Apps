import assert from "node:assert/strict";
import test from "node:test";

import { sendDigitalProductDeliveryEmail } from "../server/lib/email";
import { isExternalDownloadUrl } from "../server/lib/supabase-storage";

type BrevoPayload = {
  htmlContent?: string;
  textContent?: string;
};

async function captureDeliveryEmail(
  expiryHours?: number | null,
): Promise<BrevoPayload> {
  const originalKey = process.env.BREVO_API_KEY;
  const originalFetch = globalThis.fetch;
  let payload: BrevoPayload | undefined;

  process.env.BREVO_API_KEY = "test-brevo-key";
  globalThis.fetch = async (_input, init) => {
    payload = JSON.parse(String(init?.body)) as BrevoPayload;
    return new Response(JSON.stringify({ messageId: "test-message" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const options = {
      to: "buyer@example.com",
      customerName: "Pembeli Test",
      productName: "Produk Digital Test",
      downloadUrl: "https://drive.google.com/file/d/test/view",
      ...(expiryHours !== undefined ? { expiryHours } : {}),
    };
    const result = await sendDigitalProductDeliveryEmail(options);
    assert.equal(result.sent, true);
    assert.ok(payload, "Payload email harus dikirim ke Brevo");
    return payload;
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.BREVO_API_KEY;
    else process.env.BREVO_API_KEY = originalKey;
  }
}

test("link permanen menyuruh pembeli menyimpan email tanpa peringatan 24 jam", async () => {
  const payload = await captureDeliveryEmail(null);
  const html = payload.htmlContent ?? "";
  const text = payload.textContent ?? "";

  assert.match(html, /Simpan email ini/);
  assert.match(text, /Simpan email ini/);
  assert.doesNotMatch(html, /24 jam/);
  assert.doesNotMatch(text, /24 jam/);
});

test("expiryHours default maupun eksplisit 24 tetap menampilkan peringatan 24 jam", async () => {
  for (const expiryHours of [undefined, 24] as const) {
    const payload = await captureDeliveryEmail(expiryHours);
    const html = payload.htmlContent ?? "";
    const text = payload.textContent ?? "";

    assert.match(html, /Link aktif selama 24 jam/);
    assert.match(text, /Link aktif selama 24 jam/);
  }
});

test("isExternalDownloadUrl membedakan URL http(s) dari path bucket", () => {
  assert.equal(isExternalDownloadUrl("https://drive.google.com/file/d/test/view"), true);
  assert.equal(isExternalDownloadUrl("http://example.com/download/file.pdf"), true);
  assert.equal(isExternalDownloadUrl("products/template/file.pdf"), false);
});