#!/usr/bin/env bash
# Backs up the production database to the backups bucket. The dazbee-backup timer runs it each night
# as the deploy user (deploy/dazbee-backup.service, which deploy/setup.sh installs).
#
#   deploy/backup.sh [--dir <folder>]
#
#   --dir <folder>   the folder compose runs in, which holds deploy/, the .env and live/; /opt/dazbee
#                    unless given
#
# One REPEATABLE READ transaction exports its snapshot and reads each table's row count
# (deploy/table-counts.sql); pg_dump dumps in custom format from that same snapshot while it stays
# open, so the dump and the counts agree. Both go to the bucket as dazbee-<UTC time>.dump and a
# .counts beside it, the .counts last, so a backup whose .counts is there is whole. The bucket's
# lifecycle rule deletes copies older than 14 days. deploy/restore.sh restores one and checks it
# against its .counts.
#
# Postgres's client tools and rclone run in compose's backup-db and backup-store containers, which
# take their settings from the .env (deploy/env.example). The dump waits in backups/ inside the folder
# only until it is uploaded. The dump waits for a deploy in flight and holds off the next, so a
# migration never waits on the dump's locks.
set -euo pipefail
shopt -s inherit_errexit

readonly SETTINGS=(R2_BACKUP_ENDPOINT R2_BACKUP_BUCKET R2_BACKUP_ACCESS_KEY_ID R2_BACKUP_SECRET_ACCESS_KEY)
# How long the dump waits for a deploy in flight to finish.
readonly DEPLOY_WAIT_SECONDS=900

dir=/opt/dazbee

usage() {
  echo 'usage: backup.sh [--dir <folder>]' >&2
  exit 2
}

log() { printf '%s  %s\n' "$(date -u +%H:%M:%S)" "$*"; }

compose() { docker compose --progress quiet -f deploy/compose.yml --project-directory . --env-file .env "$@"; }

# Runs a command in a one-off `service` container, with this run's folder as /backup.
run() {
  local service=$1
  shift
  compose run --rm --no-deps -T --quiet-pull -v "$work:/backup" "$service" "$@"
}

# Writes /backup/counts and /backup/dump from one snapshot. psql runs pg_dump while its transaction,
# which exported the snapshot, stays open, and fails when pg_dump does.
dump() {
  {
    cat << 'EOF'
BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY;
SELECT pg_export_snapshot() AS snapshot \gset
\o /backup/counts
EOF
    cat deploy/table-counts.sql
    cat << 'EOF'
\o
\setenv SNAPSHOT :snapshot
\! pg_dump --format=custom --snapshot="$SNAPSHOT" --file=/backup/dump
\if :SHELL_ERROR
  DO $$ BEGIN RAISE EXCEPTION 'pg_dump failed'; END $$;
\endif
COMMIT;
EOF
  } | run backup-db psql -X -q -t -A -v ON_ERROR_STOP=1
}

while [ $# -gt 0 ]; do
  case $1 in
    --dir)
      [ $# -ge 2 ] || usage
      dir=$2
      shift 2
      ;;
    *) usage ;;
  esac
done

cd "$dir"
for setting in "${SETTINGS[@]}"; do
  grep -q "^$setting=." .env || {
    echo "set $setting in .env (deploy/env.example says what it is)" >&2
    exit 1
  }
done

mkdir -p live
exec 8> live/backup.lock
flock -n 8 || {
  echo 'another backup is running' >&2
  exit 1
}
install -d -m 700 backups
# Folders a backup that was killed left behind.
rm -rf backups/run.*
work=$(mktemp -d "$PWD/backups/run.XXXXXXXX")
trap 'rm -rf "$work"' EXIT

name=dazbee-$(date -u +%Y%m%dT%H%M%SZ)
log "backup: dumping the database as $name"
(
  flock -w "$DEPLOY_WAIT_SECONDS" 9 || {
    echo "a deploy still runs after ${DEPLOY_WAIT_SECONDS}s" >&2
    exit 1
  }
  dump
) 9> live/deploy.lock

[ -s "$work/counts" ] || {
  echo 'the database has no tables' >&2
  exit 1
}
# The dump's table of contents reads back.
run backup-db pg_restore --list /backup/dump > /dev/null
mv "$work/dump" "$work/$name.dump"
mv "$work/counts" "$work/$name.counts"

log "backup: uploading $name.dump, $(stat -c %s "$work/$name.dump") bytes"
run backup-store copyto "/backup/$name.dump" "backups:$name.dump"
run backup-store copyto "/backup/$name.counts" "backups:$name.counts"
log "backup: $name is in the bucket: $(awk '{ tables++; rows += $NF } END { print tables " tables, " rows " rows" }' "$work/$name.counts")"
