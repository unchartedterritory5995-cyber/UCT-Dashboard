# SESSION REPORT — 2026-09-16, session 1

**F-SIGN-1 is closed: 46 of 46 commits claimed. Two new defects were found underneath it —
one fixed, one an owner decision. The premise about `--check-commits` was wrong, and the
truth is worse.**

---

## 1 · ET, trees, poll log

```
ET start   2026-09-16 00:07 EDT Wed   (tools/weekly_exec.py et)
ET end     2026-09-16 01:12 EDT Wed
docs   terminal-research   70dca057d -> d80b884bb   3 commits   PUSHED: no (pending)
code   feat/s7-price-level e703af0a8   unchanged, origin agrees
gate-box lock   PRESENT (notebook-k, scripts/gate_shards.py --shards 6) -> no local vitest
manifest 44 -> 49 rows | constraints 36 -> 43 | UNITS 44 -> 49 | pushing units 31 -> 40
no CI runs polled: no code commit was made this session
```

## 2 · V — `--check-commits` was never broken. It stopped being run.

The brief said it *"must have been checking the manifest's own list against itself."*
**Measured before touching anything:**

```
[verify-manifest] commit coverage: origin/master..feat/s7-price-level
  commits on the branch : 46      mapped: 35 of 46
  ⛔ UNREFERENCED: e703af0a8  E CP29 …          (eleven lines, each with its subject)
exit=1
```

It derives its universe from `git log origin/master..feat` — exactly the rule — and has
been right since it was built. **The citation trail simply ends at session 2:**

```
SESSION_REPORT_2026-09-14_2   "first run, and not vacuous — 11 of 13 mapped, exit 1"
SESSION_REPORT_2026-09-15_1   "13 of 13 commits mapped, exit 0"   F-MERGE-1 CLOSED
SESSION_REPORT_2026-09-15_2   "19 of 19 commits mapped"
sessions 3,4,5,6,7            ← no citation. The flag appears nowhere.
```

Sessions 5–7 recorded `verify_manifest 40 OK, 0 STALE` — **the fingerprint check, a
different question** — and the eleven accumulated underneath. ⚰️ Session 2's own report even
named the mechanism: the check *"was run as `… | tail -10`"*, the pipe trap that also made
two exit-1 audits read as 0 in session 6. **Three false readings, one cause.**

### The two real defects (K CP8)

⛔ **"EXACTLY one" was never checked.** `claimed[sha] = stem` is a dict write, so a sha
claimed by two rows silently kept the last one and the printed arithmetic quietly stopped
closing. A commit cherry-picked twice makes the second pick EMPTY, exit 1, stranding the run.

⛔ **Base and tip were literals inside the function**, so the only fixture this check ever
had was production: demonstrable passing, never constructible failing.

**Four demanded controls, verbose, on the real units:**

```
1  the real tree              46 commits, 35 mapped, ELEVEN named            exit 1
2  a real CLONE + one orphan  47 commits, 35 mapped, TWELVE named            exit 1
     ⛔ UNREFERENCED: 0ceec3b60  AN ORPHAN nobody claims
3  a row claiming a sha twice ⛔ CLAIMED TWICE: 18dd13683 by `packet-a-absent-bound-gate`
                                AND `a-second-row-claiming-the-same-commit`  exit 1
4  every commit claimed       46 of 46                                       exit 0
```

Plus five self-check rows on a throwaway, including *"…and claiming it → exit 0 again"* —
which is what makes the orphan row mean something rather than being satisfied by a check
that is always red.

## 3 · A — the eleven, attributed

| sha | subject | files | decision |
|---|---|---|---|
| `ce615a2eb` | E CP25: F-CI-30, the derived flaky set | workflow, ci_inventory | **E CP25** — its own record |
| `8c39c4c28` | F-CI-30: a file the SUITE INVOKES | ci_inventory | **E CP25** — same finding, same file |
| `e02dca955` | F-CI-29: the parity lane ran nothing | test_ast_math_parity | **E CP30** PROPOSED |
| `16027f239` | Run #23 scored; ROOT_BUCKETS 8→12 | workflow, pytest_shards | **E CP31** PROPOSED — pair |
| `4feaeb86f` | REVERT the shard split, 12→8 | pytest_shards | **E CP31** PROPOSED — pair |
| `8a8ebe0ab` | E CP26: promote the gate job | workflow | **E CP26** — its own record |
| `4274e26cc` | F-CI-32: full history on every job | workflow | **E CP32** PROPOSED |
| `240bb3305` | F-CI-36: the leaked override | test_thesis_reviews_router | **E CP33** PROPOSED |
| `5a58d91cf` | E CP27: ROOT_BUCKETS 12, 2nd attempt | pytest_shards | **E CP27** — its own record |
| `304ac481c` | E CP28: the override-leak class fix | conftest | **E CP28** — its own record |
| `e703af0a8` | E CP29: COVERAGE_LOST | workflow, ci_inventory | **E CP29** — its own record |

