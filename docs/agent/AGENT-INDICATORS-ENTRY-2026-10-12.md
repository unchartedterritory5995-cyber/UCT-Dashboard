# UCT Agent × Indicators — entry from the chart, + resizable sidebar (2026-10-12)

Branch `feat/agent-indicator-builder` (worktree `C:\w\agind`), from master `382606e92c`. **Local only — not
pushed, merged or deployed.** UCT Agent stays admin-only; advanced Pine stays off; no flag changes.

## What changed

**Stage 1 — Create Indicator / Modify open UCT Agent.** On the Charts workspace, when the Agent is available
(admin + Agent flag — the Agent's own gate), the chart's Create Indicator door (Chart Settings → Indicators →
"+ Create Indicator", the legend's "Modify with UCT Intelligence", Settings → Modify) opens the Agent on THAT
chart instead of the chart-side dock:

- Create: the Agent asks **"What indicator would you like to build?"** and offers **Formula / Import / Library /
  Screenshot** (they open the existing builder on that chart — no second editor).
- Modify: the Agent asks **"What would you like to change in “<name>”?"** (no doors).
- The member's next message runs the EXISTING `indicator.draft` capability (`chart` = that chart, `edit` = the
  definition) — same engine, draft store, preview, approval, save, cancel, receipts and Undo as M3. No new
  planner or engine; no planner model call for that message ("never mind" builds nothing).
- No route (other pages, members without the Agent, pop-outs, Multi Chart, a chart the host can't see) ⇒ the
  chart-side dock, exactly as before. The Agent's own `openCreateIndicatorFor` never routes back to the Agent.

**Resizable sidebar.** Drag the Agent's left edge (7 px separator): left = wider, right = narrower. 320 px min;
760 px max and never less than 520 px left for the board. ←/→ (Shift = 64 px), Home/End, Enter or double-click
= 392 default. Width kept in this browser's storage (`uct.agent.width`), like `uct.agent.open`.

## Interface changes (for the Agent latency / routing session)

| File | Change |
|---|---|
| `agent/indicatorEntry.js` (new) | route seam (`setIndicatorAgentRoute`, `routeIndicatorAuthoring`) + one-shot intent |
| `agent/useAgent.js` | `send`: the authoring intent is consumed after Undo / pending-proposal handling and before the "nothing is waiting" reply and fast-path ops. New returns: `prompt(request)`, `openDoor(door)`. No change to model routing, streaming, persistence or presentation. |
| `agent/AgentPanel.jsx` | new optional prop `request` ({id, chartRef, defId, name}); question choices with `door` call `agent.openDoor` |
| `agent/host.js` | `charts.openIndicatorDoor(ref, door)` |
| `agent/AgentDock.jsx`, `AgentPanel.module.css`, `agent/agentWidth.js` (new) | the resize handle; `--agent-w` set on the dock |
| `ChartsWorkspace.jsx` | registers the route while `agentAllowed`; passes `request` |
| `ChartWidget` / `ChartPane` / `StockChart` / `ChartToolbar` | `openIndicatorDoor(door)` pass-throughs; `ChartToolbar.openCreateIndicator` asks the route first |

### Overlap with Response Time Optimization (`C:\w\agperf`, `perf/agent-latency`) — trial merge

`agperf` has UNCOMMITTED edits to `useAgent.js`, `AgentPanel.jsx` and `host.js`. A read-only three-way trial
merge (`git merge-file`; base `382606e92c`, ours = this branch, theirs = their working files, copied to a scratch
directory — their worktree untouched) merges all three **with 0 conflicts**. Semantics checked:

- `useAgent.send`: they add `turnStart('send')` at the top and `turnEnd()` in `finally`, so the authoring early
  returns (answer → `indicator.draft`, "never mind") are traced and closed like every other path; their
  `turnPath(path)` in `execute` tags the authoring call `fast`. Their streaming changes are in the model path,
  after the authoring block. No change to their code is needed.
- `prompt` / `openDoor` are plain callbacks (not `exclusive`), so they never open a traced "click" turn.
- `AgentPanel.jsx`: their one-line change (~L438) and ours (request effect, door choices) are disjoint.
- `host.js`: theirs is in `readServerBoard`; ours is one method in `buildChartSource`.

**Intended resolution:** whichever lands second rebases onto the first; re-run `agentIndicatorEntry`,
`agentLatency`, `AgentPanel` and `agentDockResize` together. Re-run the trial merge if their files change.

## Verified before release review (10-12)

- **Resize does not disturb the charts** (browser, synthetic ramp bars, two charts with indicators and a drawn
  horizontal line; real mouse drags 392→760→320 and 8 keyboard steps): the same 30 chart canvases before and
  after (no chart re-created), **0 bars requests and 0 API requests** during a drag, indicator legends
  unchanged, the drawing kept, no text selection, no page horizontal scroll.
- **Chart context:** the question is bound to the CHART and the symbol is read when the member answers (switch
  the symbol first → the draft builds for the new one); a chart that left the board (layout switch) → the
  builder asks which chart, nothing built; a second Create Indicator on another chart wins; with a draft open
  on chart A, Create Indicator on chart B starts a separate draft on B. Drafts already keep their own chart.
- **Fallback builder** (Agent off in the browser): Create Indicator opens the chart-side dock with its own
  Formula / Import / Library / Screenshot doors and builds a previewed EMA 21 end-to-end.
- **Fixed in this pass:** the route now declines on the phone app and in Multi Chart (`resolveAgentChart`) —
  before, an admin's Create Indicator there would have opened an Agent that isn't shown / refuses every
  message. A door clicked while the Agent is mid-reply is now asked when the reply lands (it was dropped).

## Real-model acceptance checklist (NOT run — needs paid-call approval)

Admin account, Agent flag on, a layout with two charts (never "Positions" / Main Trading), Haiku 4.5, ≤ $0.10.
For each step note the receipt text, the `/api/agent/turn` and `/converse` counts, and that nothing else changed.

1. **Create** — Chart Settings → Indicators → + Create Indicator on the LEFT chart → the Agent asks "What
   indicator would you like to build?" with 4 doors, no model call. Answer "highlight candles when the 9 EMA is
   above the 20 EMA" → "Started … (draft — not saved)"; 0 `/api/agent/turn`, 1 `/converse`; no chart written.
2. **Preview** — "show it on the chart" → preview on the LEFT chart only; nothing saved.
3. **Refine** — "also require RSI above 50" → the same draft, revision +1 (not a new draft).
4. **Approve + save** — "save it as Trend Test and add it to my chart" → a proposal first; Apply → saved
   version 1 and added to the LEFT chart; the receipt names both.
5. **Undo** — Undo → the chart add is removed; the saved definition stays.
6. **Modify** — legend chip → "Modify with UCT Intelligence" on Trend Test → "What would you like to change in
   “Trend Test”?" (no doors). "make it blue" → an EDIT draft; save → version 2 of the SAME id.
7. **Cancel** — + Create Indicator → "never mind" → "OK — nothing was built.", 0 model calls.
8. **Door** — + Create Indicator → Formula → the formula builder opens on that chart.
9. **Context** — + Create Indicator on the RIGHT chart, switch its symbol, then answer → the draft is for the
   right chart and the new symbol.
10. **Fallback** — a non-admin (or the flag off) → + Create Indicator opens the chart-side dock, unchanged.

## Real-model acceptance — RESULTS (2026-10-12, owner-approved: Haiku 4.5, $0.10 total)

Set-up: the real ChartsWorkspace + UCT Agent in `agent-harness.html?live=<port>&bars=ramp` (synthetic bars;
layout/preference writes stay in-page). A local relay (`railway run` injected ONLY the Anthropic key into a
minimal child env) served the Agent turn route (the router's conversation logic, research + background naming
off) and the REAL `/api/user-definitions` router — `/converse` and every save gate — on a SCRATCH store,
signed in as one local test admin. Both models pinned to `claude-haiku-4-5`; the builder's `max_tokens`
lowered to 2048 for the check. One ceiling across both doors: before each call its worst case was reserved;
it never tripped. **No production save, write, flag or data was touched.**

**Spend: 6 model calls, $0.0716** — Agent planner 3 ($0.0134, $0.0176, $0.0104), indicator builder 3
($0.0222 cache write, then $0.0042 and $0.0039 on the cached prompt).

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Create | **PASS** | Question + 4 doors, 0 calls; the answer → "Started “EMA 9 > EMA 20” (draft — not saved)": 1 builder call, **0 planner calls**, nothing written to a chart |
| 2 | Preview | **PASS** | "Showing “EMA 9 > EMA 20” as a preview on Left chart (SPY) — a preview only, not saved." (1 planner call) |
| 3 | Refine | **FAIL (as run — test order, not this branch)** | Run AFTER the saves to protect the budget. M3 clears the selected draft on every save (`setActive(null)`) and never guesses between ≥2 drafts, so "also require RSI above 50" was planned as a NEW draft ("Which chart is this indicator for?"). In the documented order the door's draft IS the selected one — now pinned by a regression test. Re-run needs ≈ $0.02 (budget left $0.028; the guard's worst-case reservation refused it) |
| 4 | Approve + save | **PASS** | Named the draft → "You have 4 indicator drafts open — which one do you mean?" (M3 rule; 2 were empty drafts from the relay set-up failures) → chose it (no call) → proposal "Save “Trend Test” as a new indicator … then add it to Left chart (SPY)" → Apply → saved v1 (read back) + added |
| 5 | Undo | **PASS** | typed "undo" → "Removed the Trend Test I added on Left chart (SPY)."; the saved definition stays; 0 calls |
| 6 | Modify | **PASS** | Settings → "Modify with UCT Intelligence" on Trend One → "What would you like to change in “Trend One”?" (no doors, settings closed, no dock). "make the line blue" → an `edit:<defId>` draft (1 builder call, 0 planner); "save it" (fast path, 0 calls) → "Save a new version of “Trend One” … blue line" → Apply → "Saved “Trend One” (version 2)" — same id |
| 7 | Cancel | **PASS** | "never mind" → "OK — nothing was built.", 0 calls |
| 8 | Formula door | **PASS** | "Opened Formula on the chart." → the existing formula builder; its Save stored "Trend One" v1 through the real save route |
| 9 | Context | **PASS** | Create on the RIGHT chart, switched it NVDA → AAPL in the chart UI, then answered → the builder request carried `{sym: AAPL, tf: D}`, revision 0 (a separate new draft) |
| 10 | Fallback | **PASS** | Agent off → + Create Indicator opens the chart-side dock with Formula / Import / Library / Screenshot (its build path was verified earlier with the scripted builder) |

Observations (existing M3 behaviour, not changed here — for the Indicators owner):
- A first builder message that FAILS (here: the relay's missing cost-ledger table) leaves an empty
  "Untitled draft" that later counts in "which one do you mean?".
- After saving Trend One v2 the receipt says "It is not on a chart" although v1 is on the left chart.
- Naming a draft ("the EMA 9 > EMA 20 draft") with several open still asks which one (by design: never a
  silent pick).

## Remaining gaps (why the chart-side builder is NOT removed)

- The Agent exists only on the Charts workspace and only for admins; Create Indicator also serves the cohort
  and other chart surfaces (pop-outs, Multi Chart, other pages). Removing the dock needs the Agent there first.
- Formula / Import / Screenshot still open the existing dialogs (by design: one builder). Library opens the
  Chart Settings Indicators tab.
- Real-model acceptance: 9 of 10 PASS (above); Refine needs a re-run in the documented order (≈ $0.02).
