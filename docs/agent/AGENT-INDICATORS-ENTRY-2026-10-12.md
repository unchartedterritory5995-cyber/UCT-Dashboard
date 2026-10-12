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

## Remaining gaps (why the chart-side builder is NOT removed)

- The Agent exists only on the Charts workspace and only for admins; Create Indicator also serves the cohort
  and other chart surfaces (pop-outs, Multi Chart, other pages). Removing the dock needs the Agent there first.
- Formula / Import / Screenshot still open the existing dialogs (by design: one builder). Library opens the
  Chart Settings Indicators tab.
- Real-model behaviour of the authoring message is unchanged M3 code but was exercised here only with a
  scripted `/converse` double (no paid calls).
