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
# The hand-off folder and its scripts (DESKTOP-PROMPT.md uses $H and $S).
export H="${H:-$UCT_WORKTREES/pine-handoff}"
export S="$H/docs/pine/parity-programme/scripts"
freeram() { powershell.exe -NoProfile -Command "[int]((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1KB)" | tr -d '\r'; }
# RAM gate (coordinator rule): call before acquiring ANY heavy lock. Waits until free RAM >= RAM_GATE_MB (6000);
# gives up (return 1) after RAM_GATE_MAX_WAIT seconds (default 21600) so a wait loop always ends.
ram_gate() {
  local bad=0 need=${RAM_GATE_MB:-6000} waited=0 max=${RAM_GATE_MAX_WAIT:-21600} r
  while :; do
    r=$(freeram); case "$r" in ''|*[!0-9]*) bad=$((bad+1)); [ "$bad" -ge 3 ] && { echo "ram_gate: freeram unreadable ('$r'), giving up" >&2; return 1; };; *) bad=0; [ "$r" -ge "$need" ] && return 0;; esac
    [ "$waited" -ge "$max" ] && { echo "ram_gate: still ${r} MB < $need after ${waited}s, giving up" >&2; return 1; }
    echo "ram_gate: free ${r} MB < $need, waiting 120 s"; sleep 120; waited=$((waited+120))
  done
}
# One heavy job under this machine's lock:  hl <label> -- <command...>  (12 h queue wait)
hl() {
  ram_gate || return 1
  local label=$1; shift; [ "${1:-}" = "--" ] && shift
  echo "[hl] $(date +%T) free RAM $(freeram) MB before '$label'"
  "$UCT_PY" "$HEAVY_LOCK" run --label "$label" --timeout 43200 -- "$@"
}
# Lane-scoped helpers:  lane_env <lane>  sets RUN and the per-lane heavy-lock paths.
#   RUN=$UCT_RESUME/runs/<lane>/ (created); LOCK_MUT, LOCK_MP2, LOCK_MP3, LOCK_FINAL2, LOCK_FINAL3
#   = $UCT_RESUME/dsk/heavy-<kind>-<lane>.lock. Use them as:  "$UCT_PY" "$HEAVY_LOCK" run --path "$LOCK_FINAL2" -- ...
# Refuses (return 1, nothing exported) if any path resolves under C:/Users/Patrick/.claude/ (a lock there
# lands in the agent config tree and gets swept or synced).
lane_env() {
  local lane=${1:-}
  case "$lane" in ""|*[!A-Za-z0-9._-]*) echo "lane_env: need a lane name [A-Za-z0-9._-]" >&2; return 1;; esac
  local run="$UCT_RESUME/runs/$lane/" d="$UCT_RESUME/dsk" k p bad=""
  for p in "$run" "$d"; do
    local n; n=$(cygpath -m "$p" 2>/dev/null || echo "$p"); n=$(echo "$n" | tr 'A-Z' 'a-z')
    case "$n/" in c:/users/patrick/.claude/*|/c/users/patrick/.claude/*) bad=$p;; esac
  done
  [ -n "$bad" ] && { echo "lane_env: refusing, $bad is under C:/Users/Patrick/.claude/" >&2; return 1; }
  mkdir -p "$run" "$d" || return 1
  export RUN="$run"
  for k in MUT MP2 MP3 FINAL2 FINAL3; do
    export "LOCK_$k=$d/heavy-$(echo $k | tr 'A-Z' 'a-z')-$lane.lock"
  done
}
# lock_run <LOCKVAR> <label> -- <command...>   e.g.  lock_run LOCK_FINAL2 mylane-final -- bash $RUN/job.sh
# ram_gate, then ONE heavy job under that lane lock (12 h queue wait). Use this instead of calling heavy_lock.py directly.
lock_run() {
  local var=$1 label=$2; shift 2; [ "${1:-}" = "--" ] && shift
  local path=${!var:-}; [ -n "$path" ] || { echo "lock_run: $var is empty (call lane_env <lane> first)" >&2; return 1; }
  ram_gate || return 1
  echo "[lock_run] $(date +%T) free RAM $(freeram) MB before '$label' on $var"
  "$UCT_PY" "$HEAVY_LOCK" run --path "$path" --label "$label" --timeout 43200 -- "$@"
}
