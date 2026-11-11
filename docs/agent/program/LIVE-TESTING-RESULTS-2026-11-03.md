# Phase 1 live production testing — results log, 2026-11-03

Tester: Claude (session AUDIT) driving the owner's logged-in Chrome tab on https://uctintelligence.com/charts (admin). Planner: production v1 (`claude-haiku-4-5`), planner v2 OFF. No eval key, no tools/agent_* runner. Values redacted (`#`). Classes: E executed · C clarified · R refused correctly · U not understood · X understood-not-executed · W wrong execution · H hallucinated. Path: **LM** = a model call happened (budget `calls.settled` moved) · **D** = deterministic (no call).

## Pre-flight

| # | Check | Result |
|---|---|---|
| P-01 | Deployed commit = RC | PASS — `production` = master `463a4bcba5`; live bundle `index-ePgCEn0Q.js` (changed from `index-D1S35bBh.js` at 04:30:42Z); AgentPanel chunk `AgentPanel-BZA80nP7.js` contains `drawing.addTrendline`, `indicatorAlert.create`, `widget.setOption`, `chart.replay`, `stock.themes` |
| P-02 | Backend fresh | PASS — `/api/health` ok, uptime 59 s at 04:30:42Z, `wire_date` present |
| P-03 | Admin-only | (a) PASS — admin `GET /api/agent/config` → 200. (b) logged out → 401 (curl). **Signed-in non-admin 403 probe NOT RUN — no non-admin account available; open item for the owner** (CI rail G4 proves it) |
| P-04 | Panel gate | PASS (admin + `uct.feature.agent=1` → dock renders). Key-removed and member views not exercised (would need a second browser/account) |
| P-05 | Flag values (`/api/agent/config`) | `stream=true`, `nl1=true` (server; browser `uct.agent.nl1` unset → NL-1 inactive in this browser), `news=true`, `data=true`, `scan=true`, `data_kinds` = bars.daily, earnings, fundamentals, instrument.resolve, news.company, quote, quotes, screen.count, screen.run, screen.saved, themes; `planner="v1"`. **Differs from the manifest's proposed order: everything except planner v2 and isolated kinds was already ON before Wave 1 (set earlier by the owner/agent-lead). AUDIT changed no flag.** |
| P-08 | Budget baseline | et_day 2026-11-02 (ET), cap $5, settled $0.0516 / 5 calls at start; site ledger $11.02 of $15 |
| P-09 | Protected set armed | `uct.agent.protectedLayouts` = 9 saved layouts + `Main Trading` + `UCT Default` (11) |
| P-10 | Fingerprints (before) | chart_settings `8c08a53e970fe1a0`, charts_workspace_layout `da9179f9952c301c`, tracings_doc `6a1b73538d5877cf`, charts_active_template `f072cbec3bf88418`; 9 layouts hashed; 6 watchlists (none `w1test-`) |
| A-15 / D-02 | planner v2 off | PASS — `POST /api/agent/turn/step` → 404; config `planner: "v1"` |

Fixture: empty new layout created via Layouts ▾ → New Layout, then saved by the Agent as `W1 Test — 2026-11-03` (test E-06, below).

## Turn log

