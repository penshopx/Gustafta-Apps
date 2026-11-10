#!/usr/bin/env bash
set -euo pipefail

# Always create a fresh LOCAL cluster. Never adopt an existing URL, cluster,
# pgpass file or PG* connection setting from the application environment.
for bin in initdb pg_ctl createdb node; do
  command -v "$bin" >/dev/null || { echo "PostgreSQL lokal dan Node wajib tersedia" >&2; exit 1; }
done
# Retain only database names for alias-safe rejection, never their credentials.
app_names=$(node -e '
  try {
    console.log(JSON.stringify(["DATABASE_URL", "DATABASE_URL_POOLED", "LMS_TEST_DATABASE_URL"]
      .map(key => process.env[key]).filter(Boolean).map(value => new URL(value).pathname)));
  } catch { console.error("Identitas URL aplikasi tidak valid"); process.exit(1); }
')
dir=$(mktemp -d /tmp/gustafta-commerce-pg.XXXXXX)
cleanup() {
  local status=$?
  trap - EXIT
  if [[ -f "$dir/data/postmaster.pid" ]] &&
    ! env -i PATH="$PATH" HOME="$dir" pg_ctl -D "$dir/data" -m immediate stop >/dev/null 2>&1; then
    echo "Gagal menghentikan PostgreSQL uji; direktori dipertahankan untuk cleanup: $dir" >&2
    exit 1
  fi
  rm -rf "$dir"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
port=$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
env -i PATH="$PATH" HOME="$dir" initdb -D "$dir/data" -A trust -U fixture --no-locale >/dev/null
env -i PATH="$PATH" HOME="$dir" pg_ctl -D "$dir/data" -l "$dir/server.log" \
  -o "-h 127.0.0.1 -p $port -k $dir" -w start >/dev/null
env -i PATH="$PATH" HOME="$dir" createdb -h 127.0.0.1 -p "$port" -U fixture commerce_integration_test

# No credentials are stored. This URL exists only in the child environment.
# Do not forward provider keys: tests mock their own Scalev/email/Meta calls.
run() {
  env -i PATH="$PATH" HOME="$HOME" NODE_ENV=development \
    DATABASE_URL="postgresql://blocked@127.0.0.1:1/blocked_application" \
    TEST_DATABASE_URL="postgresql://fixture@127.0.0.1:$port/commerce_integration_test" \
    TEST_DATABASE_APP_NAMES="$app_names" \
    TEST_LIFECYCLE_ALLOW_CREATEDB=1 \
    SESSION_SECRET="disposable-commerce-test-session-only" \
    SCALEV_WEBHOOK_SECRET="disposable-commerce-webhook-only" \
    BREVO_API_KEY="disposable-commerce-email-only" \
    node --import tsx --import ./tests/fixtures/commerce-network.ts "$@"
}
run scripts/setup-integration-test-database.ts setup
test_concurrency=1
if [[ "${1:-}" == "--parallel" ]]; then
  test_concurrency=4
  shift
fi
if [[ $# -eq 0 ]]; then
  set -- tests/commerce-network.test.ts tests/test-database-isolation.test.ts tests/test-database-lease.test.ts \
    tests/integration-database-lifecycle.test.ts \
    tests/scalev-*.test.ts \
    tests/order-api.test.ts tests/order-api-scalev.test.ts \
    tests/store-catalog-*.test.ts \
    tests/claw-seed-store-visibility.test.ts \
    tests/sbu-skk-ebook-delivery.test.ts
fi
# File workers may start concurrently, but the DB guard coordinates fixtures.
status=0
run --test --test-concurrency="$test_concurrency" "$@" || status=$?
run scripts/setup-integration-test-database.ts teardown --confirm-disposable || status=1
exit "$status"
