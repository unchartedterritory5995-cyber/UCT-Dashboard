# Desktop environment for the Pine parity programme scripts. Source it; every value is overridable.
#   source docs/pine/parity-programme/scripts/env-desktop.sh
# The desktop (Windows profile C:\Users\Patrick) is where the programme started: the scripts'
# defaults are already its paths. VERIFY each path on first use (DESKTOP-PROMPT.md step 2) and
# override here rather than editing the scripts.
: "${UCT_HOME:=/c/Users/Patrick}"
export UCT_WORKTREES="${UCT_WORKTREES:-$UCT_HOME/uct-worktrees}"
# Run outputs AND the licence-held coverage sample ($UCT_RESUME/pine-sample, never committed).
export UCT_RESUME="${UCT_RESUME:-$UCT_WORKTREES/_resume-2026-11-01}"
export HEAVY_LOCK="${HEAVY_LOCK:-C:/Users/Patrick/uct-clips/tools/heavy_lock.py}"
# The python that has pytest + the api deps (requirements.txt, incl. linkify-it-py).
export UCT_PY="${UCT_PY:-python}"
freeram() { powershell.exe -NoProfile -Command "[int]((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1KB)" | tr -d '\r'; }
# One heavy job under this machine's lock:  hl <label> -- <command...>  (12 h queue wait)
hl() {
  local label=$1; shift; [ "${1:-}" = "--" ] && shift
  echo "[hl] $(date +%T) free RAM $(freeram) MB before '$label'"
  "$UCT_PY" "$HEAVY_LOCK" run --label "$label" --timeout 43200 -- "$@"
}
