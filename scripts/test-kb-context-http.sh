#!/usr/bin/env bash
set -euo pipefail

# No application URL is ever used. With an explicit test DB, its existing
# isolation guard must pass; otherwise provision a fresh temporary local DB.
if [[ -n "${TEST_DATABASE_URL:-}" ]]; then
  exec npx --no-install tsx --test tests/kb-context-access-http.test.ts tests/kb-context-delegation-http.test.ts tests/kb-context-access.test.ts tests/kb-publication-history.test.ts
fi
for bin in initdb pg_ctl createdb; do
  command -v "$bin" >/dev/null || { echo "PostgreSQL lokal atau TEST_DATABASE_URL terisolasi wajib tersedia" >&2; exit 1; }
done
dir=$(mktemp -d /tmp/kb-context-http-pg.XXXXXX)
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
createdb -h 127.0.0.1 -p "$port" -U fixture kb_context_integration_test
export TEST_DATABASE_URL="postgresql://fixture@127.0.0.1:$port/kb_context_integration_test"
npx --no-install tsx scripts/setup-kb-context-test-database.ts
npx --no-install tsx --test tests/kb-context-access-http.test.ts tests/kb-context-delegation-http.test.ts tests/kb-context-access.test.ts tests/kb-publication-history.test.ts
