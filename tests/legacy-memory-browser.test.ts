import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import puppeteer, { type Page, type ElementHandle } from "puppeteer-core";
import { startRecoveryBrowserFixture } from "./fixtures/legacy-memory-browser/server";

// Explicit browser suite, not part of the cheap default unit-test run.
// npm run test:legacy-memory-browser (Chromium must be installed).
const base = "/api/admin/legacy-memories";
const attestation = "I independently verified the trusted original record";
async function post(page: Page, url: string, body: unknown = {}) {
  return page.evaluate(async (url, body) => {
    const response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  }, url, body);
}
async function ready(page: Page) {
  await page.waitForSelector('[data-testid="memory-3"]');
}
async function paginate(page: Page, heading: string, next: boolean) {
  const button = await page.evaluateHandle((heading, next) => {
    const headings = document.querySelectorAll("h2");
    for (const item of headings) {
      if (item.textContent === heading) {
        const buttons = item.parentElement!.querySelectorAll("button");
        return buttons[buttons.length - (next ? 1 : 2)];
      }
    }
    throw new Error(`Missing section: ${heading}`);
  }, heading, next);
  const element = button.asElement() as ElementHandle<HTMLButtonElement> | null;
  assert.ok(element);
  await element.click();
  await button.dispose();
}
async function submit(page: Page, evidence: any, hash = evidence.evidenceSha256) {
  await page.click(`[data-testid="memory-${evidence.memoryId}"]`);
  await page.type("#proposed-user", evidence.proposedUserId);
  await page.type("#evidence-ref", evidence.evidenceRef);
  await page.type("#evidence-hash", hash);
  assert.equal(await page.$eval('[data-testid="submit-evidence"]', el => (el as HTMLButtonElement).disabled), true);
  await page.click("form input[type=checkbox]");
  await page.click('[data-testid="submit-evidence"]');
  await page.waitForFunction('document.querySelector("#proposed-user") === null');
}
async function selectNewReview(page: Page, id: number) {
  await page.reload();
  await ready(page);
  await paginate(page, "Riwayat keputusan", true);
  await page.waitForSelector(`[data-testid="review-${id}"]`);
  await page.click(`[data-testid="review-${id}"]`);
}
async function decisionEnabled(page: Page, approve: boolean, reject = approve) {
  for (const name of ["approve-review", "reject-review"]) {
    assert.equal(await page.$eval(`[data-testid="${name}"]`, el => !(el as HTMLButtonElement).disabled), name === "approve-review" ? approve : reject, name);
  }
}

