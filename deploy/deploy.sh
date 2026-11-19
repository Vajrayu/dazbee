#!/usr/bin/env bash
# Puts one commit live: the API first (its migrations run when it starts), then the sync server, then
# the web app. Run it from anywhere on the server; it works in the folder that holds deploy/, the
# .env, live/ and certs/.
#
#   deploy/deploy.sh [--dir <folder>] [--local] <commit>
#
#   --dir <folder>  the folder compose runs in; /opt/dazbee unless given
#   --local         uses the commit's images already on this machine instead of pulling them
#
# The web app and API swap blue-green. Caddy sends each request to the first colour that runs and
# answers its health check, blue before green (deploy/Caddyfile), so a swap needs no reload: the
# colour that isn't live starts on the commit's image, both run while Caddy's health check finds the
# new one and requests on the old one end, then the old one stops. The sync server is stopped with
# SIGTERM, which folds every open design and closes each tab to reconnect, then the new one starts;
# if it isn't healthy in time, the previous image starts again. A failed health check stops the new
# container, leaves the previous version of that app serving and exits non-zero; apps swapped before
# it stay on the commit. Caddy is reloaded only when deploy/Caddyfile changed since the last deploy.
#
# What it changes lives in live/, which copying deploy/ over never touches:
#   live/web, live/api   the live colour of each, blue or green
#   live/images.env      each container's image tag, which compose reads after the .env
#   live/deployed        each app's deployed commit
#   live/history         the commits deployed, oldest first
#   live/Caddyfile       the Caddyfile Caddy last loaded
# It keeps each app's images of the last three commits deployed, and any a container uses, and
# removes the rest.
set -euo pipefail
shopt -s inherit_errexit

readonly REGISTRY=ghcr.io/dazbee-ai
readonly APPS=(api sync web)
# How long a new container has to pass its health check.
readonly HEALTH_SECONDS=60
# How long both colours run before the old one stops: Caddy's health check, every second, finds the
# new one, and requests on the old one end.
readonly DRAIN_SECONDS=5
readonly KEEP_IMAGES=3

dir=/opt/dazbee
pull=true
commit=

usage() {
  echo 'usage: deploy.sh [--dir <folder>] [--local] <commit>' >&2
  exit 2
}

log() { printf '%s  %s\n' "$(date -u +%H:%M:%S)" "$*"; }

# Compose over the production file, with the image tags this script keeps after the .env's settings.
# The green profile lets every command name a green colour; each one here names its services.
compose() {
  local env_files=(--env-file .env)
  [ -f live/images.env ] && env_files+=(--env-file live/images.env)
  docker compose -f deploy/compose.yml --project-directory . "${env_files[@]}" --profile green "$@"
}

# Writes `file` from stdin through a temporary file beside it, so a reader never sees half of it.
write_file() {
  local file=$1
  cat > "$file.new"
  mv -f "$file.new" "$file"
}

# The setting that names a service's image tag: web-blue -> WEB_BLUE_TAG.
tag_setting() { printf '%s_TAG' "$(tr 'a-z-' 'A-Z_' <<< "$1")"; }

# The tag of the image a service's container was made from; nothing when it has no container.
running_tag() {
  local id
  id=$(compose ps -aq "$1")
  [ -n "$id" ] || return 0
  docker inspect -f '{{.Config.Image}}' "$id" | sed 's/.*://'
}

# The tag live/images.env holds for a service's setting; nothing when it holds none.
kept_tag() {
  [ -f live/images.env ] || return 0
  sed -n "s/^$1=//p" live/images.env
}

# Sets one tag in live/images.env, keeping the others.
keep_tag() {
  local setting=$1 tag=$2
  { grep -v "^$setting=" live/images.env || true; echo "$setting=$tag"; } | sort | write_file live/images.env
}

# Starts live/images.env from the containers there are, so compose keeps making each one as it is.
start_images_env() {
  [ -f live/images.env ] && return 0
  local service
  for service in web-blue web-green api-blue api-green sync; do
    echo "$(tag_setting "$service")=$(running_tag "$service")"
  done | sort | write_file live/images.env
}

# The live colour of `web` or `api`; blue until a deploy records one.
live_colour() {
  local colour=blue
  [ -f "live/$1" ] && colour=$(< "live/$1")
  case $colour in
    blue | green) echo "$colour" ;;
    *)
      echo "live/$1 names no colour: $colour" >&2
      return 1
      ;;
  esac
}

other_colour() { [ "$1" = blue ] && echo green || echo blue; }

# Reloads Caddy when deploy/Caddyfile differs from the one it last loaded.
apply_caddyfile() {
  cmp -s deploy/Caddyfile live/Caddyfile && return 0
  log 'caddy: loading the new Caddyfile'
  compose exec -T caddy caddy reload --config /etc/caddy/deploy/Caddyfile --adapter caddyfile
  write_file live/Caddyfile < deploy/Caddyfile
}

