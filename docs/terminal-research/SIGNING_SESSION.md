# SIGNING SESSION — the runbook

**44 units.** Three sittings, two commands each. Both tools are **resumable**: an
interruption costs a re-run, not a manifest edit.

⛔ **Read the table `sign_all` prints before it writes anything.** That table, not this
file, is the thing you are approving.

---

## ⛔⛔ READ THIS BEFORE SITTING 1 — F-SIGN-1, ELEVEN COMMITS WOULD NOT LAND

**Eleven commits on `feat/s7-price-level` are claimed by no unit in `merge_all.UNITS`.** If
you run all three sittings today, every one of the 44 units signs and merges, the session
reports success, and **none of these reaches master**:

```
ce615a2eb  E CP25: F-CI-30 — the flaky set is DERIVED from the record
e02dca955  F-CI-29: the parity lane ran NOTHING in CI — subprocess(LIST, shell=True)
16027f239  Run #23 scored: pyyaml for the publisher, tests-05 SPLIT not extended
4feaeb86f  REVERT the shard split: 41 NEW failures. ROOT_BUCKETS 12 -> 8
8c39c4c28  F-CI-30: a file the SUITE INVOKES is test-affecting
8a8ebe0ab  E CP26: promote the gate job
4274e26cc  F-CI-32: full history on every job
240bb3305  F-CI-36: the leaked dependency override
5a58d91cf  E CP27: ROOT_BUCKETS 12 — the shard split, second attempt
304ac481c  E CP28: no test may leave a dependency override on the shared app
e703af0a8  E CP29: COVERAGE_LOST
```

**Cause:** `E CP26`–`E CP29` are recorded in `UNITS` as `[], # docs worktree only`. They are
not. Each has a real commit in the code repo, and four findings-fixes are unattributed
entirely. Derive it yourself — it is four lines, and it is **not** a list to be trusted from
this file:

```python
import sys; sys.path.insert(0, "tools"); import merge_all as M, subprocess
CODE = str(M.DEFAULT_CODE_REPO)
g = lambda *a: subprocess.run(["git","-C",CODE,*a],capture_output=True,text=True,encoding="utf-8").stdout.strip()
ahead   = [l.split()[1] for l in g("cherry","origin/master","feat/s7-price-level").splitlines() if l.startswith("+")]
claimed = {g("rev-parse",c) for _,cs,_ in M.UNITS for c in cs}
print([c[:9] for c in ahead if c not in claimed])     # want []
```

⛔ **Do not fix this by guessing.** Which unit owns `4feaeb86f` (a revert) or `16027f239`
(a scoring commit) is a decision about what master should contain, not a mechanical
attribution. **Attribute them deliberately, then re-run the snippet until it prints `[]`.**

⭐ Why it was invisible: `UNITS` and `sign_manifest.txt` are two hand-maintained lists, and
until K CP7 nothing compared them at all. K CP7 closed the *membership* half (a row in one
and not the other now fails by name). **This is the other half — a unit that is present and
empty — and it is still open.**

---

## ⛔ ONE THING FIRST, OR EVERY MERGE FAILS

The merge worktree must be **at master**, and you must **tell the tool which worktree that
is**:

```
git -C C:\Users\Patrick\uct-worktrees\_merge-master checkout -B merge-run origin/master
```

⛔⛔ **`cd` DOES NOT STEER `merge_all` — the `--code-repo` flag does (K CP7).** Before K CP7
the tool resolved its target from `__file__`, so it printed a byte-identical refusal whether
you stood in the master checkout or the feature worktree, and its remedy named
`s7-price-level` — i.e. it told you to move the branch holding this programme's own work
onto master. **Pass the path. Every command below does.**

`merge_all` cherry-picks onto whatever that worktree has checked out. `s7-price-level` sits
on `feat/s7-price-level`, which already **contains** every unit commit — so each cherry-pick
there would be EMPTY, exit 1, and leave `.git/CHERRY_PICK_HEAD` behind, on unit 1. The tool
refuses, names the repo it actually used, and will not move your HEAD for you.

