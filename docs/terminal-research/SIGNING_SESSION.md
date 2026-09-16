# SIGNING SESSION — the runbook

**49 units. FOUR sittings**, two commands each. Both tools are **resumable**: an
interruption costs a re-run, not a manifest edit.

⛔ **Read the table `sign_all` prints before it writes anything.** That table, not this
file, is the thing you are approving.

---

## ⛔⛔ ONE BLOCKER IS OPEN — F-SIGN-5, AND IT IS AN OWNER DECISION

**The declared order cannot execute to the end.** Replayed onto a throwaway branch from
`origin/master`, the sequence cherry-picks **43 of 46 commits clean** and then strands:

```
STRANDED at commit #44  76a3b98c2   (unit `packet-t-stale-test-gate`)
  fix(docs): correct the ThemeTracker red's attribution
  CONFLICT (modify/delete): app/src/pages/ThemeTrackerPage.flagkey.test.jsx
                            deleted in HEAD and modified in 76a3b98c2
```

**The contradiction, in two measured facts:**

| | |
|---|---|
| `0ef787268` **creates** `ThemeTrackerPage.flagkey.test.jsx` | owned by **s2-accelerator-chord** (F-S2-1) |
| `76a3b98c2` **modifies** that same file | owned by **packet-t-stale-test-gate** |
| the manifest says | `#!last: s2-accelerator-chord-pre-implementation-gate` |

The file does not exist on `origin/master` — confirmed with `git cat-file -e` — so F-S2-1's
commit is the only thing that creates it. **"F-S2-1 merges last, alone" and "packet-t's
commit depends on F-S2-1's commit" cannot both be true.**

⛔ **This is not a mechanical fix and was not guessed at.** The three ways out are all
decisions about what master should contain:

1. **F-S2-1 stops being last** — the member-visible unit merges mid-list, giving up the
   "alone and deliberate" property it was given on purpose.
2. **`76a3b98c2` is re-attributed to F-S2-1** — it touches that one file and nothing else,
   so it *can* ride with the unit it depends on; but packet-t then merges without the fix
   that its own record describes.
3. **The pair is squashed or the dependency broken** — changing what lands, not just when.

⭐ **Sittings 1 and 2 are unaffected and provably clean.** `packet-t` is row **47 of 49**;
every commit before it replayed without conflict. The blocker lives in Sitting 3.

---

## ✅ F-SIGN-1 IS CLOSED — every commit is claimed

```
[verify-manifest] commit coverage: origin/master..feat/s7-price-level
  commits on the branch : 46      commits claimed by a unit: 46      mapped: 46 of 46
exit=0
```

The eleven orphans were attributed under the owner's rule. **E CP26–CP29 got their real
commits** (they were wrongly marked *"docs worktree only"*); **E CP25** took `ce615a2eb`
and its `8c39c4c28` follow-up; and four findings-fixes that had no packet were given
PROPOSED checkpoints, each with collision proof and its own row:

| new unit | commits | why |
|---|---|---|
| **E CP30** | `e02dca955` | F-CI-29 — the parity lane ran nothing in CI |
| **E CP31** | `16027f239` + `4feaeb86f` | the FIRST shard-split attempt **and its revert**, together |
| **E CP32** | `4274e26cc` | F-CI-32 — `fetch-depth: 0` on every job |
| **E CP33** | `240bb3305` | F-CI-36 — the leaked override, the instance that was measured |

⚠️ **E CP31's pair is behaviourally net-zero and textually not**, and that is stated rather
than smoothed over: `ROOT_BUCKETS = 8` before the pair and after it, but **+24/−1 survives**
in `pytest_shards.py` (the comment block recording why 12 failed the first time) and **+10**
in the workflow (a pyyaml publisher fix that rode along on the first commit and was never
reverted).

## ⚰️ F-SIGN-4 — THE DECLARED ORDER WAS ALREADY BROKEN, AND EVERY CHECK SAID OTHERWISE