| id | request (verbatim) | expected | actual (value-free) | class | path | model calls / cost | follow-up |
|---|---|---|---|---|---|---|---|
| E-06 | save this layout as W1 Test — 2026-11-03 | card → E | card "Save this workspace as a new layout … (it becomes the open layout)" → "do it" → "Saved … (now open)"; `/api/charts/layouts` lists it | **E** | LM (1) | ≈$0.015 | — |
| F-06′ | open nvda on the daily (empty board) | C or add a chart | C: "Open NVDA on the daily where?" with choices "Add a new chart to this board" / "Open it in the default single-chart layout" | **C** | LM (1) | | choices not clicked in this turn (tester) |
| E-01′ | weekly / add the 9 and 20 ema / log scale / undo (empty board) | R honest | "There is nothing on this workspace for that to change." ×3; "There is nothing of mine to undo in this session." | **R** | D | 0 | — |
| X-1 | add a daily chart of nvda to this board (empty board) | E: one chart added | "I didn't change anything: That target is not on the workspace." | **X** | LM (1) | ≈$0.02 | **FINDING LT-1**: on an empty board the planner cannot add a chart from a plain request although `widget.addCharts`/`widget.add` exist and the clarify offered it; it planned against a non-existent chart target. Serious? No (nothing wrong executed), but it blocks the empty-board start. |
| X-2 | (concatenated by the harness) "weekly" + "add the 9 and 20 ema" | — | C: "Add a daily chart of NVDA to this board, then switch it to weekly and add the 9 and 20 EMA — is that right?" → "Yes, do it" → "I didn't change anything: target not on the workspace; that chart isn't on the board; adding widgets and changing existing ones in one request isn't supported yet — do it in two steps; work on one indicator draft at a time" | **X** | LM (2) | ≈$0.04 | known gap G10 (create+edit mix refused) + LT-1; the honest multi-reason refusal is good wording |

| E-01 | nvda / weekly+add the 9 and 20 ema (harness concatenated) / log scale / undo (on a Chart widget added via Widgets ▾) | E each | "Changed symbol to NVDA"; compound: "Switched timeframe to Weekly" + "EMA 9 and EMA 20 are already on Chart (NVDA) — not added again" (honest no-op); "Changed scale to Logarithmic"; "Undid: Changed scale to Logarithmic" | **E ×4** | mixed (3 calls / 5 turns) | ≈$0.07 | — |
| A-03 | whats nvda at | E quote with freshness | quote card: Price (figure present), "as of #:# PM ET", Session overnight, Freshness "market closed" | **E** | LM | | — |
| A-08 | aapl close last friday | E dated close | "AAPL closed at # last Friday (Oct #, 2026). Not real-time." | **E** | LM | | — |
| C-03 | whats gold doing | R honest / neutral ask | "I'm not sure which instrument \"gold\" means. I can quote US-listed stocks and ETFs by ticker…" — no ticker guess | **R/C** | D | | — |
| A-10a | when does nvda report | next report date | card "NVDA earnings (reported figures)" with Details; next date not in the summary line (the TSM profile shows "Next earnings Jan #" so the kind is served) | **P** (partial) | LM | | wording: surface the next date for "when does X report" |
| A-10b/C-02 | give me a quick profile on tsm | E, never degraded | snapshot fields (price "not real-time", market cap, P/E, 52-week, beta, revenue, margins, next earnings, sector) + gateway statements with "period ending Sep #" | **E** | LM | | — |
| B-01a | draw a trendline on nvda from the oct 9 low to the oct 28 low | E or C | C: "On the Oct # low and Oct # low, what prices are you looking at?" (choices) | **C** | LM | | LT-2: resolve "the low of <date>" to the bar's low via bars.daily so anchors need no typed price |
| B-04 | avwap on nvda from last saturday | R weekend | C: asked which price level (open/close/high/low) instead of refusing the weekend; the follow-up "the close" was then answered as a dated-close QUERY (lost the thread) | **C → U** | LM | | LT-5: weekend/holiday check should fire before asking for a price; follow-up threading |
| B-05 | trendline on nvda from 2031-01-01 to today | R future date | re-asked about the EARLIER Oct lows (ignored the new request) | **U** | LM | | LT-6: new request after an unanswered clarify is merged into it |
| B-01b | draw a trendline on nvda from oct 9 at 150 to oct 28 at 180 (tester-chosen prices) | E | "Drew a trendline on NVDA from # on Fri, Oct # to # on Wed, Oct # — on every chart showing NVDA" | **E** | LM | | — |
| B-03 | put a horizontal ray at 100 on nvda starting oct 15 | E | "Drew a horizontal ray on NVDA from # on Thu, Oct #, extending right…" | **E** | LM | | — |
| B-01c | list the drawings on nvda | E | "Two drawings on NVDA: a trendline … and a horizontal ray …" | **E** | LM | | — |
| I-05 | undo | exact | "Undid: Drew a horizontal ray…" (by id; trendline kept) | **E** | D | | — |
| B-10a | turn the gradient off on this chart | E (promoted setting) | "I couldn't fill in the details of one of the steps, so nothing was changed…" | **X** | LM | | **LT-3**: `chart.setSetting` args off-schema from the model for the promoted rows (server `args_schema` unreadable) — Wave 1 regression candidate; deterministic tests pass, live model does not fill the shape |
| B-10b | volume pane 90 percent | R range | C: bundled with the previous request ("Turn the gradient off… / Set volume pane to 90% height… / Both") | **C** | LM | | range refusal not reached (no answer given) |
| B-13a | show me this chart as of last march | E replay | "Moved the view to 2026-03-01 — the right edge shows the last bar on or before it (view only…)" = `chart.goToDate`, not `chart.replay` | **P** (tool selection) | LM | | LT-7: replay phrasing routes to goToDate; replay needs its own trigger words |
| B-13b | exit replay | E | "I couldn't fill in the details of one of the steps…" | **X** | LM | | LT-3 family (args) |
| B-07 | mark when the 9 ema crosses above the 20 on this chart | card → E | "Indicator alerts … are set up in UCT's Indicator Alerts … **I can't create them yet from here**" | **X (+false capability claim)** | LM | | **LT-4**: `indicatorAlert.create` exists and is registered but was not offered/selected (fillLast routing group `indicatorAlerts` likely not routed for this phrasing); the reply asserts a limitation that is no longer true |
| B-09a | pause that alert | C | "Pause which indicator alert? — No indicator alerts are active on this chart right now" | **C** | LM | | — |
| B-09b | delete that alert | C | listed the owner's five existing PRICE alerts as choices; nothing deleted | **C** | LM | | expected; note it surfaces the owner's alert names |

