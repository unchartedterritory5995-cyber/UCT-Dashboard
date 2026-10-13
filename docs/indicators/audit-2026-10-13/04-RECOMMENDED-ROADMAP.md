# UCT Indicators — Recommended Roadmap

**Audit date:** 2026-10-13
**Baseline:** master = production `84164aee3d`

This roadmap orders work by **practical value to serious traders**, not by feature count. Finding IDs (P0-x, P1-x, P2-x) refer to `03-GAP-ANALYSIS.md`. Nothing here is authorized for implementation; it is a proposal for the owner's approval.

**Effort:**
- **S** — less than 1 day
- **M** — 1–5 days
- **L** — 1–3 weeks
- **XL** — more than 3 weeks

These are relative engineering estimates for one focused session, including tests.

**Principles:**
1. **Correct and honest before broad.** An import or indicator that misleads is worse than one that refuses.
2. **Extend the existing engine; don't fork it.**
   - One manifest, one tree, two interpreters, one permission gate (`evaluability.js`).
   - Every item below adds to that infrastructure.
   - Nothing introduces a third formula language.
3. **Members first, then admin features.** Admin-only Agent features don't move the competitive position until they reach members.
4. **Don't build it because TradingView has it.** Backtesting and a full scripting language are deliberately *not* in the first two phases.

---

## Phase A — Stabilization (correctness, persistence, trust, critical tests)

**Why:** these are broken promises. Each one damages trust in the whole Indicators product, migration most of all.

| # | Scope | Findings | Effort |
|---|---|---|---|
| A1 | **Import correctness.** Fix PCF `STOC` argument order (with an alert-migration notice for saved definitions); fix thinkScript MTF composition; disclose or anchor `ta.cum`. Each fix gets a value-checked test against an independent reference, so the existing shape-only and wrong-tree tests are replaced | P0-1, P0-2, P0-3 | M |
| A2 | **One honest import verdict.** Compute the verdict from the lane that will draw it. Surface host notes (strategies, state). Unknown note codes default to "values may differ". Reserve "Exact" for capture-backed constructs. Use the four-class outcome (values / visuals / inputs / behaviour) | P0-7, H1–H8 | M |
| A3 | **Protect configured studies.** Route the toggle-off doors (Library row, Ctrl+I/O/B, Alt+U, right-click submenu, Settings list) through hide or single-instance remove. Surface instances dropped by `normalizeInstances` ("1 indicator could not be shown: …"). Uninstall deleted definitions in open tabs | P0-6, P1-7, P2-2 | M |
| A4 | **Undo for indicator operations** (add, remove, input edit, move, toggle), persisted across reload. Reuse the Agent's exact-undo model (`agentMutations.js:507-532`) rather than inventing a new one | P1-8 | M–L |
| A5 | **Ichimoku as standard.** Forward-displaced spans on the future axis (the infrastructure exists), cloud fill, per-line warm-up, and alert-address migration. Needs owner sign-off; this is the "preserved quirk" | P0-4 | M |
| A6 | **VWAP family truth.** Alert evaluator respects the RTH/ETH view the chart used. AVWAP calendar anchors refuse partial history (like the date branch already does). Alert parameters seeded from the chart instance. Stochastic slow on the server | P1-4, P1-5, P1-6 | M |
| A7 | **Renderer honesty.** Remove or implement "Last value horizontal". Fix marker dots and autoscale. Own-pane object coordinates. Global hide covers all layers. Area per-bar colour (or refuse the restyle) | P0-5, P1-2, P1-3, P2-5, P2-6 | M |
| A8 | **Restore red rails.** Add `version` to the fixtures behind the 68 security and integrity tests. Re-ground the concierge and starter fixtures. Fix the phase-E `~s2` lookup. Make the escape census platform-independent and run it on the Linux production image | P1-1, P2-15 | S–M |
| A9 | **Privacy:** stop returning `author_id` from share resolution (or return a pseudonymous handle) | P2-1 | S |

**Dependencies:**
- A1 needs a decision on saved STOC alerts: notify, auto-migrate, or keep the old hash.
- A5 needs owner sign-off.
- A4 depends on A3, because the toggle semantics must be settled first.

**Risks:**
- Changing calculations (STOC, Ichimoku, VWAP) changes armed alerts. Every change needs a migration note and a dry-run count of affected saved definitions (read-only).
- `controlDoorCensus.test.js` and other rails pin today's toggle behaviour, so A3 has to update them deliberately.

