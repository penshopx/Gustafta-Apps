---
name: Fixture watchdog ownership
description: Ownership and cleanup boundaries for tests that deliberately kill their tester.
---

An independent fixture watchdog must allocate its own fresh temporary profile before the tester launches a browser. A complete profile argument can establish fixture ownership across the launch-to-PID-registration gap; executable names and unrelated user profiles cannot.

**Why:** Killing a tester bypasses finally, and killing it during launch can also bypass registration of the browser handle.

**How to apply:** Use a separate watchdog with tester-disconnect recovery, a finite lifetime, a cleanup deadline, and PID plus start-time validation before every signal. Restrict profile removal to the watchdog's own freshly allocated directory.

Freeze the proven process tree and refresh its descendant census before emergency termination and profile removal.

**Why:** A running fixture can create descendants or recreate profile directories while cleanup is in progress; stopping the captured root alone is not enough.

**How to apply:** Reach a bounded, stable census of stopped owned processes, then terminate those identities and confirm no executing survivors before deleting their temporary directory. Retain the directory and fail explicitly when ownership or cleanup cannot be established.
