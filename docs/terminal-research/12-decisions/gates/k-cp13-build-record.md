---
id: k-cp13-build-record
unit: K CP13
packet: packet-k-two-command-signing-gate
merges-after: K CP15
status: SIGNED (K CP13, fingerprint 83651c95e)
---

# K CP13 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick
APPROVED ON:      2026-09-17
APPROVED AT SHA:  83651c95e
SCOPE APPROVED:   CP13 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> **K CP13 — the merge engine cannot crash on `railway`, always consults merged state, and
> gains `--batch`/`--resume-signed` under R-BATCH/R-RESUME-SIGNED.** Scope is
> `tools/merge_all.py` **as enumerated by `git show --stat` of this unit's commit** (shared
> with K CP15 — see that record's §4).

⛔ **Collision proof:** K's packet table declares CP1–CP2; build records top out at k-cp15
(this session); manifest rows top out at CP15. **CP13 free**, built LAST per the owner's
explicit build order (CP14 → CP15 → CP13), since this checkpoint's `--batch` depends on
CP15's derivation.

---

## 1 · ⛔⛔ F-DEPLOY-1 — THE STOP THAT ENDED SESSION 7

Unit 1 merged at 23:22Z. `merge_all` then died:

```
File "tools/merge_all.py", line 830, in wait_for_deploy
  rc, out = run(["railway", "deployment", "list", "--service", "web", "--json"], ...)
FileNotFoundError: [WinError 2] The system cannot find the file specified
```

`run()` handed the bare string `"railway"` to `subprocess.run`. On Windows the CLI is an npm
shim (`AppData/Roaming/npm/railway.CMD`) that `CreateProcess` cannot resolve without help.
`pre_push_guard._railway()`, in this SAME repository, already carries the fix and the lesson
(`shutil.which`, never `shell=True`) — it had not been adopted here.

**Consequence: the engine could merge at most one unit per invocation.** Cold start: one
successful push, then a crash. Every resume: `skipped_any` fires the RESUMED SETTLE, which
crashed BEFORE any push at all. `--dry-run` returns early from `wait_for_deploy`, so this was
invisible to five sessions of "replay CLEAN."

## 2 · The fix — four parts

**(a) One resolver, used everywhere.** `_resolve_bin(name)` — `shutil.which`, cached — and
`run()` routes every subprocess call through it, catching `OSError` and returning `(1, reason)`
instead of raising. Every `git` and `railway` call in this file gets the fix for free, not
just the one that happened to crash first.

**(b) `wait_for_deploy` cannot crash, and `--dry-run` now PROVES the resolver works.** The
dry-run branch used to `return True` before calling `run()` at all; it now makes the REAL
(read-only) `deployment list` call and reports success or failure, without gating the dry
run's exit on it. Measured: `railway resolved to …\railway.CMD; the real deployment-list call
succeeded, 92693 byte(s)`. A real (non-dry) failure now retries rather than crashing. It also
short-circuits the settle sleep when the deploy source already shows the tip SUCCESS for
`>= SETTLE_SECONDS` — a resume long after the fact no longer pays a second 150s sleep on top
of one it already paid.

**(c) `replay()` consults merged state (closes F-RESUME-1).** `_cherry_says_merged(base, sha,
repo)` — one implementation, shared by `merged_into_master()` (the live per-unit push loop,
refactored onto it) and `replay()` (the preview) — answers "is this patch already
equivalent-upstream" before a pick is attempted. An already-merged unit is SKIPPED, not
stranded. The CLEAN line now reads `CLEAN N picked, M already merged, of TOTAL`.

**(d/e) `--resume-signed` and `--batch`.** `_check_resume_signed(stem, manifest)` is an
explicit, PRINTED, LOGGED (`docs/terminal-research/resume_log.txt`) pre-flight confirming a
named row's three R-RESUME-SIGNED conditions before the ordinary loop proceeds — auditable,
not implicit. `--batch` accumulates consecutive rows whose `member_visible_files()` (K CP15)
is empty into one pending list, cherry-picking each (still signed immediately before its own
pick, K CP10 unchanged) without pushing; a member-visible row, a refusal, or the end of
`units` flushes the batch as ONE push. `_push_with_attest` implements R-ATTEST: on a BURST
refusal specifically (`_is_burst_refusal`, matched against the exact live strings observed
2026-09-17) it sets `UCT_BURST_ATTESTED_BY`/`_AT`, logs the attestation
(`docs/terminal-research/attestation.log`, with the deployment list read at that moment) and
retries ONCE, then clears the env immediately — RECENCY and BUILDING refusals are never
attested. `_print_guard_clauses` prints the PUSHING repo's own `pre_push_guard.py` path, line
count, and parsed constants before every push.

## 3 · Controls

```
railway resolves via shutil.which, printed                                    ok (measured)
--dry-run's wait_for_deploy makes the REAL read-only call, proves the CLI works ok (measured)
replay() on the real (partly-merged) manifest: "CLEAN 45 picked, 3 already merged, of 48" ok
merged_into_master finds packet-c's commit equivalent-upstream to ANOTHER session's
  independent identical edit (669bde826) — real, not synthetic                 ok (measured)
