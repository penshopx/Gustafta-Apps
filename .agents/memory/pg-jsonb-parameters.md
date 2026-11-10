---
name: JSONB parameters in node-postgres
description: How to bind mixed scalar and JSONB values safely in generic persisted-content reconcilers.
---

# JSONB parameters in node-postgres

When a generic reconciler updates columns of mixed types, bind strings/numbers as scalars but pass object and array JSONB values through `JSON.stringify`.

**Why:** `node-postgres` serializes a raw JavaScript array using PostgreSQL-array syntax. A JSONB column then rejects it as invalid JSON, rolling back an otherwise valid transaction. The failure is easy to miss when unit mocks do not model driver parameter conversion.

**How to apply:** Use the original database value to identify object/array-backed columns, serialize only those updated values, and keep the whole reconciliation transactional. Include a regression test that inspects the bound parameter rather than testing only the in-memory transform.