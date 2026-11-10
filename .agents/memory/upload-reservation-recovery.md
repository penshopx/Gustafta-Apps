---
name: Upload reservation recovery
description: Why abandoned upload recovery combines an age threshold with transaction-scoped writer protection.
---
Use an age threshold together with transaction-scoped row locking, not age alone, when reclaiming committed but empty upload reservations.

**Why:** An external storage request can remain active beyond any chosen age threshold. Row locking protects that writer across replicas and releases automatically when its database connection dies, without heartbeat drift or session-level advisory locks that conflict with transaction poolers.

**How to apply:** Keep the content writer's row lock until its content reference commits. Recovery must skip locked rows and count them toward quota. A writer resumed after its reservation was reclaimed must fail before contacting storage rather than continue without reserved capacity.
