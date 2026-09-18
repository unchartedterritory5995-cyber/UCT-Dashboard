# The lean-run manifest — what the box was, what was insured, and what that makes cheap

> **Owner ruling, 2026-09-17: "I cannot close the other Claude sessions. Proceed anyway, with the
> risk made cheap and the footprint made small."** This file is the record of steps 1–3 of that
> ruling and the standing conditions every later step in this programme runs under.

---

## 0 · The state of the box, measured

| | |
|---|---|
| total RAM | 31.8 GB |
| free physical at first refusal | **3.1 GB** — *below* the 4.8 GB at which this box OOM-swept a worktree on 2026-09-12 |
| commit charge at first refusal | **46.2 / 49.1 GB = 94%** |
| concurrent `claude` processes | **7** (owner cap is 3 + integrator) |
| `llama-server` | **4,096 MB** |

⛔ **Commit charge is the number that bites, not free physical.** At the commit limit Windows
fails allocations, and a failed allocation inside `npm ci` is exactly how the 2026-09-12 incident
deleted `app/node_modules` down to zero entries and then destroyed the worktree's `.git` file. A
killed `npm ci` **deletes before it installs**.

---

## 1 · THE WORST CASE IS NOW RECOVERABLE

```
C:\Users\Patrick\uct-backups\uct-dashboard-ALL-20260917-213535.bundle      468 MB
C:\Users\Patrick\uct-backups\LATEST_BUNDLE.txt                            (the path, for scripts)
```

- Outside **every** worktree (checked against `git worktree list`, 91 of them) and outside
  `C:\data`.
- `git bundle create --all refs/stash`, pack threads pinned to 1 and window memory capped at 64m
  so the insurance could not itself cause the sweep it insures against. 33 seconds.
- `git bundle verify` → **"The bundle records a complete history."**

⭐ **VERIFIED BY CONTENT, NOT BY EXIT CODE.** 934 refs, and four spot checks that each had to be
present — this branch's tip, `refs/stash`, `worktree-indicator-ecosystem` (recorded in memory as
deliberately never pushed) and `feat/inc4-home` — **plus a control**: a fabricated sha had to be
ABSENT, which it was. Without that control "found it" would be indistinguishable from a search
that matches everything.

> ### ⛔ FROM HERE ON, A SWEPT WORKTREE COSTS A RE-CLONE AND AN `npm ci`, NOT DATA.
> Recovery is `git clone <bundle> <dir>` then `npm ci` in `app/`. **~370 packages, minutes.**

⚠️ **77 local branch tips are on no remote**, across 91 worktrees belonging to other workstreams —
several deliberately so (`worktree-indicator-ecosystem` is recorded as "NOT pushed"). They were
**not** pushed: publishing other sessions' branches without their knowledge is not this session's
call. The bundle is what protects them, and it protects them better, because it also carries the
shared stash that a push could not.

**This branch's own tip is pushed and identical to `origin/design/bar-and-strong-cut`** — verified
by sha equality, not by `git status`.

---

## 2 · WHAT WAS SHED: NOTHING, AND THE CHECK IS WHY

`llama-server` (4,096 MB) was the candidate. It **failed the first condition** and was left alone.

| check | result |
|---|---|
| no live connection | ❌ **FOUR `ESTABLISHED` sockets** on `127.0.0.1:8125` |
| whose | **pid 528**, a python process running from another Claude session's scratchpad (`5691081b-…`, not this session's `1c73ae1b-…`). Four connections matches the server's own `-np 4`. |
| an invoker in any worktree | none — the only `8125` hits are incidental numeric values inside `darkpool_cache/*.json` and a research JSON, i.e. **data, not code** |
| control on the socket query | an `ESTABLISHED` socket was found elsewhere (pid 4276), so the query works and "four" is a real reading |

Then this session's own footprint: **no stray node/python process carries this session's id**, and
the live `vitest` workers belong to `breadth-dc` and `notebook-k` — other worktrees, not mine.

> ### **Total freed: 0 MB. Nothing was mine to shed, and the one big thing is in use.**

⭐ Recorded as a result rather than skipped. A shed step that frees nothing and a shed step that
was never run look identical afterwards unless one of them is written down.

---

## 3 · LEAN RUN RULES — in force for the rest of this programme

- ⛔ **No six-shard gate while the box is like this.** Shards run **SEQUENTIALLY, one worker**,
  sampler wrapped. It counts as a gate only if the sampler is **CLEAR** and the totals reconcile,
  and it is recorded here as a **lean run**.
- ⛔ **No Vite dev server.** `npm run build` **once**, serve the static bundle with the lightest
  server available, point Chrome device emulation at that. **One tab. Closed between critique
  passes.**
- `vitest --pool=forks --poolOptions.forks.singleFork` (or equivalent), one worker.

### The threshold, and what happens mid-step

**Boot requires ≥ 4.5 GB free AND commit ≤ 92%, holding for THREE consecutive samples.**

Sample every **30 s** during any browser or build step. If free memory falls below **3.5 GB**
mid-step: stop that step **cleanly at the next boundary**, record **`INCONCLUSIVE-RESOURCE`**, wait
for the threshold, resume **from the boundary**. ⛔ Never let a step run into a sweep.

⛔ **`INCONCLUSIVE-RESOURCE` IS NOT A FAILURE AND MUST NEVER BE RECORDED AS ONE.** This programme
already has the precedent in `gate_box_sampler` — CLEAR vs INCONCLUSIVE-CONTENDED are different
facts, and collapsing "we could not measure it" into "it is broken" is the defect `CoverageLine`
exists to avoid. A resource-voided step says nothing whatsoever about the code.

---

## 4 · The samples so far

| when | free | commit | verdict |
|---|---|---|---|
| first refusal | 3.1 GB | 94% | REFUSE — below the 2026-09-12 incident level |
| after the bundle | 3.8 GB | 91% | REFUSE |
| threshold sample 1 | 5.0 GB | 83.7% | PASS |
| threshold sample 2 | 4.0 GB | 86.6% | **FAIL** |
| threshold sample 3 | 4.7 GB | 86.8% | PASS |

**2 of 3 — the hold is not met.** Commit charge has recovered substantially (94% → ~86%); free
physical is oscillating across the 4.5 GB line. Per step 5, work continues on everything that
needs neither a browser nor a build, sampling every 120 s, and the browser work starts the moment
three consecutive samples pass.
