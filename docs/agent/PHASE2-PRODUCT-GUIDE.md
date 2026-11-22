# UCT Agent Phase 2 — Interactive product guide (Workstream B)

Built overnight on 2026-10-29, on branch `feat/agent-p2-guide`. It is not merged or deployed.

The guide has three modes, and they are kept strictly apart:

| Mode | Example | What happens | Changes the board? |
|---|---|---|---|
| **Explain** | "What is RSI?", "What does ADR mean?", "What is an EMA?", "What's the difference between a chart indicator and a condition?" | An instant answer in UCT's own words: the indicator catalog's own description (name, short name or tag naming exactly one row; "an EMA" is the Moving Average's Type), or the product's concepts and features. | Never. `guide.explain` is a query. |
| **Show me** | "Where do I change the timeframe?" | The **real** control is highlighted on the board, with a step card (Next, Back, Exit, Done). | Never. `guide.show` is a query and the overlay clicks nothing. |
| **Do it for me** | "Now do it for me" (after a walkthrough) | The feature's **existing** capability runs on the chart that was shown. It asks for the value first ("Which timeframe?"). | Yes, through the ordinary planner, policy, receipt and Undo. |

## Architecture

| Part | Role |
|---|---|
| `agent/guide/registry.js` | The tutorials. Each one names its **discovery topic** (`discovery.js` TOPICS) and the **registered capabilities** that do it. Whether a member sees a tutorial is read from the live manifest (`guideFeatures(ctx)`). Nothing about availability is stated by hand. |
| `agent/guide/targets.js` | Finds the real control in one of three ways. (1) A stable `data-guide` id the control carries. (2) A control's own accessible name inside a registered container; this is used for Indicators' search box, so no Indicators file was edited. (3) A board cell by widget type. Chart controls are scoped to the chart being discussed (`data-widget-id`). A target counts only if it is **visible**; this reuses the Notebook tour's `isOnScreen`. |
| `agent/guide/GuideOverlay.jsx` | The ring and the card. See "Safety" below for how it behaves. |
| `agent/guide/guideStore.js` | One walkthrough at a time, session-only. It also keeps `lastShown`, which "do it for me" uses. |
| `agent/guide/explain.js` | Explanations, in this order: UCT concepts, then the indicator catalog (`meta.description`), then a feature's `explain`. |
| `agent/capabilities/guide.js` | `guide.show` and `guide.explain`, both on a read-only `guide` target. It also holds `doItForMe`. |
| Routing, discovery and contract | A `guide` routing group (show-me words), a discovery topic, a regenerated manifest golden and NL-1 parity fixture, and the Python group map. |

The UI edits are **attributes only**: `data-guide` on the symbol slot, timeframe bar, "More timeframes", timeframe
menu, settings gear, Chart settings panel and tabs, drawing tools, Widgets ▾ and its chips, the layouts dock and
library, and the watchlist picker. Board cells also got `data-widget-type`. No behaviour changed.
`agentGuideTargets.test.js` reads the source and checks that every registered target is rendered by a real
control.

## Tutorials (all working against the real controls)

| # | Tutorial | Steps | Do it for me |
|---|---|---|---|
| 1 | Changing a chart's symbol | The symbol name. | Says what to say ("change this chart to NVDA"), because the value comes from the member. |
| 2 | Changing timeframes | The timeframe buttons, then "More timeframes". | Asks "Which timeframe?" with choices, then runs `chart.setTimeframe` with a receipt and Undo. |
| 3 | Adding and configuring an indicator | The gear, then the Indicators tab, then the search box and the list of indicators already on the chart. It waits for the member's clicks and starts where they already are. | Asks "Which indicator?" with the chart's own quick-menu studies as choices, then runs `indicator.add`. |
| 4 | Creating and arranging several charts | Widgets ▾, then Chart (with a note on dragging headers and edges). | Says what to say ("four daily charts for …"). |
| 5 | Using watchlists | The board's own watchlist (only if there is one), then Widgets ▾, then Watchlist. | Says what to say. |
| 6 | Saving and switching layouts | The layouts bar, then the library. | Says what to say. |
| 7 | Basic drawing tools | The drawing tools, then Horizontal Line, then Trendline. | Says what to say ("draw a line at 450"). |
| 8 | Finding chart settings | The gear, then the tabs. | Says what to say. |

## Safety

- **Access:** Agent is admin-only, so the guide is too. A tutorial whose capabilities the member cannot use is not
  shown; for example, the indicator walkthrough is hidden without indicator access.
- **No writer:** the guide has no writer of its own. "Do it for me" runs the existing capabilities through the
  normal path.
- **Never claims what it cannot see:** if the control isn't on screen, it says so and explains instead. If the
  control disappears mid-walkthrough, the guide stops and says why.
- **Does not interfere:** the ring has `pointer-events: none`, the card is non-modal (`data-escape-layer`), the
  overlay never takes focus, and it cleans up every timer and listener on unmount.
- **Escape:** one press does one thing. The guide listens last and ends only when nothing else answers: a text field's
  Escape is the field's, an open sheet, palette or dialog owns the press, a menu the press closed had it, and a press
  something prevented or stopped is left alone. It is declared in the shortcut registry (`agent.guideEscape`, with the
  `agent.guideEscapeGate` observer) and bound only while a walkthrough is on screen. The card's × always ends it.

## Instant indicator explanations (owner decision 2026-10-29)

A simple question naming exactly one catalog indicator is answered instantly from the catalog
(`components/chart/indicatorCatalog`): "What is RSI?", "What does ADR mean?", "What is MACD?", "What is an EMA?"
(one of the Moving Average's types, read from its own `Type` options), and "RSI vs MACD". A name, short name or id
wins over a tag ("ATR" is ATR, not SuperTrend's `atr` tag); a term that names several rows is not guessed. There is
no separate glossary: the hand-written EMA-vs-SMA entry was removed.

The model still answers anything more: "EMA vs SMA" (two types of one indicator), "what is RSI telling me about
NVDA", "a good RSI setting for the 5 minute", and terms the catalog lacks ("a dead cat bounce", "a VCP").
The NL corpus `talk-01` ("what is rsi") now expects the instant answer; `talk-07` (EMA vs SMA) still expects the
model. `agentCore` and `agentGuide` were updated to match.

## Tests

| File | What it covers |
|---|---|
| `agentGuide.test.jsx` | 28 tests through the real panel with the controls in the document. **Explain** changes nothing; catalog indicators are instant; anything more goes to the model. **Show me** covers the real control, steps, the clicked chart, "can't see it", waiting for the member's click, a context-aware start, a lost control, Escape and Exit, and that it is non-modal with no focus steal. **Do it for me** covers Weekly with Undo, RSI, a feature that needs the member's words, no hijack without a walkthrough, and a direct command. |
| `agentGuideTargets.test.js` | 19 tests: every target is real; capabilities and topics exist; both guide capabilities are queries; access gating; feature matching. |
| `agentPhase2Integration.test.jsx` | The brief's Phase 5 conversations with both workstreams together. |

## Guide system (2026-11-05)

"How do I…" about a Charts action runs a walkthrough on the real controls: gold outline, floating dark panel, step counter, Next, Close. There is still one framework. `guide/registry.js` holds the entries, `guide/GuideOverlay.jsx` runs them, and adding a tutorial is one entry plus `data-guide` attributes.

### What a walkthrough does

| Situation | Behaviour |
|---|---|
| Part of it is already done | Starts at the furthest step whose predecessor's result is true on screen. The earlier steps stay in the count, so Back and Restart reach them. |
| A step's result is already true (a menu open, a tab selected) | Skipped, at the start and while running. A step's `waitFor` is its result. |
| Something is closed | The walkthrough opens with the control that opens it. |
| The control is greyed out | Says why, in the step's own `off` sentence. |
| The control is behind an open window | Says so. |
| A narrow row clipped the control (the gear, with the Agent open and two charts) | Slides the row while the step needs it, and puts it back. |
| The chart is too narrow to show drawing tools | Says so, and gives the keyboard chord. Pressing it moves the walkthrough on. |
| A menu closes, or a window is shut | Returns to the nearest earlier step on screen. |
| Nothing earlier is on screen (a layout switched) | Pauses and offers Restart, carries on by itself when the control returns, and stops with a notice after 30 seconds. |
| The member's click closes the control | That step is done. The last one finishes with no notice. |
| Skip on a step the next one depends on | Stays there and says what to do first. |
| "Do it for me" on the card, or typed | The feature's existing capability, through the normal `doIt` path. The card works over a modal, where the Agent panel is inert. |

The card never sits on the control. `placeCard` measures the card, tries below, above and beside the control, and stays off the menu or window it is in when there is room.

### Families

A registry entry teaches a family. `slots` (`guide/slots.js`) read which one from the member's words, and steps name it as `{slot.field}`. The rows come from the product's own tables wherever one exists: the indicator catalog, the widget registry and the settings descriptors. Drawing tools and grids are hand rows, railed against `TOOLS` and `LAYOUTS`.

| Feature | Teaches | Path |
|---|---|---|
| `indicators` | Add any catalog indicator | Gear, Indicators, Add to Chart, search, result |
| `indicatorColor` | An indicator's colour | Gear, Indicators, its row, the swatch, the colour panel |
| `indicatorEdit` | One setting of an indicator | Gear, Indicators, its row, the field |
| `drawing` | Every toolbar tool | The tool, then the clicks it needs on the chart |
| `multiChart` | Every grid preset | Layouts, Multi Chart, the preset, then the way back |
| `widgetResize`, `widgetMove` | Resize and move | The edge and corner, the header |
| `layoutSave` | Save, or save as new | Layouts, Save Layout, then the choice |
| `alertIndicator`, `alertPrice` | Indicator and price alerts | The bell and its form; the Alerts widget, added if missing |
| `widgetAdd`, `widgetSettings`, `widgetHeader` | Any widget, its gear, its header buttons | Widgets menu, the Place box on a full board, the gear |
| `compare`, `replay`, `periodSort`, `goToDate`, `chartTab`, `chartThemes`, `chartTemplate`, `chartType`, `timeframeCustom`, `watchlistAddSymbol`, `widgetMerge` | One path each | |
| `chartSetting` | Every row of `chartSettingsDescriptors` with a Chart Settings path | Gear, its tab, its section |

### Action families (2026-11-05, coverage pass 2)

`guide/actions.js` holds the small actions that share a surface. A family is one feature and a table of rows; a row is `{ id, label, re, steps }`, and the feature's `{ each: 'slot' }` step takes the chosen row's own steps. Adding an action on a surface a family already covers is one row, plus `data-guide` (or `data-menu-id`) on its control.

| Family | Surface |
|---|---|
| `chartMenu` | The chart's right-click menu (`ChartWidget.jsx`) |
| `legendChip` | A legend chip's menu (`legend/chipMenu.js`) |
| `chartView` | Pane dividers, range and session buttons, Share, and the chart's keys |
| `compareAction`, `panelAction` | Compare Symbols, the timeframe menu, Replay, theme scope, Restore Defaults |
| `drawingEdit` | A drawing's own right-click menu and the toolbar's Undo |
| `indicatorManage` | Chart settings → Indicators: templates, panes, Remove, Create Indicator |
| `watchlistAction` | Watchlist rows, the row menu, column titles |
| `layoutAction`, `tabAction` | The layout bar's menu, widget tabs and chart tabs |
| `widgetAction` | One row per control of one widget, adding the widget first when it isn't on the board |

A control that appears only on a right-click gets a step that asks for the right-click, on the real region, and moves on when the row it needs appears. A menu opened on the wrong region does not satisfy it: the step stays and repeats where to click.

A pane divider is drawn by the chart library, so it carries no attribute of ours. `{ within: 'chart.plot', cursor: 'row-resize' }` finds the library's own handle, and the ring follows it while it is dragged.

Status per action is in the coverage pass's `teach-status.md`, generated from recorded real-mouse runs.

### What pass 2 found in the browser

- The inventory read the right-click menu from `StockChart.jsx`. That menu is the app-wide one. On `/charts`, `ChartWidget.jsx` takes the right-click and shows its own, much shorter menu, so scale, chart type, extended hours, Add indicator and Draw line are not on it. Rows written from the inventory failed on the first real right-click and were rewritten against the real menu.
- A list target's `altText` looked only at the first entry, so "Relative Strength Index" read as "RSI isn't on this chart" although the second entry had found it.
- A `chart.*` id inside a portalled menu was searched for only inside the chart cell. Timeframe rows are now `timeframe.*`, and a `within` box ending in `Menu` is searched everywhere.
- A watchlist row's menu opens only on the ticker symbol, not the whole row.
- Words like "show me how" read as the Show row of a family. A family's row reader drops how the member asked before it reads what they asked for.

### What pass 3 found in the browser

- **The card disabled the keys it named.** `utils/modalOpen.js` reads any `role="dialog"` as a modal, so the chart ignored every chord while a card said "press Alt+Shift+A". The card is now `role="region"`, and each key row was re-run with the card on screen.
- **The Formula Builder is reachable on `/charts`:** Alt+Shift+A opens the indicator library, and New formula opens the builder. Create Indicator is the other door, and goes to the Agent.
- **Multi Chart walkthroughs run.** Each chart in the grid is a cell the guide can scope to. The session buttons do not fit on a narrow cell, so that row says so.
- **"Do it for me" while the Agent is busy** used to drop the click. The card now says so in fixed words.
- A target below the fold of a long window is scrolled up, rather than passed over for its fallback.
- **Two charts with the Agent open squeeze the drawing strip to nothing:** the fixed buttons beside it take the whole line, and "where are the drawing tools" got a sentence instead of a walkthrough. While a step needs the strip, the buttons beside it step aside, and they come back when the step ends. Nothing is stored.
- **The Canvas walkthrough ended on a step that repeated the last one,** so the card stayed on Skip. The tab is now its last step and the card offers Done.

### What the browser found that tests could not

These were only visible on the real workspace (`agent-harness.html`, headless Chrome, real mouse):

- With the Agent open on a two-chart board, the gear is clipped and the drawing tools are squeezed to nothing.
- `inertBackground` marks the card inert while Chart Settings is open, so its buttons did nothing and a press landed on the backdrop, which closed the window. The card now carries `data-sheet-keep-live`.
- The Agent panel is inert while Chart Settings is open, so a member cannot type there. Only the card can hand over.
- A press on the card counted as an outside click and closed popovers.
- A full board asks where a widget goes (the Place box), which no walkthrough knew.
- The old `indicators` walkthrough stalled when a row was selected: the search box only shows after Add to Chart.
- Layouts ▾ closes when the pointer leaves it, so a step there cannot rely on Next.

### Held-out result

`agentGuideHeldOut.test.js` holds 40 teaching phrasings written after the registry.

| Set | Result |
|---|---|
| Instant path, first run | 26 of 30 reached the right walkthrough. One of the four misses was a wrong expectation in the table ("a news widget" is the menu's News chip, `tradeExchangeNews`). The other three were real ("recoloring", "get alerted", and "on the chart" read as the Chart widget), and were fixed afterwards, so those three no longer count as held out. |
| Depends on the real model | 10 of 10 miss the instant path: "what is the way to…", "i want to learn how to…", "which button makes…", "help me add…". Deterministic tests prove nothing about these. No paid model call was made. |
| Browser, ten phrasings across start states | 10 of 10 showed a ring on a live control with the card off it: one chart, two charts, a watchlist rail, half-empty board, light theme, 1100×700 window. |

So 26 of 40 are proved instant on first sight, and 10 of 40 are unproved until an owner-approved model run.

### Limits

- The Agent refuses every request in Multi Chart mode, so no walkthrough can start there.
- Right-click menus, legend chip menus and pane dividers have no `data-guide`, so they are not taught.
- The bell's popover overflows the left edge on a narrow chart. That is a layout defect in the popover, not in the guide.

## Not done

- **Explaining the settings of an open indicator-settings panel.** The guide knows Chart settings is open and starts
  there, but it does not read the dialog's fields.
- **Mobile Charts:** the walkthroughs target the desktop workspace.
- **"Do it for me" for symbol, charts, watchlists, layouts and drawing** says what to say rather than offering
  choices. These need the member's own value, so none is guessed.

## Try it (admin, Charts)

1. "Where do I change the timeframe?", click Next, then say "Now do it for me", then click Weekly, then "undo".
2. "Show me where to add an indicator", then click the gear yourself; the card follows you.
3. Open Chart settings, then ask "how do I add an indicator?"; it starts at the search box.
4. "What's the difference between a chart indicator and a condition?"
