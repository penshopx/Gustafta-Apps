# Private document HTTP regression

Run `npm run test:kb-context-http`. It provisions a temporary local PostgreSQL
database, runs the HTTP and unit tests, and shuts down/removes the cluster. The
PostgreSQL executables (`initdb`, `pg_ctl`, `createdb`) must be installed. Missing
PostgreSQL fails the command; it does not silently skip the HTTP check.

Alternatively, set `TEST_DATABASE_URL` to a dedicated disposable database with
a name ending in `_integration_test`. For a fresh empty database, first run
`npm run setup:kb-context-test-db`. The standard test DB identity/marker guard
rejects the application database before importing any DB-backed module. Never
point this test at the running app: it boots its own full production route
registration, real PostgreSQL storage, and loopback-only AI recorder.

All application SQL, including startup seeds, runs inside one pinned transaction.
Drizzle transactions use savepoints on that same connection, never separate
commits. Concurrent independent transactions fail explicitly. Normal shutdown rolls back; a child-process
test proves that SIGKILL also discards its imported private KB, users, agent and
messages. No customer rows are mutated and no external AI call is permitted.

Coverage:
- Import through the real `apply-import` endpoint; reject anonymous/B writes and
  ignore supplied publication/owner overrides.
- A, B, and anonymous visitors; A requests first to detect cache reuse leaks.
- Non-stream chat, streaming chat, and DocGen generation, checking AI **input**
  and responses rather than assuming a denied/failed call means safe retrieval.
- Both raw KB fallback and persisted RAG chunks (without paid embeddings).
- Agent JSON and DocGen HTML export: authentication/authorization plus filtered
  content; B as an editor proves agent access does not grant private KB access.
- Email-session identities on all generation paths.

Session establishment and external AI are fixtures; session issuance/OTP, the
browser, external embedding providers and other export formats are not covered.
Each chat has a separate session: this suite tests imported KB privacy, not
cross-user ownership of shared/reused conversation IDs or history exports.
