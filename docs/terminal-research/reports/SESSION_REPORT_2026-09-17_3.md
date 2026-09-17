# SESSION REPORT — 2026-09-17, session 3

**⛔ STOPPED before the sittings, on a premise correction I could not measure my way past:
R-MERGE-2's resolution method is not constructible.** K CP10 (sign-per-unit) is built and
controlled — and its own control caught a bug that had signed a real packet. The resolution
itself is proven sound; what is undecided is how it reaches `feat`, and the three ways change
what lands on master.

---

## 1 · ET, trees, remote, freeze, poll log

```
ET start   2026-09-17 12:32 EDT Thu   (tools/weekly_exec.py et)
ET end     2026-09-17 14:05 EDT Thu
remote     https://github.com/unchartedterritory5995-cyber/UCT-Dashboard.git
origin/master  d9455a6d6 -> f86c3759e   (moved again; 4th time in 3 sessions)
code   feat/s7-price-level 4c4ba1cb1   UNCHANGED — not rewritten, not force-pushed
docs   terminal-research   1c4f659a2 -> 1e10fd0d7
freeze  81/81 OK at start · authorised window (merge_all) · re-recorded 81/81
poll log  none — no CI run was started this session
```

## 2 · ⚠️ THE PUSH WINDOW — the ET authority contradicts the deploy authority

`weekly_exec.py et` printed **`master-push window: CLOSED (Mon-Fri 09:00-16:00 ET)`**. The
prompt says no time-of-day holds. **The repo settles it, and it is a file tier, not a clock:**

