# UCT Agent — Charts operator plan (final roadmap)

**Status:** adopted 2026-10-27 (owner). Replaces the remaining Phase 2 batches (P2-C, P2-D, P2-E, P2-F) and the Charts parts of Batches 8b and 10 with four finite phases.
**Goal:** the Agent understands natural-language requests and does essentially anything a member can do by hand in the supported Charts workspace, through each feature's own canonical writer, with approvals, receipts and Undo.
**Unchanged:** admin-only; NL-1 off unless separately authorized; server limits (60 actions per request, 12 operations per plan, 2 model calls); spend caps; the Indicators project owns the indicator engine, styling, panes and definition management.

## Phases

| Phase | Contents | Depends on | Status |
|---|---|---|---|
| **1. Agent-only completion** | Multi-chart sentences, ordinal targeting, chart setup (templates, copy a look, timeframe menu, comparison display), drawing visibility / lock / level / bulk, watchlist order and notes, widget tabs, A1 integration (`keepIndicatorState`, Undo compatibility tests), hardening, draft discard, drawing-layer exports | nothing | **built** — branch `feat/agent-charts-operator-p1`, draft PR; not merged |
| **2. Indicator control + custom-indicator management** | Agent wrappers for Indicators' new mutation ops (appearance, plot style, colour, display target, pane order and size, duplicate, copy between charts), structured targeting, definition delete / fork / version restore | Indicators ships the ops (PHASE2-SHARED-CONTRACT §3, I-1…I-13) | waiting on Indicators |
| **3. Anchored drawings** | Trendline, ray, rectangle, Fibonacci, channel, text… from explicit dates and prices (or deterministic bar reads); anchor edits; per-tool styling | Phase 1's drawing-layer exports (done) | next Agent phase |
| **4. Qualification and release** | The acceptance catalog in the real-workspace harness, corpus extension, real-model qualification on the sealed sets, fixes, release | Phases 1–3; owner's paid-eval decision | — |

## Phase 1 — what was built (2026-10-27)

| Area | Capability | Approval / Undo |
|---|---|---|
| Several charts in one sentence (`agent/multiChart.js`, legacy instant path) | "NVDA on the left and AMD on the right" (+ "both weekly"); "TSLA on the first chart, AAPL on the second" | applied, one Undo |
| | "show NVDA and AMD side by side": 2 charts → both reused; 1 chart → it shows the first, a new chart for the second is proposed; 0 charts or "in new charts" → proposed; 3+ charts → proposed with the charts named | as stated |
| | "make the left chart look like the right one" → `chartSetup.copyLook` | proposed, exact Undo |
| Ordinal targeting (`deixis.ordinalChart`) | "the second chart", "chart 3", "the last one", "the middle chart" (only for 3 or 5 charts in one row or column; otherwise asked) — fast path and NL-1's chart-identification screen | — |
| Chart setup (`capabilities/chartSetup.js`, own routing group `chartSetup`) | `copyLook`, `removeTimeframe` (menu ✕), `favoriteTimeframe` (★), `compareDisplay` (scale, eye, Group only), `saveTemplate` / `deleteTemplate` (Chart Settings → Templates, through the shared `chartTemplatesAfterSave` / `chartTemplatesAfterDelete`) | copyLook, deleteTemplate and a replacing save are proposed; all exact Undo |
| Chart settings | `watermark.color` promoted to Agent-eligible | applied, Undo |
| A1 | `chart.resetDefaults` now uses A1's `keepIndicatorState` (also keeps `header.infoValues`, finding C5) | proposed, Undo |
| Indicators | "swap the 9 for a 10 (on every chart)" — the in-place `indicator.update` | as before |
| Drawings | `setVisible`, `lock`, `setLevel` (horizontal line / ray), `setAllVisible`, `clear`; "it" = the drawing marked `recent` | `clear` always proposed (owner: broad destructive operations); `remove` of one visible drawing now applied (a hidden one is proposed); moving a line with an alert is proposed |
| Watchlists | `reorder` (A–Z / Z–A / tickers to the top), `setNote` | applied, exact Undo |
| Workspace | `widget.addTab` (the widget header's "+") | applied, Undo |
| Custom indicators | `indicator.discardDraft` through `agentAuthoring.discardDraft` | proposed, no Undo (stated) |
| Hardening | malformed clarification choices are dropped, never rendered (both lanes); a model plan over 12 operations is refused in the panel too | — |
| Drawing layer (C-3) | `components/chart/drawingTools.js`: `POINT_COUNT` (parity-tested against the overlay's own table), `validateDrawing`, `drawingTimeFor` | — |

**Two Undo histories stay separate** (owner): the Agent's stack and A1's member history never record or undo each other's changes; each refuses on conflict. Proven by `agentA1UndoCompat.test.jsx` (a)–(c).

**Not in Phase 1 (by design or dependency):** indicator colours / styles / panes / copy (Phase 2, Indicators); anchored drawings (Phase 3); replay, float / pop-out / merge, screenshots, Multi-Chart grid presets, layout version history (out of scope); flagging tickers (the flagged list syncs as a whole set); sorting a list by price or change (no data in the list); reset view / zoom (no read-back the Agent can verify).

## Acceptance (Phase 1)

- `agentChartsOperatorP1.test.jsx` — every new capability against the real registry, planner, runtime and Undo.
- `agentChartsOperatorAcceptance.test.jsx` — through the real panel: A1–A8 (positional, side by side, copy a look, ordinals, one-chart side by side, every-chart indicator swap) and the hardening cases in both the legacy and NL-1 lanes.
- `agentA1UndoCompat.test.jsx` — A1's real member history and toast beside the real panel.
- Dev corpus +14 cases (`p1-01`…`p1-14`); the corpus harness now scores the multi-chart lane.

## Definition of DONE (whole programme)

1. Every in-scope manual Charts action is an Agent action through its canonical writer, with approval policy, receipt and Undo; out-of-scope items are refused honestly; the classification rails are green.
2. The acceptance catalog passes in the real-workspace harness in both lanes; no new failures against master by test identity; server limits and the golden manifest contract unchanged.
3. Real-model qualification on the sealed sets meets the gates in `agent/testing/acceptance.js` (0 unsafe plans; ≥90% interpretation; ≥85% conversation turns; ≥90% clarification recall; ≤5% unnecessary questions; p95 ≤ 6 s; ≤ $0.01 per request) — needs the owner's paid-eval authorization.
4. Released through the normal gate and promotion, with an authenticated admin smoke run.
