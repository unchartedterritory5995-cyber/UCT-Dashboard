# Notebook wave 13: program plan (2026-10-02)

**A trader-first notebook: plans that grade themselves, charts that are the plan, your own edge.**

| | |
|---|---|
| Status | **FINAL SCOPE.** Program document for 16 lanes: 13A-13J plus 13Q, with sub-lanes 13A/E/H/I split -1/-2 and 13C split 1/2. |
| Owner | Patrick (merges, deploys, flag flips, beta operations) |
| Written by | wave-13 planner, session 441b0c89; read-only on code |
| Base | `origin/feat/notebook-w12-landing` at `0c437e7c6d` (wave 12 not yet merged) |
| Extends | `NOTEBOOK-10-OF-10-PLAN.md`, `WAVE-12-PLAN.md` (replaces neither) |
| Citations | Every `file:line` was read at `0c437e7c6d` (R-CITE). A line number is a dated claim, so re-read it before acting. Competitor claims carry their vendor URL. |

---

## 0. Executive summary

**Objective.** Make the UCT Notebook the notebook a swing trader works in every day, and better at
that job than Notion, Evernote, Obsidian and the trading journals (TradeZella, Edgewonk,
TraderSync, TradesViz and the rest). It should do what none of them can, because it holds the
member's broker fills, UCT's charts, scanners and pattern engine, and the member's own research.
Wave 13 builds five capabilities on what already exists:
- **Plans that grade themselves.** A plan drawn on a chart or written in a note is matched to the
  broker fill and graded.
- **The market frozen at the fill.** The context of every entry is captured and kept.
- **The member's own edge,** measured honestly.
- **A flagship chart and technical-analysis track.** The chart is the plan, carries a technical
  fingerprint, builds a visual playbook, runs an active-setups board and finds more names like
  this one.
- **Research that comes back when it matters.**

Beta operations (testers, invites, feedback programmes, launch) are owner-managed and **out of
scope** (section 9).

**Program goals (product and engineering), each checkable:**

| # | goal | measured by |
|---|---|---|
| G1 | Every lane's definition of done met | the lane specs, Appendix A |
| G2 | Every lane walked in a real browser at 390 and 1200 px, keyboard included, flag off and on | `docs/notebook/evidence/w13<x>/` raw walk JSON, committed before summary (R-RAW) |
| G3 | Performance budgets held: note open p95 < 300 ms at 1,000 paragraphs, search p95 < 100 ms at 50k, the Notebook first-open byte budget, typing per D24 | `docs/notebook/perf-budgets.json`; ruling D9 (`NOTEBOOK-10-OF-10-PLAN.md`:159); the chart engine stays off the first-open closure (`lib/widgetEmbedCore.js`:11-18) |
| G4 | 13Q click budgets met for all 23 flows, or each miss owned by a lane | section 6, `tools/notebook_w13q_clicks.py` evidence |
| G5 | Zero schema or data-safety regressions | the never-revert keep-list updated for the one schema change; broker-mirror, account-purge and address-space rails green; no second writer into notes |
| G6 | AI cost per call bounded by the existing caps: **zero new model calls** in wave-13 code | import-graph rails per lane (Appendix A) |
| G7 | One six-shard gate with 0 NEW failures against a fresh master baseline (D16) | `docs/notebook/gate-runs/wave13-landing/` |

**Milestones** (section 5): M0 scaffold, M1 foundations, M2 core features, M3 flagship and
research, M4 hardening and gate, M5 ship.

**Critical path:** M0 scaffold, then 13A-1 plan core, 13H-1 chart schema, 13H-2 chart plan,
13I-2 visual playbook, 13Q-2 fixes, the gate, the wave-12 PR merge, and finally the wave-13 PR
merge and deploy.

---

## 1. Product strategy

### 1.1 Who the member is

| segment | share | what they do daily | what they need from a notebook |
|---|---|---|---|
| **Chart-first swing trader** (primary, owner, 2026-10-02) | most members | Scan, mark up charts, set levels, trade breakouts, pullbacks and EPs, manage stops | The chart IS the plan; levels that become alerts and grades; a playbook of their own setups; a morning board |
| Research-driven trader (secondary) | some | Theses, earnings, filings, transcripts | Prep that writes itself, passages they can cite, theses that come back when the price says so |

### 1.2 Jobs to be done

1. *"Before the open, show me my setups and how close each is to triggering."* (13J)
2. *"Let me draw the plan on the chart, and tell me size and R:R."* (13H)
3. *"After the trade, tell me honestly whether I followed my plan."* (13A)
4. *"Remember what the market looked like when I got in."* (13E)
5. *"Which of my setups actually pay, and on what kind of chart?"* (13B, 13I)
6. *"Find me more names that look like my best winners."* (13J)
7. *"Write my review for me, from what happened."* (13F)
8. *"When a name I wrote about hits my level or reports, put my thinking in front of me."* (13C, 13D)
9. *"Let me save the sentence from the call and use it as evidence."* (13G)

### 1.3 Why UCT wins (competitive findings)

Two read-only research reports, 2026-10-02, cover **31 products**:
- 13 trader journals and charting platforms;
- 18 notes, AI-notebook and investor-research tools.

They are held in the session scratchpad, not in the repo. Every claim below carries its URL.
"Reported" marks a review-site claim, and TraderSync's vendor pages returned 403.

**Where UCT is already ahead.** No trader-journal page fetched states any of these:
- a thesis linked both ways to a broker-synced position (G-070);
- charts and facts frozen at insert (G-060 to G-062);
- a thesis changelog citing Compass verdicts (G-073b);
- the stop-hit-with-research alert (G-074);
- a zero-setup per-ticker workspace (G-111);
- Ask answers whose citations are verified locations, and which refuse when the notes don't
  support them (G-123, G-124).

