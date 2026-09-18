---
id: e-cp37-build-record
unit: E CP37
packet: packet-e-ci-gap-gate
merges-after: E CP36
status: UNSIGNED
---

# E CP37 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner; delegated to the running Claude Code session, 2026-09-17)
APPROVED ON:      2026-09-18
APPROVED AT SHA:  99f53fb54
SCOPE APPROVED:   CP37 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> **E CP37 — `test_weekly_exec.py` still called a function E CP35 removed.**
> Scope is `tests/test_weekly_exec.py` **as enumerated by `git show --stat` of
> `e9741b9d4`.**

⛔ **Collision proof, three sources:** E's packet table declares **CP1–CP3**; build
records on disk top out at **e-cp36**; manifest rows top out at **CP36**. **CP37 free.**

⚠️ **Renumbered from the prompt's plan**, which used CP37 for the post-merge baseline
re-anchor (itself already renumbered twice — CP35 by the original plan, then CP36 by
E CP36's own precedent). That re-anchor becomes **E CP38**; this row is the one built
first, so it takes the free number, per the same rule E CP35 and E CP36 both set.

---

## 1 · A second real NEW failure on master's first full-suite run — attributable, not environmental

E CP36 fixed the missing-`PyYAML` collection abort (`verdict: COVERAGE_LOST` →
`NEW_FAILURES`, `missing 0`, `coverage_lost 0` on the re-run). The re-run's diff
(`35340953181` vs baseline `35008710335`) still showed **41 NEW** failures — most of
them attributable to OTHER concurrent workstreams' commits on master (unrelated
subsystems: `test_gate_box_lock`, `test_gitattributes_eol`, `test_secret_scrub`,
`test_mutation_harness_anchors`, `test_audit_sandbox_env`, `test_breadth_restore`,
`test_discord_render_*`, `test_bars_server_include_today`, `test_e2e_sandbox_guard`,
`test_flow_classification`, `test_shared_data_root_guard` — none touched by this
session's 48 merged units, out of scope to fix here).

**One of the 41 traced directly to this session's own E CP35, in scope to fix:**

```
FAILED tests/test_weekly_exec.py::test_the_push_window_is_decided_at_a_NAMED_instant[...]
  AttributeError: module 'weeklyexec' has no attribute 'push_window_closed'
```

`tools/weekly_exec.py`'s `push_window_closed` was REMOVED by E CP35 (replaced by
`window_authority_line()`, a fundamentally different derivation — file-tier text, not
a clock instant). `grep -n push_window_closed tools/weekly_exec.py` confirms it no
longer exists; `tests/test_weekly_exec.py` was never updated to match, so master's
first-ever CI run against this test file surfaced the AttributeError E CP35 should
have caught, and did not, because nothing had run this test against master before.

## 2 · The fix

Removed the stale parametrized test block (`test_the_push_window_is_decided_at_a_
NAMED_instant`, its `@pytest.mark.parametrize` table, and its now-obsolete
"the clock that lied" section header) and the `import pytest` line that block was the
only user of. Per this repo's own standing rule — stale tests are rewritten or
deleted, never left calling a removed symbol — and matching E CP35's own build record,
which already narrates `push_window_closed`'s removal as deliberate: this is not a new
finding about the removal, only about the test file nobody updated alongside it.

No new test was written for `window_authority_line()` — E CP35's own build record
already documents controls for it (real-runbook read, extra-tier fixture, no-runbook
fixture), and adding formal pytest coverage for a function that already has those
controls is a separate, larger scope than fixing the actual regression this unit
found: a test calling a symbol that no longer exists.

## 3 · Controls

```
grep -n push_window_closed tools/weekly_exec.py (before fix)   0 matches (confirms removal)
grep -n push_window_closed tests/test_weekly_exec.py (before)  1 match (the stale call)
python -m pytest tests/test_weekly_exec.py --collect-only -q   23 collected, 0 errors
python -m pytest tests/test_weekly_exec.py -q                  23 passed
grep -n "pytest\." tests/test_weekly_exec.py (after)            0 matches — import pytest
                                                                 correctly removed as dead
```

## 4 · Files

```
tests/test_weekly_exec.py   -20/+9 lines: removed the stale parametrized block and
                             its now-unused `import pytest`
```

## 5 · Validators

```
ast.parse                     OK
scoped pytest, full file      23 passed, 0 failed, 0 errors
```

## 6 · Drafted ledger row — NOT written

| 122 | `e9741b9d4` | 2026-09-18 | CI | 1 | E CP37: `tests/test_weekly_exec.py` still called `push_window_closed`, a function E CP35 removed when it replaced the hardcoded clock-based push-window rule with a file-tier derivation. The stale call surfaced as a real AttributeError on master's first-ever full-suite CI run — one of 41 NEW failures in that run's diff, and the only one this session's own merged units are responsible for; the rest trace to other concurrent workstreams' commits on master. Fixed by removing the stale test block per the standing rule that a test calling a removed symbol is rewritten or deleted, never left in place. |

## 7 · Drafted RESUME delta — NOT applied

- ⛔⛔ **Removing a function and updating its test are two edits, and E CP35 only
  made one.** The build record for a removal should name every test file that
  exercised the removed symbol, not just the production callers — a test suite
  that has never run against the target branch cannot surface the gap until it
  finally does.
- ⭐ **This is the SAME root shape as F-CI-46, one level up:** an instrument
  (this specific test file) could not report its own defect until a prerequisite
  (a real master CI run) existed to run it. Two sightings in one sitting is
  worth naming as a pattern, not two unrelated findings.
- ⚠️ **The remaining ~40 NEW failures in this run's diff are OUT OF SCOPE for
  this session** — they trace to `feat/inspector-finish`, `feat/notebook-kill-
  switch`, and the DC-2/DC-3 breadth-timing workstreams' own commits on master,
  none of which this session's 48 units touch. E CP38 (the baseline re-anchor)
  is a separate decision about whether to accept that wider, attributed diff or
  wait for those workstreams' own fixes — not something this session can force
  clean by fixing code it does not own.
