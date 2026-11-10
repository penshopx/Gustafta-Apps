---
name: Browser shutdown evidence
description: Distinguishing normal Puppeteer disconnection from shutdown-time transport failure.
---

Do not treat every disconnected browser after `close()` as failed, or every resolved `close()` as successful. For a checker-owned browser, require evidence of a clean child-process exit when the connection has disappeared. Do not discover or signal an injected browser's process to obtain that evidence.

**Why:** Puppeteer normally disconnects as part of closing, and its launcher can swallow a transport-close error before resolving. A connection-only check rejects normal production shutdown; a promise-only check can publish incomplete results.

**How to apply:** Preserve ownership boundaries and distinguish a clean exit from a running child, signal termination, or nonzero exit when validating browser shutdown. Test both transport loss with a resolved close and a normal disconnected shutdown.

For Linux process-tree evidence, distinguish “no executing survivors” from “every PID reaped.” Container process reaping may leave a transient zombie after a renderer exits; report that separately rather than claiming every process entry disappeared.

**Why:** Real Chromium cleanup can stop the browser and all descendants while an exited descendant remains visible to `/proc`. Its parent/reaper controls removal, not the disconnected Puppeteer transport.

**How to apply:** State precisely which shutdown guarantee was verified, and do not treat an exited zombie as either an executing renderer or proof of full reaping.