`docs/runbooks/deploy-windows.md` (owner-approved 2026-09-11, *"the single authority on push
timing"*, and it says it **replaces the blanket RTH freeze**) defines **Tier 1 — push any
time**: docs, markdown, `tests/**`, `tools/**`, `scripts/**`, `app/**`.

**Derived over all 47 units — 32 distinct files:**

```
tools 14 · app 10 · tests 5 · .github 1 · CLAUDE.md 1 · api 1
the one api/ file: api/routers/stream.py
```

The authority states `api/routers/**` is **not** on flow-worker's watch list, and the tool
agrees: `flow_worker_watch_coverage` → `reachable=156 watched=24 changed=32`, **exit 0, OK**.

⭐ **All 47 units are Tier 1.** R-NO-BLOCKS and the authority agree; `weekly_exec`'s window
line is the superseded blanket rule. **F-OPS-1: two authorities over one value**, and the one
a session reads first is the stale one.

## 3 · K CP10 — sign-per-unit

`merge_all` now signs each row **immediately before cherry-picking it**, inside the unit loop.
Master moves hourly here; signing every row up front invites a strand on an **already-signed**
unit whose record cites a SHA the resolution would rewrite — and a signature is pinned to
packet content, so that fix would mean editing a signed row. Signing per unit makes a strand
hit an **unsigned** row by construction.

⛔ **The delegation is re-checked per unit**, not once per run: a four-hour run can outlive
its authority, and the authority is a file that can change. The scope is **derived from the
manifest's checkpoint cell** — the same cell `sign_all` reads, so the two cannot disagree.

**Controls (8):**

```
sign_one precedes the cherry-pick IN THE LOOP (AST, not grep)      ok
...in the same loop                                                ok   <- non-vacuity
the fixture starts UNSIGNED                                        ok   <- non-vacuity
sign_one signs THE PACKET IT WAS GIVEN                             ok
...the fixture now reads SIGNED                                    ok
...scope derived from the manifest cell                            ok
...by-line is the DELEGATED one                                    ok
⛔ THE REAL PACKET IS UNTOUCHED                                     ok
```

### ⚰️ The control caught a bug that had already signed a real packet

The first `sign_one` **ignored the packet it was handed** and signed the path from the manifest
row. The fixture stayed `UNSIGNED` while the real `k-cp3-build-record.md` was signed — with
the delegated by-line, scope `CP3 ONLY`, outside any merge. **The run reported success either
way.**

Restored from the committed blob by **writing bytes** (never `git checkout`), verified
`UNSIGNED`, `52 OK / 0 STALE`, `.scopes/` removed. The last control row exists because of it.

⭐ **This is the whole argument for controls in one incident:** the bug was invisible to the
tool's own output, and review would have read the code as correct.

## 4 · M — the resolution is sound; the prescribed method is not constructible

**M.1 evidence** (base `f86c3759e`, remote named):

```
master's conftest.py : dependency_overrides appears 0 times   <- the additive claim
E CP28's conftest.py : dependency_overrides appears 6 times   <- control: the probe can say yes
E CP28's hunk        : 45 added lines, 0 removed
master's change      : ab7c55873 test(wisdom): R21 — strict-xfail baseline
```

**M.2 — built and proven on a throwaway from the true base:**

```
replayed 40 units clean up to E CP28 (base f86c3759e)
resolved commit 6e342a8f4
ADDITIVE PROOF vs master's conftest: 0 removed, 45 added
the added lines EQUAL E CP28's original hunk: True
M.4: ✅ CLEAN to the end — all 47 units replay onto f86c3759e with the resolution
```

**One strand of the three allowed. The resolution is correct and additive.**

### ⛔ But M.5 cannot be done as specified

```
feat's conftest at #41^ : 302 lines
master's conftest       : 342 lines
master has 40 lines feat lacks; feat has 0 master lacks
```

R-MERGE-2 says to rewrite E CP28's commit so it *applies on master's current conftest*. But a
commit is a **tree**, and a cherry-pick applies its **patch**. Give the rewritten commit a tree
of *master's file + hunk* and its patch — measured against its parent **on feat**, which lacks
master's 40 lines — becomes *master's 40 lines + the 45-line hunk*. **Cherry-picking that onto
master re-applies a change already there.**

⭐ The resolution only works where it was built: with feat's conftest already containing
master's change. That is a property of **feat's history**, not of one commit.

### The three ways out, each changing what lands on master

| | what it does | cost |
|---|---|---|
| **(a) merge master into feat** — the runbook's own STRAND branch says exactly this | feat's conftest gains master's change; E CP28's patch context then matches; universe stays 47 (master's commits become reachable) | a merge commit needs its own row, and cherry-picking a merge is `-m 1` |
| **(b) resolve at merge time** | what the throwaway did, and it is proven CLEAN | `merge_all` cherry-picks declared SHAs; it has no "resolve here" step |
| **(c) rebase feat onto current master** | mechanically clean, universe stays 47 | **all 47 SHAs change**; every record's cited SHA and patch-id must be updated |

⛔ **I did not pick one.** Each changes what master receives, and the session had just
established that the prescribed method rests on a false premise. **Drafted, not built.**

## 5 · Not reached

**K10.2** (the `patch-id:` field and `STALE-PATCH`), **C** (true-base preview CI), **S** (the
four sittings) and **S.5** were not started. The sittings are gated on M, and M is the stop.

## 6 · Post-merge premise audit

Unchanged from `POST_MERGE_QUEUE.md` and still **deliberately not started**: it must run
against post-merge master, and master does not contain the units. P.1 is now **closed** —
E CP34 is on `feat` (`4c4ba1cb1`).

## 7 · Findings filed / closed

| id | finding | state |
|---|---|---|
| **F-SIGN-19** | `sign_one` signed the manifest's path, not the packet it was given — it signed a REAL packet during a fixture run | ✅ **FIXED**, restored; the control that caught it is now a row |
| **F-OPS-1** | `weekly_exec.py` prints the blanket RTH window that `deploy-windows.md` superseded on 2026-09-11 — two authorities over one value | ⛔ **OPEN** (code repo, not frozen; recorded, not fixed) |
| **F-MERGE-2** | the merge strands at #41 on `tests/conftest.py` | ⛔ **OPEN — the stop.** Resolution proven; the route to feat is undecided |
| **F-MERGE-3** | a commit's tree cannot be rewritten to "apply on a moved base" — the patch carries the base's own change with it | ⛔ **OPEN**, and it is why R-MERGE-2 is unconstructible |
| **F-CI-43** | CI never ran on master | ✅ CLOSED (E CP34, row 52) |
| **F-CI-42** | Notebook self-check reads the live repo | ⛔ OPEN, untouched |

## 8 · OPEN QUESTIONS

- **(a), (b) or (c)** for F-MERGE-2? Each changes what master receives.
- **If (c),** all 47 records' SHAs and patch-ids change — is that one authorised unfreeze or 47?
- **Master moved four times in three sessions.** Any resolution built in advance is valid only
  against the base it was resolved on; (b) is the only option immune to that.
- **F-OPS-1** — should `weekly_exec` stop printing a window, or point at `deploy-windows.md`?

## 9 · Owner-readable summary

**Nothing reached master. Nothing was signed. Members are unaffected.** The feature branch is
exactly where it was.

**What got better:** the merge tool now signs each unit in the moment it merges it, rather than
signing everything up front — so if a merge hits a snag, it hits an unsigned unit and the fix
never has to touch a signature. Building that caught a bug which had quietly signed one real
document during a test; it was undone and the check that found it is now permanent.

**Why it stopped:** your ruling was to fix the conflict by rewriting one commit so it applies
on today's master. Measured, that cannot work — a commit carries a whole file state, so the
rewritten one would also try to re-apply master's own change on top of master. The conflict
fix itself is proven correct and, with it, all 47 units merge cleanly. What is undecided is how
that fix gets onto the feature branch, and the three ways differ in what master ends up with.

**Where to watch:** nothing is in flight. No deploys, no CI runs from this session.

## 10 · Merge readiness

```
rows 52   SIGNED 0   MERGED 0
universe  47 covered 47, exit 0      verify_manifest 52 OK, 0 STALE
drift     (52, 52)                   freeze 81/81 OK
replay    ⛔ STRAND at #41 e-cp28-build-record — tests/conftest.py  (base f86c3759e)
pre_sitting NOT-READY
```

⛔ **NOT READY.** Single blocking item: **F-MERGE-2**, awaiting a route decision.

## 11 · Three phone-readable sentences

**The conflict fix is proven and it is exactly as small as it looked** — forty-five added
lines, nothing of master's removed, and with it all forty-seven units merge cleanly onto
today's master.

**What cannot be done is the way you asked for it**: a commit carries a whole file, not just
its change, so a commit rewritten to match today's master would try to re-apply master's own
edit on top of master — the fix has to reach the branch, not the commit.

**The merge tool now signs each unit at the moment it merges it**, and building that caught a
bug which had already signed one real document during a test — undone, and the check that
found it is now permanent.

## 12 · Status

STATUS: STOPPED-ERROR