---

## The three sittings

| | rows | ends at | `--until` | minutes |
|---|---|---|---|---|
| **1** | 1–17 | `e-cp12-build-record` | `--until e-cp12-build-record` | **86.0** |
| **2** | 18–43 | `d3-cp2-build-record` | `--until d3-cp2-build-record` | **86.0** |
| **3** | 44 | `s2-accelerator-chord…` | `--include-member-visible` | **5.7** |

```
cd C:\Users\Patrick\uct-worktrees\terminal-research
set MERGE=C:\Users\Patrick\uct-worktrees\_merge-master

# SITTING 1  — 86.0 min
python tools/sign_all.py  --dry-run --until e-cp12-build-record
python tools/sign_all.py            --until e-cp12-build-record
python tools/merge_all.py --dry-run --until e-cp12-build-record --code-repo %MERGE%
python tools/merge_all.py           --until e-cp12-build-record --code-repo %MERGE%

# SITTING 2  — 86.0 min
python tools/sign_all.py  --dry-run --until d3-cp2-build-record
python tools/sign_all.py            --until d3-cp2-build-record
python tools/merge_all.py --dry-run --until d3-cp2-build-record --code-repo %MERGE%
python tools/merge_all.py           --until d3-cp2-build-record --code-repo %MERGE%

# SITTING 3  — 5.7 min, the ONE member-visible unit, alone and deliberate
python tools/sign_all.py
python tools/merge_all.py --include-member-visible --code-repo %MERGE%
```

⭐ **Check the first line of every `merge_all` run.** It now announces its target, and says
when it is falling back to the default:

```
[merge-all] code repo: C:\Users\Patrick\uct-worktrees\_merge-master
[merge-all] code repo: C:\Users\Patrick\uct-worktrees\s7-price-level   (default — no --code-repo given)
```

**The arithmetic, because the split is not arbitrary.** **31 of 44** units push to master;
each costs ~8 s of cherry-pick and push + a **186 s** build + the guard's **150 s** settle =
**5.73 min**. Total **177.7 min**. ⛔ **Two sittings cannot both be ≤ 90 min** — with
F-S2-1 held back, the remaining 172.0 min splits **86.0 / 86.0**, and both are under. That
is why there are three. *(13 units are docs-only and cost nothing — see F-SIGN-1 above,
because four of those thirteen should not be.)*

⛔ **Sitting 3 is the only member-visible change**: Ctrl/Cmd/Alt+Shift+F stops flagging
tickers on three screens (plain Shift+F is unchanged). It is alone on purpose, and it needs
`--include-member-visible` — without that flag `merge_all` stops before it and says so.

## If it stops — the resume

**Re-run the same command. Nothing else.**

- `sign_all` verifies each already-signed row (the manifest's value must be on the packet
  **and** re-derive from it), prints `SIGNED-ALREADY`, and skips it.
- `merge_all` asks **master**, by patch id (`git cherry`), and skips what is equivalent
  upstream — not the manifest, not a local branch, not a state file. ⚠️ Cherry-pick rewrites
  the commit, so the original sha is never an *ancestor* of master; `--is-ancestor` gets this
  wrong and `git cherry` gets it right. Measured, twice (see the control below).
- If the run died between a push and its settle, the next run **waits once on master's
  current tip** before pushing anything new — otherwise the Layer-0 guard would refuse.
- ⛔ **One case needs a hand:** a *failed* cherry-pick leaves the worktree mid-pick. The tool
  says so and names the fix, in **the repo it was actually pointed at**:
  `git -C <that repo> cherry-pick --abort`.

## If the guard REFUSES

```
[pre-push] ⛔ REFUSING THE PUSH. One master merge at a time, repo-wide.
```

