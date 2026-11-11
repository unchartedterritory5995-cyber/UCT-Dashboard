# PR: layout.saveAs fast path no longer claims "save … as the default on <chart>"

Branch `agent/pl/fix-saveas-fastpath` (from origin/master 70c8c41e9c). Tier T2, one matcher.

## Bug (LIVE on master)

The instant `fast` matcher of `layout.saveAs` (app/src/agent/capabilities/layout.js) accepts
`save (it|this|this layout|…)? as (a )?(new )?(layout )?(called|named )?(.+)`. Both "save it as the default on the
tsla chart" and "save as default on TSLA" matched it, so the fast path claimed them with 0 model calls:

- on /charts (a layouts source is present) the Agent proposed at once: Save this workspace as a new layout “the default
  on the tsla chart” (Apply/Dismiss);
- on a host without a layouts source, useAgent's single-kind branch (~line 2504) replied "There is nothing on this
  workspace for that to change."

The member meant: save this drawing / style as the default for the TSLA chart. That is a different intent. Close variants
("make this the default on the tsla chart", "save the trendline style as default on the tsla chart") do not match the
regex, and the model already handles them.

## Root cause

The capture `(.+?)` takes anything after "as" as a layout name. It has no idea of a "default", and no idea of a trailing
chart / symbol target. Its only guard was the S6 F2 indicator-draft rule.

## Fix (the layout.saveAs fast matcher only)

Two module-level regexes (no lookbehind):

- `SAVE_AS_DEFAULT_NAME = /^(?:the |my |a )?default\b/i`: the captured name is (or starts with) "default" / "the default".
- `SAVE_AS_CHART_TARGET`: the captured name ends in a chart / symbol target. That is `on|for|in|to`, then an optional
  `the|this|that|my`, then one of: a `$`-ticker, a capitals-typed ticker, or `<word> chart`. Tickers count only when typed
  in capitals or with `$`, the same convention `tickersIn` uses. (multiChart.js is not imported, because it imports
  `capabilities` and that would make an import cycle.)

When the sentence has no explicit layout / workspace / board / setup word, and either regex matches, the matcher returns
null and the model reads the sentence. With an explicit layout word, master's behaviour is kept: "save this layout as
default" is still an instant layout save named "default". Every other legit fast save ("save this as Momentum", "save
this layout as Swing", "Save this setup as Earnings Watch") gives exactly the same result as on master.

A lowercase bare ticker with no "chart" word after it ("save it as Momentum on tsla") is still claimed. A lowercase word
cannot be told apart from part of a name without a lexicon lookup. This is out of scope here.

## Tests

New `app/src/agent/agentSaveAsFastPath.test.jsx` (14 tests). It mounts the REAL AgentPanel the way agentLayouts.test.jsx
does: fetch is mocked, `/api/agent/turn` returns a sentinel model reply, and no paid calls are made.

- Boards: a 1-chart TSLA board and a 2-chart TSLA+NVDA board, each WITH and WITHOUT a layouts source (4 boards).
- On each board, "save it as the default on the tsla chart" and "save as default on TSLA" give: no `layout.saveAs` in
  fastParse, no proposal, no "Save this workspace as a new layout" text, no "nothing on this workspace" text, no layouts
  call, and exactly 1 model turn (the sentinel reply is shown). That is 8 tests.
- Controls on the boards that have layouts: "save this layout as Swing" and "save it as Momentum" are still instant
  `layout.saveAs` proposals (named “Swing” / “Momentum”) with 0 model turns. That is 4 tests.
- Matcher table: explicit layout wording keeps master's results (including "save this layout as default" → "default").
  Default-shaped names and chart / symbol targets with no layout word return null.

## Mutant

The new guard line was switched off (`if (false && (SAVE_AS_DEFAULT_NAME…`), which is master's matcher behaviour.
Result: 9 failed | 5 passed (14). All 8 default/target regression cases (both boards, with and without layouts) fail, and
so does the matcher-table null case. The 4 controls and the explicit-layout table stay green. After the guard was
restored: 14/14.

## Focused set

See "Verification" at the end.

## Follow-up (NOT in this PR): a kind with an empty list should hand off, not claim

useAgent's single-kind branch (~line 2504) says "There is nothing on this workspace for that to change." when a fast
match names a target kind that this host has no source for (for example `layouts` on a page with no layout library).
That reply claims the turn on a host where the fast path cannot know what the member meant. When a kind has an empty
list on a host without that source, the turn should go to the model (or the right surface) instead of being claimed. This
PR does not change that wording or that branch. It only stops this one matcher from producing the false claim.

## Verification

Two runs of at most 25 files each, no suite lock, node_modules Junction. Both EXIT 0.

- Run 1 (23 files): 23 passed, 465 passed | 17 todo. Files: the new rail; the layout fast-path and layout tests
  (agentLayouts, agentPreviousLayout, agentProtectedLayouts, agentRoutingLayoutStabilization, agentSaveLast,
  agentRoutingS6, agentStabilization, agentEarlyReceipt, ChartsWorkspace.layoutUndoAgent); the layout outcome tests
  (multiChart.outcome, boardArrangement.outcome); the 4 count pins, unchanged (agentRouting, agentScreener,
  agentNl1Selection, agentIndicatorsM2); agentNl1SelectionCoverage (no loss); agentExecReach (all);
  agentScanSat1Requests; routeReachability; agentNoLookbehindEquivalence (0 frozen rows changed, no re-record);
  noRegexLookbehind; nlm1Routing.
- Run 2 (15 files): 15 passed, 2054 passed. Files: capreg corpus.routing, corpus.routingV2, golden; agentContracts; the
  #988 rails (agentEveryExceptSet, agentStativePriceClause, agentNegatedClickAct, agentNoLookbehind988,
  agentExcludedApproved, agentExcludedGate, agentExceptCard); the other layout.saveAs users (agentFlagshipOperator,
  agentFlagshipV2, agentOperatorLive, agentKnowledgeCompare).
- firstCallRatchet is not on master, so it was not run.
- ESLint is clean on both changed source files.

## AUDIT controls (added after review)

The new rail now has 20 tests. These run on both boards that have a layouts source:

- Two new instant controls: "save it as Thrust Days" (a two-word name) and "save this layout as default" (explicit layout
  wording keeps master's behaviour). Each gives a `layout.saveAs` proposal with the right name and 0 model turns.
- "save the workspace as Momentum Swing" is NOT an instant save, on master or on this branch. The matcher's subject list
  has "this workspace" but not "the workspace", so fastParse returns null and the model handles it. This PR does not
  widen the matcher. Instead, a rail pins the current behaviour: no proposal, exactly 1 model turn. Making
  "the workspace / the layout" fast is a separate, small widening, if AUDIT wants it.
- Mutant re-run (guard off): 9 failed | 11 passed (20), the same 9 regression cases as before. All 8 controls and both
  pins stay green. File + noRegexLookbehind: 26/26.
