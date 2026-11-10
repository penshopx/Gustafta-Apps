---
name: Vite middleware WebSocket isolation
description: Independent browser fixtures must not share Vite's default WebSocket listener
---

When multiple Vite 7 middleware servers coexist, attach each HMR connection to
its own HTTP server rather than relying on `hmr: false`.

**Why:** Different HTTP ports do not isolate the default WebSocket port (24678).
In Vite 7, `hmr: false` suppresses updates but still creates the listener and
injects a connecting client. Functional browser assertions can pass while
uncaught “WebSocket closed without opened” errors fail the final check.

**How to apply:** Give Vite the fixture's HTTP server via `server.hmr.server`.
Confirm concurrent fixtures render without page errors. Keep test fixtures
loopback-only; console workflows should omit a port-readiness wait because
managed port detection expects a publicly bound interface.