test("real browser: independent reviewers, original-proof gate, access denial and independent history cursors", { timeout: 120_000 }, async () => {
  const server = await startRecoveryBrowserFixture();
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  try {
    browser = await puppeteer.launch({
      executablePath: execFileSync("which", ["chromium"], { encoding: "utf8" }).trim(),
      headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const errors: string[] = [];
    const pages: Page[] = [];
    for (const actor of ["admin-a", "admin-b", "ordinary-user"]) {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      page.on("pageerror", error => errors.push(String(error)));
      await page.goto(server.url);
      assert.equal((await post(page, `/__fixture/login/${actor}`)).status, 200);
      await page.goto(`${server.url}/admin/legacy-memories`);
      pages.push(page);
    }
    const [a, b, ordinary] = pages;
    await ready(a);
    await ready(b);
    await ordinary.waitForSelector('[role="alert"]');
    assert.match(await ordinary.$eval('[role="alert"]', el => el.textContent!), /Akses ditolak/);
    assert.equal(await ordinary.$('[data-testid="memory-3"]'), null);
    assert.equal(server.fixture.audit.filter(r => r.actor === "ordinary-user").length, 0, "ordinary UI must never request queue");
    assert.equal((await post(ordinary, `${base}/reviews`, server.fixture.evidence(3))).status, 403);
    assert.equal((await post(ordinary, `${base}/reviews/1/decision`, {
      approve: true, rationale: "original_record_verified", attestation,
    })).status, 403);

    await b.click('[data-testid="review-1"]');
    assert.match(await b.$eval("body", el => el.textContent!), /Rujukan lama disembunyikan/);
    assert.doesNotMatch(await b.$eval("body", el => el.textContent!), /fixture:historical-record|Fixture archive was insufficient/);

    // Independent pagination: history advances without moving unowned rows,
    // and moving unowned rows does not reset history.
    await paginate(b, "Riwayat keputusan", true);
    await b.waitForSelector('[data-testid="review-101"]');
    assert.ok(await b.$('[data-testid="memory-3"]'));
    assert.equal(await b.$('[data-testid="review-1"]'), null);
    await paginate(b, "Baris tanpa pemilik", true);
    await b.waitForSelector('[data-testid="memory-103"]');
    assert.ok(await b.$('[data-testid="review-101"]'));
    assert.equal(await b.$('[data-testid="memory-3"]'), null);
    await paginate(b, "Baris tanpa pemilik", false);
    await ready(b);
    assert.ok(await b.$('[data-testid="review-101"]'));
    const cursors = server.fixture.audit.filter(r => r.actor === "admin-b" && r.method === "GET").map(r => r.path);
    assert.ok(cursors.includes(`${base}?afterMemory=0&afterReview=100`));
    assert.ok(cursors.includes(`${base}?afterMemory=102&afterReview=100`));

    // Wrong digest: checking the browser attestation cannot bypass server proof.
    await submit(a, server.fixture.evidence(3), "b".repeat(64));
    await selectNewReview(a, 103);
    assert.match(await a.$eval("body", el => el.textContent!), /Anda pengaju/);
    assert.equal(await a.$('[data-testid="approve-review"]'), null);
    assert.equal(await a.$('[data-testid="reject-review"]'), null);
    for (const approve of [true, false]) {
      assert.equal((await post(a, `${base}/reviews/103/decision`, {
        approve, rationale: approve ? "original_record_verified" : "record_unavailable",
        attestation: approve ? attestation : "I independently reviewed the evidence and found it insufficient",
      })).status, 409);
    }
    assert.equal((await post(a, `${base}/reviews`, server.fixture.evidence(3))).status, 409);
    await selectNewReview(b, 103);
    await decisionEnabled(b, false);
    assert.equal(await b.$("#rationale textarea"), null);
    await b.click('input[type="checkbox"]');
    await decisionEnabled(b, false);
    await b.select("#rationale", "original_record_verified");
    await decisionEnabled(b, true, false);
    b.once("dialog", dialog => { void dialog.dismiss(); });
    await b.click('[data-testid="approve-review"]');
    assert.equal(server.fixture.reviews.find(r => r.id === 103)!.decision, "pending");
    assert.equal(server.fixture.archiveReads.length, 0, "cancel must not call approval API");
    b.once("dialog", dialog => { void dialog.accept(); });
    const denied = b.waitForResponse(r => r.url().endsWith("/reviews/103/decision"));
    await b.click('[data-testid="approve-review"]');
    assert.equal((await denied).status(), 409);
    await b.waitForFunction('document.body.textContent.includes("Tindakan gagal; tidak ada perubahan yang dikonfirmasi")');
    assert.equal(server.fixture.memories[0].user_id, null);
    assert.equal(server.fixture.reviews.find(r => r.id === 103)!.decision, "pending");
    await b.select("#rationale", "record_mismatch");
    await decisionEnabled(b, false, true);
    const rejected = b.waitForResponse(r => r.url().endsWith("/reviews/103/decision"));
    await b.click('[data-testid="reject-review"]');
    assert.equal((await rejected).status(), 200);
    await b.waitForFunction('document.querySelector("#rationale") === null');
    assert.equal(server.fixture.memories[0].user_id, null);
    assert.equal(server.fixture.reviews.find(r => r.id === 103)!.reviewed_by, "admin-b");
    await selectNewReview(b, 103);
    assert.match(await b.$eval('[data-testid="review-103"]', el => el.textContent!), /Ditolak/);
    assert.equal(await b.$('[data-testid="approve-review"]'), null);

    // Exact original bytes and all three IDs permit only the second reviewer.
    await a.reload(); await ready(a);
    await submit(a, server.fixture.evidence(4));
    await selectNewReview(b, 104);
    await b.select("#rationale", "original_record_verified");
    await decisionEnabled(b, false);
    await b.click('input[type="checkbox"]');
    await decisionEnabled(b, true, false);
    b.once("dialog", dialog => { void dialog.accept(); });
    const approved = b.waitForResponse(r => r.url().endsWith("/reviews/104/decision"));
    await b.click('[data-testid="approve-review"]');
    assert.equal((await approved).status(), 200);
    await b.waitForFunction('document.querySelector("#rationale") === null');
    assert.equal(server.fixture.memories[1].user_id, "fixture-owner");
    assert.equal(server.fixture.reviews.find(r => r.id === 104)!.reviewed_by, "admin-b");
    assert.deepEqual(server.fixture.archiveReads, [server.fixture.evidence(3).evidenceRef, server.fixture.evidence(4).evidenceRef]);
    await selectNewReview(b, 104);
    assert.match(await b.$eval('[data-testid="review-104"]', el => el.textContent!), /Disetujui/);
    assert.equal(await b.$('[data-testid="memory-4"]'), null);
    assert.equal(await b.$('[data-testid="approve-review"]'), null);
    assert.equal((await post(b, `${base}/reviews/104/decision`, {
      approve: true, rationale: "original_record_verified", attestation,
    })).status, 409);
    assert.deepEqual(errors, [], "no runtime browser errors");
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("open review follows another superadmin's decision, including a conflicting in-flight decision", { timeout: 120_000 }, async () => {
  const server = await startRecoveryBrowserFixture();
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  try {
    browser = await puppeteer.launch({
      executablePath: execFileSync("which", ["chromium"], { encoding: "utf8" }).trim(),
      headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const errors: string[] = [];
    const pages: Page[] = [];
    for (const actor of ["admin-a", "admin-b", "admin-c"]) {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      page.on("pageerror", error => errors.push(String(error)));
      await page.goto(server.url);
      assert.equal((await post(page, `/__fixture/login/${actor}`)).status, 200);
      await page.goto(`${server.url}/admin/legacy-memories`);
      await ready(page);
      pages.push(page);
    }
    const [submitter, stale, winner] = pages;
    for (const approve of [false, true]) {
      const memoryId = approve ? 4 : 3;
      const id = approve ? 104 : 103;
      await submit(submitter, server.fixture.evidence(memoryId));
      await selectNewReview(stale, id);
      await selectNewReview(winner, id);
      await stale.evaluate(() => { document.body.dataset.openReview = "unchanged"; });
      await stale.select("#rationale", "record_mismatch");
      await stale.click('input[type="checkbox"]');
      await stale.waitForFunction('!document.querySelector("[data-testid=reject-review]").disabled');

      // Hold an actual decision request so the other browser wins deterministically,
      // even on slow CI. Polling alone exercises the non-submitting case below.
      let releaseDecision: (() => Promise<void>) | undefined;
      if (approve) {
        await stale.setRequestInterception(true);
        const intercepted = new Promise<void>(resolve => {
          stale.on("request", request => {
            if (request.method() === "POST" && request.url().endsWith(`/reviews/${id}/decision`)) {
              releaseDecision = () => request.continue();
              resolve();
            } else {
              void request.continue();
            }
          });
        });
        await stale.click('[data-testid="reject-review"]');
        await intercepted;
      }
      await winner.select("#rationale", approve ? "original_record_verified" : "record_unavailable");
      await winner.click('input[type="checkbox"]');
      await winner.waitForFunction(
        'document.querySelector("[data-testid=' + (approve ? "approve-review" : "reject-review") + ']").disabled === false',
      );
      if (approve) winner.once("dialog", dialog => { void dialog.accept(); });
      const decided = winner.waitForResponse(r => r.url().endsWith(`/reviews/${id}/decision`));
      await winner.click(`[data-testid="${approve ? "approve-review" : "reject-review"}"]`);
      assert.equal((await decided).status(), 200);
      if (releaseDecision) {
        const conflict = stale.waitForResponse(r => r.url().endsWith(`/reviews/${id}/decision`));
        await releaseDecision();
        assert.equal((await conflict).status(), 409);
      }
      await stale.waitForSelector('[data-testid="review-conflict"]');
      assert.match(await stale.$eval('[data-testid="review-conflict"]', el => el.textContent!), /superadmin lain/);
      assert.equal(await stale.$("#rationale"), null, "stale decision form is removed");
      assert.equal(await stale.$('[data-testid="approve-review"]'), null);
      assert.equal(await stale.$('[data-testid="reject-review"]'), null);
      assert.match(await stale.$eval(`[data-testid="review-${id}"]`, el => el.textContent!), approve ? /Disetujui/ : /Ditolak/);
      assert.match(await stale.$eval("body", el => el.textContent!), /admin-c/);
      assert.equal(await stale.evaluate(() => document.body.dataset.openReview), "unchanged", "no page reload");
      assert.equal(server.fixture.reviews.find(row => row.id === id)!.reviewed_by, "admin-c");
      assert.equal(server.fixture.reviews.find(row => row.id === id)!.reason_code,
        approve ? "original_record_verified" : "record_unavailable");
      assert.equal(server.fixture.memories.find(row => row.id === memoryId)!.user_id,
        approve ? "fixture-owner" : null);
      const stalePosts = server.fixture.audit.filter(row =>
        row.actor === "admin-b" && row.method === "POST" && row.path.endsWith(`/reviews/${id}/decision`));
      assert.deepEqual(stalePosts.map(row => row.status), approve ? [409] : [],
        "refresh must not send a replacement decision");
    }
    assert.deepEqual(errors, [], "no runtime browser errors");
  } finally {
    await browser?.close();
    await server.close();
  }
});
