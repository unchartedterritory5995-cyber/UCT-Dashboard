# 08 — Merge queue

Ordered, integrated, gate-green branches waiting for master. One master merge at a time; the next
one is gated and ready **while** the previous waits for `web` SUCCESS, so the deploy wait costs
nothing (07-execution-plan §2).

⛔ **A ROW IS ONLY "READY" IF IT NAMES THE SHA IT WAS GATED AGAINST.** "Gate green" without the base
is a claim about a tree nobody can reconstruct — and master moves under this branch every few
minutes on a Sunday evening.

⛔ **RE-GATE ONLY WHAT MASTER'S MOVEMENT INVALIDATES.** The decision is made with the scoped-file
gate, not by re-running everything: if `git diff --name-only <gated-base>..origin/master` shares no
file with the branch's own changed set *and* touches nothing the branch's scoped files import, the
gate still stands and the row keeps its status. Anything else re-gates. Record which of the two
happened — a row that silently kept a stale green is the defect this column exists to prevent.

---

## Queue

| # | Branch | Step | Gated against | Scoped gate | Mutations | Status |
|---|---|---|---|---|---|---|
| B | *(worktree)* | 2.5 cache + coalescing | `e659454bb` | running | running | in flight |
| C | *(worktree)* | 2.6 Discord delivery | `e659454bb` | running | running | in flight |
| D | *(worktree)* | 2.7 badge + spec + goldens | `e659454bb` | running | running | in flight |
| E | *(worktree)* | 2.8 regressions + Step 3 harnesses | `e659454bb` | running | running | in flight |
| F | *(worktree)* | runbook + flip packet + RESUME | `e659454bb` | n/a (docs) | n/a | in flight |

## Merged (this push)

| # | Branch / SHA | Step | Gate | Deploy | Running SHA |
|---|---|---|---|---|---|
| 5 | `5ca4d5db2` | 2.4b P2.1–P2.10, dark | 44 files, **1,112 passed** | SUCCESS | `5ca4d5db2385` ✅ verified in-process |
| 5a | `954309f0f` | merge-5 record (docs) | n/a — docs only | SUCCESS | `954309f0f` ✅ |
| 6 | `e659454bb` | frozen cross-lane contracts + `07`/`08` | 5 files, **166 passed** | SUCCESS | `e659454bb8f2` ✅ verified in-process |

---

## Flips performed

| When (UTC) | Flag | Service | Confirmed how | State |
|---|---|---|---|---|
| **2026-09-14 00:28 UTC** (= Sun 2026-09-13 **20:28 ET**) | **`RENDER_V2_SHADOW=1`** | `web` | `--set` **auto-redeployed** here (the `web` behaviour, not `chart-renderer`'s staging one); new boot confirmed by uptime **113 s → 12 s** with the deployment SUCCESS, then the value read **in the running process**: `RENDER_V2_SHADOW="1"`, `shadow.enabled()` → `True`, and the route confirmed wrapping `_dispatch_interaction` and submitting `run_safely`. | **ON** — pre-approved by the owner's brief. `DISCORD_RENDER_V2_ENABLED` remains **absent**, so the member path is unchanged and the shadow only records. |

⛔ `railway variables --kv` was deliberately **not** used as the confirmation: it shows what the
service is CONFIGURED with, which is not evidence the running process has it.

## Rules that decide the order

1. **Leverage first, not list position.** 2.4b → 2.5 → 2.6 → 2.7 → 2.8 is a *dependency* order. A
   branch that unblocks two lanes or de-risks the flip goes ahead of one that only adds code.
2. **Nothing stacks.** `web` SUCCESS and the running SHA confirmed in-process before the next push.
   Master's own pre-push guard now checks this too and refuses an unsettled push — it is a second
   rail, not a replacement for the confirmation.
3. **flow-worker classification in the row** for anything reaching its watch list — ADDITIVE or
   BEHAVIOUR-CHANGING — weekend or not.
4. **If master moves mid-gate more than twice on one merge:** rebase once more and, in parallel,
   write the coordination OI. Do not spend a third gate cycle before the OI is written.
