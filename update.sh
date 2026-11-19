#!/usr/bin/env bash
# Update Galacticio to the latest code and restart it under pm2.
#
#   ./update.sh               pull origin/main, check, restart, verify
#   BRANCH=dev ./update.sh    follow another branch
#   SKIP_TESTS=1 ./update.sh  skip the test suite (it needs about 10 seconds and port 4061)
#
# Safe to run from cron. It refuses to run over local edits to tracked files, never touches
# .env or the account data in DATA_DIR, and rolls back to the previous version if the new one
# fails its checks or does not answer /api/health after the restart.
set -Eeuo pipefail

main() {
  cd "$(dirname "$(readlink -f "$0")")"
  local app="${PM2_APP:-galacticio}" branch="${BRANCH:-main}" port
  port="$(env_value PORT)"; port="${port:-4050}"

  need git; need node; need npm; need curl
  if ! command -v pm2 >/dev/null 2>&1; then
    say "pm2 is not installed. Install it with: npm install -g pm2"; exit 1
  fi
  local major; major="$(node -p 'process.versions.node.split(".")[0]')"
  if (( major < 18 )); then say "Node $major is too old; Galacticio needs Node 18 or newer."; exit 1; fi

  if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    say "Local changes to tracked files; commit or stash them first:"; git status --short --untracked-files=no; exit 1
  fi

  local before after
  before="$(git rev-parse HEAD)"
  say "Fetching origin/$branch"
  git fetch --quiet origin "$branch"
  git checkout --quiet "$branch" 2>/dev/null || git checkout --quiet -b "$branch" "origin/$branch"
  git merge --quiet --ff-only "origin/$branch"
  after="$(git rev-parse HEAD)"

  if [[ "$before" == "$after" ]] && pm2 describe "$app" >/dev/null 2>&1 && [[ "${FORCE:-}" != 1 ]]; then
    say "Already up to date at $(git log -1 --format='%h %s')"
    health "$port" && exit 0
    say "But the running app is not healthy; restarting it."
  else
    say "Updating $(git rev-parse --short "$before") -> $(git rev-parse --short "$after")"
    git --no-pager log --oneline "$before..$after" | sed 's/^/  /' || true
  fi

  # Dependencies: none today, but install them if package.json ever gains some.
  if node -e 'process.exit(Object.keys(require("./package.json").dependencies||{}).length?0:1)'; then
    say "Installing dependencies"; npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund
  fi

  if ! check; then rollback "$before" "$app" "$port" keep; exit 1; fi  # the old version is still running

  say "Restarting $app"
  if pm2 describe "$app" >/dev/null 2>&1; then pm2 reload ecosystem.config.cjs --only "$app" --update-env >/dev/null
  else pm2 start ecosystem.config.cjs --only "$app" >/dev/null; fi

  if ! health "$port"; then
    pm2 logs "$app" --lines 30 --nostream || true
    rollback "$before" "$app" "$port"; exit 1
  fi
  pm2 save >/dev/null
  say "Done: $(git log -1 --format='%h %s') is live on port $port"
}

# Syntax-check every server and browser script, then run the test suite.
check() {
  say "Checking"
  local f
  for f in server.js lib/*.js app/app.js; do node --check "$f" || return 1; done
  if [[ "${SKIP_TESTS:-}" != 1 ]]; then npm test --silent >/tmp/galacticio-test.log 2>&1 || { tail -20 /tmp/galacticio-test.log; return 1; }; fi
}

# Wait up to ~30 s for the restarted server to answer.
health() {
  local i
  for i in $(seq 1 30); do
    if curl -fsS --max-time 3 "http://127.0.0.1:$1/api/health" 2>/dev/null | grep -q '"ok":true'; then say "Health check passed"; return 0; fi
    sleep 1
  done
  say "Health check failed: nothing healthy on http://127.0.0.1:$1/api/health"; return 1
}

rollback() {
  local to="$1" app="$2" port="$3" mode="${4:-restart}"
  if [[ "$(git rev-parse HEAD)" == "$to" ]]; then say "Nothing to roll back to."; return; fi
  say "Rolling back to $(git rev-parse --short "$to")"
  git reset --quiet --hard "$to"
  if [[ "$mode" == keep ]]; then say "The running version was not touched."; return; fi
  if pm2 describe "$app" >/dev/null 2>&1; then pm2 reload ecosystem.config.cjs --only "$app" --update-env >/dev/null; else pm2 start ecosystem.config.cjs --only "$app" >/dev/null; fi
  health "$port" || say "The previous version is not healthy either; check: pm2 logs $app"
}

# Read KEY=value from the environment or .env, the same way server.js does.
env_value() {
  if [[ -n "${!1:-}" ]]; then printf '%s' "${!1}"; return; fi
  [[ -f .env ]] && sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*['\"]\{0,1\}\([^'\"]*\)['\"]\{0,1\}[[:space:]]*$/\1/p" .env | tail -1
}
need() { command -v "$1" >/dev/null 2>&1 || { say "Missing $1"; exit 1; }; }
say() { if [[ -t 1 ]]; then printf '\033[1;34m[update]\033[0m %s\n' "$*"; else printf '[update] %s\n' "$*"; fi; }

main "$@"; exit $?
