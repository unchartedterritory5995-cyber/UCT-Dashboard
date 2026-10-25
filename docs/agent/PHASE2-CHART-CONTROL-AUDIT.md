# UCT Agent — Phase 2: Chart Control Audit & Implementation Plan

**Status:** READ-ONLY AUDIT, 2026-10-25. No application behaviour changed. Awaiting owner review of the matrix and batch boundaries.
**Audited at:** origin/master `f0b4599b6f` (production `e9abce827a` + one notebook-only PR, #463).
**Method:** source reading with file:line evidence; existing Agent tests; two throw-away deterministic probes (deleted) against the real registry, fast path, legacy router, NL-1 selector and `planOps`. No model calls, no eval runs, sealed sets not opened.

Paths are relative to `app/src/` unless they start with `api/` or `docs/`.

---

## 1. Verified state

| Item | State |
|---|---|
| Production | `e9abce827a`, promoted 2026-10-25 04:27Z, range scan CLEAN. Site + `/api/health` 200. |
| Gate C (#403), stabilization (#423), NL-1 (#427), NL-1 hybrid (#439) | All merged and promoted. |
| NL-1 | Dark. Needs browser `uct.agent.nl1='1'` AND server `UCT_AGENT_NL1=1` (`agent/nl1/interpreter.js:29`, `api/services/uct_agent/turn.py:78`). Not set in the repo. The live Railway value was not read (CLI login expired). |
| Admin-only | Every `/api/agent/*` route uses `Depends(require_admin_dark)` (`api/routers/uct_agent.py:86-88`). `/api/agent/config` returns 401 to anonymous requests. |
| Limits | 60 actions per request (client `routing.js:184`, `nl1/selection.js:27-31`; server `turn.py:151-165`, refuses whole, never trims). Two model calls (`budget.py:55`, atomic `reserve()` `:263-268`). Model plan ≤ 12 ops (`turn.py:49` = `manifest.contract.json limits.maxOps`). |
| Indicators A1 | Draft PR #325 (`feat/indicators-a1` `2928cfc55e`), not merged, ~1700 commits behind master. It touches **no file under `app/src/agent/`**. Its Agent-adjacent files: `builder/agentMutations.js`, `engine/instanceControls.js`, `ChartWidget.jsx`, `ChartsWorkspace.jsx`. |

---

## 2. How the Agent changes a chart

- **Pipeline** (`agent/useAgent.js`): `send()` 1013. On legacy: references → fast path → model (1052-1338). Then the client screens the plan: `screenModelOps` 1376, `screenDeicticOps` 1393, `screenNewChart` 1405. Then `executeInner` 433: `prepareOps` → `planOps` (all-or-nothing, `executor.js:25-153`) → protected-layout guard 664 → approval binding check 673/681 → `decideMode` 718 → `boardStillOurs` 720 → propose or `commitPlan` 747 → `persistBoard` 754 → Undo pushed only if the save is confirmed (761) → receipt 781 → `rememberChange` 786.
- **Chart writes** go through the ChartWidget adapter `agent.commit` (`ChartWidget.jsx:337-350`). It uses the same `onOptsChange` sink as the manual settings and timeframe paths, and the same `setGroupSym` as a symbol pick.
- **Board writes** go through `widgetOps.applyBoard` (`ChartsWorkspace.jsx:2942-2953`).
- **Indicator writes** go through Indicators' `planIndicatorMutation` / `applyIndicatorMutation` / `confirmIndicatorMutation` / `undoIndicatorMutation` (`components/chart/builder/agentMutations.js:418/509/555/592`, contract `uct.indicators.mutation/1`). These wrap the UI's own writers.
- **Drawing writes** go through `drawingsStore.addDrawing/updateDrawing/removeDrawing` (`agent/host.js:444-446`), the same functions as `useChartDrawings`.
- **Approval:**
  - `planShape` (`executor.js:209-223`) proposes when any op has `risk:'confirm'`, `reversible:false` or `confirmIf`. Everything else applies, including multi-target plans (owner decision 2026-10-12, `policy.js:6-11`).
  - The binding (`executor.js:242`) pins each target's fingerprint plus the canonical patch. `approve()` checks the epoch, a 10-minute TTL, whole-or-nothing sealed proposals and a fail-closed server refresh (`useAgent.js:938-970`).
- **Undo:**
  - One entry per transaction, all-or-nothing, stack of 20 (`runtime.js:170-182`, `useAgent.js:243`).
  - The fingerprint must still match the post-change state.
  - It is session-only.

---

## 3. Capability matrix

Legend: **S** supported · **P** partial · **M** missing · **BI** blocked by Indicators · **U** unsafe or inconsistent.
"Same path" means the Agent calls the same canonical writer as the manual UI.
Legacy vs NL-1: every listed action is in both. The differences are routing (§4) and the fast path, which exists on legacy only.

### 3.1 Chart creation, removal, targeting
| Capability | Manual UI | Agent action | Same path | Undo / approval | Status |
|---|---|---|---|---|---|
| Add chart(s) | Widgets ▾ / right-click (`ChartWidget.jsx:865`) | `widget.add`, `widget.addCharts{symbols,timeframe,chart_type}` ≤12 (`workspace.js:198,256`) | Yes (`widgetOps.add`) | Undo closes them; addCharts is proposed | **P**: only into empty space, never resizes others |
| Remove widget | Header ✕ (`ChartsWorkspace.jsx:1443`) | `widget.remove` (`board.js:293`) | Equivalent, plus a clamp | Exact; two or more are proposed | **S** |
| Target a chart | Click → `selectedChartRef` | Ref `widgetId[~tabId]` (`host.js:19`); position words, deixis, click, memory subject (`deixis.js:80`, `references.js:182-189`) | n/a | Asks when unclear | **P**: unreachable are inactive chart tabs, inactive widget tabs, float/pop-out, Multi-Chart grid cells; "middle/second/third" not parsed |
| Model-path target guard | — | Only deictic requests are re-screened (`deixis.js:117`) | — | — | **U**: a bare "switch to weekly" on a multi-chart board under the model path applies to whatever ref the model picked (§5 F3) |

### 3.2 Symbols
| Capability | Manual | Agent | Same path | Undo | Status |
|---|---|---|---|---|---|
| Change symbol | SymbolSearch → `handleSymbolChange` (`ChartWidget.jsx:358`) | `chart.setSymbol` with real-symbol and company-name grounding (`chart.js:357-421`) | Commit yes. The Group-only/overlay reset is re-implemented (`chart.js:412`) | Exact; linked widgets follow but are **not** in the binding or the Undo fingerprint | **S** (see F9) |
| Symbol search / candidates | Dropdown | none (resolution happens inside setSymbol only) | — | — | **P** |

### 3.3 Timeframes and display
| Capability | Agent | Status |
|---|---|---|
| Timeframe | `chart.setTimeframe` (`chart.js:342`), same `onOptsChange` | **S** |
| Custom timeframe | `chart.addCustomTimeframe` (`chart.js:726`); same key, re-implemented | **P**: no remove (`ChartPane.jsx:504`), no ★ favourites (`:496`) |
| Chart type | `chart.setType` (`chart.js:326-340`) writes `chartType` only | **U** on breadth/indicator series, which read `breadthChartType` (`pane/ChartPane.jsx:338-351`). Found by reading the code, not yet confirmed by a test. Stocks: **S** |
| Session / scale | `chart.setSession`, `chart.setScale` | **S** |
| Theme (one / all) | `chart.applyTheme` (same `applyThemeToOneChart`), `chart.applyThemeAll` (same `themeAllChartWidgets`) | **S**. "All widgets" scope **M** |
| Background, candle colours | `chart.setBackground`, `chart.setCandleColors` | **P**: no gradient; no separate border/wick |
| Volume | `volume.setState` | **P**: no volume styling or MA |
| Display settings | `chart.setSetting`: ~54 descriptor rows marked `agent:'eligible'` (`chartSettingsDescriptors.js`) | **P**: watermark opacity/colour/position, header colours, info row, IPO/dark-pool markers, Heikin Ashi not eligible |
| Go to date | `chart.goToDate`, same `paneRef.goToDate` | **P**: no range or reset view. **U**: advertised `undo:'exact'`, but no Undo when the prior view is unknown, which silently drops Undo for the whole plan with no note; the fingerprint excludes view (F6) |
| Reset defaults | `chart.resetDefaults` keeps indicator-owned keys (`chart.js:275-282,654`); manual Restore wipes all (`ChartSettingsModal.jsx:468`) | **U (by design)**: needs an owner ruling; A1.3 changes manual Restore to keep indicators too |

### 3.4 Moving averages and indicators: add / remove
| Capability | Agent | Status |
|---|---|---|
| Add | `indicator.add{defId,inputs}` (`indicatorEdits.js:507`), fan-out per chart, fast path "add a 20 ema" | **S**. One indicator op per plan (`exclusive`+`sequential`, `:298`), so multi-indicator requests run as sequential steps with separate receipts and Undo. Adding EMA 9/20 when the default `ovl:*` EMAs exist creates duplicates without a warning |
| Remove | `indicator.remove{instance}`, always proposed, Undo restores the identity | **S** |

### 3.5 Indicator parameters, visibility, styling
| Capability | Agent | Status |
|---|---|---|
| Parameters | `indicator.update{instance,inputs}`; int/float/enum/bool advertised | **P** |
| Hidden keys | `indicator.update` **accepts** a colour key that is not advertised, and Indicators' `checkInstanceInput` does not validate colour strings (`engine/instanceControls.js:163-175`; the `SETTABLE` filter at `indicatorEdits.js:74` is presentation-only). A probe stored `"not-a-colour"`, and the receipt read "Change EMA 9 to EMA 9". | **U** (F4) |
| Show / hide | `indicator.show/hide` → `setInstanceHidden` | **S** (A1.1 changes hide semantics: `hiddenVia`) |
| Colour / width / line style / plot style | none; writers exist (`setInstanceAppearance :994`, `setInstancePlotStyle`, `setInstanceCandleColor :813`) but are not in `MUTATION_OPS` | **BI** |
| Instance addressing | exact id → legend name (ambiguity refused) → defId if unique → `#<len>` regex over display names (`indicatorEdits.js:306-318,396`) | **P**: length lookup is a regex over names, not structured |

### 3.6 Panes, position, ordering
| Capability | Manual | Status |
|---|---|---|
| Move to pane / merge / overlay on price or volume | `setInstanceDisplayTarget` (`instanceControls.js:866`) | **BI**: no mutation op |
| Pane order ("RSI above price") | `movePane/movePaneTo` (`engine/paneOrder.js:166,182`); pane keys derived inside `ChartSettingsIndicators.jsx:1305` | **BI**: no op, no exported `paneKeysOf`. `chart.js:14-16` forbids the Agent writing `paneOrder` |
| Pane heights | `setPaneSizes` | **BI** |
| Add into a specific pane | implicit via add only | **P** / **BI** |

### 3.7 Drawing tools
| Capability | Agent | Status |
|---|---|---|
| Horizontal level at a price | `drawing.addLevel{price,color,style}`, same object as the price-axis menu (`StockChart.jsx:5840`) | **S** |
| List | `drawing.list` (newest 40, 10 under compaction) | **S** |
| Restyle | `drawing.style{color,style,width}` | **P**: writes `color` on `advance`, where the UI uses `labelColor`; no fill or font size |
| Remove one | `drawing.remove`; refuses locked drawings or ones with a bound alert | **S** but **U**: applied immediately (risk local), target id chosen by the model, Undo re-adds with a new id, hidden drawings removable |
| Trendline, ray, hray, vertical, rect, fib, channel, pitchfork, text, avwap, measure, etc. | none | **M**. Needs exported `POINT_COUNT`/validator and a display-time helper (Charts-owned) |
| Move / set level, lock, hide, duplicate, clear all, alert-on-line, Drawing Board switch | none | **M** |
| Scope | per raw symbol: every chart on NVDA shares drawings + undo history; protected-layout guard only while that layout is open | Risk |

### 3.8 Comparisons and overlays
| Capability | Agent | Status |
|---|---|---|
| Add / remove / clear | `chart.compare{add,remove,clear}` (`chart.js:678-722`) | **P**. **U**: cap hard-coded at 10 while the product ceiling is `MAX_COMPARISONS = 5` (`chartCeilings.js:12`); the count ignores `remove`; removing an absent symbol says "already there"; the entry builder is re-implemented |
| Group-only, Same/New % scale, per-overlay colour/enable, add theme group | none | **M** |

### 3.9 Layouts, templates, workspace
| Capability | Agent | Status |
|---|---|---|
| Open / list / current / save / save-as / rename / create / delete / duplicate | `layout.*` (`layout.js:350-628`), Dock handlers; create/duplicate are safer create-only variants | **S** |
| Apply chart template | `chart.applyTemplate`, same `chartTemplateSettings`, proposed | **S** |
| Save / delete chart template | none | **M** (A1.3 is reworking templates: wait) |
| Multi-Chart grid layouts | none | **M** |

### 3.10 Sync and multi-chart
| Capability | Agent | Status |
|---|---|---|
| Link colour, chart tabs (add/select/rename/close/link) | `widget.setLink`, `chart.*Tab` (same reducers) | **S** |
| Widget tabs | select/rename/close only | **P** |
| "All charts" ops | fast path `ALL_RE` → one op per chart; model fan-out | **P**: only mounted, active, on-grid charts. Inactive tabs, widget-tabs and float charts are silently skipped. "all four charts" misses the fast path |
| Crosshair/time sync, grid Groups mode, Period Sort set-all | none | **M** |

### 3.11 Formula Builder / custom indicators
| Capability | Agent | Status |
|---|---|---|
| Open Create Indicator prefilled | `indicator.openCreate` | **S** |
| Draft / preview / save / undo draft | `indicator.draft/previewDraft/saveDraft/undoDraft` via Indicators-owned `builder/agentAuthoring.js` (`uct.indicators.authoring/1`) | **S** (cohort-gated; save proposed and permanent) |
| Copy indicators between charts | `indicator.add` re-creation only (lossy: colour, source, links lost); `chart.applyTemplate` needs a saved template | **P** / **BI** (needs `copyFrom`) |

### 3.12 Undo, approvals, receipts, memory
| Capability | Status |
|---|---|
| Approval binding, TTL, epoch, fail-closed refresh, compensation, read-back ACK, protected layouts on apply and Undo | **S** (verified) |
| Multi-step Undo (stack 20, per-receipt button) | **S**. "undo the last two changes" is not parsed (**M**) |
| "Undo that …" noun | ignored; newest entry undone (`fastPath.js:216-223`) | **P** |
| Memory: chart subject, indicator subject, last change, result sets | **S**. No drawing references (**M**) |
| Undo does not update memory | **U** (F2) |
| NL-1 correction undoes the newest entry, not the last change | **U** (F1, dark path) |
| Agent Undo vs A1.2's member Ctrl+Z stack | Two stacks over one chart; each refuses on conflict (safe), but a member's Ctrl+Z won't undo Agent changes | Needs a contract ruling |

---

## 4. Natural-language command coverage (deterministic; no model)

"Valid plan" = a hand-written ideal op list passes `planOps` against fixture boards (`agent/testing/fixtureHost.js`).

| # | Instruction | Legacy fast path | Needed action routed (legacy / NL-1) | Valid plan | Main risk | Gap owner |
|---|---|---|---|---|---|---|
| 1 | Put the 9 and 20 EMA on my chart | ✗ ("put" is not verb-carried, `fastPath.js:158,245`; "add the 9 and 20 EMA" ✓) | ✓ / ✓ | Yes, as 2 sequential steps | duplicates of default EMAs; which chart | Agent |
| 2 | Make the 9 green and the 20 red | ✗ | ✓ / ✓ | Only via the unadvertised `color` key, unvalidated | model told colours unsupported → refusal or a guess; garbage stored | Indicators (styling op + validation); Agent (key guard) |
| 3 | Change RSI to 28 periods | ✗ (trailing "periods"; "change rsi to 28" ✓) | ✓ / ✓ | Yes (`period:28`) | `indicator.add rsi 28` also validates, giving a second RSI | Agent |
| 4 | Move RSI above price | ✗ | workspace routed → `widget.move` on offer | **No** | widget moved instead of pane | Indicators (pane op), then Agent |
| 5 | Copy these indicators to the chart on the right | ✗ | ✓ / ✓ | Lossy, N sequential adds | "these" = selected/subject; partial copy; duplicates | Indicators (`copyFrom`) + Agent |
| 6 | Show me AAPL and NVDA side by side | ✗ | ✓ / ✓ | Yes on 2 charts (setSymbol ×2); addCharts refused on full boards | replace vs add; which two of four | Agent (intent policy) |
| 7 | Change all four charts to the daily timeframe | ✗ ("all" consumed, "four charts" left; "make every chart daily" ✓) | ✓ / ✓ | Yes (4× setTimeframe) | model may change only the selected chart; "four" never checked | Agent |
| 8 | Remove the comparison but keep my indicators | ✗ | **legacy: `chart.compare` NOT routed** ("comparison" ≠ `/\bcompare\b/`, `routing.js:281`) / NL-1 ✓ (charts in core) | Yes (`compare.clear`) | legacy substitution with `indicator.remove` (proposed, not silent) | Agent |
| 9 | Undo that last change | ✓ (`fastPath.js:222`) | — / **NL-1: not in the exact lane** (`nl1/interpreter.js:39`) → model, which has no undo action | n/a | NL-1 prose or reverse-op guess | Agent |
| 10 | Make the left chart look like the right one | ✗; the **legacy discovery misanswers** with the planned similar-charts topic (`discovery.js:174-176`) | partial | **No** single plan | partial copy | Agent (copy-look) + Indicators (indicator half) |

Corpora (dev `corpus.json` 195 turns / 91 chart; `dev-nl1.json` 46 / 27; exposed `heldout-v1.json` 196 / 89) contain **no** cases for: indicator colour or style, pane placement, copying indicators, "look like", two-ticker side by side, "all N charts", or removing a comparison. Only one `indicator.update` case exists in dev and none in exposed. The fixture strip of default MAs (NL1-PROXY-SMOKE.md:58) hides the duplicate-EMA risk from evals.

Additional gap-exposing instructions, to add to the dev corpus: "make the 20 EMA thicker and dashed"; "put RSI 14 on all four charts"; "swap the 9 for a 10 on every chart"; "hide everything except price and volume"; "remove QQQ from the comparison on the right chart"; "show NVDA on the left and AMD on the right"; "put the RSI back where it was"; "make this chart weekly and add the 50"; "change RSI to 28 periods on the right one"; "copy the left chart to a new chart with TSLA"; "undo the last two changes"; "turn off the 200 and keep the 50".

---

## 5. Defects and inconsistencies (severity order)

| ID | Finding | Evidence | Reach |
|---|---|---|---|
| F1 | NL-1 correction ("no, I meant 15m") undoes the **newest Undo entry** without checking it is `memory.lastChange`. They diverge after a non-undoable or unsaved change, or after the member pressed Undo, so an unrelated earlier change gets reversed. | `nl1/interpreter.js:197-205`; `useAgent.js:761` vs `786`; memory has no undo id | NL-1 only (dark). Must fix before any evaluation |
| F2 | Undo never updates conversation memory, so "do the same on the right one" repeats an undone change, and the model's `last_change_detail` describes it as live | `useAgent.js:905-920`; `references.js:244` | Legacy + NL-1 |
| F3 | No client guard on the model's chart choice for non-deictic requests on multi-chart boards. The owner's "bare command → clicked chart, named on receipt" rule exists only in the legacy fast path, so under NL-1 it is prompt-only | `deixis.js:117`; `useAgent.js:1126-1171`; `turn.py:455-457` | Legacy model path; all of NL-1 |
| F4 | `indicator.update` accepts unadvertised input keys (colour), and colour strings are not validated | `indicatorEdits.js:74`; `instanceControls.js:163-175` | Legacy + NL-1 |
| F5 | Compare cap 10 vs product ceiling 5; count ignores removals; wrong no-op text | `chart.js:699,721`; `chartCeilings.js:12` | Both |
| F6 | `chart.goToDate` advertises exact Undo but can have none, which drops Undo for the whole plan with no note; view is not in the fingerprint | `chart.js:224-233`; `executor.js:272` | Both |
| F7 | `chart.setType` on breadth-like series writes the wrong key (from reading the code; needs a confirming test) | `chart.js:337`; `ChartPane.jsx:338-351` | Both |
| F8 | Drawing removal applies immediately on a model-chosen id; Undo re-adds with a new id; hidden drawings are removable | `drawings.js:241-268`, `:93-103` | Both |
| F9 | `setSymbol` on a linked chart retargets linked widgets that are outside the binding and the Undo fingerprint | `chart.js:357-420` | Both |
| F10 | Stale memory subject after a two-chart change | `memory.js:59-60` | Both |
| F11 | Fast path applies "both/all" immediately while the server prompt says multi-target → propose; stale comments say "proposal" | `useAgent.js:1134-1140`; `fastPath.js:121-123`; `turn.py:446,456`; `policy.js:6-11` | Consistency |
| F12 | Effective client op cap 24 (96 raw) ≠ documented 12; `APPLY_MAX_OPS` dead with a wrong comment | `executor.js:23,32`; `policy.js:302` | Consistency (model plans still capped at 12 server-side) |
| F13 | `chart.resetDefaults` keeps indicators while manual Restore wipes them | `chart.js:654`; `ChartSettingsModal.jsx:468` | Owner ruling |
| F14 | "Undo that indicator removal" ignores the noun and undoes the newest entry | `fastPath.js:216-223` | Both |
| F15 | `drawing.style` on `advance` writes `color`, where the UI uses `labelColor` | `drawings.js:204-239`; `ChartDrawingOverlay.jsx:3176` | Both |
| F16 | Stale comments and descriptors: `workspace.js:29-31`, `chartSettingsDescriptors.js:133` | — | Docs |

Verified correct: approval binding + fail-closed refresh, epoch/TTL, all-or-nothing planning with compensation, read-back ACK, protected-layout guard on apply and Undo, server refusal of >60 actions and >12 ops, admin gate on all routes, drawing sync confirmation before Undo is offered.

---

## 6. Ownership boundary

**Indicators owns** (`components/chart/builder/*`, `components/chart/engine/*`, `ChartSettingsIndicators.jsx`, pane code): calculation, rendering, panes, ordering, sizes, indicator config and styling, Formula Builder and validation, indicator persistence, and the mutation contract `uct.indicators.mutation/1` + `uct.indicators.authoring/1`.

**Agent owns** (`agent/**`, `api/services/uct_agent/**`, `api/routers/uct_agent.py`): NL interpretation, routing and NL-1 selection, reference/target resolution, planning, approvals, receipts, Agent Undo stack, memory, action schemas, context providers.

**Charts workspace / drawing layer** (neither project): `ChartWidget.jsx` agent adapter, `ChartsWorkspace.jsx` `widgetOps`, `drawingsStore.js`, `ChartDrawingOverlay.jsx`. Agent changes here go through PRODUCT-HANDOFFS.

### Shared contract to stabilize

Exists today (freeze):
- `instancesOf`, `instanceFingerprint`, `INDICATOR_OWNED_TOP_KEYS` (`builder/agentSeams.js:30,67,116`)
- `catalogRows` / `inputSpecOf` / `checkInstanceInput` (`instanceControls.js:138,163`)
- `checkIndicatorPermission(op,args,ctx)` (`agentMutations.js:363`)
- `plan / apply / confirm / undo IndicatorMutation` (`:418/509/555/592`)
- `resolveIndicatorTarget` (`:387`) and `REASONS` (`:38`)
- confirm result `{status, receipt, undo}`
- Agent schemas `indicator.add/remove/update/show/hide/openCreate/draft/previewDraft/saveDraft/undoDraft`

To add (Indicators-owned, after A1 lands; same plan/apply/confirm/undo shape):
1. `setAppearance {instanceId, key: lineWidth|lineStyle|overlap, value}`, `setPlotStyle`, `setColor {instanceId, target, plotKey?, hex}`, plus colour validation in `checkInstanceInput`.
2. `setDisplayTarget {instanceId, target: pane|volume|price|@instanceId}`.
3. `movePane {paneKey, beforeKey|delta}`, `setPaneSize`.
4. `duplicate {instanceId}`, `copyFrom {sourceCs, instanceIds}` (exact copy via `addInstanceCopy`).
5. Exported pure `paneKeysOf(cs, registry)`.
6. Structured `resolveIndicatorTarget({defId, inputs, ordinal})` to replace the Agent's legend regex.
7. `instancesOf` exposes `hiddenVia` (A1.1) and built-in `defId` + current `inputs` (needed for copy and "look like").
8. Receipt carries `instanceFingerprintAfter`; the Agent passes `ctx.boardRevision` (currently never passed, `indicatorEdits.js:42`).
9. **Undo rule (owner ruling):** either Agent-confirmed changes are also recorded in A1.2's `recordIndicatorChange(..., {origin:'agent'})`, or A1's toast says Agent changes are undone from the Agent. Keep "Agent records never carry `granularity`" and both stacks refusing on `changed-since`.

---

## 7. Implementation batches

Each batch is its own PR, dark, admin-only, with no change to the 60 / 2-call / 12-op limits, budgets or permissions. Fixtures only; no model calls.

### P2-A — Safety and consistency fixes (Agent-only) ★ start now
- **What:**
  - F1: bind the Undo entry id into `memory.noteChange`; `correctionPlan` requires `entry.id === last.undoId`.
  - F2: `doUndo` marks or clears memory.
  - F4: `indicator.update` refuses keys outside `settableInputs` (Agent guard; the Indicators validation fix goes via handoff).
  - F5: import `MAX_COMPARISONS`, count after removals, correct no-op text.
  - F6: `goToDate` `undoNote` + honest `undo` metadata; view in the fingerprint for goto plans.
  - F7: confirm with a test, then write `breadthChartType` on breadth-like series.
  - F11, F12, F16: stale comments and dead code only. **No** policy change.
  - F14: the receipt names what was undone.
  - F15: `labelColor` on `advance`.
- **Files:** `agent/nl1/interpreter.js`, `agent/memory.js`, `agent/useAgent.js` (undo/remember only), `agent/capabilities/{chart,indicatorEdits,drawings}.js`, `agent/executor.js`, `agent/policy.js`, `agent/fastPath.js` (comments).
- **A1 overlap:** none.
- **Tests:**
  - Each finding gets a failing test first (correction after Undo; correction after an unsaved change; same-on-right after Undo; colour key refused; 6th comparison refused; breadth type).
  - Full `src/agent` suite, the backend Agent suite, manifest golden (expect a version bump only if summaries change).
- **Risk:** low. Watch for manifest-text changes that move the routing byte budget.

### P2-B — Targeting and NL coverage (Agent-only) ★ start now (after or alongside P2-A)
- **What:**
  - Fast path: verb carry for put/stick/throw; "all N charts" with the N checked against the board (ask on mismatch); trailing "periods/bars/length".
  - Router vocabulary: comparison/overlay → charts.
  - NL-1 exact undo lane broadened to "undo that last change", "undo the last change"; "undo the last N changes" as N sequential undos with one receipt each, all-or-nothing refusal.
  - Discovery: "look like" no longer maps to similar-charts.
  - **F3 client guard:** on a multi-chart board, a model-path op on a chart the member neither named, pointed at nor clicked becomes a proposal naming the chart.
  - F10: subject cleared on multi-chart changes.
  - "Which chart?" honesty: report unreachable charts (inactive tabs, float, grid) instead of silently skipping on "all".
  - Duplicate-indicator notice when adding an MA already present.
- **Files:** `agent/fastPath.js`, `agent/routing.js`, `agent/nl1/interpreter.js`, `agent/discovery.js`, `agent/deixis.js`, `agent/references.js`, `agent/memory.js`, `agent/useAgent.js` (screening).
- **Tests:**
  - Add the §4 instructions and the 12 extra instructions to the **dev** corpus (not exposed or sealed).
  - Deterministic coverage tests for fast path, routing and NL-1 selection.
  - Legacy prompt byte-identity where flags are off, for unrouted requests.
- **Risk:** medium. A guard that proposes more often could make admin UX chattier; the corpus defines "expected propose". Changes to routing shift which groups pack under 55, so run the selection coverage test.

### P2-C — Multi-chart workflows on existing APIs (Agent-only)
- **What:**
  - "A and B side by side" policy: two charts → setSymbol ×2; otherwise propose `addCharts`. Owner ruling needed.
  - Multi-clause positional symbols ("NVDA left, AMD right").
  - `indicator.update` fan-out ("swap the 9 for a 10 on every chart").
  - `chart.copyLook {from,to}`: copies the stored chart settings **minus** `INDICATOR_OWNED_TOP_KEYS`, through the same `agent.commit`; proposed; exact Undo.
- **Depends on:** P2-B targeting.
- **Files:** `agent/capabilities/{chart,indicatorEdits}.js`, `agent/useAgent.js` fan-out.
- **A1 overlap:** none (reads `INDICATOR_OWNED_TOP_KEYS` only).
- **Risk:** `copyLook` must never copy indicator keys. A test asserts the key set equals the shared constant.

### P2-D — Remaining chart controls via existing canonical writers (Agent + Charts handoffs)
- **What:**
  - Remove a custom timeframe (`removeCustomTf`), ★ favourites.
  - Compare Group-only and scale mode, built from the Compare panel's own helpers. Also export the entry builder and replace the Agent copy.
  - Reset view.
  - "All widgets" theme scope.
  - Additional `chart.setSetting` eligible rows.
- **Not included:** save/delete chart template (wait for A1.3).
- **Files:** `agent/capabilities/chart.js`, `chartSettingsDescriptors.js` (Charts-owned; handoff), `CompareSymbolsPanel.jsx` helper export (handoff).
- **Risk:** low-medium.

### P2-E — Drawings (Agent + drawing-layer handoff)
- **E1, now:**
  - Hide/show, lock/unlock, set level of a horizontal line (same `updateDrawing`).
  - `drawing.remove` becomes a proposal when the target is hidden, or when two candidates sit within a tolerance (owner ruling on whether all removals should be proposed).
  - Drawing subject in memory ("make it red").
- **E2, after a handoff:** time-anchored tools (trendline, ray, rect, fib, text), once the drawing layer exports `POINT_COUNT`, `validateDrawing` and a real-time→display-time helper. Points are only from member-given dates/prices or deterministic bar reads. Also update `confirmDrawingsSynced` for the dark `/api/tracings` store before that flag flips.
- **Risk:** per-symbol scope reaches other layouts, including Main Trading when it is closed. Receipts must say so; consider extending the protected-layout guard to any symbol shown on a protected layout.

### P2-F — Indicator styling, panes, copy (BLOCKED BY INDICATORS A1 + new ops)
- **What:** Agent wrappers for each Indicators op in §6 items 1-7: `indicator.style`, `indicator.moveTo`, `pane.move`, `pane.resize`, `indicator.duplicate`, `indicator.copyTo`; `indicator.add` `placement`; approval binding extended to `paneSizes`/`presentation`; the Undo rule (§6.9).
- **Can start:** only after A1 merges and Indicators ships the ops. Before that, only the joint contract doc (P2-G).

### P2-G — Shared contract document (joint, doc-only) ★ start now
- **What:** freeze `uct.indicators.mutation/1` as it is today; specify the shapes in §6 items 1-9; record the Undo-stack ruling; record that A1.0's `settingsRecord` is the shared record shape.
- **Files:** `docs/agent/` and `docs/indicators/` only. Needs Indicators' ACK.

---

## 8. Risks, testing, release

- **Wrong chart** is the main risk class: F3, F10, F9, the "all" partial reach, and the per-symbol drawing scope. Every batch adds multi-chart fixture tests: four charts, a selected chart, linked colours, inactive tab, protected layout.
- **Substitution:** `indicator.add` for update, `widget.move` for pane moves, `indicator.remove` for compare. Add deterministic substitution guards where an unambiguous rule exists (the hybrid's `apply → propose` guard is the model).
- **A1 collision:** keep Agent work inside `agent/**` until A1 merges. Anything that needs `agentMutations.js`, `instanceControls.js`, `ChartWidget.jsx` or `ChartsWorkspace.jsx` waits or goes through the Indicators session.
- **Per-batch test gate:**
  - `vitest src/agent` (1,348 baseline), `agentMutations`, backend `tests/test_uct_agent*.py` (645 baseline).
  - Manifest golden in JS and Python, NL-1 selection invariants, legacy byte-identity with flags off.
  - Production build, ESLint on changed files, secret scan.
- **Release:** one PR per batch → required CI → master deploy gate → promote. Admin-only, NL-1 untouched. Real-model acceptance remains blocked on the paid-eval decision; dev-corpus additions get exercised once evals are authorized.

## 9. Recommendation

Start **P2-A (safety and consistency fixes)** immediately, then **P2-B (targeting and NL coverage)**, with **P2-G (shared contract doc)** drafted in parallel for the Indicators session to ACK.

- All three live entirely in `app/src/agent/**` or docs, which A1 does not touch.
- P2-A fixes F1 before any NL-1 evaluation could hit it.
- P2-B removes the main wrong-chart risk and closes the cheap misses in the ten trader instructions.

P2-F (styling, panes, copy) is the most visible remaining capability, but it cannot proceed until A1 lands and Indicators ships the new mutation ops.
