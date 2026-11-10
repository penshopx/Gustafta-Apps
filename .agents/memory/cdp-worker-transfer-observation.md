---
name: CDP worker transfer observation
description: Worker entry requests migrate sessions; paused service workers need early resume for network setup.
---

When measuring cold-browser JavaScript transfers, correlate unambiguous request IDs across parent/worker CDP sessions. Install network listeners before resuming a worker. For service workers, send Network.enable and resume startup before awaiting its acknowledgement.

**Why:** Chromium moves entry-worker response/finish events to the child session, making session-only bookkeeping falsely report a pending zero-byte entry. Its migrated finish event can contain only headers, not the internally stored body. A service worker paused at startup cannot acknowledge Network.enable until resumed, so awaiting enable first deadlocks instrumentation.

**How to apply:** Preserve session-qualified IDs normally and only cross-match a unique request ID. For worker-entry bodies delivered internally, reconcile actual encoded body reads from Chromium NetLog with CDP header bytes; require a unique completed match with identical decoded length. Delete raw NetLog after collection. Include compressed dedicated-worker imports and service-worker registration in offline browser fixtures; never silently count an unobserved entry as zero.

Do not assume a migrated worker's finish total contains headers only. HTTP/2 can report body and framing bytes there even when its body-data events report no encoded bytes.

**Why:** The same compressed HTTP/2 worker intermittently produced either header-only or body-inclusive finish totals; adding NetLog body bytes to that total double-counted a real download.

**How to apply:** Keep response-header evidence separate and reconcile the body against it, not against the finish total. Service-worker registration can omit the response event; confirm an HTTP/1 header-only finish against NetLog text, requiring equal lengths because values may be redacted. Displayed HTTP/2 text is not HPACK wire size. Missing header evidence must invalidate the match.