# Records `app`'s deployed commit in live/deployed, one `<app> <commit>` line per app.
record_deployed() {
  local app=$1
  { [ -f live/deployed ] && grep -v "^$app " live/deployed || true; echo "$app $commit"; } | sort | write_file live/deployed
}

# Starts `service` on the commit's image and waits for its health check; fails when it isn't healthy in time.
start_healthy() {
  local service=$1 tag=$2
  (
    export "$(tag_setting "$service")=$tag"
    compose up -d --no-deps --wait --wait-timeout "$HEALTH_SECONDS" "$service"
  )
}

# Swaps `web` or `api` to the commit, blue-green.
swap() {
  local app=$1 live next
  live=$(live_colour "$app")
  next=$(other_colour "$live")
  log "$app: starting $next on $commit, while $live serves"
  if ! start_healthy "$app-$next" "$commit"; then
    log "$app: $next failed its health check; stopping it, and $live keeps serving"
    compose logs --no-color --tail 50 "$app-$next" || true
    compose stop "$app-$next" || true
    return 1
  fi
  keep_tag "$(tag_setting "$app-$next")" "$commit"
  echo "$next" | write_file "live/$app"
  log "$app: $next is healthy; stopping $live in ${DRAIN_SECONDS}s"
  sleep "$DRAIN_SECONDS"
  compose stop "$app-$live"
  record_deployed "$app"
}

# Restarts the sync server on the commit. Compose stops the old container with SIGTERM, which folds
# every open design and closes each tab with 1001 to reconnect, and waits for it to exit, up to the
# service's stop_grace_period; then it starts the new one. On the image it already runs, nothing restarts.
swap_sync() {
  local previous
  previous=$(running_tag sync)
  if [ "$previous" = "$commit" ]; then
    log "sync: already on $commit"
  else
    log "sync: restarting on $commit; open designs reconnect"
  fi
  if start_healthy sync "$commit"; then
    keep_tag SYNC_TAG "$commit"
    record_deployed sync
    return 0
  fi
  log 'sync: the new one failed its health check'
  compose logs --no-color --tail 50 sync || true
  if [ -n "$previous" ] && [ "$previous" != "$commit" ]; then
    log "sync: starting the previous image, $previous, again"
    start_healthy sync "$previous" || log "sync: the previous image is not healthy either"
  else
    compose stop sync || true
  fi
  return 1
}

# Adds the commit to live/history, the commits deployed, oldest first, each once.
record_history() {
  { [ -f live/history ] && grep -vx "$commit" live/history || true; echo "$commit"; } | tail -n 10 | write_file live/history
}

# Removes each app's images but those of the last three commits deployed and those a container uses.
prune() {
  local keep used app repository tag
  keep=$(tail -n "$KEEP_IMAGES" live/history)
  used=$(docker ps -a --format '{{.Image}}')
  for app in "${APPS[@]}"; do
    repository=$REGISTRY/dazbee-$app
    while read -r tag; do
      [ "$tag" = '<none>' ] && continue
      grep -qxF "$tag" <<< "$keep" && continue
      grep -qxF "$repository:$tag" <<< "$used" && continue
      docker image rm "$repository:$tag" > /dev/null || log "could not remove $repository:$tag"
    done < <(docker image ls "$repository" --format '{{.Tag}}')
  done
}

while [ $# -gt 0 ]; do
  case $1 in
    --dir)
      [ $# -ge 2 ] || usage
      dir=$2
      shift 2
      ;;
    --local)
      pull=false
      shift
      ;;
    -*) usage ;;
    *)
      [ -z "$commit" ] || usage
      commit=$1
      shift
      ;;
  esac
done
[[ $commit =~ ^[0-9a-f]{7,40}$ ]] || usage

cd "$dir"
[ -d live ] || mkdir live
# One deploy at a time on this machine.
exec 9> live/deploy.lock
flock -n 9 || {
  echo 'another deploy is running' >&2
  exit 1
}

for app in "${APPS[@]}"; do
  image=$REGISTRY/dazbee-$app:$commit
  if $pull; then
    log "pulling $image"
    docker pull -q "$image" > /dev/null
  else
    docker image inspect "$image" > /dev/null || {
      echo "$image is not on this machine" >&2
      exit 1
    }
  fi
done

start_images_env
# Caddy and Postgres start when they don't run; a running one is left as it is. A Caddy that starts
# here loads deploy/Caddyfile as it starts.
caddy_ran=$(compose ps -q --status running caddy)
compose up -d --no-recreate --wait caddy postgres
[ -n "$caddy_ran" ] || write_file live/Caddyfile < deploy/Caddyfile
apply_caddyfile

# Each step fails the script when its app isn't healthy.
swap api
swap_sync
swap web
record_history
prune
log "deployed $commit"