⚠️ **The revert pair is behaviourally net-zero and textually not.** `ROOT_BUCKETS = 8`
before the pair and after it — measured on both sides. But **+24/−1 survives** in
`pytest_shards.py` (the comment block recording why 12 failed the first time, kept
deliberately) and **+10** in the workflow: a pyyaml publisher fix that rode along on
`16027f239` and was never reverted. The rule asked for net-zero proven by diff; the diff
says net-zero on behaviour and not on text, so that is what is recorded.

⛔ **E CP31 exists rather than folding the pair into E CP27** because `16027f239` is
chronologically earlier than E CP26's `8a8ebe0ab` and both touch the workflow — putting the
pair in E CP27's row inverts them and conflicts. The first attempt was never a checkpoint,
and no code reaches master without one.

**Acceptance:**

```
verify_manifest --check-commits   46 of 46, exit 0        ✅ F-SIGN-1 CLOSED
merge_all --self-check            (49, 49), both set differences empty
sign_all --dry-run                49 commands, 0 skipped, exit 0
merge_all --dry-run               49 of 49 units, 43 constraints SATISFIED, exit 0
```

## 4 · ⚰️ F-SIGN-4 — THE DECLARED ORDER WAS ALREADY UNEXECUTABLE

Replaying the **35 already-claimed** commits in declared row order, before any attribution
work, **stranded at unit 11**:

```
⛔ STRANDED at #12 0d7c55fb1  E CP6 — split the backend suite …
   CONFLICT (content): Merge conflict in .github/workflows/full-suite-report.yml
```

— while `merge_all --dry-run` printed *"all 36 constraint(s) SATISFIED"*, *"units: 44 of
44"*, and **exit 0**.