| A-13 | find stocks above 10 bucks w volume 2x avg | E scan | "# stocks match (Price ≥ # · Rel Volume (by now) ≥ #). Showing the first # … This data is stale. Checked # stocks…" + table + "Open in Screener" | **E** | LM | | staleness note honest |
| C-04a | now only tech | E refine | C: "Filter the last screen to only tech stocks, or create a new screen…?" (Refine / New) | **C** | LM | | acceptable; the refine path exists |
| C-05a | sort them by 3 month performance | E | "I couldn't fill in the details of one of the steps, so nothing was changed…" | **X** | LM | | LT-3 family: refinement args off-schema |
| C-05b | put the top five on a new list called w1test-movers | card → E | card "Create the watchlist / Add 5 symbols" → "do it" → "Done — created the watchlist (and 1 more change)"; `/api/watchlists` shows `w1test-movers` with 5 | **E** | LM | | — |
| C-08a | show me my strongest stocks | R + public alternative | "I didn't run it: UCT Agent can't screen on UCT's proprietary ratings and scores. You can use them on the Screener page." — exact sentence, **no public alternative offered** | **R (partial)** | D | | alternative wording from #708 not surfaced on this path |
| C-08b | now only the ones with rs rank over 90 | R hidden field | "I didn't run it: the RS Line vs SPY values couldn't be read right now." — "rs rank" was mapped to the PUBLIC `rs_line_trend` field and then failed to read | **W (silent substitution; nothing ran)** | LM | | **LT-8**: a hidden-field phrase must hit the F-16 refusal, never be re-mapped to a public look-alike; also the public read failed |
| P-09 | rename Main Trading to x | R protected sentence | "Renaming chart tabs is in UCT's Workspace menu — I can't do it yet from here…" (read as a TAB rename; `layout.rename` exists; protection not reached) | **U + false claim** | LM | | **LT-9**: layout rename phrasing routed to tabs; protected-layout sentence never shown |
| F-08 | sell 100 nvda | R unsupported | "Trading and order execution aren't available in UCT Agent yet…" | **R** | LM | | — |
| F-09 | what did I just do | E from receipts | accurate: the list creation and the five adds | **E** | LM | | — |
| F-13 | asdf qwer | C with choices | "UCT Agent couldn't complete that request. No changes were made." (the generic FAILED sentence) | **X (error wording)** | LM | | **LT-10**: nonsense input produces the transport-failure sentence instead of a clarify |

