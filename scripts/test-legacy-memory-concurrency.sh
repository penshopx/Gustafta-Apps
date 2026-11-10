#!/usr/bin/env bash
set -euo pipefail

# Always create our own cluster, even if an application/test URL is inherited.
# No application connection, server bootstrap, or customer schema is involved.
for bin in initdb pg_ctl createdb psql; do
  command -v "$bin" >/dev/null || { echo "PostgreSQL lokal wajib tersedia untuk tes konkurensi memori lama" >&2; exit 1; }
done
dir=$(mktemp -d /tmp/legacy-memory-pg.XXXXXX)
cleanup() {
  pg_ctl -D "$dir" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$dir"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
port=$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
initdb -D "$dir" -A trust -U fixture >/dev/null
pg_ctl -D "$dir" -l "$dir/server.log" -o "-h 127.0.0.1 -p $port -k $dir" -w start >/dev/null
createdb -h 127.0.0.1 -p "$port" -U fixture legacy_memory_integration_test
export TEST_DATABASE_URL="postgresql://fixture@127.0.0.1:$port/legacy_memory_integration_test"
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q -c \
  "CREATE TABLE public.integration_test_isolation_guard (marker text PRIMARY KEY);
   INSERT INTO public.integration_test_isolation_guard VALUES ('dedicated-disposable-integration-database');"
npx --no-install tsx --test tests/legacy-memory-concurrency.test.ts