**Cause, one inversion:** `t2-cp1-build-record`'s commit is chronologically #14, its row sat
**last**, and E CP5 / E CP6 (#15, #16) edit the same workflow file. The `#!after:`
constraints check the relative order of *named pairs*; **nothing checked that the resulting
sequence actually applies.**

⛔ Fixed by moving that one row to its chronological slot plus a new
`#!after: e-cp5-build-record <- t2-cp1-build-record`. ⭐ **Found by replaying, not by
reading** — and a constraint set that is 100% satisfied is not evidence the merge runs.

## 5 · ⛔⛔ F-SIGN-5 — OPEN, AND IT IS YOURS

The full ordered list now cherry-picks **43 of 46** and strands:

```
STRANDED at commit #44  76a3b98c2   (unit `packet-t-stale-test-gate`)
  CONFLICT (modify/delete): app/src/pages/ThemeTrackerPage.flagkey.test.jsx
                            deleted in HEAD and modified in 76a3b98c2
```

| measured fact | |
|---|---|
| `0ef787268` **creates** that file | owned by **s2-accelerator-chord** (F-S2-1) |
| `76a3b98c2` **modifies** it, and touches nothing else | owned by **packet-t-stale-test-gate** |
| the file on `origin/master` | **absent** (`git cat-file -e`) |
| the manifest | `#!last: s2-accelerator-chord-pre-implementation-gate` |

**"F-S2-1 merges last, alone" and "packet-t's commit depends on F-S2-1's commit" cannot both
be true.** The three ways out — F-S2-1 stops being last; `76a3b98c2` re-attributes to
F-S2-1; or the dependency is broken by changing what lands — are all decisions about what
master should contain, so none was taken.

⭐ **Sittings 1 and 2 are provably clean.** `packet-t` is row **47 of 49**; every commit
before it replayed without conflict. The blocker is confined to Sitting 3.

## 6 · U — the two audits

```
                              before   after
audit_signature_regexes         0        0
verify_doc_shas                 1        0
audit_scope_vs_checkpoints      1        1
```

**`verify_doc_shas`** failed on four SHAs, every one an **illustrative placeholder inside a
worked example** — `deadbeef`, `c0ffee01`, `000000a1` (SESSION_REPORT_5's merged-state
example) and `deadbeefdeadbeef` (e-cp26's `railway deployment list` payload). All
NOT-LEGACY, none a citation. Closed the designed way: **declared in `QUOTED_DEAD` with
reasons**, not reworded and not by relaxing the audit — rewording them is how a worked
example stops demonstrating the thing it demonstrates. The allowlist's phantom-check still
fires (mutation: a bogus entry → exit 1).

**`audit_scope_vs_checkpoints`** stays at exit 1 on **7 signed lines across 4 packets**:

| packet | lines | tag |
|---|---|---|
| `intelligence-layer` | slices 1–3 | **EXPECTED-LEGACY** (section H) |
| `h14-placeholder-stop-unification` | 1 | NOT-LEGACY |
| `s10-presentation-primitives` | 1 | NOT-LEGACY |
| `s12-rollout` | 2 | NOT-LEGACY |

⭐ **None of those four packets has a row in this manifest** — measured, `grep -c` = 0 for
each — so none is signable or mergeable by this session. The audit is reporting on packets
outside it, and the audit itself names the remedy: *"closed by NUMBERING the packet, not by
re-signing it."*

⛔ **No `--legacy-before` flag was added.** It was authorised only if every failing line were
EXPECTED-LEGACY; three packets are not.

## 7 · Findings

| id | finding | state |
|---|---|---|
| **F-SIGN-1** | eleven commits claimed by no unit | ✅ **CLOSED** — 46 of 46, exit 0 |
| **F-SIGN-4** | the declared merge order was unexecutable; constraints check pairs, not the sequence | ✅ **FIXED** — row relocated + new constraint |
| **F-SIGN-5** | `#!last: F-S2-1` contradicts packet-t's dependency on F-S2-1's commit | ⛔ **OPEN — owner decision** |
| **F-SIGN-6** | `--check-commits` was correct and unrun for five sessions; not in any validator list | ✅ **FIXED** — now in the runbook's pre-sitting checks |
| **F-SIGN-7** | a sha claimed by two rows was a silent dict overwrite | ✅ **FIXED, K CP8** |
| **F-CI-42** | Notebook self-check asserts a property of the live repo | ⛔ **OPEN — Notebook** |

## 8 · OPEN QUESTIONS

- **F-SIGN-5**: which of the three resolutions? It decides whether the member-visible unit
  keeps its "alone and deliberate" property.
- **Sitting count**: attribution grew the wall time 178 → 229 min, so three sittings no
  longer fit under 90. Four at 74.5 / 74.5 / 74.5 / 5.7 — or bend the 90.
- **h14 / s10 / s12**: numbering those three packets closes the last audit. Not this
  session's packets; whose?
- **E CP31's pyyaml rider**: a publisher fix rode on the split-attempt commit and was never
  reverted. Fine as attributed, but it means one row's scope is two things.

## 9 · [KEYBOARD]

```
NOT READY.

Blocking item: F-SIGN-5 — packet-t's commit 76a3b98c2 modifies a file created by
F-S2-1's 0ef787268, while the manifest declares F-S2-1 last. The cherry-pick
proof reaches 43 of 46 and strands at #44.

Everything else is green:
  runbook snippet            []              (want [])
  verify_manifest --check-commits  46 of 46, exit 0
  sign_all  --dry-run        49 commands, 0 skipped, exit 0
  merge_all --dry-run        49 of 49, 43 constraints SATISFIED, exit 0
  verify_doc_shas            exit 0
  audit_signature_regexes    exit 0
  audit_scope_vs_checkpoints exit 1 — 7 lines, 4 packets, NONE with a manifest row

Sittings 1 and 2 are PROVABLY CLEAN (packet-t is row 47 of 49). If you want them
run before deciding F-SIGN-5, say so and they go — none of the three resolutions
changes what Sittings 1 or 2 contain.
```

## 10 · Merge readiness

```
universe 46   covered 46   equal ✅
cherry-pick proof   43 of 46 clean, strands at #44 (F-SIGN-5)     ⛔
verify_manifest     49 OK, 0 STALE
reader states       49 UNSIGNED, 0 SIGNED, 0 MALFORMED
drift control       UNITS vs manifest, both directions empty, (49, 49)  ✅
dry-runs            sign_all exit 0 · merge_all exit 0, 43 constraints
```

⛔ Nothing signed, nothing merged, nothing pushed to master. No deploys, no flag flips, no
wake-ups.

## 11 · Three phone-readable sentences

**The eleven are attributed and the coverage check reads 46 of 46** — four findings-fixes
that had no checkpoint now have one, and the first shard-split attempt is merged together
with its own revert rather than quietly dropped.

**The check that was supposed to catch this was never broken — it stopped being run after
session 2**, while a different check's "40 OK, 0 STALE" was recorded as though it answered
the same question.

**Replaying the merge instead of reading it found that the declared order could not run at
all**, stranding at unit 11 on a workflow conflict while every constraint reported
satisfied; that one is fixed, and a second contradiction near the end is yours to decide.

## 12 · Status

STATUS: STOPPED-NOTHING-READY
