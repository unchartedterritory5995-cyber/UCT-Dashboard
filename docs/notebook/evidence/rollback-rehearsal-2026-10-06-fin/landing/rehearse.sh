#!/usr/bin/env bash
# Lane ROLLBACK, 2026-10-06. The local rehearsal of rolling the wave 12-15 landing back.
# No server is started. Run from the repository root of a CLEAN worktree on the landing branch:
#     bash docs/notebook/evidence/rollback-rehearsal-2026-10-06-fin/landing/rehearse.sh
# It builds the revert from objects, checks the two trees out in turn inside this worktree
# (a local branch that is never pushed, then a detached checkout), runs named test files only,
# and returns to the branch it started on. Every runner writes a log; the exit code of each is
# appended to results.txt before anything else runs.
set -u
E=docs/notebook/evidence/rollback-rehearsal-2026-10-06-fin/landing
# Where the logs go. They are TRACKED files now, and the script checks two other trees out in
# turn: writing them in place made the second checkout refuse ("local changes would be
# overwritten") once they had been committed. Point REHEARSAL_OUT at a directory outside the
# repository, then copy the logs into this folder when the run is back on its branch.
L=${REHEARSAL_OUT:-$E}
mkdir -p "$L"
START=$(git branch --show-current)
[ -n "$START" ] || { echo "not on a branch: refuse"; exit 2; }
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "tracked changes in the tree: refuse"; exit 2; }
R=$L/results.txt
: > "$R"
note() { echo "$*" | tee -a "$R"; }
run() {  # run <log name> <command...>
  local log="$L/$1.log"; shift
  "$@" > "$log" 2>&1; local code=$?
  note "exit $code  $(grep -E '^[0-9]+ (passed|failed)|^=+ .*(passed|failed|error)| passed| failed|Test Files|      Tests ' "$log" | sed 's/\x1b\[[0-9;]*m//g' | tail -2 | tr '\n' ' ')  <- $*"
}

note "landing tip (HEAD): $(git rev-parse HEAD) on $START"
python tools/notebook_rollback_chain.py --landing HEAD --pending --from origin/master > "$L/pending-revert-keeplist.jsonl"
note "tool exit $?"
RESULT=$(python -c "import json,sys; print([json.loads(l) for l in open(sys.argv[1], encoding='utf-8')][-1]['result'])" "$L/pending-revert-keeplist.jsonl")
BASE=$(python -c "import json,sys; print([json.loads(l) for l in open(sys.argv[1], encoding='utf-8')][-1]['base'])" "$L/pending-revert-keeplist.jsonl")
note "revert-with-keep-list commit: $RESULT   pre-landing base: $BASE"

note ""
note "== TREE A: the landing reverted WITH the keep-list =="
git switch -q -C rehearsal/w12-15-revert-keeplist "$RESULT" || { note "switch failed"; exit 2; }
note "checked out $(git rev-parse HEAD) tree $(git rev-parse HEAD^{tree})"
note "kept files vs the landing tip (must list nothing): [$(git diff --name-only "$START" HEAD -- api/services/journal_two/notebook_schema.py app/src/pages/journal-2-0/lib/notebookSchema.js tests/test_notebook_schema_guard.py app/src/pages/journal-2-0/lib/notebookSchema.rail.test.js api/services/journal_two/account_purge.py tests/test_journal_two_account_purge.py tests/test_notebook_rollback_never_revert.py docs tools scripts CLAUDE.md | tr '\n' ' ')]"
note "product files that differ from the pre-landing base (must list only the kept ones): [$(git diff --name-only "$BASE" HEAD -- api app/src | tr '\n' ' ')]"
note "landing modules on disk (must be none): [$(ls api/services/journal_two/chart_blocks.py api/services/journal_two/plan_grading.py api/services/journal_two/template_gallery.py 2>/dev/null | tr '\n' ' ')]"
run A1-kept-rails            python -m pytest tests/test_notebook_rollback_never_revert.py tests/test_notebook_schema_guard.py tests/test_journal_two_account_purge.py -q -p no:cacheprovider -W ignore
run A2-notes-save-load       python -m pytest api/services/journal_two/test_notes.py tests/test_notes_cas_is_atomic.py tests/test_notes_answer_is_the_committed_row.py tests/test_notes_unbuildable_body_refused.py tests/test_journal_two_notes_versions_router.py -q -p no:cacheprovider -W ignore
run A3-server-imports        python -m pytest tests/test_main_router_order.py -q -p no:cacheprovider -W ignore
run A4-ab-probe-keeplist     env EXPECT=keeplist python -m pytest "$E/test_ab_probe.py" -q -p no:cacheprovider -W ignore -s
( cd app && npx vitest run src/pages/journal-2-0/lib/notebookSchema.rail.test.js --maxWorkers=2 ) > "$L/A5-client-rail.log" 2>&1
note "exit $?  $(sed 's/\x1b\[[0-9;]*m//g' "$L/A5-client-rail.log" | grep -E 'Test Files|      Tests ' | tr '\n' ' ')  <- vitest notebookSchema.rail.test.js (kept rail, rolled-back editor)"
git switch -q "$START" || { note "could not return to $START"; exit 2; }

note ""
note "== TREE B: the landing reverted WHOLE (a plain git revert: the pre-landing tree) =="
git switch -q --detach "$BASE" || { note "switch failed"; exit 2; }
note "checked out $(git rev-parse HEAD) tree $(git rev-parse HEAD^{tree})"
run B1-ab-probe-whole        env EXPECT=whole python -m pytest "$E/test_ab_probe.py" -q -p no:cacheprovider -W ignore -s
run B2-ab-probe-keeplist-MUST-FAIL env EXPECT=keeplist python -m pytest "$E/test_ab_probe.py" -q -p no:cacheprovider -W ignore -s
git switch -q "$START" || { note "could not return to $START"; exit 2; }
note ""
note "back on $(git branch --show-current) at $(git rev-parse HEAD); tracked changes: [$(git status --porcelain --untracked-files=no | tr '\n' ' ')]"
grep -h "AB-PROBE" "$L"/A4-ab-probe-keeplist.log "$L"/B1-ab-probe-whole.log | sed 's/^\.*//' | tee -a "$R"
