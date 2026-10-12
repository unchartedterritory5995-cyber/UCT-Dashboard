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

⚠ **Overlap:** `C:\w\agperf` (`perf/agent-latency`) has uncommitted edits in `AgentPanel.jsx`, `host.js` and
`useAgent.js`. The regions are disjoint except `useAgent.js` near the hook's return object (theirs ~L1003–1024,
ours ~L1006–1027) — expect a small textual conflict; both sides are additive.

## Remaining gaps (why the chart-side builder is NOT removed)

- The Agent exists only on the Charts workspace and only for admins; Create Indicator also serves the cohort
  and other chart surfaces (pop-outs, Multi Chart, other pages). Removing the dock needs the Agent there first.
- Formula / Import / Screenshot still open the existing dialogs (by design: one builder). Library opens the
  Chart Settings Indicators tab.
- Real-model behaviour of the authoring message is unchanged M3 code but was exercised here only with a
  scripted `/converse` double (no paid calls).
