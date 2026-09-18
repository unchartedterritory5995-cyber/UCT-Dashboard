---
id: e-cp28-build-record
unit: E CP28
packet: packet-e-ci-gap-gate
merges-after: E CP27
status: UNSIGNED
---

# E CP28 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick
APPROVED ON:      2026-09-17
APPROVED AT SHA:  72443be8b
SCOPE APPROVED:   CP28 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> **E CP28 — no test may leave a dependency override on the shared app.** Scope is
> `tests/conftest.py` **as enumerated by `git show --stat` of this unit's commit.**

⛔ **Collision proof, three sources:** E's packet table declares **CP1–CP3**; build records
on disk top out at **e-cp27**; manifest rows top out at **CP27**. **CP28 free.**

---

## 1 · The class, measured

F-CI-36 was one file. The class is not:

```
tests/** with comments and docstrings stripped:
  96 files install an override    51 clear one    1 restores one
  55 files do NEITHER
```

⛔ **Fixing 55 files one at a time leaves the 56th to be written tomorrow.** This makes the
cleanup structural: an autouse, function-scoped fixture in `tests/conftest.py` snapshots
`app.dependency_overrides` before each test and restores it after.

## 2 · Three decisions inside it, each with a reason

⛔ **RESTORE, never `.clear()`.** Another fixture may legitimately have installed an
override before this test; clearing would trade one leak for a different breakage.

⛔ **LAZY BY CONSTRUCTION.** It reads `sys.modules.get("api.main")` and never imports it.
Forcing the whole application to import for every test in the tree is exactly the
collection cost this repository has been OOM-killed by.

⭐ **Function-scoped is SAFE, and that was measured, not assumed.** **Zero** module-,
class-, package- or session-scoped fixtures under `tests/` touch `dependency_overrides` —
by AST, with a control confirming the same walk sees **77** non-function-scoped fixtures
overall. Nothing relies on an override surviving between tests.

## 3 · The mutation ladder, both diffs by EDIT

```
both fixes (per-file + class)          -> 62 passed
class fix ONLY (per-file fix removed)  -> 62 passed     <- the class fix holds alone
NEITHER fix                            -> 41 failed, 21 passed   <- the leak returns
```

⭐ **The middle rung is the one that proves the unit.** Without it, "the suite is green"
is explained perfectly by the per-file fix and this checkpoint would be decoration.

## 4 · Files

```
tests/conftest.py   one autouse fixture, `_no_test_leaks_a_dependency_override`
```

⛔ **The 96 writers are NOT touched.** A sweep that edited 96 test files to fix a property
the harness can guarantee is a sweep that has to be repeated.

## 5 · Validators

```
ast.parse                     OK
check_repo_hygiene            clean, no line-ending flip
the F-CI-36 reproduction      62 passed (both fixes) · 62 (class only) · 41 failed (neither)
```

## 6 · Drafted ledger row — NOT written

| 108 | *(this unit's commit — named in the session report)* | 2026-09-15 | CI | 1 | E CP28: an autouse fixture in `tests/conftest.py` restores `app.dependency_overrides` after every test, so no test can leak one regardless of whether it cleans up. 96 files install an override, 51 clear one, 55 do neither. It restores rather than clears (another fixture may own one), reads `sys.modules` rather than importing `api.main` (collection cost), and is safe function-scoped because zero non-function-scoped fixtures touch the mapping. Mutation-proved three ways: both fixes 62 passed, class fix alone 62 passed, neither 41 failed. |

## 7 · Drafted RESUME delta — NOT applied

- ⛔ **When one file leaks, count the class before fixing the file.** 96 writers, 51
  clearers — the file was the instance, not the problem.
- ⛔ **A harness guarantee beats 55 edits**, and cannot be forgotten by the 56th test.
- ⭐ **The middle mutation rung is the unit's proof**: remove the per-file fix and the
  class fix must still hold, or the checkpoint is decoration.
