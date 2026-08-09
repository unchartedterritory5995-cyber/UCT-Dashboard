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
# Usage:  bash tools/_mutate_path_risks.sh
set -u

ROOT="C:/Users/Patrick/uct-worktrees/phase-b2-engine"
cd "$ROOT" || exit 99
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

# apply <file> <old> <new>  — refuses to no-op (never str.replace without
# asserting the old text is present: lesson_test_that_passes_vacuously)
apply() {
  python - "$1" "$2" "$3" <<'PY'
import sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(path, encoding="utf-8").read()
assert old in s, f"MUTATION TARGET ABSENT in {path}: {old!r}"
assert s.count(old) == 1, f"MUTATION TARGET AMBIGUOUS in {path} ({s.count(old)}x)"
open(path, "w", encoding="utf-8").write(s.replace(old, new))
PY
}

echo "================ CONTROL A ================"
purge
python -m pytest "$RAIL" "$CAP" -q -p no:randomly --junitxml="$OUT/controlA.xml" > "$OUT/controlA.log" 2>&1
CA=$?
NRUN=$(python -c "
import xml.etree.ElementTree as ET
r = ET.parse(r'$OUT/controlA.xml').getroot()
s = r if r.tag=='testsuite' else r[0]
print(s.get('tests'))
")
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
  apply "$file" "$old" "$new" || { echo "APPLY FAILED (target absent) -> MUTATION NOT APPLIED"; FAILURES=$((FAILURES+1)); return; }
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
  cp "$OUT/backup.tmp" "$file"
  local restored
  restored=$(sha "$file")
  if [ "$restored" = "$before" ]; then
    echo "restored OK ($restored)"
  else
    echo "!!! RESTORE FAILED for $file"
    FAILURES=$((FAILURES+1))
  fi
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
