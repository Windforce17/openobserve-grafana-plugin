#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_DIR}"

# Homebrew and Docker Desktop tools on macOS are commonly installed in these paths.
# Keep the original user PATH after them.
export PATH="/opt/homebrew/bin:/usr/local/bin:${HOME}/.docker/bin:/Applications/Docker.app/Contents/Resources/bin:/Applications/OrbStack.app/Contents/MacOS/xbin:${PATH}"

ACTION="${1:-start}"
GRAFANA_PORT="${GRAFANA_PORT:-3000}"
GRAFANA_VERSION="${GRAFANA_VERSION:-12.4}"
GRAFANA_IMAGE="${GRAFANA_IMAGE:-docker.io/grafana/grafana}"
PLUGIN_ID="$(node -e "console.log(require('./src/plugin.json').id)")"
export GRAFANA_PORT GRAFANA_VERSION GRAFANA_IMAGE
export GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS="${GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS:-${PLUGIN_ID}}"
export COREPACK_ENABLE_STRICT="${COREPACK_ENABLE_STRICT:-0}"

usage() {
  cat <<EOF
Usage: scripts/dev-grafana.sh [start|stop|restart|logs|build|status|help]

Commands:
  start     Build the plugin and start Grafana in Docker on http://localhost:${GRAFANA_PORT}
  stop      Stop the local Grafana container
  restart   Stop, rebuild, and start Grafana again
  logs      Follow Grafana container logs
  build     Build the plugin frontend only
  status    Show Docker container status
  help      Show this help

Environment variables:
  GRAFANA_PORT=3000                 Host port for Grafana
  GRAFANA_VERSION=12.4              Grafana Docker image version
  GRAFANA_IMAGE=docker.io/grafana/grafana
                                    Grafana image name, for example docker.io/grafana/grafana-enterprise
  SKIP_BUILD=1                      Start Grafana without rebuilding dist/

After start:
  1. Open http://localhost:${GRAFANA_PORT}
  2. Anonymous admin access is enabled by the development Docker image.
  3. Add an OpenObserve datasource, then use Query Editor Stream Type = traces to test trace queries.
EOF
}

ensure_command() {
  local cmd="$1"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "Missing required command: ${cmd}" >&2
    exit 1
  fi
}

compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    echo "docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    echo "docker-compose"
  else
    echo "Docker Compose is required. Install Docker Desktop or docker-compose." >&2
    exit 1
  fi
}

install_deps_if_needed() {
  if [[ -x "node_modules/.bin/webpack" ]]; then
    return
  fi

  echo "node_modules is missing. Installing dependencies..."
  if npm ci; then
    return
  fi

  echo "npm ci failed; falling back to pnpm with hoisted node_modules layout."
  if command -v corepack >/dev/null 2>&1; then
    corepack enable >/dev/null 2>&1 || true
  fi
  ensure_command pnpm
  pnpm install --no-frozen-lockfile --shamefully-hoist

  # This repository is npm-lockfile based. Keep local pnpm fallback metadata out of commits.
  rm -f pnpm-lock.yaml
}

build_plugin() {
  if [[ "${SKIP_BUILD:-0}" == "1" ]]; then
    echo "SKIP_BUILD=1, reusing existing dist/."
    return
  fi

  ensure_command node
  ensure_command npm
  install_deps_if_needed

  echo "Building ${PLUGIN_ID} plugin..."
  ./node_modules/.bin/webpack -c ./.config/webpack/webpack.config.ts --env production
}

start_grafana() {
  ensure_command docker
  local compose
  compose="$(compose_cmd)"

  build_plugin
  mkdir -p provisioning/{access-control,alerting,dashboards,datasources,plugins}

  echo "Starting Grafana ${GRAFANA_VERSION} on http://localhost:${GRAFANA_PORT} ..."
  ${compose} -f docker-compose.yaml up -d --build

  echo "Waiting for Grafana health endpoint..."
  for _ in $(seq 1 60); do
    if curl -fsS "http://localhost:${GRAFANA_PORT}/api/health" >/dev/null 2>&1; then
      echo "Grafana is ready: http://localhost:${GRAFANA_PORT}"
      echo "Plugin id: ${PLUGIN_ID}"
      echo "Use Stream Type = traces in the OpenObserve query editor to verify trace queries."
      return
    fi
    sleep 1
  done

  echo "Grafana container started, but health endpoint did not become ready within 60 seconds." >&2
  echo "Run: scripts/dev-grafana.sh logs" >&2
}

stop_grafana() {
  ensure_command docker
  local compose
  compose="$(compose_cmd)"
  ${compose} -f docker-compose.yaml down
}

case "${ACTION}" in
  start)
    start_grafana
    ;;
  stop|down)
    stop_grafana
    ;;
  restart)
    stop_grafana || true
    start_grafana
    ;;
  logs)
    ensure_command docker
    $(compose_cmd) -f docker-compose.yaml logs -f grafana
    ;;
  build)
    build_plugin
    ;;
  status)
    ensure_command docker
    $(compose_cmd) -f docker-compose.yaml ps
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    echo "Unknown command: ${ACTION}" >&2
    usage
    exit 2
    ;;
esac
