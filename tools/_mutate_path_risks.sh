#!/usr/bin/env bash
# Mutation harness for the LIVE-PRICES-LRU + LLM-NO-TIMEOUT rails.
#
# Discipline, per repo convention:
#   * CONTROL A must be GREEN and must have run a NON-ZERO number of tests
#     (abort-on-zero: a suite that collected nothing is green for the wrong
#     reason and would make every mutation below look like a kill).
#   * every mutation is PROVEN APPLIED by sha before the verdict is taken.
#   * verdicts come from BARE EXIT CODES. No pipe anywhere near pytest — a pipe
#     hands you the exit code of `tail`, which is always 0.
#   * every artifact is sha-restored and the sha is re-verified.
#   * __pycache__ is purged around every mutation
#     (lesson_python_pycache_defeats_same_length_mutation).
#
# ⛔⛔ FOUR THINGS THIS HARNESS GOT WRONG, ALL FIXED 2026-09-15:
#
#   1. ROOT WAS HARDCODED TO A DIFFERENT WORKTREE —
#      `C:/Users/Patrick/uct-worktrees/phase-b2-engine`. Measured: that directory
#      does not exist, so `cd` failed and the script exited 99 before doing
#      anything, which reads as "nothing happened" rather than "this cannot
#      work". Should it ever come back, every mutation below lands in a tree
#      nobody running this named. ROOT is now DERIVED with
#      `git rev-parse --show-toplevel` against the script's OWN directory, and an
#      empty answer from git is treated as a failed invocation, never as a root.
#
#   2. THERE WAS NO TRAP AROUND A MULTI-MINUTE MUTATION WINDOW. Between `apply`
#      and the `cp` that restores sits a full pytest run. A Ctrl-C in there left
#      `api/services/cache.py`, `api/routers/live_prices.py`,
#      `api/services/llm_timeouts.py`, `api/services/transcripts.py` or
#      `api/services/voice_openai.py` MUTATED in the working tree, committable.
#      The restore is now bound to EXIT/INT/TERM and verified by sha, and the
#      backup's path is printed if it ever cannot be put back.
#
#   3. A WINDOWS PATH WAS INTERPOLATED INTO A PYTHON STRING LITERAL —
#      `ET.parse(r'$OUT/controlA.xml')`. Paths cross into Python by ENVIRONMENT
#      and are rebuilt with pathlib; that is the standing rule and the shape
#      `tools/_mutate_expected_red_io.py` exists in.
#
#   4. `apply` WROTE THROUGH TEXT MODE, WHICH REWRITES EVERY LINE ENDING.
#      ⚠️ NOT the bug it first looked like. The raw bytes of these files are CRLF
#      and the multi-line anchors are written with LF, so a byte-level count says
#      M2 and M3 match ZERO times — but `open(path, encoding="utf-8")` does
#      UNIVERSAL-NEWLINE translation, so in text mode they matched fine. The real
#      fault was the write: `open(path, "w")` emits `os.linesep`. MEASURED
#      2026-09-15 on an LF-on-disk copy (which is what git stores for these
#      paths): after the old `apply`, CRLF=69 of 69 lines — every ending flipped;
#      after the new one, CRLF=0. That is owner ruling R-2's failure exactly, in
#      a harness that then restores from a `cp` backup and hides it. `open(path,
#      "w")` also TRUNCATES before the write can fail. `apply` now reads and
#      writes BYTES and translates the anchor into the file's own convention.
#
# Usage:  bash tools/_mutate_path_risks.sh
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$ROOT" ] || [ ! -f "$ROOT/tools/_mutate_path_risks.sh" ]; then
  echo "!! could not derive a repo root from $SCRIPT_DIR" >&2
  echo "   git answered: '${ROOT:-}' — an empty answer is a FAILED invocation," >&2
  echo "   never a root to mutate files in." >&2
  exit 99
fi
cd "$ROOT" || exit 99
echo "ROOT (derived, git rev-parse --show-toplevel): $ROOT"
OUT="${TEMP:-/tmp}/uct_mut_path_risks"
mkdir -p "$OUT"

RAIL="tests/test_llm_timeout_census.py"
CAP="tests/test_live_prices_cache_capacity.py"

FAILURES=0

