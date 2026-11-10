---
name: Upload object ownership
description: Why upload cleanup must confirm durable references rather than infer an orphan from an exception.
---
Treat a failed metadata write or missing commit acknowledgement as an uncertain outcome, not proof that the uploaded object is unused. Confirm authoritative references while excluding an active writer before deleting an object.

**Why:** A database commit can succeed even when its response is lost; deleting metadata or bytes solely because the caller observed an error can destroy a valid document. Conversely, an object provider can create bytes and then return an error, so cleanup intent must exist before the external operation.

**How to apply:** Keep upload cleanup intent durable independently of the content transaction. Resolve it against the database after the writer releases its lock, preserve any valid object reference or DB fallback, and retain the intent when cleanup or reference checks fail.