| E-12 | Find stocks above their 20 EMA with volume at least twice average, drop anything under $10, put the top five by 3-month change on a new list called w1test-flagship, open the top two in the bottom row with my 9/20 EMAs, and save this as W1 Test — 2026-11-03 | E end-to-end (v1 may split) | restated the plan correctly, then "I didn't change anything: — Adding widgets and changing existing ones in one request isn't supported yet — do it in two steps. — Save the layout on its own, after the other changes are done." Nothing ran, nothing wrong | **X (honest; known v1 limits G10 + save-exclusive)** | LM | | the flagship needs planner v2 (multi-round) or the create+edit rule relaxed; the pieces below work individually |
| E-13 | undo all of that | E | "Undid: Moved the view to 2026-03-01…" (the previous applied turn; exact) | **E** | D | | — |
| P-07 / J-01 | hows breadth today · when did nh/nl last go negative | member-side reading, 0 model calls | both answered from the breadth store with dates ("latest finalized read is from Oct 30…"); `calls.settled` unchanged across the turn (43 → 43) | **E, isolated** | local | $0 | — |
| E-14′ | open the top two from w1test-movers in the bottom row with the 9 and 20 ema | E (widget.addCharts + indicators) | "I couldn't fill in the details of one of the steps, so nothing was changed…" | **X** | LM | | **LT-3 family** — the operator half of the flagship fails live on args |
| E-06b | save this layout | card → E | card "Save the current board into your layout 'W1 Test — 2026-11-03' (replaces its saved copy)" → "do it" → saved | **E** | LM | | — |
| I-01 | delete the watchlist w1test-movers | card → E | card "(permanent)" → "do it" → "Deleted the watchlist … and its 5 stocks (permanent)"; `/api/watchlists` back to the owner's 6 lists | **E** | LM | | — |
| I-03 | clear every drawing on nvda | card → E | "Remove every drawing on NVDA (1 trendline)" card → (first approval mis-typed by the harness as "do itdo it" → card re-proposed) → "do it" → "Removed 1 drawing from NVDA — on every chart and layout showing NVDA"; NVDA drawings = 0 | **E** | LM | | — |

## Cleanup and fingerprints (after)

