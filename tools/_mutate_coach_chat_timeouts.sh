#!/usr/bin/env bash
# Mutation harness for the Compass-chat turn budget + the D-22 ungraded-judge fix.
#
# DISCIPLINE (this repo's, learned the hard way):
#   - CONTROL A first, green, with ABORT-ON-ZERO: a suite that collects nothing
#     makes every KILLED verdict below meaningless.
#   - Every mutation is PROVEN APPLIED by comparing the file sha before/after.
#     `str.replace` with no `assert old in src` is how a mutation silently
#     no-ops and reports a fake KILL (lesson_test_that_passes_vacuously).
#   - Every verdict is a BARE pytest exit code. No pipe: `cmd | tail` reports
#     tail's status, not pytest's.
#   - Every artifact is restored from a byte copy and the sha re-verified.
#   - __pycache__ is purged around each run — a same-length mutation can
#     otherwise be served from a stale .pyc.
#
# Usage:  bash tools/_mutate_coach_chat_timeouts.sh
set -u

cd "$(dirname "$0")/.." || exit 1
ROOT="$PWD"
WORK="$(mktemp -d)"
LOG="$WORK/pytest.log"

CHAT="api/services/journal_two/coach_chat.py"
CENSUS_TEST="tests/test_llm_timeout_census.py"
JUDGE="api/services/compass_eval/judge.py"
STORE="api/services/compass_eval/store.py"
RUNNER="api/services/compass_eval/runner.py"
GOLDEN="api/services/compass_eval/golden_set.py"

T_CENSUS="tests/test_llm_timeout_census.py"
T_TURN="api/services/journal_two/test_coach_chat_timeouts.py"
T_D22="api/services/compass_eval/test_judge_store.py api/services/compass_eval/test_runner.py api/services/compass_eval/test_report_card_gate.py"
ALL="$T_CENSUS $T_TURN $T_D22"

ARTIFACTS="$CHAT $CENSUS_TEST $JUDGE $STORE $RUNNER $GOLDEN"

killed=0; survived=0; broken=0

sha() { python -c "import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest())" "$1"; }
purge() { find "$ROOT/api" "$ROOT/tests" "$ROOT/tools" -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null; }

for f in $ARTIFACTS; do
  mkdir -p "$WORK/orig/$(dirname "$f")"
  cp "$f" "$WORK/orig/$f"
  sha "$f" > "$WORK/orig/$f.sha"
done

restore() {
  for f in $ARTIFACTS; do cp "$WORK/orig/$f" "$f"; done
  purge
  for f in $ARTIFACTS; do
    if [ "$(sha "$f")" != "$(cat "$WORK/orig/$f.sha")" ]; then
      echo "!! RESTORE FAILED for $f"; exit 9
    fi
  done
}

# apply <file> <python-heredoc-on-stdin>; asserts the edit landed
apply() {
  local f="$1" before after
  before="$(sha "$f")"
  python - "$f" || { echo "!! mutation script errored for $f"; restore; exit 9; }
  after="$(sha "$f")"
  if [ "$before" = "$after" ]; then
    echo "!! MUTATION DID NOT APPLY to $f (sha unchanged: $before)"
    restore; exit 9
  fi
  purge
}

# ── CONTROL A ────────────────────────────────────────────────────────────────
echo "== CONTROL A: unmutated suite =="
purge
python -m pytest $ALL -q --no-header -p no:randomly > "$LOG" 2>&1
rc=$?
COLLECTED="$(python - "$LOG" <<'PY'
import re, sys
m = re.search(r"(\d+) passed", open(sys.argv[1], encoding="utf-8", errors="replace").read())
print(m.group(1) if m else "0")
PY
)"
echo "CONTROL A exit=$rc collected=$COLLECTED"
if [ "$rc" -ne 0 ]; then echo "!! CONTROL A is RED — abort"; tail -30 "$LOG"; exit 1; fi
if [ "$COLLECTED" -eq 0 ]; then echo "!! ABORT-ON-ZERO: control collected nothing"; exit 1; fi

# ── mutations ────────────────────────────────────────────────────────────────
run_mutation() {
  local name="$1"; shift
  local targets="$1"; shift
  purge
  python -m pytest $targets -q --no-header -p no:randomly > "$LOG" 2>&1
  local rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "  $name: SURVIVED  (exit 0 — the rail does not see this defect)"
    survived=$((survived+1))
  elif [ "$rc" -eq 1 ]; then
    echo "  $name: KILLED    (exit 1)"
    killed=$((killed+1))
  else
    echo "  $name: BROKEN    (exit $rc — collection/interpreter error, not a verdict)"
    tail -20 "$LOG"
    broken=$((broken+1))
  fi
  restore
}

echo
echo "== M1: the chat client loses its timeout= =="
apply "$CHAT" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding="utf-8").read()
old = "anthropic.Anthropic(api_key=key, timeout=self.timeout)"
new = "anthropic.Anthropic(api_key=key)"
assert old in s, "M1 anchor missing"
open(p, "w", encoding="utf-8").write(s.replace(old, new, 1))
PY
run_mutation M1 "$T_CENSUS"

echo "== M2: the summary client loses its timeout= =="
apply "$CHAT" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding="utf-8").read()
old = """        client = anthropic.Anthropic(
            api_key=os.environ["ANTHROPIC_API_KEY"],
            timeout=float(timeout) if timeout else summary_call_timeout_secs(),
        )"""
