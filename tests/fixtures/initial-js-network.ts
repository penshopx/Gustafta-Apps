import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import puppeteer, { type CDPSession } from "puppeteer-core";
import { workerWireTransfers } from "../../scripts/lib/worker-wire-transfer";

/** One ephemeral certificate, trusted only by this browser via its public key. */
export async function networkBrowserFixture() {
  const directory = await mkdtemp(join(tmpdir(), "transfer-network-test-"));
  try {
    const keyPath = join(directory, "key.pem");
    const certPath = join(directory, "cert.pem");
    execFileSync("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
      "-subj", "/CN=localhost", "-keyout", keyPath, "-out", certPath,
      "-addext", "subjectAltName=IP:127.0.0.1",
    ], { stdio: "ignore" });
    const key = await readFile(keyPath);
    const cert = await readFile(certPath);
    const publicKey = new X509Certificate(cert).publicKey.export({ type: "spki", format: "der" });
    const pin = createHash("sha256").update(publicKey).digest("base64");
    const chrome = process.env.CHROME_PATH ??
      execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
    const executablePath = join(directory, "chromium");
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    await writeFile(executablePath, `#!/bin/sh\nexec ${quote(chrome)} --site-per-process --ignore-certificate-errors-spki-list=${quote(pin)} "$@"\n`);
    await chmod(executablePath, 0o700);
    return {
      key, cert, executablePath, directory,
      close: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

/** Independent protocol/NetLog witness; no production bookkeeping is reused. */
export async function networkEvidence(url: string, executablePath: string) {
  const directory = await mkdtemp(join(tmpdir(), "transfer-evidence-test-"));
  const netlog = join(directory, "netlog.json");
  const targets: { type: string; parentType: string }[] = [];
  const responses: { url: string; protocol: string | undefined; headers: number }[] = [];
  const setups = new Set<Promise<void>>();
  const errors: unknown[] = [];
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  try {
    browser = await puppeteer.launch({
      executablePath, headless: true, protocolTimeout: 5000,
      args: ["--no-sandbox", "--disable-dev-shm-usage", `--log-net-log=${netlog}`],
    });
    const page = await browser.newPage();
    const observe = async (session: CDPSession, type: string) => {
      session.on("Network.responseReceived", ({ response }) => {
        responses.push({ url: response.url, protocol: response.protocol, headers: response.encodedDataLength });
      });
      session.on("Target.attachedToTarget", (event) => {
        targets.push({ type: event.targetInfo.type, parentType: type });
        const child = session.connection()?.session(event.sessionId);
        assert.ok(child);
        const setup = observe(child, event.targetInfo.type)
          .finally(() => child.send("Runtime.runIfWaitingForDebugger"))
          .catch((error) => { errors.push(error); });
        setups.add(setup);
        void setup.finally(() => setups.delete(setup));
      });
      await session.send("Network.enable");
      await session.send("Network.setCacheDisabled", { cacheDisabled: true });
      await session.send("Target.setAutoAttach", {
        autoAttach: true, waitForDebuggerOnStart: true, flatten: true,
      });
    };
    await observe(await page.createCDPSession(), "page");
    await page.goto(url, { waitUntil: "load", timeout: 10000 });
    await delay(800);
    await Promise.all([...setups]);
    assert.deepEqual(errors, []);
    await browser.close();
    browser = undefined;
    return { targets, responses, wire: workerWireTransfers(await readFile(netlog, "utf8")) };
  } finally {
    try {
      await browser?.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
