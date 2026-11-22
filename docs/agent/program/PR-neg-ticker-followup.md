# #988 follow-up: a trailing "not / except / but not" on one chart

Branch `agent/pl/neg-ticker-followup`, from master `9e79f5efc0` (#988 merged). LOCAL / SIMULATED: jsdom, the real Agent panel,
scripted model plans (BROWSER-MOCK-MODEL). No paid model calls.

## What was wrong

After #988, a request that leaves one chart out at the end ("hide volume, not the NVDA chart") never touched that chart. That
part was already right. Two problems were left over:

1. **Over-ask.** With two charts, NVDA and AMD, and the model's plan on AMD, the member was still asked "Which chart do you mean?",
   even though AMD was the only chart the words could mean.
2. **Wording.** "hide volume except the NVDA chart" asked "Did you mean Chart (NVDA)?" while the only button was AMD. A question
   must never name a chart the words left out.

Cause: the target resolver (`deixis.resolveDeictic`) read "the NVDA chart" as a *description of the target*, even inside an
exclusion, or, once the negated clause was dropped, found no target at all and fell back to "pick one". The unnamed-chart gate
(`deixis.screenUnnamedTargets`) counted a ticker or ordinal said only inside an exclusion as a chart the member *named*, so the
click stopped answering for the request.

## The change (one file of code: `app/src/agent/deixis.js`)

`leftOut(text, charts, click)` returns the charts the words leave out. It is the same reader the last safety net already uses
(`spatialCheck.excludedCharts`: ticker, position, order, line, side, the click). Three guards use it:

| Guard | Where | Rule |
|---|---|---|
| G1 | `resolveDeictic` | A chart described only to be left out is not a description of the target. No question can name it. |
| G2 | `resolveDeictic` | A click the words leave out never answers for them. When the words leave exactly **one** candidate, that one is meant. |
| G3 | `screenUnnamedTargets` | When the words leave exactly one chart on the board, that chart counts as named. A ticker or ordinal said only inside an exclusion doesn't stop the click from answering. |

An exclusion the board can't place (`UNPLACED`) is still asked by the constraint check behind these gates. A value after "not"
("weekly, not daily", "log, not linear", "the 50, not the 200") is still not an exclusion (`negNamesAChart`, unchanged). No regex
was added, so there's no lookbehind. The `digests.deixis` baseline is unchanged (the relation readers weren't touched).

Unchanged from #988: an excluded or anchor chart is never applied, carded or offered, on any path.

## Before / after (two charts, NVDA left and AMD right, no click, model plan scripted)

| Words | Model plan on | Before (`9e79f5efc0`) | After |
|---|---|---|---|
| hide volume, not the NVDA chart | AMD | "Which chart do you mean? … pick one: AMD" | **AMD volume hidden, no question** |
| hide volume, not the NVDA chart | NVDA | asked, AMD offered | asked "Did you mean Chart (AMD)?", AMD offered; NVDA untouched |
| hide volume except the NVDA chart | AMD | "Did you mean Chart (NVDA)?" with only AMD offered | **AMD volume hidden, no question** |
| hide volume except the NVDA chart | NVDA | asked, AMD offered | asked, AMD offered; NVDA untouched |
| hide volume on everything but NVDA | AMD | applied on AMD | applied on AMD (same) |
| hide volume on everything but NVDA | NVDA | "Did you mean Chart (AMD)?" | same |
| hide volume, but not on the NVDA chart | AMD | "Which chart do you mean? … pick one: AMD" | **AMD volume hidden, no question** |
| hide volume, but not on the NVDA chart | NVDA | asked, AMD offered | asked, AMD offered; NVDA untouched |

The "After" column is the original probe re-run on the head, unchanged and not committed.

## Tests

- New rail `app/src/agent/agentTrailingNegation.test.jsx` (367 cases). It covers the excluded chart named by ticker (with and
  without a chart noun), position and order, under six exclusion operators (`, not`, `except`, `everything but`, `, but not on`,
  `other than on`, `excluding`). Each is run with the model aimed at the chart that is left and at the excluded chart, and with
  the click in three states (none, on the excluded chart, on the other one). It runs on 1×2 and 1×3 boards. It also has a
  no-model-plan safety block (instant path or a reply in words) and value-after-"not" controls.
  - Red on `9e79f5efc0`: **87 failed | 169 passed** for the first 256 cases (commit `ab67aa9000`), and **9 failed** for the added
    three-chart bare-ticker / ordinal cases (commit `fdc51413d0`, run against master's deixis.js). Every failure was an
    over-ask or a headline naming the excluded chart. None applied, carded or offered the excluded chart.
  - Green on the head: **367 passed**.
- Focused #988 rails plus no-lookbehind (23 files: agentNegatedClickAct, agentExcludedApproved, agentEveryExceptSet,
  agentFastPathEveryExcept, agentNoLookbehindEquivalence (deixis digests), agentNoLookbehind988/Oracle/Strings,
  noRegexLookbehind, agentDeixis, agentRelativeChart, agentSpatialConstraints, agentNegatedAnchor, agentExceptCard,
  agentExcludedGate, agentStativePriceClause, agentStructural*, agentTickerAnchors, agentPossessiveAnchor,
  agentDrawingsAnchored, deixisValueNotRelation, and the new rail): **23 files, 2754 tests passed** on the head.

### Mutants (one per guard; each turns the new rail red)

| Mutant | Rail result |
|---|---|
| M1 (G1) a description keeps the excluded chart | 16 failed |
| M2 (G2) an excluded click answers | 9 failed |
| M3 (G2) no one-left inference | 12 failed |
| M4 (G3) the click test reads names said inside an exclusion | 9 failed |
| M5 (G3) no one-left naming | 50 failed |

Removed during mutation because no rail could kill them, since a gate behind them already holds: an excluded-click check and
one-left inference in the bare-command branch, a filter on the question's choices (`useAgent`'s `dropExcluded` already filters),
naming with exclusions blanked in `screenUnnamedTargets`, and `UNPLACED` / negated-click handling in `leftOut`.

## Requests the owner can try (two charts on the board)

- "hide volume, not the NVDA chart" (no chart clicked): the other chart's volume hides, no question.
- "hide volume except the left one": the right chart only.
- Click the NVDA chart, then "hide volume, but not on the NVDA chart": the other chart, no question. The click doesn't win
  over the exclusion.
- "make it log, not linear" with a chart clicked: applied on the clicked chart (a value, not a chart).
- With three charts: "hide volume, not the NVDA chart" while one of the other two is clicked: applied there.

## Limits

- **Three or more charts, no click:** "hide volume, not the NVDA chart" leaves two or more charts, so a plan on one of them is
  still asked about ("Which chart do you mean?", offering only the charts that are left). The words don't say which chart.
  This is the same as master, never worse.
- A ticker on several charts, inside an exclusion with no line scope, is `UNPLACED`: the constraint check asks about the plan,
  as on master.
- Exclusions are read by the existing `excludedCharts` vocabulary. An exclusion phrasing it doesn't know isn't an exclusion
  here either (the excluded-chart safety net is the same reader).

## Files (from git: `git diff --stat 9e79f5efc0..HEAD`)

| File | Change |
|---|---|
| `app/src/agent/deixis.js` | +30 / -4: `leftOut`, `theOneLeft`, G1 to G3 |
| `app/src/agent/agentTrailingNegation.test.jsx` | +140: the new rail |
| `docs/agent/program/PR-neg-ticker-followup.md` | this document |

`useAgent.js` and `spatialCheck.js` are unchanged.