_is_burst_refusal: the real BURST text -> True; RECENCY/BUILDING text -> False ok
--resume-signed on a fully-merged SIGNED row -> resumable; on an unknown stem -> refused ok
--dry-run --batch on the real Sitting-1 range: 3 already-merged rows skipped, 2 docs-only
  rows pass through untouched, 10 INSTRUMENT rows batch into ONE push, guard clauses
  printed (891 lines, parsed constants correct)                               ok (measured)
```

⚰️ **A real, non-synthetic finding surfaced by these controls, not invented for them:**
`packet-d-nav-tabs-gate`'s 3 commits ALSO read as already-merged mid-session — a concurrent
session sharing this worktree signed and landed rows 3–6 (packet-d, packet-b, packet-v,
s4-cp2-build-record) while this checkpoint was being built. Committed factually, separately,
never mixed into this checkpoint's own commit (see `c66fb6d4a`, `58b442de5`).

## 4 · Files

```
tools/merge_all.py   _resolve_bin, run() (hardened), wait_for_deploy (hardened, dry-run
                     exercises the real call), _iso_age_seconds, _cherry_says_merged (new,
                     shared), replay() (skip-merged), merged_into_master (refactored onto
                     the shared helper), _et_now_line, RESUME_LOG/ATTEST_LOG,
                     _check_resume_signed, _print_guard_clauses, _log_attestation,
                     _is_burst_refusal, _push_with_attest, _flush_batch, main() (batch/
                     resume-signed CLI flags + restructured per-row loop)
```

Shared commit with K CP15 (that record's §4 explains why).

## 5 · Validators

```
ast.parse                              OK
merge_all.py --self-check              PASS — every prior control plus the ones in §3
merge_all.py --dry-run (real manifest) CLEAN 45 picked, 3 already merged, of 48
merge_all.py --dry-run --batch --until e-cp9-build-record
                                       3 already-merged, 2 docs-only, 10 batched into ONE
                                       push, guard clauses printed correctly
```

## 6 · Drafted ledger row — NOT written

| — | *(docs-worktree only — see UNITS)* | 2026-09-17 | SIGNING | 1 | K CP13: `merge_all` could merge at most one unit per invocation — `subprocess.run(["railway",...])` cannot resolve the Windows npm shim, crashing `wait_for_deploy` after the first push and before every resume's push. Fixed with one `shutil.which` resolver used by every subprocess call, never raising. `replay()` now consults `git cherry` and skips already-merged units instead of stranding on an empty pick (F-RESUME-1). Adds `--resume-signed` (explicit, logged, three-check confirmation to resume a signed row) and `--batch` (R-BATCH: consecutive non-member-visible rows push together; a member-visible row pushes alone, via R-ATTEST's BURST-only, logged, single-retry attestation). |

## 7 · Drafted RESUME delta — NOT applied

- ⛔⛔ **A lesson fixed in one tool and not propagated to its sibling is a lesson that has
  not actually been learned by the programme, only by the file.** `pre_push_guard.py` had
  the `shutil.which` fix; `merge_all.py` did not, in the same repository, for the entire
  window this programme has been trying to merge.
- ⛔ **A dry run that returns before its own most consequential call is not a preview of
  that call.** `wait_for_deploy`'s old dry-run path proved this exactly: five sessions of
  green REPLAY sat on top of a defect that could only be found by actually pushing.
- ⭐ **A push guard's cadence is a property of the PUSHING repo, not the one you happen to be
  reading.** `_merge-master` (checked out at master) carried a 739-, then 891-line guard
  while the feature branch's copy stayed at 279 lines and had neither the BURST nor the
  RECENCY clause. Print the guard you are actually about to go through, every time.
