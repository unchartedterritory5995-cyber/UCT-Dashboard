# State reconciliation + current mobile delta — 2026-09-08

Read against **HEAD**, not against the older worklist. Every row below was
checked in code; nothing is carried forward from `99b`'s status table, which is
where the stale claims came from.

## 1 · Contradictions found

The pre-merge checkpoint repeated three statements that are false at HEAD.

| claim in the checkpoint | truth at HEAD | evidence |
|---|---|---|
| **MOB-05** drawing-bound alerts *"DEFERRED — needs a schema change and server-side alert evaluation"* | **SHIPPED** | `api/services/watchlist_alert_service.py:63` — *"`drawing_id` BINDS the alert to a chart drawing ('follow this line', MOB-05)"*; `drawing_id` column in the insert; **`resync_bound_alerts(user_id, drawing_id, target_price=…)`** so a moved line re-points its alert; frontend `onSetAlert` + a "Set alert…" row; `components/chart/drawingAlertAnchors.js` + `drawingAlertMode.test.jsx` |
| **MOB-10** per-object Hide *"blocked on MOB-15 as its recovery surface"* | **BOTH SHIPPED** | `components/chart/drawingObjects.js` IS the recovery surface — its roster is derived from `TOOLS` rather than retyped, with `drawingObjects.test.js` failing by name if a tool loses its name. `ChartDrawingOverlay.jsx:2789` and `:2844` both call `updateDrawing(id, { hidden: !d.hidden })`, and `:1924` refuses to let a hidden object take a hit test |
| **R8** top-3 recent tools *"never authorized, still 🟡, unbuilt"* | **PARTIALLY SHIPPED** | `components/chart/MobileToolPicker.jsx` already persists recents — `RECENT_KEY = 'uct.draw.recentTools'`, most-recent-first, de-duplicated, capped, with the comment *"a phone's recent tools are not a fact about the account"*. What is missing is surfacing them **without opening the picker**, and long-press-for-last-tool |

Also corrected in passing: **MOB-08** (`presentation[deviceClass]`) is shipped —
`pages/charts/presentation/devicePresentation.js` + test — the worklist still
listed it as deferred.

⚰️ **Why this happened, because it is the same defect this repo keeps paying
for:** the checkpoint was assembled from a status table in `99b` rather than
from the code. A hand-maintained roster beside the thing it describes goes stale
silently, and it read as authoritative because it was specific. The rule that
applies here is the one already written across `CLAUDE.md`: **measure it, don't
quote it.**

## 2 · Verified-absent at HEAD

Checked, genuinely not there:

- **Advanced chart types.** `CHART_TYPE_OPTIONS` is `candles · hollow · bars ·
  HLC · line · area`, plus Heikin Ashi as a separate flag. No Renko, Kagi, Line
  Break, Point & Figure, Range, Step Line. (`BaselineSeries` is imported, but for
  the percent-compare baseline — not as a chart type.)
- **Bar Replay on the phone.** No replay door in the mobile shell; `hideReplay`
  is passed by grid cells. MOB-20 stands.
- **Multi-chart grid on the phone.** No door in `pages/charts/mobile/` — the grid
  remains desktop-only.
- **Session (pre/post/overnight) context in the review surfaces.** `sessionView` /
  `extendedHoursShading` exist on `StockChart` and are used by grid cells; no
  reference in the phone shell files.

## 3 · CURRENT MOBILE DELTA

Classified against the phase's own standard — *if this happens 100 times in a
session, is it excellent?* — **not** against TradingView's feature list.

⭐ **The advantage to protect.** TradingView ships **no native mobile screener**
(their own support docs). UCT already has scan → review and screener → review
entry points on a phone. That is the moat; breadth-chasing that does not deepen
it is a distraction.

| item | status at HEAD | review-workflow value | call |
|---|---|---|---|
| Persistent favourites (tools / indicators / timeframes / chart types) | recents exist for **tools** only; custom timeframes exist | **HIGH** — a reviewer uses 3 tools and 2 timeframes all session | **strongest candidate next** |
| R8 · top-3 recents rail + long-press last tool | recents persisted, not surfaced | **HIGH** — saves a picker open per drawing | fold into favourites |
| R7 · review-session context banner | not built | **MEDIUM** — the pill already answers "where am I" | low priority; risk of chrome |
| Swipe / long-press quick actions on review + watchlist + feed rows | `useLongPress` + `TickerActions` exist; not wired to feed rows | **HIGH** — flag/alert/tag without leaving the feed | high value, small |
| Device-specific last-chart / layout / resume | MOB-08 device-scoped presentation shipped | **MEDIUM** — resume-where-you-left is the remaining half | verify what resumes today before building |
| Watchlist / list-level alerts | per-symbol alerts only | **MEDIUM** — a list-level alert is a scan, and scans already exist | probably redundant with scans |
| Pre/post/overnight session info in review surfaces | absent on phone | **HIGH** — a gap is the reason you are reviewing at all | small, high value |
| Instant cross-device drawing/workspace sync | ordinary persistence + MOB-09 tracings highwatermark | **LOW** for review — phone-then-desktop is not a 100×/session action | leave |
| Mobile multi-chart layouts / sync | desktop only | **LOW–MED** — the **review feed already is** phone multi-chart, bounded and certified | do not duplicate |
| Mobile Bar Replay | absent (MOB-20) | **LOW** for review — replay is study, not triage | defer |
| Renko / Kagi / Line Break / P&F / Range / Baseline / Step Line | absent | **LOW** — none is used 100×/session by a reviewer | defer; pure breadth-chasing |
| One-tap trading | absent | **out of scope** | an execution-product question, not charting |

**Reading of the delta:** the four HIGH rows — favourites/recents surfacing, row
quick-actions, session context — are all *inside* the review loop and all small.
Everything TradingView-shaped (replay, exotic chart types, cross-device sync) is
LOW against this standard. The gap is depth in the loop we already own, not
breadth.

⛔ **Nothing above is authorized or started.** This section is classification for
the next decision, taken before a 168-commit merge so the merge is not made
against stale beliefs.