The two big charting platforms leave journaling to others:
- TradingView offers text notes per symbol
  (https://www.tradingview.com/support/solutions/43000667897-how-to-check-all-text-notes/);
- TrendSpider offers a spreadsheet template
  (https://trendspider.com/calculators/spreadsheets/trading-journal/).

**Positioning by category:**

| category (count) | their strength | their gap that wave 13 takes |
|---|---|---|
| Trader journals (12: TradeZella, Edgewonk, TraderSync, Tradervue, TradesViz, Kinfo, Chartlog, Trademetria, Stonk Journal, Journalytix, TraderMake.money, TradeBench) | Broker sync, stats, rules checklists the trader ticks, replay, AI chat | Plans graded by hand or not at all; context not frozen; charts are live, not the plan. Their notes are plain text beside trades |
| Charting platforms (TradingView, TrendSpider) | Charts and alerts | Journaling left to third parties; alerts carry no note (https://www.tradingview.com/features/) |
| Notes and AI notebooks (Notion, Evernote, Obsidian, OneNote, Apple Notes, Craft, Capacities, Tana, Reflect, Mem, NotebookLM) | Editors, capture, agents, MCP | Know nothing about trades, levels or earnings. Notion's 285 trading-journal templates are static (https://www.notion.com/templates/category/trading-journal) |
| Investor research (Koyfin, Seeking Alpha, Fiscal.ai, AlphaSense, Finviz Elite, Tradervue) | Transcripts, filings, monitoring | Notes are a light annotation; they monitor the company, not the member's claim (https://docs.fiscal.ai/docs/guides/mcp-skills) |

**Per capability: the bar to beat.**

| lane | best competitor practice | how wave 13 beats it |
|---|---|---|
| 13A | Plan first, compare plan with outcome by hand: TradeBench (https://tradebench.com/trading-journal-features/). Checklist-item stats and an "Efficiency" score: Edgewonk (https://edgewonk.com/trading-psychology). A rules heatmap: TradeZella (https://www.tradezella.com/trading-journal) | Graded automatically from the fill, frozen, every number cited |
| 13B, 13I | Deterministic checks ranked by dollar impact and z-test confidence, with an LLM that only narrates: TradesViz (https://www.tradesviz.com/blog/ai-coach-trading-review/). Setup tags "which ones actually pay you": Tradervue (https://www.tradervue.com/) | Honest ranges and sample labels, plus the frozen chart and fingerprint of every setup |
| 13E | A note prompt on each fill: Journalytix (https://www.jigsawtrading.com/journalytix-institutional-grade-trade-analytics/). "Review without hindsight changing the story": Finviz (https://elite.finviz.com/blog/journal-every-trade-with-detailed-notes-insights/) | No competitor freezes market context at the fill |
| 13F | A Session Review agent: TradeZella (https://help.tradezella.com/en/articles/11201153-what-is-zella-ai-tradezella-s-ai-trading-assistant). Report cards: Edgewonk (https://edgewonk.com/trading-psychology) | A review note built from the member's own data, with deterministic leaks, n and dollars |
| 13H | A chart with entry and exit on every imported trade: Chartlog (reported, https://trading-journals.com/reviews/chartlog). Annotated charts pasted into a diary: TradeBench (URL above). A price-level Note drawing tool: TradingView (https://www.tradingview.com/blog/en/new-note-tool-47007/) | A live, interactive chart inside the note whose drawn lines ARE the plan: graded, sized and alertable |
| 13J | Real-time screener: Finviz (https://finviz.com/elite) and TradesViz. No competitor states "find names like my winners" | Similarity over UCT's own nightly-scored universe |
| 13C, 13G | AI call summaries: Seeking Alpha (snippet, https://seekingalpha.com/article/4774507-navigating-premium-key-features-plus-new-ai-powered-tools). Highlight tags: AlphaSense (https://help.alpha-sense.com/hc/en-us/articles/41816174285459-Annotate-Documents-and-Notes-with-Highlight-Tags). Note icons on watchlist rows: TradingView (URL above). Missed trades entered by hand: Edgewonk (URL above) | Prep and passages tied to the member's own thesis and trades. Thesis status and distance on the row. Passed setups scored automatically |
| 13D | The strongest alerts, but no note: TradingView (URL above) | Monitors the member's own claim and opens what they thought then |

---

## 2. Scope

### 2.1 Tracks, lanes and definitions of done

| track | lane | member-facing outcome | done when |
|---|---|---|---|
| **Execution and discipline** | 13A | Every closed trade shows its plan and four checks (entry, stop, size, target); Unplanned label; discipline record; review note; setup chip | Appendix A.13A met; walk green |
| | 13E | An Entry-context card frozen at the fill (regime, scans, breadth, RS, days to earnings), plus a "why did you take it?" note | A.13E |
| | 13F | Daily, weekly and monthly review notes drafted on a click, with the leak finder (n, dollars, cited trades) | A.13F |
| **Edge and playbook** | 13B | My Playbook: per-setup stats with honest ranges, notes linked, what you wrote before losses vs wins | A.13B |
| | 13I | (shared with Charts and TA) | A.13I |
| **Charts and TA (flagship)** | 13H | The full interactive chart in the note: drawings saved with the note, the drawn plan with R:R and size, alerts from drawn levels, bar replay, multi-timeframe and benchmark blocks | A.13H |
| | 13I | The technical fingerprint at insert; checklist autofill; a visual playbook grid with filters and slice stats; pattern suggestions; before and after | A.13I |
| | 13J | The active setups board (the morning cockpit) and find more like this | A.13J |
| **Research and catalysts** | 13C | Reporting soon, and a one-click pre-filled earnings prep note | A.13C |
| | 13D | Notes resurface when price, move or date says so (in-app) | A.13D |
| | 13G | Transcript passages as citable excerpts; thesis chips on rows; a passed-setups journal | A.13G |
| **Usability** | 13Q | The click-by-click program: 23 flows with budgets; misses fixed | Section 6 |

Every new surface carries **one empty-state line or one tooltip** of help, as part of its lane.
There is no onboarding programme.

### 2.2 Out of scope, and why

| item | why |
|---|---|
| Beta operations (testers, invites, cohorts, feedback programme, known-issues and what's-new pages, 100-user cost and load sizing, the support path, beta metrics) | **Owner ruling 2026-10-02:** managed by the owner, on the side |
| An MCP server over the personal API (TradesViz https://www.tradesviz.com/, Notion https://developers.notion.com/docs/mcp, Evernote https://evernote.com/mcp) | A privacy surface that needs the zero-retention posture first (8a) |
| Scheduled agents (Notion https://www.notion.com/product/ai, Mem https://get.mem.ai/pricing) | 13F drafts on a click; AI Actions stays dark |
| Exit what-if simulation (Edgewonk https://edgewonk.com/, TradesViz) | Next-wave candidate; MFE/MAE already exists (`db.py`:1756-1761) |
| Mentor mode (TradeZella https://www.tradezella.com/pricing, Tradervue https://www.tradervue.com/site/pricing/) | D4 keeps comments and team workspaces out |
| Tick replay, and overlays on replay | TradeZella and TraderSync lead on fidelity (reported). 13H's bar replay covers "what happened next" |
| **Later candidates** (do not plan) | Replay launched from a note chart; shareable annotated chart cards (the trade card exists: `lib/tradeCardPng.js`) |
| Standing rulings | Multiplayer and a plugin marketplace (D4); native apps and cold-start offline (D5, D19); two-way sync (D18); the size cap (D20) |

---

## 3. Architecture

### 3.1 Shared foundations (single authorities, landing first in M0 and M1)

| foundation | single authority | owner lane | consumed by |
|---|---|---|---|
| **Plan levels** | `api/services/journal_two/plan_extract.py`, the ONE reader of "levels named in a note" | 13A-1 | 13A grading; 13H (writes roles that it reads); 13D index; 13G chips; 13I before/after; 13J board |
| **Technical fingerprint** | `api/services/journal_two/tech_fingerprint.py`. It reuses the screener's own formulas and re-derives none | 13I-1 | 13I panel, checklist and filters; 13J find-similar |
| **Chart-block storage and schema** | The `widgetEmbed` node. Drawings live in its existing `annotations` attr; ONE new attr `ta` holds setup tag, frozen fingerprint and plan-block marker. **Never-revert** (section 3.5) | 13H-1 | 13H, 13I, 13J |
| **Frozen market context** | `api/services/journal_two/entry_context.py`, keyed (member, symbol, entry day) | 13E-1 | 13E card; 13F leaks; 13I filters and before/after |
| **Level index** | `j2_note_levels`, a projection of `plan_extract` output, never in the save path | 13D | 13D resurfacing; 13G chips; 13J board |
| **Sample-size wording** (ruling R3) | `lib/sampleSize.js` + `sample_size.py`, with a parity rail | 13B | 13B, 13F, 13I |
| **Flags and scaffold** | M0 commit: one row per flag in `docs/feature_flags.json` and `NOTEBOOK_FLAGS` (`api/routers/auth.py`:142-178); reserved `api/main.py` lines; flag-gated nav links | integrator | all |

### 3.2 What exists and is reused, not rebuilt (cited)

| capability | where it lives today |
|---|---|
| A real StockChart inside a note (ChartPane), frozen by `replayCutoff`, live mode, "what happened next" peek | `components/notebook/ChartEmbed.jsx`:26-61, :83-135, :141-150; `components/StockChart.jsx`:2366 |
| Drawings saved on the note, not in localStorage: a controlled annotation layer and Draw mode | `ChartEmbed.jsx`:113-130; `components/notebook/WidgetEmbedView.jsx`:498-556, :631-635. A frozen copy of the /charts drawings is taken at capture (`lib/widgetEmbedCore.js`:71-110) |
| The /charts drawing store, localStorage per symbol (NOT used for note charts) | `components/chart/drawingsStore.js`:1-30; `useChartDrawings.js`:1-6; `StockChart.jsx`:6105 |
| Per-embed chart settings, and the member's own settings stamped at insert | `ChartEmbed.jsx`:53-56, :146-147; `widgetEmbedCore.js`:11-29 |
| `/mtf` (D, 1h, 15m) and `/compare` (before and after) inserts | `widgetEmbedCore.js`:208, :472-495; `components/notebook/SlashMenu.jsx`:440-490 |
| A linked crosshair across a note's charts | `ChartEmbed.jsx`:44-48 |
| Drawing tools (trendline, horizontal, rectangle, fib, AVWAP, text), touch routing | `components/chart/ChartDrawingOverlay.jsx`; rail `ChartDrawingOverlay.touchRouting.test.jsx` |
| Indicators: MA overlays, HVC, the RS line (server-computed), AVWAP | `components/chart/chartDefaults.js`:128, :146; `chart/engine/nativeRegistry.js`:149-151, :1896-1902 (the indicator engine, `chart/engine/`) |
| Alerts bound to drawings (level or trendline, follow-the-line sync) | `components/chart/useBoundDrawingAlerts.js`:1-23; `drawingAlertAnchors.js`:88; `api/services/watchlist_alert_service.py`:53-94; `api/routers/watchlist_alerts.py`:37, :65, :82 |
| Bar replay as its own chart (never a StockChart mode) | `journal-2-0/components/trade/TradeReplay.jsx`:1-16 |
| Sizing | `brain_service.size_a_trade`, long only, 2% cap, needs the brain pack (`api/services/brain_service.py`:178-199); starter formulas `risk_per_share` and `position_size` (`lib/formula/computed.js`:41-60); `maxRiskPerTradePct` (`accounts.py`:78) |
| The trade-plan canvas, levels with roles | `lib/tradeCanvas.js`:7-11, :69-74; `trade_canvas.py`:62 |
| Multi-chart grid herd-safety | `pages/charts/grid/GridChartCell.jsx`:439 (`backgroundWarm={false}`); `useStaggeredMount.js`:17 (limit 3); `gridWarm.js`:15; `gridLayouts.js`:14 (16 cells max) |
| Pattern engine | `pattern_detections` (`api/services/pattern_engine/pattern_db.py`:26-47); `GET /api/patterns/{sym}`, default `confirmed_only=True` (`api/routers/patterns.py`:134, :679-690); Compass tool (`voice_tool_impls.py`:2056) |
| Nightly scored universe (the fingerprint's columns) | `screener_rows` technical, momentum and pattern columns (`api/services/screener/snapshot_db.py`:65-75, :113-121); built by `snapshot_builder.build_row` (`snapshot_builder.py`:325); formulas in `technicals.compute_technicals` (`technicals.py`:475-545, pole `:202`, RS-line trend `:252`), `candles.multi_candle` (close CV, `candles.py`:252, :283-292), base tightness (`base_catalog.py`:1235-1240); scan sweep 05:00 ET (`scan_evaluator.py`:258-259) |
| Setup vocabulary | Model Book catalog (`pages/modelbook/setupCatalog.js`:31, :48), playbooks (`setupPlaybooks.js`:13), examples (`modelbook_service.py`:104); trade setups (`constants/setupGroups.js`:5, :29) |
| Market context sources | `regime.get_current_regime` (`regime.py`:54); `breadth_live.compute_live` (`breadth_live.py`:1611); `rs_ranking.get_rs_for_ticker` (`rs_ranking.py`:287); `engine.get_candidates` (`engine.py`:2746); `GET /api/scans/definition-results` (`scan_results.py`:107); themes (`theme_db.get_themes_for_ticker`, `theme_db.py`:227) |
| Per-setup stats | `playbook_stats.get_playbook_stats` (`playbook_stats.py`:92), the authority |
| Excerpts (page-anchored) | `j2_note_excerpts` (`db.py`:1251-1265); `note_excerpts.py`; web captures stored as documents (`web_capture.py`:106-115) |

### 3.3 Data flow

```
broker fill / logged position ──► 13E entry_context (frozen, per member+symbol+day)
                                        │
note: chart block (widgetEmbed)         ▼
  annotations[role=entry|stop|target] ─► plan_extract (13A-1) ◄── canvas levels / properties /
  ta.{setupTag, fingerprint} (13H/13I)      │                       labelled text / Compass verdict
                                            ├─► j2_trade_plan_links (frozen grade inputs) ─► 13A grade ─► 13B/13F/13I
                                            ├─► j2_note_levels (projection) ─► 13D resurfacing, 13G chips, 13J board
tech_fingerprint (13I-1) ◄── screener_rows (nightly) / technicals on bars ≤ as-of
        └─► ta.fingerprint (frozen at insert) ─► 13I playbook filters ─► 13J find-similar (nightly matches)
```

### 3.4 New tables (all additive, `CREATE IF NOT EXISTS`, purged with the account, in the address-space census)

| table | lane | key | written by |
|---|---|---|---|
| `j2_trade_plan_links` | 13A | (user_id, trade_ref) | matcher or member |
| `j2_note_levels` | 13D | (user_id, note_id, level id) | projection job (watermark) |
| `j2_entry_context` | 13E | (user_id, symbol, entry_day_et) | capture job, or on demand |
| `j2_chart_blocks` | 13I | (user_id, note_id, embed_id) | projection job (watermark) |
| `j2_similar_matches` | 13J | (user_id, embed_id, as_of, rank) | nightly job after the sweep |
| `j2_passed_setups` | 13G | (user_id, symbol, saved_at, source) | nightly job |

Projections never run in the save path and never write a note. Tables owned by a module
self-ensure (the `daily_counters` precedent, `account_purge.py`:286-295), except
`j2_trade_plan_links`, which lives in `db.py`.

### 3.5 The one schema change, and the never-revert rule

- **13H-1 adds ONE attr, `ta`, to the existing `widgetEmbed` node** (a level-0 node,
  `api/services/journal_two/notebook_schema.py`:78). Its shape is `{setupTag, fingerprint,
  planBlock}`. Plan roles live inside the existing `annotations` JSON, so they need no attr.
- **Why it is never-revert.** An older bundle does not declare `ta`, so it would drop the attr the
  next time it saves the note: silent data loss.
- **It must therefore:**
  - land in both `app/src/pages/journal-2-0/lib/notebookSchema.js` and `notebook_schema.py`;
  - take a `NODE_POLICY` row decision in every public mode (`public_note_payload.py`, including
    12A's gallery mode; `annotations` is already never published, `:296`), plus its
    citation-table rows;
  - join the keep-list in `docs/notebook/wave5-rollback.md`.
- **Controller acknowledgement is required at M1 entry** (decision log P1).
- No other lane adds a node or an attr. A lane that thinks it needs one stops and asks.

### 3.6 Flags (each unset = off; enablement gates, no cohorts)

| flag | lane |
|---|---|
| `NOTEBOOK_PLAN_GRADING_ENABLED` | 13A |
| `NOTEBOOK_PLAYBOOK_ENABLED` | 13B |
| `NOTEBOOK_EARNINGS_PREP_ENABLED` | 13C |
| `AWARENESS_NOTE_RESURFACE_ENABLED` (read like `AWARENESS_THESIS_REVIEW_ENABLED`, `awareness/engine.py`:33-43) | 13D |
| `NOTEBOOK_ENTRY_CONTEXT_ENABLED` | 13E |
| `NOTEBOOK_REVIEW_DRAFTS_ENABLED` | 13F |
| `NOTEBOOK_TRANSCRIPT_CAPTURE_ENABLED`, `NOTEBOOK_THESIS_CHIPS_ENABLED`, `NOTEBOOK_PASSED_SETUPS_ENABLED` | 13G |
| `NOTEBOOK_CHART_PLAN_ENABLED` | 13H |
| `NOTEBOOK_TA_FINGERPRINT_ENABLED`, `NOTEBOOK_VISUAL_PLAYBOOK_ENABLED` | 13I |
| `NOTEBOOK_SETUPS_BOARD_ENABLED`, `NOTEBOOK_FIND_SIMILAR_ENABLED` | 13J |

Every flag follows the same rules:
- It is parsed by the one parser (`api/services/notebook_flags.py`:47).
- It is gated per route: flag off answers 404 before any session read.
- It is listed dark in the ledger.
- Arming is the owner's: one flag at a time, verified in the running process, with the ledger
  updated in the same push.

---

## 4. Team structure (how a product org maps onto this repo)

| role | who | duties in this repo |
|---|---|---|
| **CEO and product owner** | Patrick | Merges and deploys PRs, flips flags, rules on decisions, runs beta operations |
| **Program controller** (product and eng management) | the controlling session | Owns this plan and the rulings (owner-delegated); dispatches lanes; keeps the decisions log |
| **Track leads** (one per track) | the lane agent working that track's current lane | Execution: 13A, 13E, 13F. Edge: 13B. Charts and TA: 13H, 13I, 13J. Research: 13C, 13D, 13G. Usability: 13Q. Each builds, writes rails, mutation-proves, walks, commits and pushes at every green checkpoint, and reports with evidence paths |
| **QA lead** | the integrator's QA duty | Re-runs each lane's scoped rails in its own session (a lane's "done" is evidence, not a verdict); checks walks against raw JSON; holds the gate lock; reads the manifest totals and `GATE EXIT`, never the task status |
| **Platform and ops lead** | the integrator's ops duty | The M0 scaffold; the flag ledger; deploy-window checks (`docs/runbooks/deploy-windows.md`); box memory; the one-gate-at-a-time rule |
| **Integrator** | one session | Merges lane branches into `feat/notebook-w13-landing`, resolves ownership handoffs, opens the PR |

**Constraints this org works under** (CLAUDE.md, "AGENT CONCURRENCY" and "RESOURCE RULES"):
- At most **three agents at once, integrator included**.
- One six-shard gate at a time.
- Backend pytest by named files only; no `npm ci` on a loaded box.
- A gate never shares a worktree with an implementer.
- `git commit -F -` with a quoted heredoc; never `git add -A`; `tools/check_repo_hygiene.py
  --staged` before every commit.

---

## 5. Execution plan

### 5.1 Milestones

| M | name | lanes | entry | exit |
|---|---|---|---|---|
| **M0** | Scaffold | integrator commit W13-0 | this plan accepted | Flag rows dark (ledger + `NOTEBOOK_FLAGS`); reserved `main.py` lines, each separated by unchanged lines; flag-gated nav links in `NotebookTab.jsx` (Playbook, Setups board, Passed setups); flag-parse rails green |
| **M1** | Foundations | 13A-1, 13I-1 then 13H-1, 13E-1 | M0 on landing; P1 acknowledged | `plan_extract` (all six sources, including chart roles), `j2_trade_plan_links`, grading API; `tech_fingerprint`; the `ta` attr in both schemas, keep-list and policy rows; `entry_context` capture. All mutation-proved, no UI exposure needed |
| **M2** | Core features | 13A-2, 13H-2, 13C-1, then 13B, 13D, 13E-2, then 13C-2, 13Q-1, 13G-1 | each lane's M1 dependency on landing | Each lane's definition of done plus its walk |
| **M3** | Flagship and research | 13I-2, 13J, 13F, then 13G-2/3 | 13H-2, 13B, 13A-2, 13D, 13E-2 on landing | as M2 |
| **M4** | Hardening and gate | 13Q-2, then the gate (alone) | every lane on landing | 13Q budgets met or owned; gate 0 NEW; PR opened (after wave 12 merges) |
| **M5** | Ship | owner | PR green | Owner merges and deploys; flags armed one at a time, owner's call |

### 5.2 Dispatch (three agents at once)

| step | trigger | slot 1 | slot 2 | slot 3 |
|---|---|---|---|---|
| 0 | plan accepted | integrator: **W13-0** | — | — |
| 1 | W13-0 on landing | **13A-1** plan core | **13I-1** fingerprint core | **13E-1** entry context |
| 2 | 13I-1 reports | 13A-1 | **13H-1** chart schema | 13E-1 |
| 3 | 13E-1 reports | 13A-1 | 13H-1 | **13C-1** |
| 4 | 13A-1 and 13H-1 land | **13A-2** grading UI | **13H-2** chart plan | 13C-1 |
| 5 | 13C-1 reports | 13A-2 | 13H-2 | **13D** |
| 6 | 13A-2 lands | **13B** | 13H-2 | 13D |
| 7 | 13D lands | 13B | 13H-2 | **13E-2**, then **13C-2** (one slot, in turn) |
| 8 | 13H-2 lands | 13B | **13Q-1** (instrument + baseline) | 13E-2 / 13C-2 |
| 9 | 13B lands | **13I-2** visual playbook | **13J** board + similar | 13E-2 / 13C-2 / **13G-1** |
| 10 | 13E-2 and 13C-2 land | 13I-2 | 13J | **13F** |
| 11 | 13J lands | 13I-2 | **13G-2/3** | 13F |
| 12 | all lanes land | **13Q-2** fixes | — | — |
| last | box idle | the gate, then the PR | | |

### 5.3 Dependency graph and critical path

```
W13-0 ─┬─ 13A-1 ─┬─ 13A-2 ─┬─ 13B ─┬─ 13I-2 ───────────────┐
       │         │         │       └─ (sampleSize) 13F ────┤
       │         ├─ 13D ───┼─ 13J ◄── 13H-2, 13I-1          ├─ 13Q-2 ─ GATE ─ PR ─ (owner) w12 merge ─ w13 merge/deploy
       │         │         └─ 13G-2/3                       │
       ├─ 13I-1 ─┴─ 13H-1 ─ 13H-2 ─────────────────────────┘
       ├─ 13E-1 ─ 13E-2 (after 13A-2) ─ 13F
       └─ 13C-1 ─ 13C-2 (after 13A-1 hands over notebookTemplates.js)
```

**Critical path:** W13-0, 13A-1 (L), 13H-1 (M), 13H-2 (L), 13I-2 (L), 13Q-2 (M), the gate, the
wave-12 merge (owner), and the wave-13 merge and deploy (owner).

**Real constraints, not slack:**
- **The box.** 31.8 GB, a shared gate lock, OOM history (CLAUDE.md, "THREE CONCURRENT SESSIONS
  OOM-SWEPT THIS BOX").
- **The owner's merge cadence.** Wave 12 is unmerged, and the wave-13 PR opens only after it.

### 5.4 Branches, gate, PR

- **Landing branch:** `feat/notebook-w13-landing`, from `origin/feat/notebook-w12-landing`.
  When wave 12 merges, master is merged in (merge, never rebase).
- **Lane branches:** `feat/notebook-w13<lane>`: `a1`, `a2`, `b`, `c1`, `c2`, `d`, `e1`, `e2`,
  `f`, `g`, `h1`, `h2`, `i1`, `i2`, `j`, `q`.
- **The gate.**
  - Run from worktree `notebook-w13-gate` (a `notebook-*` branch name, so `hub/rule12Paths.test.js`
    scopes it correctly): `python scripts/gate_shards.py --shards 6`.
  - The baseline is re-adopted from a fresh master gate (D16), and records go to
    `docs/notebook/gate-runs/wave13-landing/`.
  - Every lane's Python rails run by named file on the final tree. `App.jsx` and `auth.py` are
    touched, so there is no carry-over.
- **One PR:** `feat/notebook-w13-landing` → master. Everything ships dark.

### 5.5 File ownership (disjoint; "after X" = only once X is on landing)

| owner | files |
|---|---|
| W13-0 | `notebook_flags.py`, `auth.py` (`NOTEBOOK_FLAGS`), `docs/feature_flags.json`, `api/main.py` (reserved lines), `journal_two.py` (`_J2_TELEMETRY_EVENTS`, `:73`), `tabs/NotebookTab.jsx` (three gated nav links), the client flag keys |
| 13A-1 | `plan_extract.py`, `plan_grading.py`, `notebook_plan_grades.py`, `db.py`, `account_purge.py`, `address_space.py` |
| 13A-2 | `TradeDetailPage.jsx`, `PlanGradeCard.jsx`, `InsightsHub.jsx`, `DisciplineRecord.jsx`, `TradesTable.jsx`, `lib/planReview.js`, `hooks/usePlanGrade.js`, `lib/notebookTemplates.js` |
| 13B | `playbook_stats.py`, `playbook_patterns.py`, `notebook_playbook.py`, `MyPlaybook.jsx`, `PlaybookSection.jsx`, `app/src/App.jsx`, `lib/sampleSize.js`, `sample_size.py` |
| 13C-1 / 13C-2 | `earnings_prep.py`, `notebook_earnings_prep.py`, `notebook_home.py`, `ResearchHome.jsx`, `TickerResearchWorkspace.jsx`, `lib/earningsPrep.js`, `lib/templateContext.js`; `notebookTemplates.js` after 13A-2 |
| 13D | `awareness/rules.py`, `awareness/engine.py`, `voice_proactive_service.py`, `note_levels.py`, `NoteEditorPage.jsx`; `account_purge.py`, `address_space.py` after 13A-1 |
| 13E-1 / 13E-2 | `entry_context.py`, `notebook_entry_context.py`, `EntryContextCard.jsx`, `WhyPrompt.jsx`; after 13A-2: `TradeDetailPage.jsx`, `PositionDetailPage.jsx`, purge and address-space entries |
| 13F | `leak_finder.py`, `review_drafts.py`, `notebook_review_drafts.py`, `lib/reviewDrafts.js`, `EODRecap.jsx`, `CompassReview.jsx`; `ResearchHome.jsx` after 13C-2; `InsightsHub.jsx` after 13A-2 |
| 13G | `transcript_capture.py`, `passed_setups.py`, `notebook_research_capture.py`, `SaveTranscriptPassage.jsx`, `ThesisChip.jsx`, `PassedSetups.jsx`, `PositionsTable.jsx`, `HoldingsList.jsx`; `App.jsx` after 13B; purge entries after 13A-1; one agreed mount line each in `TranscriptPanel.jsx` and `WatchlistWidget.jsx` |
| 13H-1 / 13H-2 | `lib/notebookSchema.js`, `notebook_schema.py`, `public_note_payload.py`, `docs/notebook/wave5-rollback.md`, `lib/widgetEmbedNode.jsx`, `lib/widgetEmbedCore.js`, `ChartEmbed.jsx`, `WidgetEmbedView.jsx`, `SlashMenu.jsx`, new `ChartPlanPanel.jsx`, new `lib/chartPlan.js`, new `BarReplay.jsx` (generalised from `TradeReplay.jsx`, which 13H owns this wave), new `notebook_chart_alerts.py`, `notes_export_formats.py` (plan-levels line) |
| 13I-1 / 13I-2 | `tech_fingerprint.py`, `chart_blocks.py`, `notebook_fingerprint.py`, `notebook_visual_playbook.py`, `FingerprintPanel.jsx`, `VisualPlaybook.jsx`, `lib/fingerprintChecklist.js`, `lib/setupTagMap.js`; after 13H-2: `WidgetEmbedView.jsx` (tag and panel mount); after 13C-2: `notebookTemplates.js` (checklist context); after 13E-2: `TradeDetailPage.jsx` (before/after); after 13B: `App.jsx`, `MyPlaybook.jsx` (a link) |
| 13J | `setups_board.py`, `similar_matches.py`, `notebook_setups_board.py`, `SetupsBoard.jsx`, `BoardCard.jsx`, `SimilarNames.jsx`; `App.jsx` after 13G |
| 13Q | `tools/notebook_w13q_clicks.py` and evidence. 13Q-2 edits only through owning lanes' files, after they land |

**Never touched by any lane:**
- `OptionsFlow.jsx` and the flow routers (partner Ravi; G-040);
- `broker/*`, `positions.py`;
- `StockChart.jsx` (charts programme; 13H works through `ChartPane` props only);
- `ScannerShell.jsx`, except an agreed 13Q-2 fix.

---

## 6. Quality plan

| layer | standard |
|---|---|
| **Rails per lane** | Listed in Appendix A. Every rail that shells out carries a non-vacuity control (CLAUDE.md, "An empty result is a failed invocation") |
| **Mutation proofs** | Every load-bearing rail is mutation-proved by its lane, before the lane reports done: the 13A freeze and mirror, the 13C and 13G AlphaVantage import graph, 13D's "R1-R6 unchanged", 13H's never-revert keep-list, 13I's "formulas reused", 13J's "no per-request universe scan". Never via `git checkout` (restore from captured bytes, verify against `git cat-file`) |
| **Real-browser walks** | `tools/notebook_w13<x>_walk.py` per lane, on a census-pinned sandbox (`tools/notebook_perf_harness.py` `Sandbox`, `:749`): 390 and 1200 px, keyboard, flag off and on, raw JSON committed before any summary (R-RAW) |
| **The chart walks must include** | Draw a plan on a note chart, see R:R and size, arm an alert; the fingerprint panel; a playbook filter; the active board; find-similar. All at 390 and 1200, with touch routing at 390 and the 44 px floor (`app/src/styles/tapFloor.test.js`) |
| **Accessibility** | Each new surface is in `a11y/notebookSurfaces.js` (each lane adds its own entries; the integrator resolves list merges). axe in CI is a promotion gate. a11y fixture recipes end with `landPendingAutosave()` (CLAUDE.md, wave 10 Phase I) |
| **Performance** | `docs/notebook/perf-budgets.json` unchanged. New chart code stays lazy (the `widgetEmbedCore.js`:11-18 precedent), so the Notebook first-open bytes do not move. Board and grid follow the herd rules (section 3.2). Never raise a budget to fit a reading |
| **Usability** | 13Q budgets (below) |
| **Gate** | One six-shard gate on the final landing tree, 0 NEW (section 5.4) |

### 13Q: the click-by-click program ("EASY IS THE KEY")

**13Q-1, the instrument (no product code).** `tools/notebook_w13q_clicks.py` drives each flow
three ways on a sandbox:
- mouse clicks;
- keystrokes, with Tab counted separately and pressed for real until focus arrives, capped at 600;
- taps at 390.

Typing the content itself is not counted. **Control first:** the instrument must reproduce the
Screener's ~337 Tabs before any fix. That finding is the controller's, and was not located in the
repo (decision log).

| # | flow | mouse | keys | taps |
|---|---|---|---|---|
| Q1 | new blank note, cursor in body | 2 | 3 | 2 |
| Q2 | new note from a template with a ticker | 4 | 6 | 4 |
| Q3 | open a note by title | 2 | 4 | 3 |
| Q4 | search, open a hit | 3 | 5 | 3 |
| Q5 | today's daily note | 1 | 2 | 1 |
| Q6 | link a note to a trade | 3 | 6 | 3 |
| **Q7** | **save Screener results to a note** (337 Tabs today) | 3 | 10 | 3 |
| Q8 | save a price or consensus fact | 3 | 8 | 3 |
| Q9 | ask the Notebook, insert the answer | 3 | 5 | 3 |
| Q10 | task with a due date | 2 | 4 | 3 |
| Q11 | tag and move 5 notes | 8 | 15 | 10 |
| Q12 | export one note as Word | 3 | 6 | 3 |
| Q13 | plan grade of my last trade (13A) | 2 | 4 | 2 |
| Q14 | My Playbook, drill a number (13B) | 3 | 6 | 3 |
| Q15 | create earnings prep (13C) | 2 | 5 | 2 |
| Q16 | open a resurfaced note (13D) | 2 | 4 | 2 |
| Q17 | answer "why did you take it" (13E) | 2 | 4 | 2 |
| Q18 | draft this week's review, open a leak (13F) | 3 | 6 | 3 |
| Q19 | save a transcript passage to a thesis (13G) | 3 | 6 | 4 |
| Q20 | insert a chart, draw entry, stop and target, read size (13H) | 6 | 10 | 8 |
| Q21 | arm an alert at a drawn stop (13H) | 2 | 4 | 2 |
| Q22 | filter the visual playbook to one setup (13I) | 2 | 4 | 3 |
| Q23 | morning board, open the closest setup, find similar (13J) | 3 | 6 | 3 |

**Keyboard budgets by ruling (controller, 2026-10-07).** The `keys` column above was written as a
pointer budget with a small allowance. For ten flows it is below the arithmetic floor for a
keyboard: the keys that are not Tab (Enter, Space, a shortcut, a menu arrow), plus one Tab for
each move to a new control. No page design can meet a number below its floor, so that number is
not a usable bar. For these ten the keyboard budget is the floor plus 2. Mouse and touch
budgets are unchanged, and so is the keyboard budget of every other flow. The ruling excuses
nothing else: each of the ten must still be driven to its floor plus 2. The tool reads this
table (`KEYS_RULING_FLOOR`), and its verdict uses the ruled number.

| # | plan keys | floor | keys budget | why the plan number cannot be met |
|---|---|---|---|---|
| Q6 | 6 | 8 | 10 | "g then j" is 2 keys, then 3 presses of Enter (the trade, Save to Notebook, Current note) and 3 moves |
| Q9 | 5 | 7 | 9 | 4 presses of Enter (skip link, Ask, send, Insert) and 3 moves |
| Q11 | 15 | 25 | 27 | 14 keys that are not Tab (5 ticks, 2 jumps to the bulk bar, 7 others) and at least 11 moves |
| Q12 | 6 | 10 | 12 | Word is the fourth item of the Export menu: 3 Down and 4 Enter, and 3 moves |
| Q16 | 4 | 6 | 8 | the flow starts in Settings: 3 presses of Enter and 3 moves |
| Q17 | 4 | 5 | 7 | 2 presses of Enter, and a move each to the skip link, the field and Save |
| Q19 | 6 | 7 | 9 | 5 keys that are not Tab and 2 moves |
| Q20 | 10 | 20 | 22 | 3 keys to insert the chart, 1 to open the plan, a role key and Enter for each of 3 levels, and 10 moves |
| Q18 | 6 | 7 | 9 | added by the same ruling later that day: the page's own skip link is behind the shell's, so it costs 2 Tabs, then 3 presses of Enter and 2 more moves |
| Q23 | 6 | 7 | 9 | added with Q18, for the same reason: 2 Tabs to the page's skip link, 3 presses of Enter and 2 more moves |

A miss is a finding with its raw path, never an edit to the target. **13Q-2** fixes misses through
the owning lane's files. Q7's fix (the door earlier in tab order, or a skip link) lives in
`ScannerShell.jsx` and is agreed with the Screener owner first.

---

## 7. Risk register

| # | risk | L | I | mitigation | owner |
|---|---|---|---|---|---|
| R-1 | **Production deploy fragility.** 2026-10-02: web returned 502 for about 1 h 47 min because a fresh `bars.db` snapshot lacked `idx_ohlcv_daily_bydate` and a boot step scanned 31 GB on the event loop (`docs/incidents/2026-10-02-web-boot-bydate-index.md`, commit `abb7d23bb3`, branch `origin/lane/bars-boot-index-fix`, not yet on master) | M | H | No wave-13 lane touches `bars.db`, its indexes or the boot path. New jobs register with startup delays and run off the event loop. The fingerprint reads `screener_rows` and bars through existing readers. Deploy only when the owner chooses | platform |
| R-2 | **Box memory and the shared gate lock** (OOM sweeps, CLAUDE.md) | M | H | Three agents, integrator included; one gate; scoped pytest; no `npm ci` under pressure | platform |
| R-3 | **The never-revert schema attr `ta`** | L | H | One attr, both schema files, policy rows, the keep-list; P1 acknowledged at M1; rollback by flag only | 13H lead |
| R-4 | **Partner and programme files** (OptionsFlow, the Screener, TranscriptPanel, WatchlistWidget, StockChart) | M | M | Listed as never-touched, or one agreed mount line. Flow is excluded entirely | integrator |
| R-5 | **Vendor zero retention unverified** (8a) | — | M | Zero new model calls. The "why" dictation appears only when the voice flag is armed. Voice stays dark | controller |
| R-6 | **AI cost** | L | M | No new model calls (import-graph rails); existing caps unchanged | platform |
| R-7 | **The pattern engine is owner-paused** (pattern lab paused 2026-09-07; `confirmed_only` is never flipped, default at `patterns.py`:686) | M | M | Read-only use, the default `confirmed_only=True`; no detector work; suggestions are confirmed by the member | 13I lead |
| R-8 | **The AlphaVantage budget is per process** (`alphavantage_client.py`:88-92) | M | M | 13C and 13G never reach `av_transcripts`, the call-recap generator, or the transcript route's AlphaVantage fallback (`earnings_intel.py`:262-278); rails | 13C/13G leads |
| R-9 | **Broker mirror fidelity** | L | H | Labels, never filters; 30-in-30-out rails | 13A lead |
| R-10 | **A herd of mini charts on the board** (the 2026-05-24 outage class) | M | H | The `GridChartCell` recipe, `backgroundWarm=false`, a mount queue of 3, 16 cards a page | 13J lead |
| R-11 | **Grade integrity** (a plan edited after the fact) | M | M | Freeze at first match; re-link recorded | 13A lead |
| R-12 | **A second writer into notes** | L | H | Create-only; projections are read-only on notes | all leads |
| R-13 | **Single-process state** | M | M | Durable `daily_counters`, no new module dicts. Any per-process limiter is listed in CLAUDE.md's single-process list | platform |
| R-14 | **Two setup vocabularies** (the Model Book catalog vs trade setups; CLAUDE.md measured partial overlap) | H | M | One alias map, `lib/setupTagMap.js` (13I), railed against both lists | 13I lead |
| R-15 | **Sizing unavailable** (`size_a_trade` needs the brain pack and is long-only, `brain_service.py`:180-189) | M | L | Fall back to the existing `position_size` starter formula with the account's risk %, and say which method was used (P3) | 13H lead |
| R-16 | **Owner merge cadence;** wave 12 unmerged | H | M | Land on the wave-12 landing branch; the PR waits for wave 12 | integrator |

---

## 8. Decisions log

**Rulings (controller, owner-delegated, 2026-10-02):**

| id | decision |
|---|---|
| R3 | Sample sizes: n<10 "too few to judge" (stat behind a reveal); 10-24 "thin sample", with a range; 25 and up normal. Compass's hard-mute at 25 (`personal_edge.py`:15) is unchanged |
| R4 | 13A: freeze plan numbers at first match. Entry kept within max(0.25R, 0.5% of planned entry). Stop honoured when the exit is at or better than stop + 0.25R slippage. Size within ±10% of planned shares. One constants block with a test. Links key on `trade_refs`, never `j2_trades.id` |
| R5 | 13C: never auto-create notes; a Reporting-soon list with a one-click draft; never AlphaVantage |
| R6 | 13D: in-app only, 2 a day per member, under its own sub-cap outside the shared 8/day insight cap (`voice_proactive_service.py`:28) |
| R7 | The three research-picked lanes are 13E, 13F and 13G. Respect partner ownership (Options Flow, the Screener door) and file boundaries |
| O1 (owner) | Chart and TA is the flagship track: 13H, 13I, 13J. Reuse UCT's engines, one authority per concept; plan levels stay `plan_extract`. Alerts from drawn levels are IN scope (13H) |
| O2 (owner) | **Beta operations are owner-managed and out of scope.** Removed: lane 13T, invites, cohort-scoped flags, feedback changes, known issues, what's new, onboarding, 100-user cost and load sizing, beta metrics. This supersedes the earlier R1 (invites) and R2 (beta cost ceilings) |
| Standing | D4, D5, D6, D9, D16, D17, D18, D19, D20, D24 (`NOTEBOOK-10-OF-10-PLAN.md`:148-174) |

**Pending (to settle at the milestone named):**

| id | decision | by | when |
|---|---|---|---|
| P1 | Acknowledge the `ta` attr on `widgetEmbed` as the wave's one never-revert schema change | controller | M1 entry |
| P2 | The mount-line agreements: `TranscriptPanel.jsx` (UCT Terminal programme), `WatchlistWidget.jsx` (charts workspace), and the 13Q-2 fix in `ScannerShell.jsx` (Screener) | owner of each file | before 13G and 13Q-2 |
| P3 | Accept the sizing fallback (the starter formula when `size_a_trade` is unavailable or the trade is short) | controller | 13H-2 entry |
| P4 | 13A's target tolerance (`TARGET_SHORTFALL = 0.25R`, the planner's value; R4 did not set it) | controller | 13A-1 |
| P5 | The 337-Tab finding: confirm its source (not located in the repo) | controller | 13Q-1 |
| P6 | The order in which flags are armed after deploy | owner | M5 |

---

## Appendix A. Lane specifications

Each lane lists its outcome, what it reuses, its files and tables, its flag, its rails and walk, and
what NOT to build. Ownership is in section 5.5.

### A.13A Plan vs execution grading (13A-1 core, 13A-2 UI)

- **Outcome.**
  - Every closed trade shows four checks: Entry, Stop, Size, Target.
  - A trade with no prior plan is labelled Unplanned.
  - A discipline record covers the last 20 and 60 trades.
  - One click writes a review note: frozen grade table, link to the plan, frozen entry and exit
    charts.
  - A setup chip appears when a broker trade lacks a setup and its plan names one.
- **Plan sources** (precedence, all read by `plan_extract.py`):
  1. an explicit note link (`note_trade_links.py`:156, graduation `:90-96`);
  2. the Compass verdict (`pre_trade_verdict.py`:84-106; `verdict_scorecard.py`:10-17);
  3. **chart annotations with a role** (13H);
  4. canvas levels (`trade_canvas.py`:62);
  5. Position Tracker properties (`notebookTemplates.js`:272-284);
  6. labelled text (`:954`, `:60-61`).
- **Matching.**
  - Same member and symbol. Candidates, in order: an explicit link, a verdict before entry, then a
    plan note or chart within 30 days before entry.
  - A tie: the member picks.
  - No candidate: Unplanned.
  - A date-only entry is judged by day, and labelled so.
- **Freeze (R4).** At first match, store the numbers, the source, the version id and the time.
  Only "Re-link" regrades. A plan whose only version post-dates entry is graded and labelled
  "plan edited after entry".
- **Constants** (`plan_grading.py`, one dict):
  - the R unit is |entry − stop|;
  - `ENTRY_TOL = max(0.25R, 0.5%)`;
  - `STOP_SLIP = 0.25R`;
  - `SIZE_TOL = ±10%` of shares;
  - `TARGET_SHORTFALL = 0.25R` (P4).

  Reading the target check: *hit*; *reached, not taken* (`mfe_price`, `db.py`:1756-1761); *not
  reached*. A missing input reads "—". Options are "not graded in v1", and still counted.
- **Files and tables.** As in section 5.5. `j2_trade_plan_links` in `db.py`. The setup chip writes
  through `PATCH /api/j2/trades/{id}` (`api/routers/journal_two.py`:1187). The plan templates
  declare Entry/Stop/Target/Shares (`templatePropertyDefs.js`:77).
- **Flag.** `NOTEBOOK_PLAN_GRADING_ENABLED`.
- **Rails.**
  - Constants pinned value by value.
  - One fixture per source shape; conflicting entries read "unreadable".
  - Precedence and the tie.
  - Freeze.
  - The four checks, long and short, with a placeholder stop.
  - Mirror: 30 in, 30 out.
  - Stable keys survive purge and reinsert.
  - Purge and address-space census; route census.
  - Mutation-prove the freeze, the mirror and the constants.
- **Walk.**
  1. Plan, then trade, then grade, then review note.
  2. Unplanned.
  3. Placeholder stop taken from the plan.
  4. The setup chip.
- **Not:** an LLM on numbers; import changes; a "plan required" gate; regrade on edit; options
  grading.

### A.13B My Playbook

- **Outcome.**
  - Per-setup cards with R3 wording and ranges from n=10; every number opens its trades.
  - "From your notes".
  - "What you wrote before losses vs wins" (both counts, both n, "Patterns, not proof").
  - A frozen snapshot note.
- **Reuses.**
  - `playbook_stats.get_playbook_stats` (`:92`), with range fields added: Wilson interval on win
    rate, t-interval on mean R. Untagged trades stay excluded (`:114`).
  - Links from `j2_note_embeds` and `j2_trade_plan_links`.
  - Word lists from the account taxonomy, falling back to `tag_suggest.py` (`:33`, `:39`).
  - `personal_edge.py` is read-only (a Compass change needs the report card first).
- **Files.** Section 5.5. No table.
- **Flag.** `NOTEBOOK_PLAYBOOK_ENABLED`.
- **Rails.**
  - Interval fixtures; wording at n = 9, 10, 24, 25.
  - Every displayed number is found in the authority's payload.
  - The pattern miner's counts and minimums.
  - The snapshot stays frozen.
  - Mutation-prove "no stat without its n".
- **Walk.** Seed 40 trades and 3 setups; drill; open a pattern; snapshot.
- **Not:** a fourth per-setup computation; LLM text; p-values; mining all words; any Compass change.

### A.13C Earnings prep

- **Outcome (R5).** **Reporting soon** on Home (the member's own sets, the next 7 days). One click
  drafts a prep note with:
  - date and timing;
  - the pre-report expected move;
  - the last four reactions;
  - estimates against a year ago;
  - the stored recap;
  - my trades and notes on the name;
  - my position going in.

  Each value carries "Source, as of", frozen.
- **Reuses.**
  - `calendar_personalization.get_user_ticker_sets` (`:25`).
  - `_next_report_date` (via `api/routers/calendar.py`:4043-4085).
  - `_compute_enrichment_for_date` (`calendar.py`:3395-3423).
  - `implied_store.get_implied_history` (`:227`).
  - `earnings_reaction.reaction_for` (`:161`).
  - `call_recap_store.get` (`:96`, stored only).
  - `ticker_research.get_ticker_research_summary` (`:200`).
  - The earnings-prep template (`notebookTemplates.js`:715-756).
- **Cost.** Zero model calls and zero AlphaVantage calls. 20 drafts per member per day, counted in
  `daily_counters`.
- **Flag.** `NOTEBOOK_EARNINGS_PREP_ENABLED`.
- **Rails.**
  - Source and as-of on every cell.
  - Each source stubbed off yields "—".
  - The import graph never reaches AlphaVantage or the recap generator.
  - The cap holds across a restart.
  - No note is created without a click.
- **Walk.** A position and a watchlist name report this week; create both notes; the frozen values
  survive a data change.
- **Not:** auto-created notes; LLM text; a calendar-page door.

### A.13D Resurfacing

- **Outcome.** In-app notices when a researched ticker:
  - touches a level named in a note;
  - moves 8% or more (the mover insight's top tier, `voice_proactive_service.py`:394-399);
  - reaches a named date (Review Date, or a catalyst note's date).

  The notice opens the note at the version that named the level.
- **Reuses.**
  - `rule_thesis_stop_review` (`awareness/rules.py`:127-183).
  - `notes.bulk_member_mentioned_symbols` (`notes.py`:3014).
  - `_fire_candidate` (`engine.py`:237-280).
  - Levels from `plan_extract`.
  - `NoteVersionPreview.jsx`.
- **Index.** `j2_note_levels`, rebuilt by watermark, never in the save path.
- **Delivery (R6).**
  - Importance stays below the away floor of 8 (`engine.py`:26).
  - 2 a day, in a durable scope of its own; `add_insight` (`voice_proactive_service.py`:35) admits
    this kind outside the shared count.
  - One per level per day.
  - Placeholder stops are never levels.
- **Flag.** `AWARENESS_NOTE_RESURFACE_ENABLED`.
- **Rails.**
  - R1-R6 output byte-identical.
  - With the shared cap full, a resurfacing still fires, and it never consumes the shared cap.
  - The cooldown.
  - No `deliver_alert_payload` is reachable.
  - A trashed note leaves the index.
  - Purge.
- **Walk.** Cross a canvas stop: one notice; open it at the right version; a second cross is
  silent; a Review Date of today.
- **Not:** a second pipeline; `user_alerts` or S7 predicates; email or Discord; prose parsing.

### A.13E Market context frozen at the fill (13E-1 core, 13E-2 UI)

- **Outcome.**
  - An Entry-context card on positions and trades: regime and exposure, the UCT scans that held the
    name, days to earnings, % above the 50-day, RS rank. Each value carries its as-of.
  - An optional "why did you take it?" saves a new note linked to the position (text; dictation
    only when the voice flag is armed).
  - One in-app bell line a day for new fills, through the task-reminder path (`note_tasks.py`:
    35-37, :605).
- **Key.** (member, symbol, entry day ET), joined through `trading_day_et` (`db.py`:1737). Broker
  trades carry a sentinel `position_id` (`trades.bulk_insert_trades`, `trades.py`:773, :851) and broker positions store `'{}'`
  context (`broker/balances.py`:425-429), so position ids cannot carry it. Past days read *not
  captured*, and are never reconstructed as if frozen.
- **Reuses.**
  - `regime.get_current_regime` (`:54`).
  - `breadth_live.compute_live(cached_only=True)` (`:1611`).
  - `rs_ranking.get_rs_for_ticker` (`:287`).
  - `engine.get_candidates` (`:2746`) and `scan_results.py`:107.
  - `_next_report_date`.
  - The position link (`PositionDetailPage.jsx`:339).
- **Capture.** A job every 10 minutes in market hours, plus on-demand capture when a page opens.
  No broker or positions code is edited.
- **Flag.** `NOTEBOOK_ENTRY_CONTEXT_ENABLED`.
- **Rails.**
  - A frozen row never changes.
  - A past day reads "not captured".
  - The day join matches a broker trade to its position.
  - One bell line a day.
  - No microphone with voice off.
  - Purge.
- **Walk.** Log a position; the card shows; answer the prompt; close the trade; the card stays.
- **Not:** model calls; flow context; reconstruction labelled as frozen; broker edits.

### A.13F Reviews that write themselves, with the leak finder

- **Outcome.** One click drafts a daily, weekly or monthly review note:
  - trades and P&L;
  - the discipline record;
  - setup changes;
  - links to plans, reviews and resurfaced notes;
  - frozen charts of the best and worst trades;
  - **leaks**.

  Doors: `EODRecap.jsx`, `CompassReview.jsx`, the daily note and Home. Compass text is quoted only
  if it exists, labelled as AI (G-064).
- **Leak finder.** Each finding states n with R3 wording, the dollar impact (net P&L and average R
  against the member's baseline) and the trades it rests on. Detectors:
  - revenge re-entry (`revenge_detect.py`);
  - size up after a loss;
  - a weak time window;
  - regime at entry and holding into earnings (13E);
  - Compass SKIP overridden (`verdict_scorecard.py`);
  - unplanned trades and stops not honoured (13A).
- **Never a second authority.**
  - Period data comes from `coach_data_assembler.assemble_day` and `assemble_week` (`:489`, `:43`).
  - Setups come from `playbook_stats`; grades from 13A.
  - Scaffolds come from the catalog's own builds (`post-market-debrief` `:336`, `weekly-review`
    `:419`, `monthly-review` `:469`).
- **Flag.** `NOTEBOOK_REVIEW_DRAFTS_ENABLED`.
- **Rails.**
  - Every number equals its authority's field.
  - Detector fixtures with known n and dollars.
  - Below n=10, behind the reveal.
  - A finding's trades sum to its dollars.
  - No model client is reachable.
- **Walk.** A seeded week: draft; open a leak; the Compass label shows.
- **Not:** background drafts; LLM narrative; duplicate stats.

### A.13G Research capture

- **G1, transcript passage to a citable excerpt.**
  - The transcript quarter is stored once as a captured document (the `web_capture.py`:106-115
    precedent; page = speaker turn; quarter and speaker kept).
  - The passage becomes an ordinary excerpt (`j2_note_excerpts`, `db.py`:1251-1265; G-116 to
    G-120), attachable to a thesis as for or against.
  - The quote is re-verified against the **cached FMP transcript only**. A miss refuses honestly
    and never triggers the AlphaVantage fallback (`earnings_intel.py`:262-278).
  - The mount is one agreed line in `components/calendar/TranscriptPanel.jsx` (`:1-25`; P2).
  - Flag `NOTEBOOK_TRANSCRIPT_CAPTURE_ENABLED`.
- **G2, thesis chips on rows.**
  - **Step 0: verify in the UI that no indicator exists.** A grep of `Watchlists.jsx`,
    `PositionsTable.jsx` and `HoldingsList.jsx` found none; `Watchlists.jsx`'s per-item notes are
    a different store (`:891`). Commit the screenshots.
  - Each row then shows the thesis status (`builtin:thesis_status`), the distance to invalidation
    or stop (`j2_note_levels`) and a hover preview.
  - One batch read for all visible rows.
  - Mounts: `PositionsTable.jsx`, `HoldingsList.jsx`, and `WatchlistWidget.jsx` by agreement.
  - Flag `NOTEBOOK_THESIS_CHIPS_ENABLED`.
- **G3, passed setups.**
  - Sources: names saved but not traded, from scanner captures already in notes (read-only; no
    Screener edit) or watchlist adds (`watchlist_items.added_at`).
  - Scored on returns at +1, +5 and +20 sessions and the best move within 20 sessions, from daily
    bars, frozen at save.
  - A name traded within 10 sessions leaves the list.
  - R3 wording; a nightly job maintains `j2_passed_setups`.
  - Flag `NOTEBOOK_PASSED_SETUPS_ENABLED`.
- **Rails.** The quote is on the cached page; no AlphaVantage path; N rows = 1 request; the
  passed-setup score is frozen and the traded name excluded; the job is idempotent; purge.
- **Walk.** Save a passage as opposing evidence; the chips with distance; a passed name scored
  after a fixture week.
- **Not:** flow capture or signals (G-040); edits to the Screener door; AI summaries.

### A.13H Charts in notes, the full interactive chart: "chart markup is the plan" (13H-1 schema, 13H-2 features)

**Already built, do not rebuild** (section 3.2):
- a real StockChart in notes with frozen and live modes and the "what happened next" peek;
- drawings saved on the note, with Draw mode;
- per-embed settings, and the member's own settings at insert;
- `/mtf` and `/compare`;
- a linked crosshair;
- the full drawing toolset, touch routing included;
- MAs, HVC, the RS line and AVWAP;
- alerts bound to drawings.

**New in 13H:**

| # | feature | how (reuse) |
|---|---|---|
| H1 | **Schema:** the `ta` attr on `widgetEmbed` | Section 3.5; both schema files; policy rows; keep-list (P1) |
| H2 | **Timeframe switching in the note chart** | An explicit embed-toolbar action writes `params.tf` (ChartEmbed keeps the TF bar off by design, `:30-33`, so changes arrive as toolbar actions); one version per change |
| H3 | **Drawn trade plan.** Mark a horizontal line as Entry, Stop or Target | The role is stored inside the drawing in `annotations` (survives rollback). `plan_extract` (13A-1) reads it; 13H never computes a second plan |
| H4 | **R:R and size panel** (`ChartPlanPanel.jsx`) | R:R uses the `r_multiple` starter semantics (`computed.js`:41-47). Size comes from `brain_service.size_a_trade` (`:178-199`) for a long with the brain pack installed; otherwise the `position_size` starter (`computed.js`:54-59), with Account risk = account size × `maxRiskPerTradePct` (`accounts.py`:78). It states which method it used (P3). No new formula |
| H5 | **Alerts from drawn levels.** One click arms an alert at a drawn level or trendline | `POST /api/watchlist-alerts` (`watchlist_alerts.py`:37) via `create_alert(..., anchors, drawing_id)` (`watchlist_alert_service.py`:53-92); trendline anchors from `anchorsForDrawing` (`drawingAlertAnchors.js`:88); moving the line re-syncs through the bound PATCH (`:65`) under the same seen-to-absent delete rule (`useBoundDrawingAlerts.js`:9-17). The alert carries a link to the note. Through `notebook_chart_alerts.py`, a thin adapter; no new alert engine |
| H6 | **"What happened next" bar replay** | `BarReplay.jsx`, generalised from `TradeReplay.jsx` (its own chart, never a StockChart mode, which keeps the single-writer invariant, `:4-8`). Steps forward from the note's as-of, with the note's drawn levels as price lines |
| H7 | **Multi-timeframe and benchmark blocks** | Extend `/mtf` with a weekly stack (W, D, 60/65) beside today's D, 60, 15 (`widgetEmbedCore.js`:208). New `/vs`: the stock beside SPY, QQQ, its sector ETF or its theme ETF (`theme_db.get_themes_for_ticker`, `:227`), frozen at the same `to` |
| H8 | **Member's indicators on note charts** | Already stamped at insert. 13H adds "apply my current chart settings" as an explicit action writing `params.settings` (`ChartEmbed.jsx`:53-56) |
| H9 | **Export** | A "Plan levels" line in Markdown and Word (the `trade_canvas.py` export precedent); public modes keep dropping `annotations` |
| H10 | **Mobile** | Draw, set a role and arm an alert at 390 with the 44 px floor (`styles/tapFloor.test.js`), using the existing touch routing |

- **Flag.** `NOTEBOOK_CHART_PLAN_ENABLED`, gating H2-H8; H1 is schema, always present.
- **Rails.**
  - `ta` survives a save-and-reload; the keep-list and policy-table rails extended.
  - A role round-trips into `plan_extract`.
  - R:R and size equal the starter or sizing outputs on fixtures, and the method label is present.
  - An alert is created with the right `drawing_id`; moving the line patches it; a cold mount never
    deletes it.
  - Replay never mounts a second StockChart writer (`singleWriterIndex.test.js` stays green).
  - Chart code is lazy (first-open bytes unchanged).
  - Mutation-prove the keep-list and role rails.
- **Walk (390 and 1200).**
  1. Insert a chart; switch timeframe; draw entry, stop and target; read R:R and size.
  2. Arm an alert at the stop; move the line, and the alert follows.
  3. Replay forward 10 bars.
  4. `/mtf W` and `/vs SPY`.
  5. Export shows the plan levels.
- **Not:** edits to StockChart internals; a new sizing formula; a new alert engine; tick replay.

### A.13I The technical fingerprint and the visual playbook (13I-1 core, 13I-2 features)

- **The fingerprint** (`tech_fingerprint.py`), frozen into `ta.fingerprint` at insert:

| field | source (reused, never re-derived) |
|---|---|
| ADR% | `technicals.compute_technicals` (`technicals.py`:475-545) |
| distance from 10/20/50/200; MA stack | same (`pct_vs_*`, `ma_stack`, `:528`) |
| RS rank; RS-line trend | `screener_rows.rs_rank` (as of the latest nightly only; a past as-of reads "not available"); `technicals.rs_line_trend` (`:252`) |
| base length and depth | `base_catalog` (`:1235-1240`); `candles.multi_candle` `pullback_depth_pct` (`candles.py`:252) |
| volume dry-up (N-week low) | `vol_nweek_low` (`snapshot_db.py`:75) |
| tightness (close CV) | `candles.multi_candle` (`:283-292`) |
| prior run (pole %) | `technicals._pole_pct` (`:202`) |
| pattern detections | `pattern_detections` active at the as-of, `confirmed_only` default (`patterns.py`:679-690) |

  Today's as-of reads the nightly `screener_rows` row (`snapshot_db.py`:403). A past as-of runs the
  same functions on bars up to that date.
- **13I-2 features:**
  - **Checklist autofill.** Creating a setup plan from a chart marks each checklist item
    (`notebookTemplates.js`:75-110 and siblings) with its fingerprint evidence, through one mapping
    module (`lib/fingerprintChecklist.js`).
  - **Visual playbook grid.**
    - It shows chart blocks with a `ta.setupTag` (the `j2_chart_blocks` projection), each card
      with its frozen chart, fingerprint and outcome (R and win/loss, from 13A links and
      `playbook_stats`).
    - Filters: setup, outcome, timeframe, regime (13E) and fingerprint ranges (for example
      "breakouts, RS > 90, depth < 15%").
    - Slice stats use R3 wording.
  - **Pattern suggestion at insert.** A detection for that symbol and date is mapped to a catalog
    name (`lib/setupTagMap.js`: `SETUP_CATALOG`, `setupCatalog.js`:48, aliased to `setupGroups.js`:
    29) and offered; the member confirms.
  - **Before and after.** The entry chart (frozen at 13E's fill day) beside the exit chart, with
    plan levels and fills marked: on `TradeDetailPage.jsx` and in the 13A review note.
- **Flags.** `NOTEBOOK_TA_FINGERPRINT_ENABLED` (the panel and autofill),
  `NOTEBOOK_VISUAL_PLAYBOOK_ENABLED` (the grid, suggestion and before/after).
- **Rails.**
  - The fingerprint equals the screener functions' output on fixture bars (a rail imports them
    rather than restating them).
  - A past as-of uses only bars up to that date.
  - RS rank on a past as-of reads "not available".
  - Suggestions are never applied without a click.
  - The alias map covers both setup lists.
  - Slice stats match the authority.
  - Mutation-prove "reused, not re-derived".
- **Walk.** Insert a chart; the fingerprint panel shows; accept a suggested tag; filter "my
  breakouts, RS > 90"; open before and after on a graded trade.
- **Not:** new indicator maths; detector changes (the pattern lab is paused); auto-tagging; LLM.

### A.13J The active setups board and find more like this

- **Board** (`SetupsBoard.jsx`).
  - Every open plan or watch note with drawn levels (`j2_note_levels`, the 13D projection) becomes
    a live mini-chart card with the member's lines (read-only), the distance to trigger and the
    days in setup.
  - Sorted by closeness to entry; 16 cards a page.
  - Built on the grid recipe: `GridChartCell`'s `backgroundWarm={false}` (`:439`), the
    `useStaggeredMount` limit of 3 (`:17`), `makeGridWarmer` (`gridWarm.js`:15) and the cell cap
    (`gridLayouts.js`:14). Never a per-card stream; prices from the shared feed.
- **Find more like this** (`SimilarNames.jsx`).
  - From any tagged chart or playbook card, list today's closest names over `screener_rows`, by a
    deterministic normalised distance on the fingerprint fields plus pattern overlap
    (`pattern_engine_ids`, `snapshot_db.py`:121).
  - Each match shows its reasons ("RS 94 vs 92, depth 11% vs 12%, VCP").
  - **Precomputed nightly** after the 05:00 ET sweep (`scan_evaluator.py`:258-259) into
    `j2_similar_matches`, for at most 25 templates a member. The request path only reads it.
  - Weights live in one constants block with a test.
- **Flags.** `NOTEBOOK_SETUPS_BOARD_ENABLED`, `NOTEBOOK_FIND_SIMILAR_ENABLED`.
- **Rails.**
  - A board of 40 levels mounts at most 3 charts at once, with no background warm.
  - Distance and days are correct on fixtures.
  - The request path never reads more than the precomputed rows (a rail fails if
    `similar_matches` queries `screener_rows` per request).
  - Reasons equal the field deltas.
  - The nightly job is idempotent.
- **Walk.** The board with 12 setups sorted by distance; open the closest; find similar; a match's
  reasons; 390 and 1200.
- **Not:** a per-request universe scan; per-card streams; new scoring formulas beyond the distance
  over existing fields.
