# D-05 Part 1 — master merge preflight

> ## ⛔ **NO-GO. I did not merge.**
> Not because the branch is unfit — it merges clean with **zero file overlap** — but because
> **three other sessions are merging to master right now**, and adding a 22-commit merge to that is
> the exact failure this repository has paid for twice.

---

## 1.1 · The "unexplained" deploy, explained

`uptime_seconds: 183` at 23:53 ET was **another workstream's master merge**. Railway's deploy history
for `web`, read via the CLI:

| time (UTC) | status | commit | message |
|---|---|---|---|
| 03:48:25 | **SUCCESS** | `154c50f718` | Merge `origin/master` into **feat/notebook-kill-switch** |
| 03:44:37 | **REMOVED** | `47e1516b5` | Merge `origin/master` into **breadth/fetch-instrument** |
| 03:25:11 | **REMOVED** | `5e88b38c4` | Merge `origin/master` |
| 03:21:27 | **REMOVED** | `07cd3319c` | Merge `origin/master` into **docs/session7-record** |
| 03:02:53 | **REMOVED** | `85e68247c` | Merge `origin/master` into **feat/notebook-kill-switch** |
| 02:51:20 | **REMOVED** | `789a6bab5` | joystick audit (#137) |

⛔⛔ **SIX WEB DEPLOYS IN FIFTY-SEVEN MINUTES, FIVE OF THEM `REMOVED`.** `REMOVED` is what a deploy
becomes when the next one supersedes it mid-flight — it is the signature of stacked pushes, and it
is the documented cause of the 2026-09-12 and 2026-09-14 502 incidents.

**Master's rate right now: 28 commits in the last two hours**, from at least four workstreams
(`feat/notebook-kill-switch`, `breadth/fetch-instrument`, `docs/session7-record`,
`feat/pane-ordering`).

⭐ **It was not a crash loop, not a restart, not an env change, and not a scheduled redeploy.** It
was ordinary concurrent development — which is the answer, and it is the one that stops the merge.

---

## 1.2 · Merge-base and cleanliness — the branch itself is fine

| measure | value |
|---|---|
| merge-base | `1216958ed2` |
| branch **ahead** | 22 commits |
| branch **behind** | **114 commits** |
| `git merge-tree --write-tree origin/master HEAD` | **exit 0**, tree `e540e391f0` — **merges clean** |
| files changed on **both** sides since the base | **none** |

⭐ Zero overlap is the strongest single fact here: in 114 commits of other people's work, **not one
file this branch touches was touched by anybody else.** Content risk is as low as it gets.

---

## 1.6 · GO/NO-GO

| # | item | result |
|---|---|---|
| 1 | clock outside 09:25–16:05 ET, read in-process | ✅ **PASS** — 2026-09-15 **00:07 ET Tue** |
| 2 | 1.1 explained, base SUCCESS | ✅ **PASS** — explained above; `web` is SUCCESS on `154c50f718` |
| 3 | 1.2 merges clean, all suites green | ✅ **PASS** — clean, zero overlap; gate self-check 69, load-harness 73, contract 11, load-model 12, OI-40 10, OI-41 13, C-09/C-02 9, C-13 7, S5c 9, OI-36 6 |
| 4 | 1.3 production migration proof | ⚪ **NOT REACHED** |
| 5 | 1.4 V1-invariance proof | ⚪ **NOT REACHED** |
| 6 | 1.5 rollback plan | ⚪ **NOT REACHED** |
| 7 | **no other deploy in flight for ANY service** | 🔴 **FAIL — see below** |
| 8 | flow-worker untouched | ✅ **PASS** — `SKIPPED` on every recent deploy; `flow_worker_watch_coverage` OK |

### ⛔ Why item 7 fails when nothing is building *this second*

At 04:07 UTC every service reads `SUCCESS`/`SKIPPED` and `origin/master` equals the deployed SHA —
so by the letter, the queue is clear. **The letter is not the rule.** `CLAUDE.md`, from the second
incident:

> *"The gap is a TIME gap, not a logic gap: `tools/pre_push_guard.py` reads the queue at the moment
> of the push and is correct at that moment, but a build takes 3–5 minutes and a gate takes longer.
> **'The queue was clear when I started my gate' is true and useless.**"*

A merge + build + deploy is 3–5 minutes. Master is taking a commit every ~4 minutes. **The
probability that another session merges inside my window is high**, and the outcome is the one
already measured six times tonight: one deploy marks the other `REMOVED`, and members get Bad
Gateway through the swap.

---

## ⛔ And the larger reason, stated plainly

R3 is a ruling by **Claude (chat), owner-delegated — explicitly not an owner ruling on the merits.**
It authorises a **production deploy for ~1,558 members**. Tonight that deploy would join a queue
three other sessions are actively using, and **I cannot coordinate with them.** None of them knows
about this branch; none of them can see this session.

⭐ Every *technical* precondition I could reach is green. What is missing is not a check — it is the
one thing a session cannot supply for itself: **a human who can see all four workstreams and say
"go now".** That is the blocker, and it is yours.

---

## What to do when you want it merged

1. **Confirm no other session is mid-merge** — you are the only one who can.
2. `git fetch && git merge-tree --write-tree origin/master discord-render-hardening` → expect exit 0
   (it is clean today; 114 commits behind means re-check).
3. Merge **once**, outside 09:25–16:05 ET.
4. Watch `web` to **SUCCESS**, not "building".
5. Verify in-process: running SHA == merged head · `v2_channels() == ()` · `house_enabled() == False`
   · `recent()` projects `refusal_reach_ms` · `/api/health` 200.

**Rollback (1.5, written as required):** `git revert -m 1 <merge-sha>` and push — one more `web`
restart. ⭐ The migration is **forward-only safe**: `refusal_reach_ms` is an additive column and
`recent()` on the old code selects an explicit column list that does not name it, so a reverted
build simply never reads it. A column present but unread is inert.

---

## Consequences for the rest of D-05

- **Part 2 (the S2 run) is NO-GO**, because it requires 1.7 SUCCESS. ⭐ Recorded for next time: the
  corrected R1 tripwire **does** have a production-readable signal that needs no second merge —
  **Discord channel-history snowflakes**, which the arrival census already proved readable through
  the bot token.
- **Part 3 proceeds**, branched from this branch rather than from a merged master (R4 assumed a
  merge that did not happen), and stated as such.
