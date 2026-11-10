#!/usr/bin/env bash
set -euo pipefail

# Always provision a fresh local cluster. Never accept an inherited DB target.
for bin in initdb pg_ctl createdb; do
  command -v "$bin" >/dev/null || { echo "PostgreSQL lokal wajib tersedia" >&2; exit 1; }
done
dir=$(mktemp -d /tmp/kb-publication-pg.XXXXXX)
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
createdb -h 127.0.0.1 -p "$port" -U fixture kb_publication_integration_test

# No provider credentials or application database URLs reach setup/tests/workers.
env -i PATH="$PATH" HOME="$HOME" \
  TEST_DATABASE_URL="postgresql://fixture@127.0.0.1:$port/kb_publication_integration_test" \
  bash -c '
    set -euo pipefail
    node --import tsx scripts/setup-kb-context-test-database.ts
    node --import tsx --test tests/kb-publication-concurrency.test.ts tests/kb-publication.test.ts tests/kb-publication-history.test.ts
  '
