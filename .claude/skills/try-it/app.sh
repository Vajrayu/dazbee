#!/usr/bin/env bash
# The copy of the app that try-it uses for one ticket: a detached worktree of one commit beside the
# main checkout, its own database in the Docker Postgres, its own bucket in the Docker storage, and
# its API, sync server and web app on ports apart from the ones in daily use, so the app the owner runs
# is left alone. Each ticket's copy has its own of all of these, so copies for different tickets run
# side by side.
#
#   app.sh start <ticket> [commit]          start the ticket's copy of the commit (HEAD by default); prints its address
#   app.sh fonts <ticket> <family>...       import Google font families into the ticket's copy
#   app.sh stop <ticket>                    stop the ticket's copy and remove its worktree, database and bucket
#
# The ports are 8800 + n (API), 1300 + n (sync server) and 3100 + n (web app), where n is the ticket
# number modulo 100; they miss the ports in daily use (8787, 1234, 3000). Logs and screenshots go to
# .try-it/<ticket>/ in the main checkout, which git ignores, and stay there.
set -euo pipefail

main=$(git worktree list --porcelain | sed -n '1s/^worktree //p')
storage=http://127.0.0.1:59000
storage_key=dazbee
storage_secret=dazbee-local-secret
storage_region=us-east-1

# Sets the ticket's worktree, database, bucket, ports and the API's settings from its number ($1).
copy_of() {
  ticket=${1:-}
  if ! [[ $ticket =~ ^[1-9][0-9]*$ ]]; then
    echo "The ticket must be a number, such as app.sh $action 801." >&2
    exit 1
  fi
  tree="$(dirname "$main")/dazbee-try-it-$ticket"
  database="dazbee_try_it_$ticket"
  bucket="dazbee-try-it-$ticket"
  api_port=$((8800 + ticket % 100))
  sync_port=$((1300 + ticket % 100))
  web_port=$((3100 + ticket % 100))
  # The API's settings, as docker-compose.yml gives them, pointed at the copy's database and bucket.
  api_env=(
    DATABASE_URL="postgres://dazbee:dazbee-local@127.0.0.1:55432/$database"
    API_PORT="$api_port"
    SYNC_TOKEN_SECRET=local-only-sync-token-secret-0000
    DAZBEE_DEV_SESSION=on
    SESSION_SECRET=local-only-session-secret-0000000
    WEB_URL="http://localhost:$web_port"
    STORAGE_ENDPOINT="$storage"
    STORAGE_BUCKET="$bucket"
    STORAGE_ACCESS_KEY_ID="$storage_key"
    STORAGE_SECRET_ACCESS_KEY="$storage_secret"
    STORAGE_REGION="$storage_region"
    STORAGE_PUBLIC_ENDPOINT="$storage"
    STORAGE_CREATE_BUCKET=on
  )
}

# Waits for a server to answer at $1, or names its log ($2) and exits.
wait_for() {
  curl -sf -o /dev/null --retry 90 --retry-connrefused --retry-delay 2 --max-time 300 "$1" ||
    { echo "Nothing answered at $1; read $2." >&2; exit 1; }
}

# A signed request to the Docker storage, its path ($1) and curl's other arguments after it.
storage_call() {
  local path=$1
  shift
  curl -sf --aws-sigv4 "aws:amz:$storage_region:s3" --user "$storage_key:$storage_secret" "$@" "$storage/$path"
}

