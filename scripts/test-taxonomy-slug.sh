#!/usr/bin/env bash
set -euo pipefail

# Disposable local DB only: do not inherit application/provider credentials.
for bin in initdb pg_ctl createdb psql node; do
  command -v "$bin" >/dev/null || { echo "PostgreSQL lokal dan Node wajib tersedia" >&2; exit 1; }
done
dir=$(mktemp -d /tmp/gustafta-taxonomy-slug.XXXXXX)
cleanup() {
  local status=$?
  trap - EXIT
  if [[ -f "$dir/data/postmaster.pid" ]] &&
    ! env -i PATH="$PATH" HOME="$dir" pg_ctl -D "$dir/data" -m immediate stop >/dev/null 2>&1; then
    echo "Gagal menghentikan PostgreSQL uji: $dir" >&2
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
env -i PATH="$PATH" HOME="$dir" createdb -h 127.0.0.1 -p "$port" -U fixture taxonomy_integration_test
env -i PATH="$PATH" HOME="$dir" psql -h 127.0.0.1 -p "$port" -U fixture -d taxonomy_integration_test \
  -v ON_ERROR_STOP=1 -qc "CREATE TABLE integration_test_isolation_guard (marker TEXT PRIMARY KEY);
    INSERT INTO integration_test_isolation_guard VALUES ('dedicated-disposable-integration-database');"
env -i PATH="$PATH" HOME="$HOME" NODE_ENV=test \
  DATABASE_URL="postgresql://blocked@127.0.0.1:1/blocked_application" \
  TEST_DATABASE_URL="postgresql://fixture@127.0.0.1:$port/taxonomy_integration_test" \
  node --import tsx --test tests/taxonomy-slug-db.test.ts tests/taxonomy-slug-http.test.ts tests/taxonomy-manager.test.ts
