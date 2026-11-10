/**
 * Preloaded ONLY by the disposable commerce runner. Provider test doubles in
 * individual suites can wrap this fetch; unmocked external requests fail closed.
 */
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.origin === "https://api.brevo.com" && url.pathname === "/v3/smtp/email") {
    return new Response(JSON.stringify({ messageId: "disposable-commerce-email" }), {
      status: 201, headers: { "Content-Type": "application/json" },
    });
  }
  if (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    return realFetch(input, init);
  }
  throw new Error("Request provider belum di-mock pada suite commerce disposable");
}) as typeof fetch;
