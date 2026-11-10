/**
 * Intentionally no signal handler/finally: the outer test kills this actual
 * tester process. Its independent fixture watchdogs must recover without it.
 */
import assert from "node:assert/strict";
import { createFixtureWatchdog, launchGuardedChromium } from "../helpers/guarded-chromium-fixture";
import { identity, tree } from "../helpers/chromium-fixture-processes";

const executablePath = process.env.CHROME_PATH;
assert.ok(executablePath);
const evidence = [];
for (let index = 0; index < 2; index++) {
  const watchdog = await createFixtureWatchdog();
  const browser = await launchGuardedChromium(watchdog, executablePath);
  const page = await browser.newPage();
  await page.goto("data:text/html,<title>cancelled-tester-fixture</title>");
  const root = await identity(browser.process()!.pid!);
  assert.ok(root);
  const captured = await tree(root);
  await watchdog.capture();
  evidence.push({
    directory: watchdog.directory, root, captured,
    watchdog: await identity(watchdog.child.pid!),
  });
}
assert.ok(process.connected);
process.send!(evidence);
setInterval(() => {}, 1_000);
