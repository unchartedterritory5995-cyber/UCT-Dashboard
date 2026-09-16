# SIGNING SESSION — the runbook

**40 units.** Three sittings, two commands each. Both tools are **resumable**: an
interruption costs a re-run, not a manifest edit.

⛔ **Read the table `sign_all` prints before it writes anything.** That table, not this
file, is the thing you are approving.

---

## ⛔ ONE THING FIRST, OR EVERY MERGE FAILS

The merge worktree must be **at master**. It is not:

```
git -C C:\Users\Patrick\uct-worktrees\s7-price-level checkout -B merge-run origin/master
```

`merge_all` cherry-picks onto whatever is checked out. `s7-price-level` sits on
`feat/s7-price-level`, which already **contains** every unit commit — so each cherry-pick
would be EMPTY, exit 1, and leave `.git/CHERRY_PICK_HEAD` behind, on unit 1. The tool now
refuses and prints this command; it will not move your HEAD for you.

---

## The three sittings

| | rows | ends at | commands | minutes |
|---|---|---|---|---|
| **1** | 1–17 | `e-cp12-build-record` | `--until e-cp12-build-record` | **86.1** |
| **2** | 18–39 | `d3-cp2-build-record` | `--until d3-cp2-build-record` | **86.4** |
| **3** | 40 | `s2-accelerator-chord…` | `--include-member-visible` | **5.7** |

```
cd C:\Users\Patrick\uct-worktrees\terminal-research

# SITTING 1  — 86.1 min
python tools/sign_all.py  --manifest tools/sign_manifest.txt --dry-run --until e-cp12-build-record
python tools/sign_all.py  --manifest tools/sign_manifest.txt           --until e-cp12-build-record
python tools/merge_all.py --manifest tools/sign_manifest.txt --dry-run --until e-cp12-build-record
python tools/merge_all.py --manifest tools/sign_manifest.txt           --until e-cp12-build-record

# SITTING 2  — 86.4 min
python tools/sign_all.py  --manifest tools/sign_manifest.txt --dry-run --until d3-cp2-build-record
python tools/sign_all.py  --manifest tools/sign_manifest.txt           --until d3-cp2-build-record
python tools/merge_all.py --manifest tools/sign_manifest.txt --dry-run --until d3-cp2-build-record
python tools/merge_all.py --manifest tools/sign_manifest.txt           --until d3-cp2-build-record

# SITTING 3  — 5.7 min, the ONE member-visible unit, alone and deliberate
python tools/sign_all.py  --manifest tools/sign_manifest.txt
python tools/merge_all.py --manifest tools/sign_manifest.txt --include-member-visible
```

**The arithmetic, because the split is not arbitrary.** 31 of 40 units push to master; each
costs ~8 s of cherry-pick and push + a **186 s** build + the guard's **150 s** settle =
**5.73 min**. Total **178.3 min**. ⛔ **Two sittings cannot both be ≤ 90 min** — the best
possible balance is 91.9 / 86.4, and 91.9 is over. With **F-S2-1 in a sitting of its own**
the remaining 172.5 min splits **86.1 / 86.4**, and both are under. That is why there are
three.

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
  wrong and `git cherry` gets it right. Measured.
- If the run died between a push and its settle, the next run **waits once on master's
  current tip** before pushing anything new — otherwise the Layer-0 guard would refuse.
- ⛔ **One case needs a hand:** a *failed* cherry-pick leaves the worktree mid-pick. The tool
  says so and names the fix:
  `git -C C:\Users\Patrick\uct-worktrees\s7-price-level cherry-pick --abort`.

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
`APPROVED AT SHA:` line"*. It fails CLOSED, and it would still stop you. All 40 manifest
packets are LF today; 19 other gate packets in that directory are already CRLF.

## ⚠️ One decision left

**How long is too long?** 178 min over three sittings bends no rule. Batching N consecutive
units into one push would turn 31 builds into 31/N — at N=4 the whole thing is ~45 minutes —
but it bends *"ONE UNIT AT A TIME, AND IT WAITS"*, written after 2026-09-12 when two merges
four minutes apart marked the first deploy REMOVED and `/api/health` served 502 for ~45 s.
What you lose is revert granularity: a bad batch reverts as a batch. **Three sittings costs
no rule at all.**

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
     …and the fingerprint still re-derives after the scope is written

SITTING BOUNDARY (R.2)
  sign_all  --until e-cp12-build-record --dry-run  -> rows: 17, 17 commands
  merge_all --until e-cp12-build-record --dry-run  -> units: 17 of 40
  merge_all                             --dry-run  -> units: 40 of 40
  --until naming nothing                           -> exit 2, names the last five

RESUME (R.3, on a throwaway repo, deleted afterwards)
  SITTING 1 (--until u2)      u1 merged, u2 merged, exit 0
  THE INTERRUPT (--until u3)  u3 pushed, then killed at its OWN settle
  SITTING 2 (no flags)        u1/u2/u3 ALREADY MERGED (read from master, by patch id)
                              ⏳ RESUMING — waiting on master's tip before pushing
                              u4 merged and deployed                     exit 0
    units reported ALREADY MERGED  -> 3    a resumed settle, once, before any push -> 1
    only ONE unit merged this run  -> 1    exit code -> 0
```

## Validators, last run 2026-09-15

```
sign_gate --self-check   PASS   sign_gate --read-check  PASS
K6.2 controls            PASS   R.3 resume control      PASS
sign_all  --dry-run      40 rows, 40 ok, 0 refusing, exit 0
verify_manifest          40 OK, 0 STALE
merge_all --self-check   PASS
merge_all --dry-run      40 units, 32 constraints, exit 0
```