**Acceptance criteria:**
- All P0s are closed, each with a test that fails on today's code.
- No import label claims "Exact" or "the values are the same" without a capture-backed or reference-backed test.
- Toggling an indicator off never loses another instance's settings, and every indicator operation is undoable.
- The backend indicator suites are green at head (or each remaining red is ticketed with a cause).
- The escape census is green on Linux.

**Can be built independently:** A1, A2, A7, A8 and A9.

**Should wait or coordinate:**
- A1's STOC alert migration involves the alerts owner.
- A5 needs owner sign-off.
- A3 and A4 touch `StockChart.jsx`, which is shared with the chart/drawing sessions, so coordinate on it.

---

## Phase B — Competitive parity (what serious traders expect)

**Why:** these are the limits active traders hit in their first week, measured against TradingView, thinkorswim and TC2000.

| # | Scope | Findings | Effort |
|---|---|---|---|
| B1 | **Lengths as parameters** in formulas (`sma(close, len)` with a declared input), resolved at bind time so budgets and lookbacks stay static | P1-9 | M |
| B2 | **VWAP crosses and session functions** within budget: a precise budget for `vwap()`, so `crossOver(close, vwap())` fits | P1-10 | S–M |
| B3 | **Formula multi-timeframe:** daily-on-intraday and intraday-on-intraday (`tf(x,'D')`, `'60'`), on the existing calc-timeframe and `mtfProjection` machinery the natives already use, with completed-bar semantics | P1-11 | L |
| B4 | **Missing classics in the shared table** (one implementation reaches every consumer and every import door): supertrend, obv, sar, alma, dema/tema, tsi, cmo, variance, zscore, barssince, `hl2/hlc3/ohlc4`, `%`; plus server twins for the chart-only Tier-1 studies, which makes them alertable and screenable | P2-11, WS1 G-1 | M–L |
| B5 | **Migration visuals and inputs** (roadmap items 3–6 in the migration report): Pine `hline`/fills/linewidth/arrows; thinkScript presentation (finish the `C:/w/rpw` work with its owner); thinkScript study references with disclosed defaults; scan one-liner detection; choice inputs; keep the source | P1-14…P1-17, P2-12 | L |
| B6 | **Incremental evaluation and off-main-thread compute** for the host lane. The runtime lane's checkpoint/resume (`runtimeColumns.js:530-620`) and worker are the model to reuse | P1-13, P2-16 | L |
| B7 | **Workspace workflow:** apply an indicator, or a preset of indicators, to all charts / this layout; per-chart vs global scope (the dead `scope` code); parameter sync across charts; settle the templates flag | P2-4 | M–L |
| B8 | **Error messages** (single line, positioned, did-you-mean, suggested substitute from the manifest, no internal jargon); fix `and`/`or` routing; link the formula reference from the Formula tab | P2-7, P2-8 | M |
| B9 | **Visual builder depth:** arithmetic on a side, nested calls, numeric indicators, plain-language function names | P2-9 | L |

**Dependencies:**
- B1 makes B5's editable inputs simpler.
- B3 builds on the native calc-timeframe infrastructure.
- B6 should land before Phase D's runtime rollout.

**Risks:**
- B3 and B6 touch the binder and caching, which are performance-critical. Gate them behind a nightly fixed-runner benchmark (WS8 §A4 methodology) with a ±15% tolerance.
- B4's server twins must keep cross-lane parity tests green.

**Acceptance criteria:**
- The WS4 "refused" list shrinks by the items above, each verified across browser and Python lanes.
- The thinkScript corpus keeps styling on 15 of 18 scripts or more.
- Pine chart-door scripts keep hline, width and arrows.
- A one-bar live tick costs at most 10% of a cold evaluation, on the clean benchmark.
- Applying an indicator to every chart in a layout takes one action.

**Can be built independently:** B1, B2, B4, B8 and B9.

**Should wait or coordinate:**
- B5's thinkScript presentation: coordinate with the `C:/w/rpw` owner.
- B6: coordinate with the chart-performance owners.
- B7: coordinate with the workspace/layout owners.

---

## Phase C — UCT differentiation (reasons to choose UCT)

**Why:** this is where UCT can be meaningfully *better*, not just equal. Each item builds on infrastructure that already exists.