**That is the guard working.** Another session's deploy is in flight, or the last one is
younger than its 150 s settle. **Stop, wait, re-run the same command** — do not override, do
not `--no-verify`. Expect at least one refusal: 8+ web deployments landed from other
sessions in one 2.5 h window on 2026-09-15.

The guard **cannot hang** (one read, one decision, no loop), applies to `master`/`main`
**only**, and does not care what is in your diff: a docs-only commit still builds the web
service (`a4e845fe7` reached SUCCESS ~186 s after `createdAt`).

⛔ **DO NOT `git checkout` A PACKET MID-SESSION.** `core.autocrlf=true` and `.gitattributes`
says nothing about `docs/**/*.md`, so a checked-out packet comes back **CRLF** and
`sign_gate`'s blank-field pattern cannot consume the `\r` — it refuses with *"no UNSIGNED
`APPROVED AT SHA:` line"*. It fails CLOSED, and it would still stop you.

## ⚠️ Decisions left

1. **F-SIGN-1 above** — attribute the eleven commits, or accept that the CI work stays on
   the branch. This is the one that changes what master contains.
2. **How long is too long?** 178 min over three sittings bends no rule. Batching N
   consecutive units into one push would turn 31 builds into 31/N — at N=4 the whole thing is
   ~45 minutes — but it bends *"ONE UNIT AT A TIME, AND IT WAITS"*, written after 2026-09-12
   when two merges four minutes apart marked the first deploy REMOVED and `/api/health`
   served 502 for ~45 s. What you lose is revert granularity: a bad batch reverts as a batch.
   **Three sittings costs no rule at all.**

*(The blank-scope defect that was on this list is FIXED — K CP6. Every signature now carries
a scope naming a checkpoint the packet declares, and refuses when it cannot.)*

---

## Controls, as run (2026-09-15)

```
SCOPE (K6.2)
  1  packet declaring CP1,CP2, scope "CP2 ONLY — …"  -> exit 0, written verbatim
  2  a BLANK scope                                   -> exit 2, sha256 UNCHANGED
  3  a scope naming CP9 (undeclared)                 -> exit 3, sha256 UNCHANGED
  4  a signed block with a blank scope               -> reader MALFORMED
  5  a signed block WITH a scope                     -> reader SIGNED (non-vacuity)

THE CODE REPO IS AN ARGUMENT (K CP7)
  no --code-repo                     -> the DEFAULT, unchanged
  --code-repo <master checkout>      -> that path, and NOT the default (non-vacuity)
  --code-repo <typo>                 -> REFUSED by name, exit 2
  an existing NON-worktree directory -> REFUSED "not a git work tree"
  a real work tree                   -> ACCEPTED (the refusal is not blanket)
  UNITS vs manifest, BOTH directions -> [] and [], lengths (44, 44)

RESUME / MERGED-STATE (R3.2, throwaway repo, master moved independently first)
  unit 1  original 0c90c0df3  -> on master as 956f35ed1   DIFFERENT
  unit 2  original 2802726fa  -> on master as ea6317da5   DIFFERENT
  --is-ancestor  wrong on 2 of 3 units      git cherry  wrong on 0 of 3
  ⭐ the two primitives DISAGREE — a fixture where they agree proves nothing, and that
    is exactly the fixture that cleared --is-ancestor in K CP5
```

## Validators, last run 2026-09-16

```
sign_gate --self-check   PASS
sign_all  --dry-run      44 sign command(s), 0 skipped, exit 0
merge_all --self-check   PASS, exit 0 (13 K CP7 rows)
merge_all --dry-run      44 of 44 units, 36 constraints SATISFIED
R3.2 resume control      PASS, exit 0
```

⚠️ **Measure exit codes directly, never after a pipe.** `cmd | tail` reports **tail's**
status: on 2026-09-15 that made two audits that exit **1** read as exit 0, and a section of
a session report was written on the false reading.
