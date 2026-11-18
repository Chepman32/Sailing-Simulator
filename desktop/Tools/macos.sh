#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
desktop="$(cd "$script_dir/.." && pwd -P)"
repository="$(cd "$desktop/.." && pwd -P)"
project_name=SailingSimulatorDesktop
project="$desktop/$project_name.uproject"
builds="$desktop/Saved/Builds"
dmg="$builds/Sailing-Simulator-Pro-macOS-arm64.dmg"
bundle="Sailing Simulator Pro.app"
destination="/Applications/$bundle"

usage() {
  printf '%s\n' 'npm start               Run the Unreal development preview and watch for changes.' \
    'npm run build           Build the Apple Silicon player and a drag-to-Applications DMG.' \
    'npm run installapp      Install the current DMG into /Applications.'
}

select_engine() {
  local candidate
  for candidate in "${UE_ROOT:-/Users/Shared/Epic Games/UE5/UE_5.8}" \
    "${UE_ROOT:-/Users/Shared/Epic Games/UE_5.8}"; do
    if [[ -x "$candidate/Engine/Build/BatchFiles/Mac/Build.sh" && \
      -x "$candidate/Engine/Build/BatchFiles/RunUAT.sh" && \
      -x "$candidate/Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor" ]]; then
      ue="$candidate"
      return
    fi
  done
  printf 'Unreal Engine 5.8 was not found. Set UE_ROOT to its installation directory.\n' >&2
  return 1
}

compile_editor() {
  "$ue/Engine/Build/BatchFiles/Mac/Build.sh" "${project_name}Editor" Mac Development \
    -Project="$project" -WaitMutex -NoHotReload -NoUBA
}

rename_path() {
  node -e 'require("node:fs").renameSync(process.argv[1], process.argv[2])' "$1" "$2"
}

build_dmg() (
  local work archive payload app
  mkdir -p "$builds"
  work="$(mktemp -d "$builds/.dmg.XXXXXX")"
  trap 'rm -rf -- "$work"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  archive="$work/archive"
  payload="$work/image"

  compile_editor
  "$ue/Engine/Build/BatchFiles/RunUAT.sh" BuildCookRun -project="$project" -platform=Mac \
    -clientconfig=Shipping -build -cook -iterativecooking -stage -pak -iostore -package -archive \
    -archivedirectory="$archive" -NoP4 -unattended -utf8output -nodebuginfo -nocompileeditor

  app="$archive/Mac/$project_name.app"
  if [[ ! -d "$app" ]]; then
    app="$archive/Mac/$project_name-Mac-Shipping.app"
  fi
  /usr/bin/codesign --verify --deep --strict "$app"
  mkdir "$payload"
  /usr/bin/ditto "$app" "$payload/$bundle"
  ln -s /Applications "$payload/Applications"
  awk '/^## Unreal Engine desktop assets/ { desktop_assets=1 } desktop_assets' \
    "$repository/public/models/README.md" > "$payload/Asset Credits.md"
  /usr/bin/hdiutil create -quiet -fs HFS+ -format UDZO -volname 'Sailing Simulator Pro' \
    -srcfolder "$payload" "$work/install.dmg"
  /usr/bin/hdiutil verify -quiet "$work/install.dmg"
  mv -f -- "$work/install.dmg" "$dmg"
  printf 'Built %s\n' "$dmg"
)

install_dmg() (
  local mount_dir stage mounted=false bundle_id
  if [[ ! -f "$dmg" ]]; then
    printf 'DMG not found. Build it first with npm run build.\n' >&2
    exit 1
  fi

  mount_dir="$(mktemp -d "${TMPDIR:-/tmp}/sailing-mount.XXXXXX")"
  stage=""
  cleanup() {
    local result=$?
    if [[ "$mounted" == true ]]; then
      if ! /usr/bin/hdiutil detach -quiet "$mount_dir"; then
        printf 'Could not eject %s.\n' "$mount_dir" >&2
        result=1
      fi
    fi
    rmdir "$mount_dir" 2>/dev/null || true
    if [[ -n "$stage" ]]; then
      if [[ -e "$stage/previous.app" && "$result" != 0 ]]; then
        if [[ ! -e "$destination" && ! -L "$destination" ]] && rename_path "$stage/previous.app" "$destination"; then
          printf 'Restored %s.\n' "$destination" >&2
        else
          printf 'The previous app is still at %s/previous.app.\n' "$stage" >&2
          exit "$result"
        fi
      fi
      rm -rf -- "$stage"
    fi
    exit "$result"
  }
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  /usr/bin/hdiutil attach -quiet -readonly -nobrowse -mountpoint "$mount_dir" "$dmg"
  mounted=true
  stage="$(mktemp -d /Applications/.sailing-install.XXXXXX)"
  /usr/bin/ditto "$mount_dir/$bundle" "$stage/$bundle"
  /usr/bin/codesign --verify --deep --strict "$stage/$bundle"

  if [[ -e "$destination" || -L "$destination" ]]; then
    bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$stage/$bundle/Contents/Info.plist")"
    if [[ -L "$destination" || "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$destination/Contents/Info.plist" 2>/dev/null || true)" != "$bundle_id" ]]; then
      printf 'Another app already occupies %s.\n' "$destination" >&2
      exit 1
    fi
    if /usr/bin/pgrep -f '^/Applications/Sailing Simulator Pro\.app/Contents/MacOS/' >/dev/null; then
      printf 'Quit Sailing Simulator Pro before installing an update.\n' >&2
      exit 1
    fi
    rename_path "$destination" "$stage/previous.app"
  fi
  rename_path "$stage/$bundle" "$destination"
  rm -rf -- "$stage/previous.app"
  printf 'Installed %s\n' "$destination"
)

action="${1:-}"
if [[ $# -gt 0 ]]; then shift; fi
if [[ "${1:-}" == --help || "${1:-}" == -h || -z "$action" ]]; then
  usage
  exit 0
fi
if [[ "$(uname -s)" != Darwin ]]; then
  if [[ "$action" == build ]]; then
    exec bash "$repository/scripts/build-verified.sh" "$@"
  fi
  printf 'This desktop command requires macOS.\n' >&2
  exit 1
fi

case "$action" in
  compile) select_engine && compile_editor ;;
  preview)
    select_engine
    exec "$ue/Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor" \
      "$project" -game -NoSplash -NoTrace -Windowed -ResX=1440 -ResY=900 "$@"
    ;;
  build) select_engine && build_dmg ;;
  install) install_dmg ;;
  *) usage >&2; exit 1 ;;
esac
