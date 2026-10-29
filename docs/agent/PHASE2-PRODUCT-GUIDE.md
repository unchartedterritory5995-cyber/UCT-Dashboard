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
- **Escape:** pressed inside the card, it ends the guide. There is no window-level key listener, so the app's key
  census and shortcut registry are untouched and every other Escape works as before.

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
