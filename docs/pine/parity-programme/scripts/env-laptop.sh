# Laptop environment for the Pine parity programme scripts. Source it; every value is overridable.
#   source docs/pine/parity-programme/scripts/env-laptop.sh
# Values are for the laptop (Windows profile C:\Users\pgosz); the desktop keeps the scripts' defaults.
: "${UCT_HOME:=/c/Users/pgosz}"
export UCT_WORKTREES="${UCT_WORKTREES:-$UCT_HOME/uct-worktrees}"
export UCT_RESUME="${UCT_RESUME:-$UCT_WORKTREES/_resume-laptop}"
# Copy of uct-clips tools/heavy_lock.py (uct-clips@wip-snapshot-2026-11-01, blob 6c43f4da3d) with
# LOCK_PATH set to C:\Users\pgosz\.claude\uct-heavy.lock; the only edit.
export HEAVY_LOCK="${HEAVY_LOCK:-C:/Users/pgosz/uct-tools/heavy_lock.py}"
# The venv carries pytest, playwright and the api deps; the system python does not.
export UCT_PY="${UCT_PY:-$UCT_HOME/uct-venv/Scripts/python.exe}"
case ":$PATH:" in *":$UCT_HOME/uct-venv/Scripts:"*) ;; *) export PATH="$UCT_HOME/uct-venv/Scripts:$PATH" ;; esac

# Free physical RAM in MB. Check it before every heavy job.
freeram() { powershell.exe -NoProfile -Command "[int]((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1KB)" | tr -d '\r'; }

# Load SMOKE_EMAIL / SMOKE_PASSWORD from the Windows user environment into this shell, never printing them.
smoke_creds() {
  if [ -z "${SMOKE_EMAIL:-}" ] || [ -z "${SMOKE_PASSWORD:-}" ]; then
    SMOKE_EMAIL=$(powershell.exe -NoProfile -Command "[Environment]::GetEnvironmentVariable('SMOKE_EMAIL','User')" | tr -d '\r')
    SMOKE_PASSWORD=$(powershell.exe -NoProfile -Command "[Environment]::GetEnvironmentVariable('SMOKE_PASSWORD','User')" | tr -d '\r')
    export SMOKE_EMAIL SMOKE_PASSWORD
  fi
  if [ -n "$SMOKE_EMAIL" ] && [ -n "$SMOKE_PASSWORD" ]; then echo "smoke creds: loaded"; else
    echo "smoke creds: MISSING (set SMOKE_EMAIL / SMOKE_PASSWORD as Windows user environment variables)"; return 1; fi
}

# One heavy job under the machine-wide lock:  hl <label> -- <command...>
# Windows python cannot spawn npm/npx by bare name: use npm.cmd / npx.cmd.
hl() {
  local label=$1; shift; [ "${1:-}" = "--" ] && shift
  echo "[hl] $(date +%T) free RAM $(freeram) MB before '$label'"
  "$UCT_PY" "$HEAVY_LOCK" run --label "$label" --timeout 14400 -- "$@"
}
