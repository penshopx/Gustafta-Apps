---
name: Nested Node test runners
description: Prevent successful empty runs when a node:test worker launches another test CLI.
---

When launching a fresh `node --test` runner from a test worker, remove inherited `NODE_TEST_CONTEXT` from that child's environment. Preserve other test isolation and fixture-group variables.

**Why:** Node treats an inherited worker context as recursive execution, warns that running files is skipped, and exits zero without executing the requested tests. A concurrency test that only checks child exit codes can therefore pass without exercising concurrency at all.

**How to apply:** For nested test CLIs, verify that expected test cases actually appear in child results as well as checking the exit status. Do not clear context indiscriminately for ordinary IPC fixture workers, which are not fresh test runners. Prefer directly owned Node children over package-manager wrappers so timeouts terminate the actual worker and minimal test environments remain usable.
