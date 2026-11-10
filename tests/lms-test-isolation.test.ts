import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));

test("all real-DB LMS suites validate isolation before importing app DB or writing fixtures", () => {
  const files = readdirSync(directory).filter((name) =>
    /^lms-.*\.test\.ts$/.test(name) && name !== "lms-test-isolation.test.ts");
  const dbSuites = files.filter((name) => {
    const source = readFileSync(join(directory, name), "utf8");
    return /const hasDb =|new Pool\(\{ connectionString: process\.env\.DATABASE_URL/.test(source);
  });
  assert.ok(dbSuites.length >= 20, "expected all LMS integration suites to be covered");
  for (const name of dbSuites) {
    const source = readFileSync(join(directory, name), "utf8");
    if (name === "lms-reenroll-certificate.test.ts") {
      assert.match(source, /await beginReenrollFixtures\(process\.env\.LMS_TEST_DATABASE_URL!/);
      continue;
    }
    assert.match(source, /installLmsTestDatabase\(\)/, `${name} must validate before its own before hook`);
    assert.doesNotMatch(source, /!!process\.env\.DATABASE_URL/, `${name} must not opt in from the app DB`);
    assert.match(source, /lmsDbSkip/, `${name} must skip without the dedicated DB`);
  }
});