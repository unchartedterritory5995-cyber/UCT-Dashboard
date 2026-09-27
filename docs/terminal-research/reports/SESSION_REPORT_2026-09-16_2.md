# SESSION REPORT — 2026-09-16, session 2

**F-SIGN-5 is closed, the replay says CLEAN 46 of 46, and the pre-sitting block reads READY.
The prescribed fix was degenerate — measuring it first saved a history rewrite and a
force-push.**

---

## 1 · ET, trees, gate-box lock, poll log

```
ET start   2026-09-16 00:36 EDT Wed   (tools/weekly_exec.py et)
ET end     2026-09-16 01:58 EDT Wed
docs   terminal-research   044dcc4e5 -> 2f9288afd   (2 commits, pushed below)
code   feat/s7-price-level e703af0a8   UNCHANGED — no rewrite, no force-push
gate-box lock   no lock file present; no local vitest was run and none was needed
poll log        none — no code commit was made, so no CI run was triggered
rows 50 -> 51 | constraints 44 -> 45 | pushing units 41 | universe 46 (unchanged)
```

## 2 · S5 — F-SIGN-5, and the premise correction that shrank it

⚠️ **The by-file split is degenerate, and `--name-status` says so before any planning:**

```
git show --name-status --format= 76a3b98c2
  M  app/src/pages/ThemeTrackerPage.flagkey.test.jsx
path count: 1
files in 76a3b98c2 that are NOT the F-S2-1 file: 0
```

The commit touches **exactly one file, and it is the F-S2-1-created file.** Commit A — "all
other hunks" — would be **empty**. So the split reduces to a **re-attribution**.

⭐ **That is the cheaper answer and the safer one.** It needs no rewrite of
`feat/s7-price-level`, no `--force-with-lease`, and the commit universe stays **46** rather
than growing to 47. The tree-equality proofs the prompt asked for are vacuous when no tree
changes — and a rebase producing an identical tree is still a rebase of the branch this
programme's CI runs against.

**The dependency, measured:**

```
0ef787268  CREATES  app/src/pages/ThemeTrackerPage.flagkey.test.jsx   (F-S2-1)
76a3b98c2  MODIFIES that file, and nothing else                       (was packet-t's)
origin/master: ABSENT     git cat-file -e -> miss
               positive control on app/src/pages/ThemeTrackerPage.jsx -> hit
```

**Rows:** `packet-t-stale-test-gate` keeps `7041a04a8` and loses `76a3b98c2`; a new row
**`t-cp2-build-record` (T CP2)** claims it and merges after F-S2-1.

**Collision proof, three sources:** packet-t's declared checkpoints read
`['CP1','CP2','D3 CP2','T CP1']` in **prose** mode (no table); build records on disk for the
packet: none (`t-cp*` absent); manifest rows naming a T checkpoint: one, `T-CP1`. A repo-wide
grep for `T-CP2` / `T CP2` / `t-cp2`: **zero hits.**

**Derived file set of the new row:**

```
app/src/pages/ThemeTrackerPage.flagkey.test.jsx   member-visible = False
member-visible files in T CP2: 0
control — member-visible files in 0ef787268 (F-S2-1): 3   <- the predicate can say yes
```

**Fingerprints:** `t-cp2-build-record` → `21c37a3bc` (new row). `k-cp9-build-record` →
`439dfc4a7` (new row). No existing packet was edited, so no fingerprint moved.

**Acceptance:** `--check-commits` **46 of 46, exit 0**; drift control **(51, 51)**;
`verify_manifest` **51 OK, 0 STALE**.

**S5.4 — the replay:** ✅ **CLEAN 46 of 46.**

## 3 · K9 — a dry run is a replay (K CP9)

`merge_all --dry-run` now clones the code repo to a throwaway, checks out `origin/master`,
cherry-picks every unit's commits in manifest order, and reports the first strand with its
position, row and conflicting files — deleting the clone in a `finally`, strand or not.
`replay CLEAN N of N` prints **before** the constraint line; the pair check is kept but
subordinate.

**Five controls:**

```
1  the real tree                    replay CLEAN 46 of 46                                 ok
2  F-SIGN-4's inversion restored     ⛔ STRAND at #12  e-cp6-build-record  0d7c55fb1
                                       conflicting: .github/workflows/full-suite-report.yml ok
3  F-SIGN-5's attribution restored   ⛔ STRAND at #44  packet-t-stale-test-gate  76a3b98c2
                                       conflicting: app/src/pages/ThemeTrackerPage.flagkey.test.jsx ok
4  member-visible row after #!last:  ORDER VIOLATION naming all three files                ok
5  an EMPTY manifest                 "ZERO units … nothing to replay", exit 0              ok
```