Before any attribution work, replaying the **35 already-claimed** commits in declared row
order stranded at **unit 11** with a content conflict in the workflow file — while
`merge_all --dry-run` printed *"all constraints SATISFIED"*, *"units: 44 of 44"*, and
**exit 0**.

**Cause:** `t2-cp1-build-record`'s commit is chronologically #14, its row sat **last**, and
E CP5 / E CP6 (#15, #16) edit the same workflow file. The `#!after:` constraints check the
relative order of *named pairs*; nothing checked that the resulting **sequence actually
applies**.

⛔ **Fixed by moving that one row to its chronological slot** (after `e-cp4`), plus a new
`#!after: e-cp5-build-record <- t2-cp1-build-record` so the ordering is enforced rather than
incidental. ⭐ **Diagnosed by replaying, not by reading** — a declared order that satisfies
every constraint can still be unexecutable, and the only instrument that can tell you is a
cherry-pick onto a throwaway.

---

## ⛔ BEFORE SITTING 1 — the merge worktree, and how the tool is aimed

```
git -C C:\Users\Patrick\uct-worktrees\_merge-master checkout -B merge-run origin/master
```

⛔⛔ **`cd` DOES NOT STEER `merge_all` — the `--code-repo` flag does (K CP7).** Before
K CP7 the tool resolved its target from `__file__`, printed a byte-identical refusal from
either worktree, and its remedy named `s7-price-level` — i.e. it told you to move the branch
holding this programme's own work onto master. **Pass the path. Every command below does.**

## The four sittings

**229.3 min** total: **40 of 49** units push to master, each ~8 s of cherry-pick and push +
a **186 s** build + the guard's **150 s** settle = **5.73 min**. ⛔ Attribution grew this
from 178 min — nine commits that were never going to be merged now are — so **three
sittings no longer fit under 90 minutes**; the working rows split three ways at 74.5 each.

| | rows | ends at | `--until` | minutes |
|---|---|---|---|---|
| **1** | 1–15 | `e-cp9-build-record` | `--until e-cp9-build-record` | **74.5** |
| **2** | 16–28 | `e-cp22-build-record` | `--until e-cp22-build-record` | **74.5** |
| **3** | 29–48 | `d3-cp2-build-record` | `--until d3-cp2-build-record` | **74.5** ⛔ contains F-SIGN-5 |
| **4** | 49 | `s2-accelerator-chord…` | `--include-member-visible` | **5.7** |

```
cd C:\Users\Patrick\uct-worktrees\terminal-research
set MERGE=C:\Users\Patrick\uct-worktrees\_merge-master

# SITTING 1  — 74.5 min
python tools/sign_all.py  --dry-run --until e-cp9-build-record
python tools/sign_all.py            --until e-cp9-build-record
python tools/merge_all.py --dry-run --until e-cp9-build-record --code-repo %MERGE%
python tools/merge_all.py           --until e-cp9-build-record --code-repo %MERGE%

# SITTING 2  — 74.5 min
python tools/sign_all.py  --dry-run --until e-cp22-build-record
python tools/sign_all.py            --until e-cp22-build-record
python tools/merge_all.py --dry-run --until e-cp22-build-record --code-repo %MERGE%
python tools/merge_all.py           --until e-cp22-build-record --code-repo %MERGE%

# SITTING 3  — 74.5 min   ⛔ DO NOT START until F-SIGN-5 is decided
# SITTING 4  — 5.7 min, the ONE member-visible unit, alone and deliberate
```

⭐ **Check the first line of every `merge_all` run.** It announces its target and says when
it is falling back to the default.

## Before each sitting — the four checks, each read from the process

```
python tools/verify_manifest.py --check-commits     # 46 of 46, exit 0
python tools/merge_all.py --self-check              # UNITS vs manifest, both directions
python tools/sign_all.py  --dry-run                 # 49 commands, 0 skipped
python tools/merge_all.py --dry-run --code-repo %MERGE%
```

⛔ **`--check-commits` is on this list because leaving it off is how eleven commits went
unclaimed for five sessions.** It was built in session 2, was correct throughout, and simply
stopped being run — while the *fingerprint* check's "40 OK, 0 STALE" was recorded as though
it answered the same question.

⚠️ **Measure exit codes from the process, never after a pipe.** `cmd | tail` reports
**tail's** status: that made two exit-1 audits read as 0 in a session report, and it is how
`--check-commits` was mis-recorded before that.

**The commit-coverage snippet**, which must print `[]`:

```python
import sys; sys.path.insert(0, "tools"); import merge_all as M, subprocess
CODE = str(M.DEFAULT_CODE_REPO)
g = lambda *a: subprocess.run(["git","-C",CODE,*a],capture_output=True,text=True,encoding="utf-8").stdout.strip()
ahead   = [l.split()[1] for l in g("cherry","origin/master","feat/s7-price-level").splitlines() if l.startswith("+")]
claimed = {g("rev-parse",c) for _,cs,_ in M.UNITS for c in cs}
print([c[:9] for c in ahead if c not in claimed])     # want []
```

## If it stops — the resume

**Re-run the same command. Nothing else.**

- `sign_all` verifies each already-signed row and prints `SIGNED-ALREADY`.
- `merge_all` asks **master**, by patch id (`git cherry`), and skips what is equivalent
  upstream. ⚠️ Cherry-pick rewrites the commit, so the original sha is never an *ancestor*
  of master; `--is-ancestor` gets this wrong and `git cherry` gets it right — measured, with
  the differing shas printed.
- If the run died between a push and its settle, the next run **waits once on master's
  current tip** before pushing anything new.
- ⛔ A *failed* cherry-pick leaves the worktree mid-pick. The tool says so and names the fix
  **in the repo it was actually pointed at**: `git -C <that repo> cherry-pick --abort`.

## If the guard REFUSES

```
[pre-push] ⛔ REFUSING THE PUSH. One master merge at a time, repo-wide.
```

**That is the guard working.** Stop, wait, re-run the same command — do not override, do not
`--no-verify`. Expect at least one refusal.

⛔ **DO NOT `git checkout` A PACKET MID-SESSION.** `core.autocrlf=true` means a checked-out
packet comes back CRLF and `sign_gate` refuses it. It fails CLOSED, and it would still stop
you.

## The two approval audits — state before signing

```
audit_signature_regexes     exit 0
verify_doc_shas             exit 0   (4 illustrative placeholders now DECLARED in
                                      QUOTED_DEAD with reasons, not reworded; the
                                      phantom-check still fires — proved by mutation)
audit_scope_vs_checkpoints  exit 1   7 signed lines naming no checkpoint, across 4 packets
                                      h14-placeholder-stop-unification · intelligence-layer
                                      s10-presentation-primitives · s12-rollout
```

⭐ **None of those four packets has a row in this manifest**, so none is signable or
mergeable by this session — the audit is reporting on packets outside it. `intelligence-layer`
is EXPECTED-LEGACY under section H; the other three are NOT-LEGACY and are closed by
**numbering those packets**, which the audit itself says: *"closed by NUMBERING the packet,
not by re-signing it."*

⛔ **No `--legacy-before` flag was added.** It was authorised only if every failing line were
EXPECTED-LEGACY, and three packets are not.

---

## Validators, last run 2026-09-16

```
sign_gate --self-check          PASS          verify_manifest --self-check   PASS
verify_manifest --check-commits 46 of 46, exit 0
sign_all  --dry-run             49 commands, 0 skipped, exit 0
merge_all --self-check          PASS (UNITS vs manifest both directions, (49, 49))
merge_all --dry-run             49 of 49 units, 43 constraints SATISFIED, exit 0
cherry-pick proof               43 of 46 clean; strands at #44 — F-SIGN-5
R3.2 resume control             PASS (--is-ancestor wrong on 2 of 3, git cherry 0 of 3)
```
