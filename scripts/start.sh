#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "${script_dir}/.." && pwd)"
cd "${project_root}"

export PATH="${project_root}/node_modules/.bin:${PATH}"
export WRANGLER_LOG_PATH="${WRANGLER_LOG_PATH:-.wrangler/wrangler.log}"

if ! command -v vinext >/dev/null 2>&1; then
  echo "vinext is unavailable. Run npm ci or yarn install before starting." >&2
  exit 69
fi

for argument in "$@"; do
  if [[ "${argument}" == "--help" || "${argument}" == "-h" ]]; then
    exec vinext start "$@"
  fi
done

if [[ ! -f dist/server/index.js || ! -d dist/client || ! -f dist/.build-verified ]]; then
  echo "No production build found. Building the app before starting..."
  bash "${script_dir}/build-verified.sh"
fi

exec node "${script_dir}/start-server.mjs" "$@"
