---
name: PostgreSQL race instrumentation
description: Keep real connection and query semantics when scheduling concurrent transactions in fixtures.
---
When pausing PostgreSQL transactions in test fixtures, preserve both callback and promise overloads of pool connection acquisition. Intercept only the transaction leases needed for the race.

**Why:** Drizzle transactions acquire promise-based leases, but ordinary node-postgres pool queries acquire callback-based leases. An async-only replacement can let the race execute correctly and then hang every normal context read.

**How to apply:** Forward callback acquisition unchanged. Schedule after a real SELECT executes, regardless of whether its SQL still contains FOR UPDATE, and prove blocking with PostgreSQL's blocking-PID observation rather than elapsed time.
