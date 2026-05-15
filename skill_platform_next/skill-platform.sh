#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_DIR="$ROOT_DIR/.pids"
LOG_DIR="$ROOT_DIR/.logs"

mkdir -p "$PID_DIR" "$LOG_DIR"

LIB_PORT="${SKILL_LIBRARY_PORT:-4010}"
ENGINE_PORT="${SKILL_ENGINE_PORT:-4020}"
STORE_PORT="${SKILL_STORE_PORT:-4030}"

SERVICES=(
  "library|services/skill-library-backend/src/server.js|$LIB_PORT"
  "engine|services/skill-engine/src/server.js|$ENGINE_PORT"
  "store|apps/skill-store-web/server.js|$STORE_PORT"
)

pid_file() {
  local name="$1"
  echo "$PID_DIR/$name.pid"
}

log_file() {
  local name="$1"
  echo "$LOG_DIR/$name.log"
}

is_pid_running() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1
}

port_pids() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti tcp:"$port" || true
  else
    ss -ltnp 2>/dev/null | awk -v p=":$port" '$4 ~ p {print $NF}' | sed -E 's/.*pid=([0-9]+).*/\1/' || true
  fi
}

start_one() {
  local name="$1"
  local script="$2"
  local port="$3"
  local pfile
  pfile="$(pid_file "$name")"
  local lfile
  lfile="$(log_file "$name")"

  if [[ -f "$pfile" ]]; then
    local old_pid
    old_pid="$(cat "$pfile" 2>/dev/null || true)"
    if is_pid_running "$old_pid"; then
      echo "[skip] $name already running (pid=$old_pid)"
      return
    fi
    rm -f "$pfile"
  fi

  local conflict
  conflict="$(port_pids "$port" | tr '\n' ' ')"
  if [[ -n "${conflict// }" ]]; then
    echo "[warn] port $port occupied by: $conflict"
  fi

  (
    cd "$ROOT_DIR"
    nohup node "$script" >>"$lfile" 2>&1 &
    echo $! >"$pfile"
  )

  local pid
  pid="$(cat "$pfile")"
  sleep 0.3
  if is_pid_running "$pid"; then
    echo "[ok]   started $name (pid=$pid, port=$port)"
  else
    echo "[fail] failed to start $name, check $lfile"
    return 1
  fi
}

stop_one() {
  local name="$1"
  local port="$2"
  local pfile
  pfile="$(pid_file "$name")"

  if [[ -f "$pfile" ]]; then
    local pid
    pid="$(cat "$pfile" 2>/dev/null || true)"
    if is_pid_running "$pid"; then
      kill "$pid" >/dev/null 2>&1 || true
      sleep 0.4
      is_pid_running "$pid" && kill -9 "$pid" >/dev/null 2>&1 || true
      echo "[ok]   stopped $name (pid=$pid)"
    else
      echo "[skip] $name pid file stale"
    fi
    rm -f "$pfile"
  else
    echo "[skip] $name pid file not found"
  fi

  local remains
  remains="$(port_pids "$port" | tr '\n' ' ')"
  if [[ -n "${remains// }" ]]; then
    for p in $remains; do
      kill "$p" >/dev/null 2>&1 || true
      sleep 0.1
      is_pid_running "$p" && kill -9 "$p" >/dev/null 2>&1 || true
    done
    echo "[ok]   cleared port $port: $remains"
  fi
}

status_all() {
  echo "Skill Platform status:"
  for item in "${SERVICES[@]}"; do
    IFS="|" read -r name _script port <<<"$item"
    local pfile
    pfile="$(pid_file "$name")"
    if [[ -f "$pfile" ]]; then
      local pid
      pid="$(cat "$pfile" 2>/dev/null || true)"
      if is_pid_running "$pid"; then
        echo "  - $name: running (pid=$pid, port=$port)"
      else
        echo "  - $name: stale pid (pid=$pid, port=$port)"
      fi
    else
      echo "  - $name: stopped (port=$port)"
    fi
  done
}

start_all() {
  echo "Starting Skill Platform..."
  for item in "${SERVICES[@]}"; do
    IFS="|" read -r name script port <<<"$item"
    start_one "$name" "$script" "$port"
  done
  echo "Done. Store: http://localhost:$STORE_PORT"
}

stop_all() {
  echo "Stopping Skill Platform..."
  for item in "${SERVICES[@]}"; do
    IFS="|" read -r name _script port <<<"$item"
    stop_one "$name" "$port"
  done
  echo "Done."
}

usage() {
  cat <<'EOF'
Usage:
  ./skill-platform.sh start
  ./skill-platform.sh stop
  ./skill-platform.sh restart
  ./skill-platform.sh status
EOF
}

ACTION="${1:-}"
case "$ACTION" in
  start) start_all ;;
  stop) stop_all ;;
  restart) stop_all; start_all ;;
  status) status_all ;;
  *)
    usage
    exit 1
    ;;
esac
