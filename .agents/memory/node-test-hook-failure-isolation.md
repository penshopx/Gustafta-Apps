---
name: Node test hook failure isolation
description: Failed isolation setup does not necessarily stop later setup and cleanup hooks in node:test.
---
Rule: Validate database isolation at awaited module evaluation before registering fixtures and importing DB-backed modules where possible. Database integration tests must also gate their own before and after hooks on validated readiness, not on the presence of a test URL.

**Why:** A rejected isolation before hook still allowed another before hook to start a server and an after hook to run cleanup. If they used the original application URL, rejection itself could touch customer data or leave open handles.

**How to apply:** Block the application's connection URL before validation, then set readiness only after the dedicated database is verified. Check readiness in every other setup and teardown hook. Test the same-name-URL rejection case and confirm the process exits.

Changing the test process's database URL does not isolate an HTTP request sent to an already-running application.

**Why:** A remote server retains its own database connection; a fixture client can use a dedicated database while the handler still mutates customer data.

**How to apply:** Start the handler/server under the validated test environment, or use an in-memory adapter. Never infer HTTP isolation from the client's environment alone.