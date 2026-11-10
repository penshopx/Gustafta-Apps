---
name: HTTP fixture startup transactions
description: Rollback isolation must include nested startup transactions, not only route SQL.
---

Full production route registration can run unrelated seeds that open their own transactions. Pinning pool queries alone does not isolate these commits; transaction leases must also stay on the fixture connection and use savepoints.

**Why:** An HTTP fixture initially passed its private-document checks while a startup seed committed through a second connection. Guarding connection acquisition exposed the escape; checking the seed baseline after forced termination makes this detectable.

**How to apply:** For full-route PostgreSQL fixtures, isolate query and transaction connection paths together, await asynchronous startup seeds, and verify that both requested fixture data and unrelated startup writes return to their baseline after termination.
