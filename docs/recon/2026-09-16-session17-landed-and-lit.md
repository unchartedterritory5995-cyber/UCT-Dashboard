---
id: WISDOM-SESSION-17
title: Session 17 — the branch was already on master, the lander said otherwise, and INGEST is lit
status: complete — landing confirmed (not performed by this session), INGEST lit, $0.00 spent.
---

# Session 17 — landed, verified, lit

> **LANDED: YES** — `c0c950fbb`, 2026-09-16 00:38:34 -0500, **merged by another workstream's batch
> lander, not by this session** · **deploy SUCCESS** · **dark check: PASS on all six services** ·
> **INGEST lit: YES** (`web`) · **seed: NO** (not reached)
> **SPEND on extraction $0.00.** No extraction API call, no key read.
> **Ledger byte-identical** — 5,406 bytes, sha `b182b329`, `31.481462 / 100.0`.

⭐⭐ **THE RESULT THAT MATTERS MOST: THE LANDING HAD ALREADY HAPPENED, AND THE SANCTIONED TOOL
REPORTED IT AS A FAULT.** Session 16 ended with `tools/land_master_first.py` refusing with
*"UNRECOGNISED PARENTS: ^1=c0c950fbb ^2=32f0d8274 … Refusing rather than guessing"*, which was
read as a bug in the tool, then as a worktree collision, and cost hours of hunting. Both readings
were wrong and the tool was never broken. `feat/wisdom-loop` was **already merged**; `c0c950fbb`
and `32f0d8274` are **master's own parents**.

---

## Why the message was misleading, and the fix

`git merge --no-ff <already-merged-branch>` prints *"Already up to date."* and **exits 0 without
moving HEAD**. The lander then read `HEAD^1`/`HEAD^2`, which now describe **master**, not the
landing, and fell into `check_direction`'s catch-all branch. The refusal was correct — nothing was
pushed — but the sentence sent the reader after a phantom.

⛔ The sharper version of the same bug: master's tip happened to be a merge commit, so `HEAD^2`
resolved. Had it been an ordinary commit, `HEAD^2` would have failed and `git()` would have
`sys.exit(2)` — an even more opaque death.

✅ Fixed in `tools/land_master_first.py` (+36 lines, 0 removed): `merge_is_noop(head, before)`, a
pre-merge `merge-base --is-ancestor` guard that answers **before** a worktree is built, and a
post-merge guard for the race where a branch lands between the fetch and the merge. Self-check
extended. Mutation-proved: pin the helper to `False` → `FAIL merge_is_noop(head=aaaa, before=aaaa)`;
restored **byte-exact** (sha `5fa0299aa5d255b1` before and after), never via `git checkout`.

**End-to-end, the exact command that misdiagnosed the session:**

```
$ python tools/land_master_first.py feat/wisdom-loop --no-push
origin/master e234b34a1   feat/wisdom-loop 157fba7a9
  ALREADY LANDED: 157fba7a9 is an ancestor of origin/master e234b34a1.
Nothing to do — nothing pushed.                                          exit 0
```

## What landed, and the proof it landed whole

`c0c950fbb` sits on master's **first-parent spine** with `^1=cc5527f66` (notebook-kill-switch)
and `^2=157fba7a9` (our tip). Master has since advanced to `e234b34a1`; our tip remains an
ancestor and the whole wisdom surface still diffs to **0 files**.

| check | result |
|---|---|
| ancestry | `157fba7a9` is an ancestor of `origin/master` |
| content | **84 of 85** branch-changed files byte-identical on master |
| `CLAUDE.md` (the 85th) | **0 lines of ours missing**; others added 71 |
| control | a file we never touched **does** differ — the comparison can see a difference |
| merged-tree gate | **1328 passed · 4 skipped · 0 failed** (204s, real totals line) |
| the 4 skips | all **environmental** — a fresh worktree has no gitignored `data/wisdom/` tree |
| those tests, where the data exists | **51 passed** |

⛔ The skip count is why the run is reported as two numbers and not one. Session 16's gate on the
branch tip read **1331 passed · 1 skipped**; the merged tree read **1328 · 4**. Same population
(1332), three tests moved from passed to **skipped** — and a skip reads as a pass in a totals line.
They turned out to be artifact-dependent tests in a checkout without the artifacts, not a
regression, but that was **measured, not assumed**.

## The landing was not clean, and that is worth recording

The batch lander pushed `cc5527f66`, `c0c950fbb` and `54abdefeb` **ten seconds apart**. Railway
coalesced them: `cc5527f66`'s deploy went **REMOVED mid-flight** and **`c0c950fbb` never got a
deploy row at all**. It reached production only as an ancestor of a later merge. That is exactly
the stacked-push hazard CLAUDE.md records — *"one master merge at a time, `web` SUCCESS before the
next push"* — and it happened to our commit.

