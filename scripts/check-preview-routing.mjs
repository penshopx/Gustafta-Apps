/**
 * Read-only check of the real workspace proxy, NOT localhost or --connect-to.
 * Start both existing workflows before running this check. No credentials used.
 */
import assert from "node:assert/strict";
import { checkPreviewRouting } from "./lib/preview-routing-contract.mjs";

const domain = process.env.REPLIT_DEV_DOMAIN;
assert(domain, "REPLIT_DEV_DOMAIN is required; no localhost fallback is allowed.");
assert(
  /^[a-z0-9.-]+\.replit\.dev$/i.test(domain),
  "Expected a development hostname, not a production URL.",
);
const origin = `https://${domain}`;

await checkPreviewRouting({ origin });
