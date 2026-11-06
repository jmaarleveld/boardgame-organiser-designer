#!/usr/bin/env bash
# Headless screenshot of the board game designer.
#
#   shoot.sh DESIGN.json OUT_DIR [--view top|front|side|iso] [--steps steps.json]
#            [--viewport 1600x1000] [--timeout ms] [--stop-after]
#   shoot.sh --stop-server      stop a dev server this script started
#   shoot.sh --server-only      just make sure the dev server is up
#
# Starts (or reuses) the Vite dev server on port 5199, then runs driver.cjs in
# the mcr.microsoft.com/playwright:v1.49.1-noble container with --network host.
# playwright-core 1.49.1 is installed once into $CACHE (outside the repo).
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SKILL_DIR/../../.." && pwd)"
PORT="${BGID_PORT:-5199}"
PW_VERSION="1.49.1"
IMAGE="mcr.microsoft.com/playwright:v${PW_VERSION}-noble"
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/bgid-headless-screenshot"
PIDFILE="$CACHE/vite-$PORT.pid"
VITE_LOG="$CACHE/vite-$PORT.log"
export PATH="$HOME/.local/bin:$PATH"
mkdir -p "$CACHE"

die() { echo "shoot.sh: $*" >&2; exit 1; }

server_up() { curl -fs -o /dev/null --max-time 3 "http://127.0.0.1:$PORT/"; }

stop_server() {
  if [[ -f "$PIDFILE" ]]; then
    local pid; pid="$(cat "$PIDFILE")"
    # Vite was started with setsid: kill the whole process group.
    kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
    rm -f "$PIDFILE"
    for _ in $(seq 20); do server_up || break; sleep 0.25; done
    echo "shoot.sh: stopped dev server (pid $pid)"
  else
    echo "shoot.sh: no dev server started by this script (pidfile $PIDFILE absent)"
  fi
}

ensure_server() {
  if server_up; then
    echo "shoot.sh: reusing dev server on :$PORT"
    STARTED=0
    return
  fi
  command -v npx >/dev/null || die "npx not found (Node lives in ~/.local/bin)"
  echo "shoot.sh: starting Vite on :$PORT (log $VITE_LOG)"
  # setsid -f: own session, parent returns at once (no fd held open on our stdout).
  # The new session leader writes its own pid (== process group id) to the pidfile.
  ( cd "$REPO" && setsid -f bash -c 'echo $$ >"$1"; exec npx vite --port "$2" --strictPort --host' _ "$PIDFILE" "$PORT" \
      </dev/null >"$VITE_LOG" 2>&1 )
  for _ in $(seq 120); do server_up && break; sleep 0.5; done
  server_up || { tail -20 "$VITE_LOG" >&2; die "Vite did not come up on :$PORT"; }
  STARTED=1
}

ensure_playwright_core() {
  PW_DIR="$CACHE/pw-$PW_VERSION"
  if [[ ! -f "$PW_DIR/node_modules/playwright-core/package.json" ]]; then
    echo "shoot.sh: installing playwright-core@$PW_VERSION into $PW_DIR"
    mkdir -p "$PW_DIR"
    [[ -f "$PW_DIR/package.json" ]] || echo '{"private":true}' >"$PW_DIR/package.json"
    npm install --prefix "$PW_DIR" --no-audit --no-fund --silent "playwright-core@$PW_VERSION" >/dev/null
  fi
}

case "${1:-}" in
  --stop-server) stop_server; exit 0 ;;
  --server-only) ensure_server; exit 0 ;;
  ""|-h|--help) sed -n '2,10p' "$0"; exit 0 ;;
esac

[[ $# -ge 2 ]] || die "usage: shoot.sh DESIGN.json OUT_DIR [options]"
DESIGN="$(realpath "$1")"; OUT="$2"; shift 2
[[ -f "$DESIGN" ]] || die "design not found: $DESIGN"
mkdir -p "$OUT"; OUT="$(realpath "$OUT")"
VIEW=""; STEPS=""; VIEWPORT="1600x1000"; TIMEOUT="180000"; STOP_AFTER=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --view) VIEW="$2"; shift 2 ;;
    --steps) STEPS="$(realpath "$2")"; shift 2 ;;
    --viewport) VIEWPORT="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    --stop-after) STOP_AFTER=1; shift ;;
    *) die "unknown option $1" ;;
  esac
done

ensure_playwright_core
ensure_server

MOUNTS=(-v "$SKILL_DIR/driver.cjs:/skill/driver.cjs:ro" -v "$PW_DIR:/pw:ro" -v "$DESIGN:/in/design.json:ro" -v "$OUT:/out")
ENVS=(-e PW_CORE=/pw/node_modules/playwright-core -e APP_URL="http://127.0.0.1:$PORT/" -e DESIGN=/in/design.json -e OUT=/out
      -e VIEW="$VIEW" -e VIEWPORT="$VIEWPORT" -e BUILD_TIMEOUT="$TIMEOUT")
if [[ -n "$STEPS" ]]; then MOUNTS+=(-v "$STEPS:/in/steps.json:ro"); ENVS+=(-e STEPS=/in/steps.json); fi

set +e
# label=disable: no SELinux relabel of repo/scratchpad files (":Z" would relabel them).
# --ipc host: Chromium's /dev/shm is tiny in a default container.
podman run --rm --network host --ipc host --security-opt label=disable \
  "${MOUNTS[@]}" "${ENVS[@]}" "$IMAGE" node /skill/driver.cjs
RC=$?
set -e

if [[ "$STOP_AFTER" == 1 && "${STARTED:-0}" == 1 ]]; then stop_server; fi
echo "shoot.sh: outputs in $OUT (exit $RC: 0 ok, 1 fatal, 2 step failed, 3 mesh failures/timeout)"
exit $RC
