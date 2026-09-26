---
id: ADR-0041
title: Item 13's absorb-outright verdict rests on a product state that no longer holds, so the MVP's build half is void
status: withdrawn
date: 2026-09-26 (published and partly withdrawn the same day)
decided_by: the programme (gate item 27 input)
gate_item: 13, 27
promotion: ⭐⭐ Promoted as the cleanest worked example in the programme of a CORRECT MEASUREMENT leading to a WRONG CONCLUSION. The measurement stands; the inference from it does not. Deleting the record would delete the lesson.
supersedes: none
superseded_by: ADR-0042 (in part — §the measurement stands; the reading of item 13's verdict does not)
register_row: none
---

# ADR-0041 — Item 13's absorb-outright verdict rests on a product state that no longer holds, so the MVP's build half is void

**STATUS: WITHDRAWN** · 2026-09-26 (published and partly withdrawn the same day) · decided by the programme (gate item 27 input) · gate item 13, 27

**Why it is an ADR and not a tracker row:** ⭐⭐ Promoted as the cleanest worked example in the programme of a CORRECT MEASUREMENT leading to a WRONG CONCLUSION. The measurement stands; the inference from it does not. Deleting the record would delete the lesson.

⛔⛔ **SUPERSEDED BY ADR-0042 (in part — §the measurement stands; the reading of item 13's verdict does not) — DO NOT ACT ON THIS RECORD.** It is kept, with its reasoning intact, because deleting it is how the next engineer re-proposes it.

## Context

Item 27 named its own settling measurement in its §8.2 and predicted this outcome as *"the
good failure"*: one grep for `ChartPane` in the breadth drill component. It was run
(`12-decisions/DECISION_CARDS_2026-09-26.md:645-647`).

## The measurement — correct, and it stands

Measured on `origin/master` (this worktree is an older docs branch, so every read was
`git show origin/master:` / `git grep origin/master`) (`:649-657`):

| measurement | result |
|---|---|
| `git grep -nE "chart\.ashx" origin/master -- app/src` | **ZERO occurrences.** The Finviz static chart PNG does not exist anywhere in the frontend |
| `app/src/pages/Breadth.jsx:49` | `const ChartPane = lazy(() => import('../components/chart/pane/ChartPane'))` |
| `app/src/pages/Breadth.jsx:343` | records that the old `DrillModal` (**~320 lines**) was **DELETED**, superseded by `pages/breadth/drill/BreadthDrillModal.jsx` (`:347`) |
| `app/src/pages/ThemeTrackerPage.jsx:7,39,1505,1537` | mounts `StockChart` **and** `ChartPane` — native on both surfaces |
| Finviz / TradingView / `chartPeriod` in `Breadth.jsx` | **no hits** |

⛔⛔ **So the incumbent is not merely matched — it is ABSENT.** A trial asking *"did
the subject stop using the in-app Finviz chart tab"* cannot be failed, cannot be passed, and cannot
be run (`:659`).

## The conclusion as taken (WITHDRAWN)

*"Item 13's absorb-outright verdict rests on a product state that no longer holds, and it is the
row the whole MVP was selected from … the absorption is already complete and the row should
read done, not do."* (`:667`)

✅✅ **Withdrawn by CARD 25** — see ADR-0042. Item 13 verdicted a **TOOL**, not an
embed, and the owner confirms he uses that tool.

## What survives, and is not a remainder

1. ✅ **The measurement.** The in-app embed is gone; that is a fact.
2. ✅ **The MVP has ZERO builds, not one.** B-1 (mount `ChartPane` in the drill) already
   ships, so **item 27's deliverable is a pure measurement protocol with no engineering in it at
   all** — which its own §8.2 argued is the best available outcome, not an embarrassment
   (`:665`).
3. ✅ **The second half of item 27's incumbent definition was never touched by any of this:**
   its §6 defines the incumbent as *"the `chart.ashx?…&p=d|w` tabs **plus finviz.com for
   the same purpose**"*. The first half is void; **the second half is a question about desk
   behaviour and no amount of code reading can answer it** (`:661`).
4. ⭐ **What it did right and should be copied:** it declined to re-verdict item 13 from one
   grep. *"Item 13's file is 783 lines and its author derived those verdicts from evidence I have
   not re-read; re-cutting its headline from one grep would be the same shortcut this programme
   keeps paying for."* (`:667`)

## Consequences

* ⚠️ **`CLAUDE.md` on master still documents the deleted component as live** — its
  DrillModal section describes *"Three chart tabs: Daily / Weekly (Finviz static PNG) / TradingView
  (iframe). Default: `'tv'`"* and a `chartPeriod` state initialised to `'tv'`. **None of that
  exists.** *"It is why item 27's author reasonably believed the tabs were live: the repo's own
  guidance told them so."* Not fixed — a different worktree and a member-facing onboarding doc
  (`:668`).
* ⭐ **The general lesson:** *"a COMPETITIVE dependency can be retired by ordinary refactoring
  while the research describing it stays perfectly intact."* **Any "tool X is still load-bearing"
  claim needs a date and a re-grep, exactly like a flag state** (`:670`; ADR-0003).

## Sources

- `12-decisions/DECISION_CARDS_2026-09-26.md:645-670`
- `10-roadmap/mvp.md:60-72`
- `00-program-control/MASTER_CHECKLIST.md:19,33`
