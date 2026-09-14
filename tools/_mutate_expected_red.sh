#!/usr/bin/env bash
# Mutation proof for the expected_red pairing rail.
#
# HARDENED 2026-09-14 after the first version shipped five defects. Each fix is
# labelled with the defect it closes so neither can be removed without noticing.
#
#   D1 path mangling   - paths cross into Python via ENV, never argv or a literal
#   D2 exit status     - set -euo pipefail; verdict computed from a matrix
#   D3 ambiguity       - "restore did not run" can never render as "rail failed"
#   D4 no cleanup      - trap EXIT/INT/TERM, idempotent
#   D5 wrong selection - tests named by NODE ID; -k silently selected the wrong set
#
set -euo pipefail

# ── D1: every path is Windows-native and travels by environment ───────────────
# ⛔ NOT set globally. Suppressing MSYS conversion for the whole script breaks
# every NATIVE binary that legitimately needs a POSIX path converted - `git -C
# /c/Users/...` fails with "cannot change to ... No such file or directory",
# which reads as a missing directory rather than as a path-conversion setting.
# Measured while hardening this very script. It is scoped per call site below.
export PYTHONIOENCODING=utf-8
NOCONV=(env MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*')

# ⛔ DERIVED, never hardcoded. A script carrying an absolute path to one
# worktree does its damage in a tree the operator never named on the command
# line - the defect this repo already carries in tools/_mutate_path_risks.sh:18.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_POSIX="$(git -C "$HERE" rev-parse --show-toplevel)"
export PROOF_REPO="$(cygpath -w "$REPO_POSIX")"
export PROOF_BASELINE_REL="docs/plans/joystick/gate-baseline.json"
PROOF_STATE_POSIX="${PROOF_STATE_POSIX:-${TMPDIR:-${TEMP:-/tmp}}/uct_expected_red_proof}"
mkdir -p "$PROOF_STATE_POSIX"
export PROOF_STATE="$(cygpath -w "$PROOF_STATE_POSIX")"
export PROOF_IO="$(cygpath -w "$HERE/_mutate_expected_red_io.py")"
export PROOF_SENTINEL="${PROOF_SENTINEL:-${PROOF_STATE}\capture.json}"

cd "$REPO_POSIX"

# ── D5: named by node id. `-k "expected_red or non_vacuity"` matched a
#        PRE-EXISTING unrelated test and MISSED one of the three, and the count
#        still came to 3 - right number, wrong set. ───────────────────────────
NODE_PAIR='tests/test_gate_shards.py::test_every_expected_red_entry_names_a_reason_and_what_it_waits_on'
NODE_ORPH='tests/test_gate_shards.py::test_a_reason_for_an_entry_that_is_not_declared_red_is_also_a_drift'
NODE_CTRL='tests/test_gate_shards.py::test_the_rail_can_fail_a_non_vacuity_control'

say() { printf '%s\n' "$*"; }
rule() { printf '%s\n' "────────────────────────────────────────────────────────────"; }

# ── D4: restore runs on success, failure and interrupt; idempotent ────────────
RESTORE_DONE=0
did_not_run_banner() {
  # D3: printed wherever a restore fails, so this condition can never arrive
  # silently and can never be mistaken for a rail result.
  say ""
  say "############################################################"
  say "### RESTORE DID NOT RUN                                  ###"
  say "### The tree may still be mutated. No restored-run result ###"
  say "### is printed, because a restore that did not happen and ###"
  say "### a rail that is broken must never look the same.       ###"
  say "############################################################"
}
restore() {
  [ "$RESTORE_DONE" = "1" ] && return 0     # idempotent
  RESTORE_DONE=1
  if ! "${NOCONV[@]}" python "${PROOF_IO}" restore; then
    did_not_run_banner
    return 1
  fi
}
on_exit() { local rc=$?; restore || rc=90; exit "$rc"; }
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

rule; say "CAPTURE"; rule
"${NOCONV[@]}" python "${PROOF_IO}" capture

rule; say "MUTATE  (strip the reason, keep the entry)"; rule
"${NOCONV[@]}" python "${PROOF_IO}" mutate

# TEST-ONLY fault-injection point. An interrupt handler cannot be tested without
# a deterministic window to interrupt, and the real runs are sub-second. Unset in
# every normal invocation; it does nothing unless explicitly exported.
if [ -n "${PROOF_TEST_PAUSE_AFTER_MUTATE:-}" ]; then
  say "  (test hook: holding mutated for ${PROOF_TEST_PAUSE_AFTER_MUTATE}s)"
  sleep "$PROOF_TEST_PAUSE_AFTER_MUTATE"
fi

rule; say "MUTATED RUN  - expect: ${NODE_PAIR##*::} FAILS, other two pass"; rule
set +e
python -m pytest "$NODE_PAIR" "$NODE_ORPH" "$NODE_CTRL" -q 2>&1 | tail -3
MUTATED_STATUS=${PIPESTATUS[0]}          # D2: captured immediately, own name
set -e
say "MUTATED RUN STATUS: ${MUTATED_STATUS}"

# ── D3: restore, then PROVE it happened, before any restored-run line exists ──
rule; say "RESTORE"; rule
RESTORE_OK=1
restore || RESTORE_OK=0

if [ "$RESTORE_OK" != "1" ]; then
  exit 3
fi

rule; say "RESTORED RUN  - expect: all three pass"; rule
set +e
python -m pytest "$NODE_PAIR" "$NODE_ORPH" "$NODE_CTRL" -q 2>&1 | tail -3
RESTORED_STATUS=${PIPESTATUS[0]}         # D2
set -e
say "RESTORED RUN STATUS: ${RESTORED_STATUS}"

# ── D2: the verdict is the matrix, and nothing after this decides it ──────────
rule; say "VERDICT"; rule
VERDICT=0
[ "$MUTATED_STATUS"  -ne 0 ] || { say "  FAIL: mutated run should have FAILED (got 0) - the rail does not fire"; VERDICT=1; }
[ "$RESTORED_STATUS" -eq 0 ] || { say "  FAIL: restored run should have PASSED (got $RESTORED_STATUS)"; VERDICT=1; }
"${NOCONV[@]}" python "${PROOF_IO}" verify_clean || VERDICT=1

if [ "$VERDICT" -eq 0 ]; then
  say "  PASS  mutated=${MUTATED_STATUS} (fires)  restored=${RESTORED_STATUS} (quiet)  tree clean"
else
  say "  PROOF FAILED"
fi

# informational only - must never be the last status-bearing statement (D2)
rule; say "tree (informational)"; rule
git status --porcelain -- "$PROOF_BASELINE_REL" || true

exit "$VERDICT"