⭐ **Controls 2 and 3 are the two real incidents restored as fixtures** — the only rows that
prove the replay can fail, each naming the exact position and file the live strand named.

⛔ **A modify/delete conflict leaves no `UU` entry.** Without a fallback to `DU`/`UD`/`AU`/`UA`
from `git status --porcelain`, F-SIGN-5's strand reported `(unnamed)` — a strand you cannot
act on.

**`#!last:` by property:** `member_visible_files(stem)` derives each follower's file set;
**UNREADABLE is a third state** — a commit git cannot show is refused, never called clean.

**Timing table:** 51 rows, 41 pushing, 5.73 min each, **235.1 min** total.

## 4 · R4 — the pre-sitting block, and the sittings

```
VALIDATOR                           EXIT  RESULT
verify_manifest (fingerprints)         0  51 OK, 0 STALE
verify_manifest --check-commits        0  mapped: 46 of 46
merge_all --self-check (drift)         0  SELF-CHECK: PASS
verify_doc_shas                        0  every cited SHA resolves
audit_signature_regexes                0  every approval-block pattern is line-anchored
audit_scope_vs_checkpoints             1  EXPECTED-LEGACY: 4 packets, 0 manifest rows
sign_all --dry-run                     0  51 sign command(s), 0 skipped
merge_all --dry-run (REPLAY)           0  replay CLEAN 46 of 46
PRE-SITTING: READY  (8 validators, all green or explained)
```

**Control:** the real tree → READY; a **copy** of the manifest with one fingerprint zeroed →
**NOT-READY**, blocking line names `verify_manifest (fingerprints)`. ⛔ A copy, never the real
manifest.

**Sittings, derived:**

| | rows | `--until` | minutes |
|---|---|---|---|
| 1 | 1–15 | `e-cp9-build-record` | 74.5 |
| 2 | 16–28 | `e-cp22-build-record` | 74.5 |
| 3 | 29–49 | `d3-cp2-build-record` | 74.5 |
| 4 | 50–51 | `--include-member-visible` | 11.5 |

**The follower's arithmetic:** `t-cp2` is 1 pushing unit = **5.73 min**. In Sitting 4 it makes
that sitting 11.5 min; as a fifth sitting it costs a whole session for a **tests-only** row
that carries zero member-visible files by derivation. Placed in Sitting 4; splitting it
changes nothing else.

## 5 · Corrections to this prompt's premises

1. **"SPLIT 76a3b98c2 BY FILE"** — the commit spans one file, so the split is degenerate and
   the instruction's "all other hunks" set is empty. Done as a re-attribution.
2. **"rewrite feat's history … force-push with `--force-with-lease`"** — not performed, and
   not needed once (1) is measured. The branch is untouched at `e703af0a8`.
3. **"--check-commits: 47/47 (universe grew by one)"** — the universe did **not** grow. It is
   **46**, because no commit was created or split.

## 6 · Instrument self-reference and mutation-restore incidents

⛔ **One, and it was mine.** `pre_sitting.py`'s first run reported
`BLOCKER: for has a manifest row`. Its `UNNUMBERED\s+(\S+)` regex matched the audit's **prose**
— *"…so a third slice is UNNUMBERED for the same reason the first two are"* — took `for` as a
packet name, and then `p in manifest_text` substring-matched it. **CODE, NEVER PROSE**,
committed in a brand-new instrument on its first execution. Fixed by anchoring to the audit's
row format at line start, and by comparing against **derived manifest stems, exactly**.

⛔ **A second, in a control rather than a tool.** The old `"F-S2-1 NOT LAST: refuses"` row still
passed after `#!last:` was redefined — but on its fixture's `#!after:` clauses, not the `last`
rule, which no longer fires on synthetic stems because the rule is about files now. Caught by
**probing** it (`check_order(moved, [("last", S2, None)])` → `[]`), not by re-running it.

✅ **Zero mutation-restore incidents.** No `finally`-less mutation script was run this session;
the K9 controls construct fixtures instead of mutating files.

## 7 · Findings filed / closed

