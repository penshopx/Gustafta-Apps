/**
 * Lightweight test runner untuk Kebijakan Agen.
 *
 * Project belum punya test framework (vitest/jest), jadi kita pakai
 * `node:test` builtin lewat tsx. Jalankan dengan:
 *
 *     npx tsx tests/run.ts
 *
 * Exit code akan non-zero kalau ada test yang gagal, sehingga aman
 * dipakai di CI / pre-merge check.
 */
import { run } from "node:test";
import { spec as SpecReporter } from "node:test/reporters";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const files = [
  resolve(__dirname, "payment-base-build.test.ts"),
  resolve(__dirname, "payment-url-migration.test.ts"),
  resolve(__dirname, "payment-url-migration-db-http.test.ts"),
  resolve(__dirname, "build-typecheck-gate.test.ts"),
  resolve(__dirname, "check-built-css.test.ts"),
  resolve(__dirname, "check-initial-css-budget.test.ts"),
  resolve(__dirname, "build-bundling-rollback.test.ts"),
  resolve(__dirname, "kepdirjen-281-reconciler.test.ts"),
  resolve(__dirname, "build-final-system-prompt.test.ts"),
  resolve(__dirname, "routes-helper-usage.test.ts"),
  // Static UI/API contract: every connected Hub remains visible in Hub Audit
  // and reset-to-solo requires confirmation before posting candidateIds: [].
  resolve(__dirname, "hub-audit-reset-solo-ui.test.ts"),
  // Static UI contract: grouped ecosystem cards keep their canonical external
  // URLs, lifecycle order, new-tab behavior, and rel protections.
  resolve(__dirname, "ecosystem-app-cards.test.ts"),
  resolve(__dirname, "wa-cta-integrity.test.ts"),
  resolve(__dirname, "store-product-reorder-persistence.test.ts"),
  // Unit: confirms sortOrder auto-fill reads the correct (updated) orderedProducts
  // after a product is deleted, including when all products are deleted (→ 10).
  // Explicitly models the old guard bug vs the fix so regressions are caught.
  resolve(__dirname, "store-sort-order-autofill-after-delete.test.ts"),
  // Unit: closing "Tambah Produk" without saving resets sortOrder to "0";
  // second open recomputes fresh max+10 from the current list.
  resolve(__dirname, "store-sort-order-form-close-reset.test.ts"),
  resolve(__dirname, "store-catalog-payment-link-clear.test.ts"),
  // End-to-end cache invalidation: PATCH payment_url via HTTP → GET catalog
  // immediately returns the NEW URL (warm cache invalidated, no TTL wait).
  resolve(__dirname, "store-catalog-payment-url-update.test.ts"),
  // End-to-end cache invalidation: DELETE via HTTP removes a product from the
  // very next catalog GET, without waiting for the warm cache to expire.
  resolve(__dirname, "store-catalog-product-delete.test.ts"),
  // Integration + cache: confirms clearing a product's paymentUrl falls back to
  // the agent URL (or null) immediately after invalidation — without a redeploy.
  resolve(__dirname, "store-catalog-payment-link-fallback.test.ts"),
  // DB integration: module metadata/filter/cache and premiumClass preservation
  // for direct agents plus linked Store products.
  resolve(__dirname, "store-catalog-module-filter.test.ts"),
  // DB integration: idempotent module reconciliation never overwrites an
  // existing module, prompt, or premiumClass.
  resolve(__dirname, "chatbot-module-reconcile.test.ts"),
  // DB integration: confirms superadmin bootstrap guard survives server restarts.
  // Skipped automatically (process.exit 0) when DATABASE_URL is absent.
  resolve(__dirname, "bootstrap-superadmin-db.test.ts"),
  // Concurrency regression: spawns two child processes of the test above at
  // the same time; the global advisory run-lock must serialize them so
  // neither clobbers the other's rows/recovery record. Skipped without DB.
  resolve(__dirname, "bootstrap-superadmin-db-concurrent.test.ts"),
  // DB integration: 4 produk claw baru (desain/rencana/studi-kelayakan +
  // persiapan-proyek-multiclaw) tetap Store-visible setelah seed dijalankan
  // dua kali (fresh + rekonsiliasi) — flags sellability, wiring 3 anggota via
  // slug lookup, dan kehadiran di katalog. Skipped tanpa DATABASE_URL.
  resolve(__dirname, "claw-seed-store-visibility.test.ts"),
  // Static (no DB): MultiClaw seed returns early when a member is absent, so
  // all three member claw seeds must remain before it in the boot sequence.
  resolve(__dirname, "persiapan-proyek-multiclaw-seed-order.test.ts"),
  // Unit: confirms normalizePhone + promoteSuperAdminIfMatch handle all phone
  // formats (leading 0, +62, bare 8x) so format mismatches never silently block
  // superadmin promotion. No DB or env required — pure logic test.
  resolve(__dirname, "superadmin-phone-promotion.test.ts"),
  // Real recovery handlers and superadmin guards with an isolated SQL fixture.
  resolve(__dirname, "legacy-memory-recovery.test.ts"),
  resolve(__dirname, "legacy-memory-routes-http.test.ts"),
  // Static + logic: confirms handleBuyNow/handleBuy in store pages builds
  // PAYMENT_BASE_URL/c/checkout?variant_ids=<id>&qty=1 when paymentUrl is null.
  // Catches regressions where the field is dropped from the catalog response or
  // the handler falls back to the root payment domain instead of the checkout path.
  resolve(__dirname, "store-beli-scalev-checkout.test.ts"),
  // DB + HTTP regression: canonical Registry/Store/Scalev mapping for the
  // SBU-SKK ebook, private bytea integrity, exact Sales Ladder mapping, no
  // client-side PDF leak, and paid-only token download through the real server.
  resolve(__dirname, "sbu-skk-ebook-delivery.test.ts"),
  // DB integration + static: when a product with a scalev_variant_id is later
  // given a payment_url, the catalog serves BOTH fields together (transition is
  // clean), every Beli handler takes exactly one checkout path (no double
  // charge), and featured handleBuy uses paymentUrl exclusively over the variant.
  resolve(__dirname, "checkout-payment-url-transition.test.ts"),
  // Static guard: Brain Builder endpoints (paid Anthropic completions) must be
  // rate-limited per user via the shared store, cap all text inputs, and keep
  // improve-brain behind assertCanMutateAgent — prevents API-credit exhaustion.
  resolve(__dirname, "brain-builder-guard.test.ts"),
  // Behavioral regression with mocked Claude: missing orchestrator markers,
  // non-owner access, oversized prompts, and hourly over-limit requests must
  // fail before any prompt can be saved or an external AI call is made.
  resolve(__dirname, "improve-brain-handler.test.ts"),
  // DB integration: confirms POST /api/admin/lms/courses/bulk-activate and
  // bulk-deactivate each return `activated`/`deactivated` = only the courses
  // that actually changed state, not the full selection. Also confirms empty-ids
  // → 400 and auth gates. DB cases require a validated LMS_TEST_DATABASE_URL.
  resolve(__dirname, "lms-bulk-activate-deactivate-mixed.test.ts"),
  // Static: confirms the certificate copy-link button (button-copy-verify-{id})
  // calls navigator.clipboard.writeText with a full absolute URL
  // (https://gustafta.my.id/lms/verify/<code>) — not a relative path — so
  // students never paste a broken link into email or chat.
  resolve(__dirname, "lms-certificate-copy-link.test.ts"),
  // Static + unit: confirms POST /api/store/order/manual calls
  // sendDigitalProductDeliveryEmail with the buyer's email and resolved
  // download URL, and surfaces emailSent in the JSON response. Also unit-tests
  // the real email helper and resolveDownloadUrl directly so signature
  // regressions are caught without booting a full server.
  resolve(__dirname, "store-manual-order-digital-email.test.ts"),
  resolve(__dirname, "store-manual-order-email-fail-reason.test.ts"),
  // DB integration: confirms POST /api/admin/lms/cert-repair backfills every
  // completed enrollment without a certificate and GET /api/admin/lms/health
  // returns pendingCertificates=0 afterwards (the UI condition that hides the
  // red alert + Perbaiki button). Requires a dedicated LMS_TEST_DATABASE_URL.
  resolve(__dirname, "lms-cert-repair-clears-pending.test.ts"),
  // DB integration: confirms two simultaneous POST /api/admin/lms/cert-repair
  // requests yield exactly one 200 and one 409 with the Indonesian
  // "already running" message, and a third request after completion is 200
  // again (in-flight flag reset in finally). Requires LMS_TEST_DATABASE_URL.
  resolve(__dirname, "lms-cert-repair-concurrent-guard.test.ts"),
  // DB integration: confirms POST /api/admin/lms/reseed reports accurate
  // counts — a lesson row mutated directly in the DB yields updated > 0 with
  // added = 0 and gets restored to seed content; an unchanged second pass
  // yields added = 0 and updated = 0. Requires LMS_TEST_DATABASE_URL.
  resolve(__dirname, "lms-reseed-updated-counts.test.ts"),
  resolve(__dirname, "lms-curriculum-removal.test.ts"),
  // DB integration: confirms DELETE /api/admin/lms/lessons/:id?force=true
  // removes the deleted lesson's lms_lesson_progress rows and recalculates
  // enrollment progress/completed_at so a student's completion percentage
  // never stays inflated after a lesson is deleted. Also checks the 409
  // enrollment guard and 401 without auth. Requires LMS_TEST_DATABASE_URL.
  resolve(__dirname, "lms-lesson-delete-progress.test.ts"),
  // DB integration: guard regression test — a lesson whose course has student
  // progress cannot be deleted silently. DELETE without ?force=true → 409 with
  // enrolledStudents > 0 and nothing deleted; with ?force=true → 200 and the
  // progress rows are gone. Requires LMS_TEST_DATABASE_URL.
  resolve(__dirname, "lms-lesson-delete-guard.test.ts"),
  // DB integration: course-level delete guard — DELETE /api/admin/lms/courses/:id
  // without ?force=true → 409 + enrollmentCount when students are enrolled;
  // with ?force=true → 200 and ALL dependent rows (enrollments, lesson_progress,
  // certificates, lessons) removed in one transaction. Also statically checks the
  // admin-academy.tsx two-stage force-confirm dialog only sends force=true after
  // explicit confirmation. Requires LMS_TEST_DATABASE_URL.
  resolve(__dirname, "lms-force-delete-cascade.test.ts"),
  // Request-level regression uses an in-memory adapter and must never connect
  // to the shared DB, even when DATABASE_URL is present in the environment.
  resolve(__dirname, "lms-access-progress-request.test.ts"),
  // Real-DB regression is opt-in: only a marked, dedicated _lms_test database.
  // With just DATABASE_URL it skips instead of touching customer data.
  resolve(__dirname, "lms-reenroll-certificate.test.ts"),
  // Guard regression: new DB-backed LMS suites cannot opt in from the app URL.
  resolve(__dirname, "lms-test-isolation.test.ts"),
  resolve(__dirname, "lms-fixture-recovery.test.ts"),
  // Every non-LMS mutating suite must reject application URLs, also when
  // invoked directly; missing dedicated DB leaves pure/static cases enabled.
  resolve(__dirname, "test-database-isolation.test.ts"),
  resolve(__dirname, "test-database-lease.test.ts"),
  // HTTP mirror + unit + static: confirms the email-health test endpoint's
  // no-admin-email guard returns 400 with the friendly message the UI renders.
  resolve(__dirname, "admin-email-test-no-email.test.ts"),
  // Real sendEmail (no BREVO_API_KEY) → not_configured; endpoint 502 contract;
  // static checks against server/routes.ts + admin-ai-health.tsx fallback chain.
  resolve(__dirname, "admin-email-test-brevo-not-configured.test.ts"),
  // Static route/UI contract: pending digital orders expose a superadmin-only
  // retry action; email falls back to WA and total failure leaves status pending.
  resolve(__dirname, "admin-digital-delivery-retry.test.ts"),
  // DB integration end-to-end: POST /api/webhooks/scalev (payment_status=paid,
  // produk "Gustafta Paket 1 Bulan") dikirim dua kali → tetap tepat satu baris
  // subscriptions_new berstatus 'active' dengan kolom order_id (hasil rename
  // dari scalev_order_id) terisi scalev_plan_<orderId>. Juga cek
  // getSubscriptionByOrderId + jalur non-paid.
  // Skipped when DATABASE_URL is absent.
  resolve(__dirname, "scalev-webhook-subscription-activation.test.ts"),
  // DB-backed end-to-end: Unified Order API records immutable package snapshot
  // price/version, survives ORD/scalev/STORE identifier collisions, then a paid
  // webhook marks the order paid and fulfills entitlements. Durable recovery
  // cleanup repairs interrupted fixtures inside the dedicated test database.
  resolve(__dirname, "order-api-scalev.test.ts"),
  // Integration (real handlers from server/lib/prod-url.ts): POST
  // /api/admin/set-prod-url validation (https-only, no .replit.dev) and
  // GET /api/config/app-url reflecting the saved URL — never a .replit.dev
  // fallback — so delivery links can't break after an admin saves a valid URL.
  resolve(__dirname, "prod-url-validation.test.ts"),
  // Static/unit (no DB): validates server/claw-catalog.ts before seeding —
  // global slug uniqueness (products + tools + generated evaluator slugs +
  // legacy seed-file agents), pricing convention (K2/2.5jt/199rb OpenClaw,
  // K3/5jt/299rb MultiClaw, documented exceptions), required fields non-empty
  // and evaluatorCriteria of exactly 4. Catches duplicate or mispriced Claw
  // batches at build time instead of after they reach the Store.
  resolve(__dirname, "claw-catalog-validation.test.ts"),
  // DB integration + static: scalevVariantId dipetakan di catalog builder,
  // dan alur cart (cart-drawer + use-cart buildCheckoutUrl) memakai
  // keberadaan scalevVariantId sebagai kondisi penentu — item dengan
  // variant ID DAN paymentUrl dirutekan lewat /c/checkout?variant_ids=.
  // Hook test produksi ada di tests/cart-scalev-checkout.vitest.tsx.
  resolve(__dirname, "store-catalog-scalev-variant.test.ts"),
  // Unit + static route/UI contract: dead Scalev variants are rejected before
  // an admin product update and the provider's clear warning reaches the toast.
  resolve(__dirname, "scalev-variant-save-validation.test.ts"),
  // Full registerRoutes + authenticated admin + real DB write: valid IDs save,
  // while deleted/unavailable Scalev variants leave the previous ID untouched.
  resolve(__dirname, "scalev-variant-save-validation-http.test.ts"),
  // Real HTTP routes + DB: global taxonomy reads remain public while only
  // admins may create, edit, or delete categories.
  resolve(__dirname, "taxonomy-admin-http.test.ts"),
  // HTTP + real DB IDOR regression: project detail/update/delete are owner-only,
  // linked Ruang Simpan files must share that owner, and anonymous calls are 401.
  resolve(__dirname, "ruang-proyek-ownership-http.test.ts"),
  // HTTP + real DB: public showcase returns an exact safe-field allowlist,
  // with contract value/client present only when each project explicitly opts in.
  resolve(__dirname, "ruang-proyek-etalase-allowlist-http.test.ts"),
  // Isolated-schema DB regression: a pre-admin_docs Ruang Proyek table is
  // migrated idempotently, then list/detail/PATCH adminDocs work over real HTTP.
  resolve(__dirname, "ruang-proyek-admin-docs-migration.test.ts"),
  // HTTP + DB integration: Product Registry + GAIA Publishing admin-only —
  // anonim 401, non-admin 403, admin create→validate→publish (zip response),
  // product_id permanen lintas edit/versi, 422 + missing untuk produk DRAFT.
  // Skipped when DATABASE_URL is absent.
  resolve(__dirname, "gaia-registry-admin-http.test.ts"),
  // HTTP security regression: memory CRUD is scoped to the authenticated user
  // and requires access to the referenced agent's chat surface.
  resolve(__dirname, "user-memory-access-http.test.ts"),
  resolve(__dirname, "tender-sessions-ownership-http.test.ts"),
  // Demand-led promotion engine (Task #396): route guards, migration/schema,
  // event privacy+dedupe, no raw search persistence, max 3/exactly 1 primary,
  // eligibility, schedule/fallback, human approval, attribution, 7/30 scoring.
  resolve(__dirname, "solution-promotion-engine.test.ts"),
  resolve(__dirname, "ecosystem-monitor-watchdog.test.ts"),
  resolve(__dirname, "ecosystem-cronitor-config-audit.test.ts"),
];

let hadFailure = false;

const stream = run({ files, concurrency: false });

stream.on("test:fail", (event) => {
  // node:test menandai suite-level events juga; abaikan event tanpa nama testfile.
  if (event && event.details && event.details.error) {
    hadFailure = true;
  }
});

// Pipe TAP/spec output ke stdout
stream.compose(new SpecReporter()).pipe(process.stdout);

stream.on("end", () => {
  if (hadFailure) {
    process.exitCode = 1;
  }
});
