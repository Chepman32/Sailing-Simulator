#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec "${script_dir}/sites-env.sh" -- "$0" "$@"
fi

export PATH="${SITES_PROJECT_ROOT}/node_modules/.bin:${PATH}"
if ! command -v vinext >/dev/null 2>&1; then
  echo "vinext is unavailable. Run npm ci or yarn install before building." >&2
  exit 69
fi

rm -f "${SITES_PROJECT_ROOT}/dist/.build-verified"
echo "Running bounded vinext build..."
node "${script_dir}/run-bounded.mjs" \
  "${SITES_BUILD_TIMEOUT:-3m}" \
  "${SITES_BUILD_KILL_AFTER:-10s}" \
  vinext build

echo "Running Worker import and rendered-route smoke test..."
npm run test:rendered
touch "${SITES_PROJECT_ROOT}/dist/.build-verified"