sha() { python -c "import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest())" "$1"; }
purge() { python -c "
import pathlib, shutil
for p in pathlib.Path('.').rglob('__pycache__'):
    shutil.rmtree(p, ignore_errors=True)
"; }

# ── THE MUTATION WINDOW IS TRAPPED ───────────────────────────────────────────
# MUT_FILE is non-empty for exactly as long as a product file is mutated on disk.
MUT_FILE=""
MUT_BACKUP=""
MUT_SHA=""

restore_mutated() {
  [ -n "$MUT_FILE" ] || return 0
  local f="$MUT_FILE" b="$MUT_BACKUP" want="$MUT_SHA" now
  if ! cp "$b" "$f"; then
    echo "!!!! RESTORE FAILED: $f IS STILL MUTATED. Put it back from $b BY HAND." >&2
    return 1
  fi
  now=$(sha "$f")
  if [ "$now" != "$want" ]; then
    echo "!!!! RESTORE DID NOT REPRODUCE THE SHA for $f ($now != $want)." >&2
    echo "     The captured original is $b. DO NOT COMMIT." >&2
    return 1
  fi
  MUT_FILE=""
  echo "restored OK ($now)"
  return 0
}

on_exit() {
  local rc=$?
  trap - EXIT INT TERM
  if [ -n "$MUT_FILE" ]; then
    echo "" >&2
    echo "!!!! ABORTED (exit $rc) WITH $MUT_FILE MUTATED ON DISK. Restoring." >&2
    restore_mutated || rc=96
    purge
  fi
  exit "$rc"
}
trap on_exit EXIT INT TERM

# apply <file> <old> <new>  — refuses to no-op (never str.replace without
# asserting the old text is present: lesson_test_that_passes_vacuously)
apply() {
  python - "$1" "$2" "$3" <<'PY'
import pathlib, sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
p = pathlib.Path(path)
s = p.read_bytes().decode("utf-8")
# The anchors below are written with LF and this checkout is CRLF on disk, so a
# multi-line anchor matches NOTHING unless it is translated into the file's own
# convention first.
CRLF = chr(13) + chr(10)
if CRLF in s:
    old = old.replace(chr(10), CRLF)
    new = new.replace(chr(10), CRLF)
assert old in s, f"MUTATION TARGET ABSENT in {path}: {old!r}"
assert s.count(old) == 1, f"MUTATION TARGET AMBIGUOUS in {path} ({s.count(old)}x)"
# write_bytes, never open(..., "w"): text mode translates every newline to
# os.linesep and would rewrite the whole file's endings, and `open(path, "w")`
# truncates BEFORE the write can fail.
p.write_bytes(s.replace(old, new).encode("utf-8"))
PY
}

echo "================ CONTROL A ================"
purge
python -m pytest "$RAIL" "$CAP" -q -p no:randomly --junitxml="$OUT/controlA.xml" > "$OUT/controlA.log" 2>&1
CA=$?
# D1: the path travels by ENVIRONMENT and is rebuilt with pathlib. Interpolating
# a Windows path into a Python string literal is what this used to do.
NRUN=$(CONTROL_A_XML="$OUT/controlA.xml" python - <<'PY'
import os, pathlib
import xml.etree.ElementTree as ET
root = ET.parse(pathlib.Path(os.environ["CONTROL_A_XML"])).getroot()
suite = root if root.tag == "testsuite" else root[0]
print(suite.get("tests") or "")
PY
)
echo "CONTROL A exit=$CA tests_collected=$NRUN"
if [ "$CA" -ne 0 ]; then echo "ABORT: control A is RED"; exit 98; fi
if [ "$NRUN" = "0" ] || [ -z "$NRUN" ]; then echo "ABORT: control A ran ZERO tests"; exit 97; fi

# mutate <label> <file> <old> <new> <testfile> <-k expr>
mutate() {
  local label="$1" file="$2" old="$3" new="$4" tf="$5" kexpr="$6"
  echo ""
  echo "---------------- MUTATION: $label ----------------"
  local before after
  before=$(sha "$file")
  cp "$file" "$OUT/backup.tmp" || { echo "BACKUP FAILED"; FAILURES=$((FAILURES+1)); return; }
  # ⛔ ARM THE TRAP BEFORE THE FIRST BYTE IS WRITTEN. Everything from here to
  # `restore_mutated` is the window an interrupt used to leave a product file in.
  MUT_FILE="$file"; MUT_BACKUP="$OUT/backup.tmp"; MUT_SHA="$before"
  if ! apply "$file" "$old" "$new"; then
    echo "APPLY FAILED (target absent) -> MUTATION NOT APPLIED"
    FAILURES=$((FAILURES+1))
    restore_mutated || FAILURES=$((FAILURES+1))
    return
  fi
  after=$(sha "$file")
  if [ "$before" = "$after" ]; then
    echo "MUTATION NOT APPLIED (sha unchanged) -> verdict would be meaningless"
    FAILURES=$((FAILURES+1))
  else
    echo "applied: $file  $before -> $after"
    purge
    python -m pytest "$tf" -q -p no:randomly -k "$kexpr" > "$OUT/$label.log" 2>&1
    local rc=$?
    if [ "$rc" -ne 0 ]; then
      echo "KILLED (pytest exit=$rc) <- the rail went RED, as it must"
      grep -m3 -E "^(FAILED|E  *assert|api/)" "$OUT/$label.log" | head -4
    else
      echo "SURVIVED (pytest exit=0) <- THE RAIL IS BLIND TO THIS DEFECT"
      FAILURES=$((FAILURES+1))
    fi
  fi
  restore_mutated || FAILURES=$((FAILURES+1))
  purge
}

# ── LLM-NO-TIMEOUT ───────────────────────────────────────────────────────────

# M1 — THE required control: a NEW unbounded client appears in a production
# module. This is the case a one-time sweep cannot catch and the rail must.
mutate "M1_new_unbounded_client" \
  "api/services/transcripts.py" \
  'def _analyze_transcript(' \
  'def _planted_unbounded(sym):
    import anthropic
    return anthropic.Anthropic(api_key="k")


def _analyze_transcript(' \
  "$RAIL" "test_no_llm_client_is_constructed_without_an_explicit_timeout"

# M2 — a site that WAS fixed silently loses its timeout again.
mutate "M2_fixed_site_unbounded" \
  "api/services/voice_openai.py" \
  '            timeout=llm_timeouts.seconds(_CLIENT_TIMEOUT_ENV,
                                         llm_timeouts.REQUEST_PATH_LONG),
' \
  '' \
  "$RAIL" "test_no_llm_client_is_constructed_without_an_explicit_timeout"

# M3 — `timeout=None`: the keyword present, the bound absent. If the census
# checked only for the keyword's presence this would survive.
mutate "M3_timeout_none" \
  "api/services/journal_two/pre_trade_verdict.py" \
  'timeout=llm_timeouts.seconds("COMPASS_VERDICT_LLM_TIMEOUT_SECS",
                                         llm_timeouts.REQUEST_PATH),' \
  'timeout=None,' \
  "$RAIL" "test_no_llm_client_is_constructed_without_an_explicit_timeout"

