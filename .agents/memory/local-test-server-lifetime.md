---
name: Local test server lifetime
description: Keep temporary PostgreSQL alive through verification and isolate non-database provider effects too.
---
Temporary database daemons started through a foreground shell command must not be assumed to survive into the next command. Start PostgreSQL, run its checks, and stop it in one invocation with an EXIT trap, or use an explicitly managed background task.

**Why:** A locally initialized PostgreSQL instance completed its first test run but was unreachable in the next shell invocation; daemonizing with pg_ctl did not preserve the process across command cleanup.

**How to apply:** For disposable integration databases in this workspace, keep server startup and verification together. Set the Unix socket directory to the temporary cluster directory; the default /run/postgresql may not exist.

Database isolation does not isolate email, payment, or analytics side effects. Run disposable integration suites with a minimal child environment, dummy webhook credentials, and explicit provider doubles that reject unexpected external requests.

**Why:** Positive checkout and delivery tests can inherit hidden dependencies on live webhook/email settings. Merely replacing the database URL can either make valid flows fail or leave real provider calls enabled.

**How to apply:** Keep the real PostgreSQL and loopback HTTP paths, but remove application provider credentials from the test process. Missing provider fixtures should fail explicitly rather than use live services.

An HTTP response ending does not mean its database work has finished. Keep rollback isolation in place until deferred post-response work and its chained SQL have drained.

**Why:** Delegated chat schedules persistence after SSE completion; waiting only for the current query tail can restore the pool before the next continuation runs.

**How to apply:** Before releasing an HTTP fixture's pinned connection, let scheduled callbacks run and drain the query queue through an idle event-loop turn. Do not treat server socket closure as a database-work completion signal.
