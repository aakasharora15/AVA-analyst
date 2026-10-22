#!/usr/bin/env bash
# Starts a throwaway Postgres for the Python tests and prints its URL.
# Usage: eval "$(scripts/test-db.sh)"   then   .venv/bin/python -m pytest tests_py
set -euo pipefail
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}
DIR=${AVA_PG_DIR:-/tmp/ava-pg}
PORT=${AVA_PG_PORT:-54329}
RUN_AS=""
if [ "$(id -u)" = "0" ]; then RUN_AS="runuser -u postgres --"; fi
if [ ! -d "$DIR/data" ]; then
  mkdir -p "$DIR" && chown -R postgres "$DIR" 2>/dev/null || true
  $RUN_AS "$PGBIN/initdb" -D "$DIR/data" -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null
fi
if ! $RUN_AS "$PGBIN/pg_ctl" -D "$DIR/data" status >/dev/null 2>&1; then
  $RUN_AS "$PGBIN/pg_ctl" -D "$DIR/data" -l "$DIR/log" -o "-p $PORT -k $DIR -c listen_addresses=localhost" start >/dev/null
fi
echo "export AVA_TEST_DATABASE_URL=postgresql://postgres@localhost:$PORT/postgres"
