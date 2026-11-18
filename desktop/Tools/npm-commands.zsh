# npm provides start as a built-in. Route the two custom shortcuts in this checkout.
npm() {
  local sailing_repo="${${(%):-%x}:A:h:h:h}"
  if [[ "$OSTYPE" == darwin* && "${PWD:A}/" == "$sailing_repo/"* ]]; then
    case "${1:-}" in
      build|installapp)
        local script="$1"
        shift
        command npm --prefix "$sailing_repo" run "$script" -- "$@"
        return
        ;;
    esac
  fi
  command npm "$@"
}