| id | finding | state |
|---|---|---|
| **F-SIGN-5** | `#!last:` as an ordinal contradicted packet-t's dependency on F-S2-1's commit | ✅ **CLOSED** — re-attributed to T CP2; `#!last:` redefined by property |
| **F-SIGN-8** | `merge_all --dry-run` described the merge instead of performing it; two orders satisfied every constraint and could not run | ✅ **FIXED, K CP9** |
| **F-SIGN-9** | a modify/delete strand reported no file names | ✅ **FIXED, K CP9** |
| **F-SIGN-10** | the `#!last:` control passed for the wrong reason after the rule was redefined | ✅ **FIXED** — replaced with four that can distinguish |
| **F-SIGN-11** | `pre_sitting`'s legacy-tagging matched prose and substring-matched the manifest | ✅ **FIXED** in the same session it was written |
| **F-SIGN-6** | validators not in a runnable list | ✅ **CLOSED** — `tools/pre_sitting.py` |
| **F-CI-42** | `nb_foreign_commits --self-check` asserts a property of the live repo, not of the tool | ⛔ **OPEN — Notebook-owned, untouched** |

## 8 · OPEN QUESTIONS

- **h14 / s10 / s12** carry signed lines naming no checkpoint and no manifest row. Numbering
  them is what turns `audit_scope_vs_checkpoints` green. Whose packets are they?
- **F-S2-1 strictly alone?** Sitting 4 currently holds it plus a tests-only follower. Split it
  if the "alone" property is meant literally.
- **E CP31's pyyaml rider** — a publisher fix rode on the split-attempt commit and was never
  reverted, so that row's scope is two things.
- **F-CI-42** goes green when `HEAD..origin/master` is empty, i.e. after Sitting 4 — but it
  will also go green on any branch that happens to be current, which is the vacuity.

## 9 · [KEYBOARD]

```
READY.

cd C:\Users\Patrick\uct-worktrees\terminal-research
set MERGE=C:\Users\Patrick\uct-worktrees\_merge-master
git -C %MERGE% checkout -B merge-run origin/master

# SITTING 1 — 74.5 min
python tools/pre_sitting.py --code-repo %MERGE%
python tools/sign_all.py  --manifest tools/sign_manifest.txt --until e-cp9-build-record
python tools/merge_all.py --manifest tools/sign_manifest.txt --until e-cp9-build-record --code-repo %MERGE%

# SITTING 2 — 74.5 min
python tools/pre_sitting.py --code-repo %MERGE%
python tools/sign_all.py  --manifest tools/sign_manifest.txt --until e-cp22-build-record
python tools/merge_all.py --manifest tools/sign_manifest.txt --until e-cp22-build-record --code-repo %MERGE%

# SITTING 3 — 74.5 min
python tools/pre_sitting.py --code-repo %MERGE%
python tools/sign_all.py  --manifest tools/sign_manifest.txt --until d3-cp2-build-record
python tools/merge_all.py --manifest tools/sign_manifest.txt --until d3-cp2-build-record --code-repo %MERGE%

# SITTING 4 — 11.5 min, the member-visible unit + the tests-only row that depends on it
python tools/pre_sitting.py --code-repo %MERGE%
python tools/sign_all.py  --manifest tools/sign_manifest.txt
python tools/merge_all.py --manifest tools/sign_manifest.txt --include-member-visible --code-repo %MERGE%
```

## 10 · Merge readiness

```
universe 46   covered 46   equal                                   ✅
replay        CLEAN 46 of 46                                       ✅
verify_manifest   51 OK, 0 STALE                                   ✅
reader states     51 UNSIGNED, 0 SIGNED, 0 MALFORMED
drift control     both directions empty, (51, 51)                  ✅
sign_all --dry-run  51 commands, 0 skipped, exit 0                 ✅
audits        signature_regexes 0 · doc_shas 0 · scope_vs_checkpoints 1
              (EXPECTED-LEGACY: 4 packets, 0 manifest rows — derived)
pre_sitting   READY
```

⛔ Nothing signed, nothing merged, nothing pushed to master. No deploys, no flag flips, no
wake-ups. `feat/s7-price-level` was not rewritten and not force-pushed.

## 11 · Three phone-readable sentences

**The fix you prescribed turned out to be degenerate, and measuring it first saved a history
rewrite** — the commit touches exactly one file, and it is the file in dispute, so it moved
whole to a new row that merges after the unit it depends on.

**The dry run now performs the merge instead of describing it**, which is the only thing that
could have caught either of the two orders that satisfied every constraint and still could
not run.

**Everything reads ready: the replay is clean end to end, eight validators pass in one
command, and the four sittings are derived rather than restated.**

## 12 · Status

STATUS: RAN