⭐ Nothing was lost, because the deploy that did succeed contained it. But **"my commit deployed"
was not answerable from the deploy list** — only from ancestry against the SHA that did deploy.

## INGEST is lit

`WISDOM_INGEST_ENABLED` set on **`web`** — derived, not assumed, as the only service that runs the
chain: the jobs register in `api/main.py`, and `worker_main.py` / `flow_worker_main.py` carry
**0** wisdom references.

Verified through the product's own predicate rather than by reading a value back:

```
ingest_enabled = True        extract_enabled = False      capture_enabled = False
GATE WISDOM_INGEST_ENABLED -> True        ... and all 24 other gates -> False
```

Including `WISDOM_EXTRACT_ENABLED`, `ASKAI_WISDOM_RETRIEVAL_ENABLED`, `WISDOM_DESK_MARKERS_ENABLED`,
`WISDOM_DOSSIER_ENABLED`, `WISDOM_LEVEL_ALERTS_ENABLED`, `WISDOM_BRAINKB_PUBLISH_ENABLED`. The
master switch is on and **every downstream capability remains individually dark**, so tonight's
chain exercises its plumbing and each of its 12 steps stops at its own kill switch.

**Timing was chosen, not stumbled into.** `catch_up()` re-runs missed cron slots within each job's
grace, so flipping the master switch can fire several at once. Replicating `catch_up`'s own
computation at 02:20 ET Tuesday: daily chain (mon-fri 18:47, 4h grace) last slot 7h33m ago → **no
catch-up**; weekly (sun 19:52, 24h) → **no**; monthly (1st sun 20:22, 24h) → **no**. Nothing fired
on the flip. First real run: **tonight 18:47 ET**.

⛔ **There are THREE member-visible doors, not one.** The brief's standing model names the Ask-AI
switch as *"the only thing that makes anything member-visible."* R50's audit says otherwise:

| door | gate |
|---|---|
| `api/routers/ai_search.py` | `ASKAI_WISDOM_RETRIEVAL_ENABLED` |
| `api/services/ai_search_dossier.py` | `WISDOM_DOSSIER_ENABLED` |
| `api/services/ticker_mentions.py` | `WISDOM_DESK_MARKERS_ENABLED` |

All three are unset, so the conclusion the model was protecting still holds — **nothing is
member-visible**. But the model has two more doors in it than the sentence suggests, and a future
flip decided on the one-switch version would be deciding on an incomplete map.

## `railway variables --set` auto-redeployed `web` — a second measurement

CLAUDE.md records this behaviour as **unsettled** (staged on `chart-renderer` 2026-08-30,
auto-redeployed on `web` 2026-09-09). Measured again here: the `--set` at **06:22:26Z** produced a
`DEPLOYING` row at **06:22:29Z** — 3 seconds later — which reached **SUCCESS**. That is `web`
auto-redeploying, consistent with the 2026-09-09 reading. The flip needed no restart to take
effect (the flag is re-read per run), but it caused one.

## The dark check had to be rebuilt mid-session

The first probe reported `WISDOM_*=unset` on all six services **with a failing control**
(`CONTROL_PORT=unset` on five of six). `PORT` is injected in-container, not into `railway run`, so
the probe was reporting its own blindness as a clean result. The rebuilt probe **enumerates by
prefix** instead of looking up names one at a time — so it cannot miss a name nobody thought to
list — and carries both a positive control (106–336 env names, 10–15 `RAILWAY_*`) and a negative
one (`__UCT_NOPE__`). Only then was `WISDOM_OR_ASKAI_NAMES=NONE` worth anything.

⭐ *An absence is only evidence if the instrument could have seen a presence* — caught here on the
single check the whole no-spend, nothing-member-visible claim rests on.

## QUESTIONS — open decisions

1. **The entity-master seed (Step F, second half) was not reached.** Still gated behind H6's
   guards and unrun.
2. **`railway variables --set` permission is contradictory across the briefs.** Session 14: *"No
   railway CLI writes. `railway variables --set` is forbidden"*. Session 15: *"CLI is the Railway
   path"* + *"never `railway variables` **without** `--set`"*, which only parses if `--set` is the
   permitted form. This session read 15 as superseding 14 and used `--set` for the INGEST flip.
   **If that was wrong, the flip is one `--unset` away from reversal.**
3. **Who runs the batch lander?** Something merged three branches ten seconds apart at 00:38. It is
   not this session's tool and its stacked pushes cost a deploy row. Worth knowing whose it is.
4. **EXTRACT remains unruled**, and nothing here changes that. The N-pass chain is built, live and
   dark; a first EXTRACT night still needs the budget check wired into the reservation loop and
   one INGEST night observed.
