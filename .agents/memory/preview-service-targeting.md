---
name: Preview service targeting
description: Avoid false API failures when multiple preview services are running
---

An app screenshot and a request to the workspace development domain can reach different running services. A successful screenshot does not prove the domain targets the same service.

**Why:** An API screenshot reached the main application and returned the expected JSON, while the development-domain request reached the mockup sandbox and returned a base-path 404. The API itself was working.

**How to apply:** Identify which service answered before diagnosing an endpoint failure. A response mentioning the mockup base path is evidence of a routing mismatch, not a missing main-app endpoint. For isolated verification, curl can keep the development-domain URL and use `--connect-to` to target the main application port. This does not verify or repair public proxy routing.

The screenshot tool can target port 5000 directly and bypass path-based artifact routing. A local screenshot of the sandbox path may therefore render the main app's 404 while the same path on the actual workspace domain correctly serves the sandbox.

**Why:** The screenshot's reported actual URL was local port 5000, but domain HTTP checks returned the sandbox HTML and its own JavaScript entry point.

**How to apply:** Check the screenshot's actual URL; verify artifact paths against the real development domain, not just the main app's local port.
