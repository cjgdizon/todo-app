#!/usr/bin/env bash
# Dumps a database into <out>/schema.sql and <out>/data.sql with plain pg_dump, for the weekly backup
# workflow. The Supabase CLI's `db dump` starts with SET ROLE "postgres", which a read-only login is
# not allowed to do. Usage: scripts/backup-dump.sh <connection-url> <out-dir>
set -euo pipefail

url="$1"
out="$2"
# The same Postgres image the Supabase CLI uses, so pg_dump is never older than the server.
image="ghcr.io/supabase/postgres:17.11.0.004"

for attempt in 1 2 3; do
  docker pull -q "$image" >/dev/null && break
  [ "$attempt" = 3 ] && { echo "could not pull $image" >&2; exit 1; }
  sleep $((attempt * 10))
done

pgdump() { docker run --rm --entrypoint pg_dump "$image" "$url" --quote-all-identifiers --no-owner --no-privileges "$@"; }

mkdir -p "$out"
pgdump --schema-only --schema=public > "$out/schema.sql"

{
  # Rows are loaded before the rows they point at exist (tasks refer to other tasks), so a restore
  # turns the checks off, exactly as the Supabase CLI's dump does.
  echo "SET session_replication_role = replica;"
  # An allow-list: from auth only users and identities. Sessions, refresh tokens and one-time tokens
  # would be live logins in a file, and nothing needs them after a restore (people sign in again).
  pgdump --data-only --table='public.*' --table=auth.users --table=auth.identities
} > "$out/data.sql"

# A dump that is empty or missing the tables would pass silently; stop instead.
grep -q 'CREATE TABLE' "$out/schema.sql"
grep -q 'COPY "public"."tasks"' "$out/data.sql"
grep -q 'COPY "auth"."users"' "$out/data.sql"
if grep -q 'COPY "auth"."sessions"' "$out/data.sql"; then echo "sessions leaked into the dump" >&2; exit 1; fi