new = """        client = anthropic.Anthropic(
            api_key=os.environ["ANTHROPIC_API_KEY"],
        )"""
assert old in s, "M2 anchor missing"
open(p, "w", encoding="utf-8").write(s.replace(old, new, 1))
PY
run_mutation M2 "$T_CENSUS"

echo "== M3: the quarantine entry is put back (a stale exemption) =="
apply "$CENSUS_TEST" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding="utf-8").read()
old = 'QUARANTINE: dict[str, int] = {\n'
new = ('QUARANTINE: dict[str, int] = {\n'
       '    "api/services/journal_two/coach_chat.py": 2,\n')
assert old in s, "M3 anchor missing"
open(p, "w", encoding="utf-8").write(s.replace(old, new, 1))
PY
run_mutation M3 "$T_CENSUS"

echo "== M4: call_timeout stops clamping to the turn (per-call bounding only) =="
apply "$CHAT" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding="utf-8").read()
old = "        return max(_MIN_CALL_SECS, min(float(ceiling), self.remaining()))"
new = "        return float(ceiling)"
assert old in s, "M4 anchor missing"
open(p, "w", encoding="utf-8").write(s.replace(old, new, 1))
PY
run_mutation M4 "$T_TURN"

echo "== M5: the in-stream deadline check is deleted =="
apply "$CHAT" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding="utf-8").read()
old = """                    if deadline.expired():
                        out_of_time = True
                        break
"""
assert old in s, "M5 anchor missing"
open(p, "w", encoding="utf-8").write(s.replace(old, "", 1))
PY
run_mutation M5 "$T_TURN"

echo "== M6: the between-rounds deadline check is deleted =="
apply "$CHAT" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding="utf-8").read()
old = """            if deadline.expired():
                yield {"type": "error", "code": "turn_budget_exceeded",
                       "message": _TURN_BUDGET_ERROR}
                return
"""
assert old in s, "M6 anchor missing"
open(p, "w", encoding="utf-8").write(s.replace(old, "", 1))
PY
run_mutation M6 "$T_TURN"

echo "== M7: the summarizer gets its own unshared budget again =="
apply "$CHAT" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding="utf-8").read()
old = "            timeout=(deadline.call_timeout(ceiling) if deadline is not None else ceiling),"
new = "            timeout=ceiling,"
assert old in s, "M7 anchor missing"
open(p, "w", encoding="utf-8").write(s.replace(old, new, 1))
PY
run_mutation M7 "$T_TURN"

echo "== M8: an unstated axis scores 0 again (D-22, in miniature) =="
apply "$JUDGE" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding="utf-8").read()
old = """    if raw is None or isinstance(raw, bool):
        return None"""
new = """    if raw is None or isinstance(raw, bool):
        return 0"""
assert old in s, "M8 anchor missing"
open(p, "w", encoding="utf-8").write(s.replace(old, new, 1))
PY
run_mutation M8 "$T_D22"

echo "== M9: a parse failure is 'judged' again, so it scores 0/0/0/0 =="
apply "$JUDGE" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding="utf-8").read()
old = "    return not axes.get(\"judge_error\")"
new = "    return True"
assert old in s, "M9 anchor missing"
open(p, "w", encoding="utf-8").write(s.replace(old, new, 1))
PY
run_mutation M9 "$T_D22"

echo "== M10: run_summary counts an ungraded question in the denominator =="
apply "$STORE" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding="utf-8").read()
old = '        " SUM(CASE WHEN judge_error IS NULL THEN 1 ELSE 0 END) AS graded,"'
new = '        " COUNT(*) AS graded,"'
assert old in s, "M10 anchor missing"
open(p, "w", encoding="utf-8").write(s.replace(old, new, 1))
PY
run_mutation M10 "$T_D22"

echo "== M11: the runner reports an ungraded question as a failure =="
apply "$RUNNER" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding="utf-8").read()
old = """            if not graded:
                ungraded.append({"id": q["id"], "reason": axes["judge_error"]})
            elif not passed:
                failed.append(q["id"])"""
new = """            if not graded:
                ungraded.append({"id": q["id"], "reason": axes["judge_error"]})
                failed.append(q["id"])
            elif not passed:
                failed.append(q["id"])"""
assert old in s, "M11 anchor missing"
open(p, "w", encoding="utf-8").write(s.replace(old, new, 1))
PY
run_mutation M11 "$T_D22"

echo "== M12: the gate folds an ungraded run back into 'failed' =="
apply "$GOLDEN" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding="utf-8").read()
old = '    return {"failed": bool(reasons), "errored": bool(errors),'
new = '    return {"failed": bool(reasons) or bool(errors), "errored": bool(errors),'
assert old in s, "M12 anchor missing"
open(p, "w", encoding="utf-8").write(s.replace(old, new, 1))
PY
run_mutation M12 "$T_D22"

# ── CONTROL B ────────────────────────────────────────────────────────────────
echo
echo "== CONTROL B: every artifact restored, suite green again =="
restore
python -m pytest $ALL -q --no-header -p no:randomly > "$LOG" 2>&1
rcb=$?
echo "CONTROL B exit=$rcb"
[ "$rcb" -ne 0 ] && tail -30 "$LOG"

echo
echo "KILLED=$killed  SURVIVED=$survived  BROKEN=$broken  CONTROL_B=$rcb"
rm -rf "$WORK"
[ "$survived" -eq 0 ] && [ "$broken" -eq 0 ] && [ "$rcb" -eq 0 ]