| # | Scope | Why traders care | Existing foundation | Effort |
|---|---|---|---|---|
| C1 | **Formula columns everywhere:** a user formula as a sortable, colour-coded watchlist or screener column, the same tree as the chart | TC2000's defining strength, and the momentum trader's daily workflow (scan, sort, chart) | One tree; `serverCompute` / `useServerColumns`; `scan_definition` | L |
| C2 | **One condition, many surfaces:** save a condition once ("9 > 20 EMA with volume expansion") and attach it to candle colour, background, markers, an alert and a scan from one place; edit once and update everywhere | It removes the copy-paste drift between chart and scan that every other platform has | Paints, alerts and scans already share the tree; the owner's two examples are already expressible | M–L |
| C3 | **Composition and building blocks:** reference another indicator's output; saved reusable sub-formulas ("my volume-expansion block") | Lets traders build systems from parts they trust | `let` bindings; `memberValue.js`; the share/library store | L |
| C4 | **Context-aware indicators:** market regime, breadth and RS as first-class formula operands (`breadth('UCTA50')`, `rs_rank`, `regime()`), e.g. "colour candles only when breadth > 60%" | Momentum traders trade *with* the market; no competitor lets a formula read proprietary breadth | 45 breadth symbols, 193 MI series and RS line already exist; `sym()`'s roster mechanism and the series adapters. **Feasibility check needed:** none is a formula operand today | L |
| C5 | **Migration inbox and trusted report:** bulk paste of a TradingView/thinkorswim/TC2000 set, ranked compatibility table, per-script four-class report, "Exact" backed by captures | Removes the biggest switching cost; no competitor offers it | `libraryIntake.js`; `importOutcome.js`; vendor harness | M–L |
| C6 | **Transparent calculation explanations:** every built-in and formula gets "how this is calculated" from its tree, plus convention notes (EMA seed, population SD, ATR seed) | StockCharts' ChartSchool is the benchmark for trust; UCT can generate this rather than hand-write it | Read-back (`sentence.js`); convention notes already in WS1 | M |
| C7 | **Keyboard-first indicator workflow:** a command palette for "add RSI 7 to all charts", "hide all oscillators", "apply preset Momentum" | Speed for active traders | The Ctrl-K palette already exists (notebook bytes); chart chords | M |

**Dependencies:**
- C1 and C2 depend on A2 and A3, so that trust and persistence are settled first.
- C4 needs a data-access design (which series, what latency, point-in-time correctness) with the breadth/MI owners.

**Risks:**
- Formula columns over large watchlists cost backend compute. They need budgets per member and caching keyed by (definition, symbol, bar), with the server lane's existing budget checks.
- C4 must keep point-in-time correctness: no lookahead from finalized breadth (memory: NH/NL finalized-only).

**Acceptance criteria:**
- A member can build the owner's two examples, apply them to candles and an alert and a scan column, and edit once to update all three.
- A 100-script bulk import produces a ranked report with no false "Exact".

**Can be built independently:** C5, C6 and C7.

**Should wait:** C4, on the Breadth/Market-Intelligence owners.

---

## Phase D — Advanced intelligence (Agent, runtime, historical studies)

| # | Scope | Notes | Effort |
|---|---|---|---|
| D1 | **Staged Pine runtime VM rollout:** grading captures, the save gate, admins → cohort → members, kill list | The single largest Pine unlock (`var` 58.9%, loops 36.6%). Exact in this audit on Supertrend and ATR trails. **The owner has said to keep it disabled; this is listed only for a future decision** | XL |
| D2 | **thinkScript `rec`/`CompoundValue`/`fold` on the same runtime** | After D1 | L |
| D3 | **UCT Agent to members (staged):** the NL indicator workflow ("highlight inside days white, alert on a break of yesterday's high") through the existing approval/undo contract | The architecture is sound (WS4, WS6). The blocker is policy and cost, not code. Do it after A2, because the Agent's receipts inherit import honesty | L |
| D4 | **Historical condition studies on user formulas:** "how often did this condition lead to +X% in N days", over the MI event-study engine | A light-weight answer to backtesting that fits UCT's research identity, before any order-simulating strategy tester | L |
| D5 | **Strategy testing** (only if D4 shows demand) | Deliberately last | XL |

**Dependencies:**
- D1 depends on B6 (incremental, worker) and A2 (honesty).
- D3 depends on owner policy and the Anthropic credit/cost posture (see the 10-13 credit outage).

**Acceptance criteria:**
- **D1:** each promoted script has a capture-graded MATCH. A kill switch is tested.
- **D3:** members can create, refine and undo indicators through the Agent, with no formula text in chat, which is the owner's standing rule.

---

## What to build first

**Phase A, items A1 + A2 + A3**, in that order. Together they:
- make every existing import truthful;
- fix the three wrong-value imports;
- stop the one-keystroke loss of configured studies.

They are mostly M-sized, need no owner policy decisions apart from the STOC alert-migration notice, and protect the migration story, which is the owner's top priority, before anything is added to it.
