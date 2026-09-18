# The redeploy storm — CAUSE FOUND (DC-2 Addendum A)

**Measured 2026-09-17 from `railway deployment list --service web --limit 40 --json`.**
The record metadata settles it; nothing here is inferred from timing.

---

## The recorded belief, and why it was wrong

`CLAUDE.md` records the storm as *"cause not proven — the best available reading is the
promotion workflow plus the `production` watch double-firing"*, and DC-2's Addendum A
was written to chase that: **A2 — list and delete extra `web` deployment triggers.**

⛔ **There are no extra triggers.** Every one of the five records for `77dad414d` carries
`branch = production`. The `web` service watches exactly one branch and it fired exactly
once. A2 has nothing to delete.

⭐ The hypothesis was reasonable and cost nothing to hold — but acting on it would have
meant hunting a misconfiguration that does not exist, and possibly deleting a trigger the
deploy actually depends on.

## What the five records actually are

| # | time | `commitAuthor` | `ignoreWatchPatterns` | `patchId` | what it is |
|---|---|---|---|---|---|
| 1 | 17:31:43 | `github-actions[bot]` | — | — | ⭐ the real promotion deploy |
| 2 | 17:41:44 | `claude` | `True` | `c42cbd04…` | a variable patch |
| 3 | 17:41:53 | `claude` | `True` | `9d215e14…` | a variable patch |
| 4 | 17:42:00 | `claude` | `True` | `71207cbc…` | a variable patch |
| 5 | 17:47:10 | `claude` | `True` | `b2289168…` | a variable patch |

**One landing produced ONE deploy.** The other four are **operator variable changes** —
each `railway variable --set` / `delete` (+ redeploy) creates its own deployment carrying
a distinct `patchId`, `ignoreWatchPatterns = True`, and the operator as `commitAuthor`
rather than the bot.

They are this programme's own R6 work: the resident-reader flag being set, verified,
deleted and redeployed, four operations inside sixteen minutes, three of them inside
sixteen seconds. **The storm was us.**

## The three discriminators, for next time

A deploy record answers "why am I here?" if you read three fields:

1. **`commitAuthor`** — `github-actions[bot]` = a promotion; a human/agent name = a patch.
2. **`ignoreWatchPatterns`** — present and `True` on a patch, absent on a promotion.
3. **`patchId`** — present ⇒ a config change, not a code deploy. It is the cleanest tell.

⛔ **`commitHash` alone cannot distinguish them**, which is exactly why five records shared
one SHA and read as "the same landing deployed five times". The SHA is the code that was
running, not the reason it restarted.

## What this changes

- **A2 is CLOSED as not-applicable.** No trigger to delete; the roster is correct.
- **A5 still stands and is now precise:** a pure CODE landing should produce exactly ONE
  record, with `github-actions[bot]` and no `patchId`. That is checkable.
- ⚠️ **§5's flip will itself create records, and that is the mechanism working.** Three
  variables (`BREADTH_SERIES_ENDPOINT_ENABLED`, then the two DC flags) = up to three patch
  deploys. They must not be read as a storm, and equally must not be started while a code
  deploy is still building — which is the same queue rule, for the same reason.
- ⭐ **And it explains the recency-vs-burst disagreement exactly.** Burst dedupes by commit
  and saw ONE; recency counts records and saw FIVE, resetting its 600 s clock each time. A
  session waiting on it watched the countdown restart while `origin/master` never moved.
  Both clauses were behaving correctly on inputs that meant different things.

## The residual, stated rather than hidden

Five other commits in the same 40-record window carry **2** records each
(`4e855cc7d`, `26147924d`, `d9455a6d6`, `9081799f2`, `e234b34a1`). Their second records
were not individually inspected, so "a landing plus one variable flip" is the LIKELY
reading and is **not measured**. The method above settles any of them in one command.
