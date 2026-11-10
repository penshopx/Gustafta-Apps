import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { sendPendingPlatformSubscriptionAdminAlert } from "../server/lib/email";

const originalFetch = globalThis.fetch;
const originalKey = process.env.BREVO_API_KEY;
const originalAlertEmail = process.env.BREVO_ALERT_EMAIL;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.BREVO_API_KEY;
  else process.env.BREVO_API_KEY = originalKey;
  if (originalAlertEmail === undefined) delete process.env.BREVO_ALERT_EMAIL;
  else process.env.BREVO_ALERT_EMAIL = originalAlertEmail;
});

test("admin mendapat email lengkap saat langganan berbayar belum memiliki akun", async () => {
  process.env.BREVO_API_KEY = "test-only-key";
  process.env.BREVO_ALERT_EMAIL = "admin@example.test";
  let request: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = async (url, init) => {
    request = { url: String(url), init };
    return new Response("", { status: 201 });
  };

  const result = await sendPendingPlatformSubscriptionAdminAlert({
    customerEmail: "buyer<script>@example.test",
    customerName: "Pembeli <img src=x>",
    plan: "monthly_3<script>",
    durationDays: 90,
    orderId: "SCALEV-301",
    amount: 599000,
  });

  assert.deepEqual(result, { sent: true });
  assert.equal(request?.url, "https://api.brevo.com/v3/smtp/email");
  const body = JSON.parse(String(request?.init?.body));
  assert.equal(body.to[0].email, "admin@example.test");
  assert.match(body.subject, /TINDAKAN DIPERLUKAN/);
  assert.match(body.textContent, /buyer<script>@example\.test/);
  assert.match(body.textContent, /monthly_3<script> \(90 hari\)/);
  assert.match(body.textContent, /SCALEV-301/);
  assert.doesNotMatch(body.htmlContent, /<script>|<img/);
  assert.match(body.htmlContent, /&lt;script&gt;/);
  assert.match(body.htmlContent, /&lt;img src=x&gt;/);
  assert.deepEqual(body.tags, ["platform-subscription-pending"]);
});