# M4 — the fail-soft env helper starts returning 0 on a bad value, which the SDK
# reads as "no timeout": every bounded client silently unbounds.
mutate "M4_env_helper_unbounds" \
  "api/services/llm_timeouts.py" \
  'return value if value > 0 else default' \
  'return value' \
  "$RAIL" "test_a_broken_env_override_falls_back_instead_of_unbounding"

# ── LIVE-PRICES-LRU ──────────────────────────────────────────────────────────

# M5 — THE fix, reverted: eviction reads the module constant again, so the
# "dedicated" instance is capped at 1000 and thrashes above ~970 tickers.
mutate "M5_revert_per_instance_bound" \
  "api/services/cache.py" \
  'while len(self._store) > self._max_size:' \
  'while len(self._store) > _MAX_SIZE:' \
  "$CAP" "test_the_derived_bound_holds_the_whole_working_set"

# M6 — the ⛔ shortcut the audit warned against: raise the SHARED constant
# instead of giving the instance its own bound. Every other cache's memory
# profile moves with it.
mutate "M6_raise_shared_singleton_instead" \
  "api/services/cache.py" \
  '_MAX_SIZE = 1000' \
  '_MAX_SIZE = 9000' \
  "$CAP" "test_raising_this_instance_did_not_raise_the_shared_singleton"

# M7 — the bound stops being derived and becomes a typed literal that happens to
# sit back in the thrash regime.
mutate "M7_bound_untethered_from_universe" \
  "api/routers/live_prices.py" \
  'CACHE_MAX_SIZE = _universe_size() * _KEYS_PER_TICKER + _SET_KEY_HEADROOM' \
  'CACHE_MAX_SIZE = 1000' \
  "$CAP" "test_the_bound_is_derived_from_the_universe_not_typed or test_the_derived_bound_holds_the_whole_working_set"

# M8 — the positive control inside the capacity rail is itself controlled: if
# the simulation stops reaching the provider, the "before" leg must notice.
mutate "M8_harness_stops_measuring" \
  "$CAP" \
  '    for r in range(rounds):' \
  '    rounds = 0
    for r in range(rounds):' \
  "$CAP" "test_the_old_module_wide_cap_reproduces_the_thrash"

echo ""
echo "================ CONTROL B (post-restore) ================"
purge
python -m pytest "$RAIL" "$CAP" -q -p no:randomly > "$OUT/controlB.log" 2>&1
CB=$?
echo "CONTROL B exit=$CB"
if [ "$CB" -ne 0 ]; then echo "!!! tree not restored cleanly"; FAILURES=$((FAILURES+1)); fi

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "ALL MUTATIONS KILLED; controls green."
  exit 0
fi
echo "$FAILURES PROBLEM(S)."
exit 1
