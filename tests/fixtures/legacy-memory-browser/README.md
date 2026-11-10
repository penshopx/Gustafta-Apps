# Isolated legacy-memory review browser fixture

This harness mounts the **real** `AdminLegacyMemories` page and query/toast components.
It extracts and executes the recovery handlers, validation schemas, superadmin
middleware and role comparison from `server/routes.ts`. Only session identity,
database-role lookup and persistence are replaced with in-memory fixtures.
The trusted archive contains immutable synthetic original bytes and is passed to
the real recovery engine. No customer database, application boot, secrets,
notifications, or external archive is used.

Run the regression suites:

```sh
npm run test:legacy-memory-api
npm run test:legacy-memory-browser
npm run check:legacy-memory-tests
npm run test:legacy-memory-concurrency
```

The concurrency command requires local PostgreSQL executables (`initdb`,
`pg_ctl`, `createdb`, `psql`). It always starts a fresh disposable cluster on a
temporary port, regardless of inherited database URLs, then stops and removes
it on exit. It never connects to the customer database or starts the app.
The test also requires the dedicated-database identity/marker guard before any
DDL. Running the TypeScript test directly without `TEST_DATABASE_URL` skips it;
use the command above for a required, non-skipped run.

This separate integration suite calls the real `createLegacyMemoryRecovery`
with synthetic immutable original-record bytes. Independent PostgreSQL
connections race approve/approve and approve/reject in both winner orders.
A third connection proves the loser is waiting on the winner's row lock using
`pg_stat_activity` and `pg_blocking_pids`, before the winner may commit.
Transactional trigger witnesses check exactly one terminal transition/audit
and either one ownership update (approval) or none (rejection). This does not
install, validate, or enable a production archive.

The browser suite requires `chromium` on PATH and uses separate browser contexts
for `admin-a`, `admin-b`, `admin-c` and `ordinary-user`. It starts and closes its own
loopback-only server and browser. The cheap API suite also covers ordinary admins
and unauthenticated callers. A missing Chromium executable is an explicit failure.

For manual browser inspection:

```sh
npx tsx tests/fixtures/legacy-memory-browser/server.ts
```

Open `http://127.0.0.1:8099`; use a same-origin POST to
`/__fixture/login/admin-a`, `admin-b`, `admin-c`, `ordinary-user`, or `ordinary-admin`, then
reload `/admin/legacy-memories`. The synthetic evidence, owners, reviews, archive
reads and request audit are available at `/__fixture/state`. These test-only
endpoints are never registered by the production server.

102 unowned rows and 102 historical decisions exercise independent cursor
pagination. The history “page” is the existing separately paginated section, not
a new production route. New review IDs start at 103. Memory 3 has a wrong digest
in the negative browser scenario; memory 4 uses the exact original record.

Changing production route boundaries or removing their access guards fails the
fixture loader loudly. This suite intentionally does not verify real login
providers, role persistence, PostgreSQL locking/concurrency, or availability of a
production trusted archive. Production currently has no archive adapter; the
existing API tests confirm approval fails closed in that configuration.

The competing-reviewer regression keeps the real page open in independent
superadmin contexts. It checks automatic refresh after rejection and a 409 when
approval wins over an in-flight rejection: the stale form disappears, a conflict
notice explains why, and current history and reviewer details appear without
reloading. The approval/rejection results are checked against synthetic state.