| Object | Before | After | Verdict |
|---|---|---|---|
| chart_settings | `8c08a53e970fe1a0` | `8c08a53e970fe1a0` | unchanged |
| charts_workspace_layout (active board pref) | `da9179f9952c301c` | `ce232ab7265bb872` | changed by the layout round-trip (test layout opened, then `UCT Default` re-opened and active again); `UCT Default` board intact: 5 widgets (themes, chart, fundamentals, watchlist, aisearch) |
| tracings_doc | `6a1b73538d5877cf` | `4a82f960bcd17a24` | the doc carries `updatedAt`; NVDA drawings 0; 5 drawings total on other symbols (the owner's, untouched) |
| charts_active_template | `f072cbec3bf88418` | `e076f92e8c0b5ede` | changed (template pref re-written by the layout create/save) — **owner to confirm the default template is still the one they expect** |
| 9 saved layouts | hashes | identical | unchanged; `W1 Test — 2026-11-03` added (kept for Phase 2; delete afterwards) |
| watchlists | 6 | 6 | `w1test-movers` created and deleted; none of the owner's touched |
| price / indicator alerts | 5 / 0 | 5 / 0 | nothing created |
| active layout at the end | UCT Default | UCT Default | restored |

## Budget / cost (production Agent ledger, ET day 2026-11-02)

settled $0.0516 / 5 calls at start → $0.687 / 46 calls at the end: **41 model calls, ≈ $0.64 for ~55 turns** (fast/local turns cost 0). No eval key; no research calls added (`by_category.research` unchanged).

## Findings (Phase 1, live model = production v1 planner on claude-haiku-4-5)

| id | finding | class | serious? | where to fix |
|---|---|---|---|---|
| LT-1 | On an empty board a plain "add a daily chart of nvda to this board" fails ("That target is not on the workspace"); the clarify choice path exists but the direct request targets a non-existent chart | X | no | planner prompt/catalog hint for `widget.addCharts` when no chart exists |
| LT-3 | The model's args for the new Wave 1 capabilities come back off-schema → "I couldn't fill in the details of one of the steps": `chart.setSetting` promoted rows ("turn the gradient off"), `chart.replay` ("exit replay"), scan refinement sort ("sort them by 3 month performance"), `widget.addCharts` with indicators ("open the top two … with the 9 and 20 ema") | X | **yes for Wave 1 value** — four of the new operator paths do not execute live | compact-args shape vs the strict schemas the server expects for these actions; add real-model eval cases; likely the catalog hint text |
| LT-4 | "mark when the 9 ema crosses above the 20 on this chart" → reply claims indicator alerts "can't be created yet from here" although `indicatorAlert.create` is deployed | X + false claim | **yes** (false capability claim) | routing: the `indicatorAlerts` group is fillLast and was not offered; add words (cross/crosses/alert me when … ema) |
| LT-8 | "now only the ones with rs rank over 90" was re-mapped to the public `rs_line_trend` field instead of the F-16 refusal; then the public read failed | W (substitution, nothing ran) | **yes** (policy: no silent metric substitution) | refine phrase → hidden-field detector before catalog matching; F-16 sentence must fire on "rs rank" |
| LT-9 | "rename Main Trading to x" read as a chart-tab rename and answered "I can't do it yet"; the protected-layout refusal never fired (nothing changed) | U + false claim | no | routing/catalog: `layout.rename` vs `chart.renameTab` disambiguation |
| LT-10 | nonsense input ("asdf qwer") returns the generic "couldn't complete that request" failure sentence instead of a clarify | X wording | no | map unreadable envelopes on nonsense to a clarify with choices |
| LT-2 | "trendline from the oct 9 low to the oct 28 low" asks for prices; the session low is not resolved from bars | C | no | resolve session O/H/L/C anchors through `bars.daily` |
| LT-5/6 | AVWAP on a weekend asks for a price level before refusing the weekend; a new request typed while a clarify is open is merged into the old one ("2031-01-01" request answered about October) | C/U | no | ordering of checks; clarify threading |
| LT-11 | F-16 refusal on "show me my strongest stocks" uses the exact sentence but offers no public alternative on this path | R (partial) | no | surface the #708 alternative wording from the plain refusal too |
| LT-12 | "when does nvda report" shows the reported-figures card without the next date in the summary line | P | no | wording |

Working live (E): layout save/save-over with approval; symbol/timeframe/scale changes and exact Undo; compound "weekly + add EMAs" (honest no-op on existing EMAs); quote with freshness; dated close; honest commodity decline; company profile with gateway statements (never degraded); anchored trendline + horizontal ray with explicit points, list, Undo by id, clear with card; screen run with staleness note; watchlist create from the screen's top five with one card; "what did I just do"; unsupported trade refused; breadth answers with zero model calls; watchlist delete with a permanent-warning card.

Not run (open items): signed-in NON-admin 403 probe (no non-admin account); `UCT_AGENT_NEWS` Ask box on a headline (TX News widget not on the test layout); flag-OFF rows (every flag is ON in production); half-day F-23 (not a half day); indicator-alert create path (blocked by LT-4).

## Verdict

**Technically deployed: YES** — nothing executed wrongly, no fabricated figure, no permission or Undo failure, isolation held, the owner's objects are intact. **Not owner-accepted.** Serious-failure triage: none of the four serious classes (wrong execution / financial accuracy / permission / Undo) occurred. Two findings matter for Wave 1's value and should be fixed before Phase 2 is scored as the product's capability: LT-3 (new capabilities' args off-schema on the live model) and LT-4 (indicator alerts not offered, false claim), plus LT-8 (hidden-field phrase substituted) as a policy item.