# An object key as a URL path: each segment percent-encoded, the slashes kept.
key_path() {
  local key=$1 out='' char i
  for ((i = 0; i < ${#key}; i++)); do
    char=${key:i:1}
    case $char in
      [A-Za-z0-9._~/-]) out+=$char ;;
      *) out+=$(printf '%%%02X' "'$char") ;;
    esac
  done
  printf '%s' "$out"
}

# Deletes every object in the copy's bucket, then the bucket; a bucket that isn't there is left be.
remove_bucket() {
  storage_call "$bucket" -I -o /dev/null || return 0
  local keys key
  while keys=$(storage_call "$bucket?list-type=2" | grep -o '<Key>[^<]*</Key>' | sed -e 's/<[^>]*>//g' \
    -e 's/&lt;/</g' -e 's/&gt;/>/g' -e 's/&quot;/"/g' -e "s/&apos;/'/g" -e 's/&amp;/\&/g') && [ -n "$keys" ]; do
    while IFS= read -r key; do
      storage_call "$bucket/$(key_path "$key")" -X DELETE -o /dev/null
    done <<< "$keys"
  done
  storage_call "$bucket" -X DELETE -o /dev/null
}

start() {
  copy_of "${1:-}"
  local commit
  commit=$(git rev-parse --verify "${2:-HEAD}^{commit}")
  local out="$main/.try-it/$ticket"

  for port in $api_port $sync_port $web_port; do
    if curl -s -o /dev/null --max-time 2 "http://localhost:$port"; then
      echo "Port $port is in use, by this ticket's copy, by one for a ticket 100 apart, or by something else; run app.sh stop <that ticket> first." >&2
      exit 1
    fi
  done
  if [ -e "$tree" ]; then
    echo "$tree is left from an earlier copy; run app.sh stop $ticket first." >&2
    exit 1
  fi

  mkdir -p "$out"
  git -C "$main" worktree add -q --detach "$tree" "$commit"
  (cd "$tree" && GH_TOKEN=$(gh auth token) pnpm install --frozen-lockfile > "$out/install.log" 2>&1) ||
    { echo "pnpm install failed; read $out/install.log." >&2; exit 1; }

  (cd "$main" && docker compose up -d --wait postgres storage > /dev/null 2>&1)
  (cd "$main" && docker compose exec -T postgres dropdb -U dazbee --if-exists "$database" 2> /dev/null)
  (cd "$main" && docker compose exec -T postgres createdb -U dazbee "$database")

  (cd "$tree/apps/api" && env "${api_env[@]}" node src/main.ts > "$out/api.log" 2>&1 &)
  wait_for "http://localhost:$api_port/health" "$out/api.log"
  (cd "$tree/apps/sync" && env DATABASE_URL="postgres://dazbee:dazbee-local@127.0.0.1:55432/$database" \
    SYNC_PORT="$sync_port" SYNC_TOKEN_SECRET=local-only-sync-token-secret-0000 \
    node --max-old-space-size=768 src/main.ts > "$out/sync.log" 2>&1 &)
  wait_for "http://localhost:$sync_port" "$out/sync.log"
  (cd "$tree" && env API_URL="http://localhost:$api_port" NEXT_PUBLIC_SYNC_URL="ws://localhost:$sync_port" \
    pnpm --filter @dazbee/web dev --port "$web_port" > "$out/web.log" 2>&1 &)
  wait_for "http://localhost:$web_port" "$out/web.log"

  echo "The copy of ${commit:0:12} for ticket $ticket is up at http://localhost:$web_port; screenshots go to $out."
}

fonts() {
  copy_of "${1:-}"
  shift
  [ $# -gt 0 ] || { echo "usage: app.sh fonts <ticket> <family>..." >&2; exit 1; }
  (cd "$tree/apps/api" && env "${api_env[@]}" node src/scripts/import-google-fonts.ts "$@")
}

stop() {
  copy_of "${1:-}"
  for port in $web_port $sync_port $api_port; do
    if command -v taskkill > /dev/null; then
      local pid
      pid=$(netstat -ano | awk -v p=":$port" '$2 ~ p"$" && $4 == "LISTENING" { print $5; exit }')
      [ -z "$pid" ] || taskkill //F //T //PID "$pid" > /dev/null
    else
      lsof -ti "tcp:$port" | xargs -r kill || true
    fi
  done
  # A stopped server can hold its files for a moment, so the worktree's removal is tried a few times.
  for _ in 1 2 3 4 5; do
    git -C "$main" worktree remove --force "$tree" 2> /dev/null || rm -rf "$tree" 2> /dev/null || true
    [ -e "$tree" ] || break
    sleep 2
  done
  git -C "$main" worktree prune
  (cd "$main" && docker compose exec -T postgres dropdb -U dazbee --if-exists "$database" 2> /dev/null) || true
  remove_bucket || echo "Could not remove the bucket $bucket from the local storage." >&2
  if [ -e "$tree" ]; then echo "Could not remove $tree; delete it by hand." >&2; exit 1; fi
  echo "The try-it copy for ticket $ticket is stopped."
}

action=${1:-}
case "$action" in
  start | fonts | stop)
    shift
    "$action" "$@"
    ;;
  *)
    echo "usage: app.sh start <ticket> [commit] | fonts <ticket> <family>... | stop <ticket>" >&2
    exit 1
    ;;
esac
