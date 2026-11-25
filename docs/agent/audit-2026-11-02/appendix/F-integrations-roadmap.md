# Audit F — UCT Agent: Indicators integration, News integration, research, historical, roadmap/handoffs, memory, multimodal, guide

Read-only audit on worktree `C:/w/aaudit` at origin/master `cfc35a3b3f` (2026-11-02). PR states from `gh pr view` in `C:/Users/blake/projects/UCT-Dashboard`. No edits, no installs, no test runs, no paid calls. Paths are relative to `C:/w/aaudit/`.

---

## 1. Indicators integration

### 1.1 Indicators-owned interfaces (`app/src/components/chart/builder/`)

**agentAuthoring.js** (520 lines, contract `uct.indicators.authoring/1`, line 34). Owns the draft: lineage, revision, history, Undo, the model call, validation, Save, read-back. Runs the SAME `authoring/authoringSession.js` pipeline the Create Indicator dock uses (lines 10-14).

| Export | Line | Meaning |
|---|---|---|
| `AUTHORING_CONTRACT`, `AUTHORING_REASONS` | 34, 38 | contract id; stable refusal strings (access, draft-expired, stale-revision, needs-ack, validation, save-conflict, saved-unconfirmed, nothing-to-preview, readonly, busy ...) |
| `openDraft(request, ctx)` | 215 | open a NEW draft (`{create:true}`) or an EDIT of the member's own saved definition (`{edit:{defId}}`); refuses unless `ctx.canAuthor === true` |
| `draftStatus(draftRef, ctx)` | 249 | the draft as it is now |
| `listDrafts(ctx)` | 256 | every authoring draft open in this tab |
| `draftTurn(draftRef, message, opts, ctx)` | 306 | ONE member turn: local turn, else `modelTurn(... converse: ctx.converse || converseTurn)` -> POST /converse (line 324); returns typed outcome `applied / question / answer / unsupported` or a refusal; refreshes the live preview after an applied change (line 341) |
| `draftUndo(draftRef, opts, ctx)` | 348 | undo the latest specialist history step exactly (`expectedStepId`) |
| `renameDraft` / `discardDraft` | 378 / 407 | rename the draft; throw the draft away |
| `readStoredDefinition(defId)` | 422 | server read-back `/api/user-definitions/{defId}` |
| `saveDraft(draftRef, opts, ctx)` | 455 | canonical Save via `saveConversation` -> `saveUserDefinition`; success ONLY after read-back matches (id, version, maths, name). "No chart is attached here (add it with M2), and requested alerts are not armed here (each is reported)" (lines 446-448); `arm: false` at line 474 |
| `showDraftPreview(draftRef, {host, chartRef}, ctx)` / `clearDraftPreview` | 500 / 514 | the tab's ONE live preview on a chart via the ChartPane handle `showAuthoringPreview` / `clearAuthoringPreview`; only when asked |

**agentMutations.js** (1143 lines, contract `uct.indicators.mutation/1`, line 43). Ops: `add, remove, setVisible, setInputs` + STYLE_OPS (`setAppearance, setPlotStyle, setColor, setDisplayTarget`) + PANE_OPS (`movePane, setPaneSize`) + CREATE_OPS (`duplicate, copyFrom`) (lines 46-49).

| Export | Line | Meaning |
|---|---|---|
| `checkIndicatorPermission(op, args, ctx)` | 396 | permission check per op |
| `resolveIndicatorTarget(cs, registry, {instanceId,name,defId,inputs,ordinal})` | 420 | find the instance a request means |
| `planIndicatorMutation(cs, request, ctx)` | 491 | the proposal (writes nothing) |
| `applyIndicatorMutation(cs, plan, ctx)` | 585 | re-checks permission + pins, returns settings for the chart's own sink |
| `confirmIndicatorMutation(persisted, pending, ctx)` | 654 | the ONLY door to "done" (read-back) |
| `undoIndicatorMutation(cs, undo, ctx)` | 704 | exact undo or refused |
| `stateFingerprint`, `groupFingerprint`, `paneFingerprint`, `dependentsOf`, `removeInstanceWithRecord`, `restoreRemoved`, `styleOptionsOf`, `planAcrossCharts`, `inputSpecOf` | 272, 198, 792, 218, 354, 370, 834, 1130, 1143 | stale-state pins; what a removal severs; tombstone revive; allowed style values; fan-out across charts; input specs |

**agentSeams.js** (171 lines): `INDICATOR_OWNED_TOP_KEYS` (31), `SEED_MAX=600` (38), `instancesOf(cs, registry)` (75, the one reader of a chart's indicators), `instanceFingerprint(cs)` (135), `seedFrom(text)` (161).

**agentDefinitions.js** (292 lines, contract `uct.indicators.definitions/1`, line 42; ops `duplicate, delete`): `describeDefinition` (92), `searchDefinitions` (126), `findDefinitionUsage` (164), `planDefinitionAction` (182), `executeDefinitionAction` (214), `undoDefinitionAction` (266); re-exports `discardDraft` (40).

**agentPanes.js** (91 lines): `paneKeysOf`, `paneArrangeArgs`, `paneOrderOf` (54, 78, 88).

### 1.2 Agent-side capabilities (`app/src/agent/capabilities/`)

All registered in `app/src/agent/builtins.js` lines 52-57 (`registerIndicatorCapabilities`, `registerIndicatorEditCapabilities`, `registerIndicatorAuthoringCapabilities`, `registerChartSetupCapabilities`, `registerIndicatorControlCapabilities`, `registerDefinitionCapabilities`).

| File | Capabilities (line) | Notes |
|---|---|---|
| `indicators.js` (M1) | `indicator.list` (128), `indicator.openCreate` (170) | read via `instancesOf`; opens the EXISTING Create Indicator panel with the request prefilled (`seedFrom`), never sends it (header lines 1-20) |
| `indicatorEdits.js` (M2) | `indicator.add` (676), `indicator.remove` (747), `indicator.update` (790) | plan -> apply -> persist (`.agent.commit` -> `host.persist()`) -> confirm -> exact Undo; "NO WRITER HERE" (header lines 1-22) |
| `indicatorControls.js` (P2) | `indicatorStyle.set` (199), `indicatorStyle.placeIn` (213), `pane.move` (233), `pane.resize` (246), `indicatorCopy.duplicate` (259), `indicatorCopy.copyTo` (277) | wraps I-1...I-12 of `docs/indicators/AGENT-CONTRACT-P2-2026-10-27.md` |
| `definitions.js` | `definition.search` (112), `definition.describe` (131), `definition.duplicate` (157), `definition.delete` (176) | wraps `agentDefinitions.js` |
| `indicatorAuthoring.js` (M3) | `indicator.draft` (863), `indicator.previewDraft` (901), `indicator.saveDraft` (928), `indicator.undoDraft` (1028), `indicator.discardDraft` (1046) | availability `ctx.surface === 'charts' && ctx.createIndicator === true` (line 827); "The Agent never reads a tree or a formula, never calls /converse [directly], never writes a definition" (lines 19-23); `explicitIndicatorCreate` (428) and `createWithSave` (420) make "create an indicator ..." an applied build + save + add; `sealSave` / `validateSaveSeal` (554 / 578) pin the approved Save |
| `app/src/agent/indicatorEntry.js` (106 lines, Indicators-owned seam) | `setIndicatorAgentRoute` (27), `routeIndicatorAuthoring` (33), `resolveAgentChart` (43), `beginAuthoringIntent` / `takeAuthoringIntent` (53 / 65), `INDICATOR_DOORS` incl. `{door:'image', label:'Screenshot'}` (90-94), `openIndicatorDoor` (98) | the chart's "+ Create Indicator" / "Modify with UCT Intelligence" doors route INTO the Agent when the Agent is available (admin); otherwise the dock |

### 1.3 Plain-English authoring path (server)

- `POST /converse` is `api/routers/user_definitions.py:523` (`converse_definition`), deps `require_paid` + `require_admin_dark_rollout` (= `require_create_indicator_access`, lines 500-519: admin, OR the `CREATE_INDICATOR_COHORT_ENABLED` cohort via `rollout_gate.create_indicator_enabled_for`).
- Charges the same per-member hourly window as `/propose` (`_charge_propose`, line 540), then `definition_conversation.converse(...)` (lines 549-552). Returns ONE structured patch envelope `uct.authoring.patch/1` or a 200 refusal `{ok: False}`; "IT STORES NOTHING AND APPLIES NOTHING" (docstring lines 526-531).
- Model: `api/services/definition_conversation.py:1342 model=dc.MODEL` -> `api/services/definition_concierge.py:95 MODEL = os.environ.get("CONCIERGE_MODEL", "claude-opus-5")`. (The Agent's own turn model is separate: `api/services/uct_agent/turn.py:81 UCT_AGENT_MODEL`, default `claude-haiku-4-5`.)
- Browser client: `app/src/components/chart/builder/authoring/converseClient.js:28 CONVERSE_ENDPOINT = '/api/user-definitions/converse'`.

### 1.4 Step-by-step: can the Agent today ...

| Step | Wired? | Evidence |
|---|---|---|
| Create an indicator from NL | YES (admin + Create Indicator access) | `indicator.draft` -> `draftTurn` -> `/converse` (`indicatorAuthoring.js:863`, `agentAuthoring.js:306-324`); an explicit "create a custom indicator ..." is applied without a card (`useAgent.js:1784`, `docs/agent/CHARTS-OPERATOR-PLAN.md` phase 2c; PR #493 MERGED 2026-10-29) |
| Preview on a chart | YES, on request only | `indicator.previewDraft` (901) -> `showDraftPreview` (`agentAuthoring.js:500`); auto-refreshed after each applied turn (line 341) |
| Edit the draft / an existing saved definition | YES | `openDraft({edit:{defId}})` (215), own definitions only; `draftTurn` again; `indicator.undoDraft`, `discardDraft`, `renameDraft` |
| Save | YES (always proposed; R1 explicit create sealed) | `indicator.saveDraft` (928) -> `saveDraft` (455), success only after read-back (lines 486-491) |
| Apply to chart | YES, as SEPARATE M2 `indicator.add` executions per `addTo` chart | `indicatorAuthoring.js:934-989` (`addTo` arg; hints at 966); `agentAuthoring.js:446` "No chart is attached here (add it with M2)" |
| Add alerts | NO | `saveDraft` passes `arm: false` and reports requested alerts instead of arming them (`agentAuthoring.js:447-448, 474`); the Agent's only alert capability is price-level only: `alert.create` summary "Only price levels — no percent-move, indicator, volume or time alerts" (`capabilities/alert.js:297-303`); indicator-condition scans are planning-only (`docs/agent/program/decisions/ADR-004-indicator-conditions-ic1.md:3-5`: "Runtime: none authorized") |
| Style / pane / copy / definition management | YES | `indicatorControls.js`, `definitions.js` (P2, PR #481 MERGED 2026-10-28) |

Caveat: all of this is admin-only (the Agent gate) and dark to members; `/converse` is cohort/admin-gated server-side.

### 1.5 PRs

- **#516** `fix/indicators-tc2000-stoc` — OPEN, DRAFT. "fix(indicators): TC2000 STOC + ATR import the documented formulas (audit P0-1) + function forms". Body: "ON HOLD — owner ruling 2026-10-30: no automatic migration. Do not merge until the owner authorizes it, after the production impact count". This is what "#516 stays on hold" in `docs/agent/program/README.md:21` and `docs/agent/program/STARTUP-PROMPTS.md` means: an Indicators-engine fix the Agent program must neither touch nor merge.
- **#465** `integrate/indicators-a1-on-master` — MERGED 2026-10-27 14:18Z (sha `826aa288ec`, in cfc35a3b3f). "Indicators A1 on current master: hide-not-delete, exact Undo, preserved indicators, layout Undo, unavailable indicators."
- **#467** `fix/agent-p2a2-envelope` — MERGED 2026-10-27 04:17Z (sha `1dea8a8b2a`, in cfc35a3b3f). "agent(P2-A2): a turn reply without a valid envelope fails safely."
- Related, all MERGED and in HEAD: #477 (Indicators P2 contract), #479 (Charts operator P1), #481 (Agent x Indicators P2), #484, #486 (operator milestone / auto-apply), #489, #493 (create fix), #517 (exact stored-state Undo, closes PHASE3-INDICATORS-HANDOFF), #520 (multistate). Open drafts: #325 (A1 original, superseded by #465), #573 (IC-1 contract docs), #617 (F-15 Pine undo), #670 / #671 / #689 / #687 / #683 -> RC #701.

---

## 2. News integration

### 2.1 Code (all present in cfc35a3b3f)

- `app/src/agent/capabilities/news.js` (125 lines): read-only queries `news.latest` (105, `/api/company-news/{sym}`) and `news.catalysts` (116, `/api/catalysts/history/{sym}`); no model call (header 1-15).
- `app/src/agent/newsAsk.js` (139 lines): the public seam — `useAgentAsk({newsId})` (108) -> `{ask, turns, busy, error, conversationId, available}`, `openAgent({conversationId})` (127), `canUseAgent(user)` (59), re-export `AgentIdentity` (25), `NEWS_ASK_MAX = 500` (27). Only the headline ID leaves the browser (`context: {news: {id}}`) (header 13-15).
- `api/services/uct_agent/news.py` (96 lines): `FLAG_ENV = "UCT_AGENT_NEWS"` (default OFF, line 16), `MAX_MESSAGE = 500` (18), RULES prompt block (21-28), `ANSWER_ONLY` (30); refused before any charge when off.
- Router: `api/routers/uct_agent.py:195` `/api/agent/config` reports `"news": news.enabled()`; `_news_turn` (261), `_news_conversation` (284), called from the turn route (250, 341-348).
- News widget side: `app/src/pages/charts/widgets/tradeExchangeNewsAgent.js:11` `NewsAgentContext = createContext({ useAsk: useAgentAsk, openAgent })` (the default value IS the real Agent exports, so no Provider is needed); `TradeExchangeNewsAsk.jsx:31-32` `NewsAgentAsk` reads the context; rendered at `TradeExchangeNewsParts.jsx:377 {agentVoice && <NewsAgentAsk newsId={item.id} />}` where `useAgentVoice()` (297-301) = `admin && useAgentFlag()`.
- `app/src/pages/charts/ChartsWorkspace.jsx` carries the `uct-agent-open` listener (per #684's body; file appears in the `useAgentAsk|NewsAgentContext` grep).
- Git: `newsAsk.js` commits `2fc9c4fb3e` and `66caca7227` (= #684's head) are on master via #692.

### 2.2 PR states (gh, 2026-11-02)

| PR | State | Merged | One line |
|---|---|---|---|
| #629 `feat/uct-news-release-links` | MERGED | 2026-11-02 22:35Z, `b831b554cc` (in HEAD) | UCT News: verified original press-release links (FMP + SEC, exact-only, 4 flags dark) |
| #658 `feat/uct-news-explain-identity` | MERGED (had been a draft) | 2026-11-02 18:46Z, `fd73320be3` (in HEAD) | News explanations in UCT Agent's voice for admins, labelled "What this means / What to watch", prompt v2 — increment 1 |
| #665 `feat/uct-news-agent-ask` | OPEN, DRAFT | no | News side of increments 2/3: Ask thread + "Continue in UCT Agent" (its content was carried into #692 via `feat/uct-news-agent-wire`; the PR itself is still open) |
| #684 `agent/lead/news-agent` | OPEN, DRAFT ("DO NOT MERGE") | no | Agent side: server news turn, `newsAsk.js`, ChartsWorkspace listener (its commits are in HEAD via #692) |
| #692 `agent/rc/news-agent` | MERGED | 2026-11-02 18:46Z, `d16867f344` (in HEAD) | Combined candidate = #684 + #658 + #665 wiring; `UCT_AGENT_NEWS` default OFF |

### 2.3 Is "ask the Agent about this headline" shipped end to end?

- The code path is complete on master: News widget Ask box -> `useAgentAsk` -> `/api/agent/turn` with `{news:{id}}` -> server re-reads the headline -> answer-only reply -> "Continue in UCT Agent" opens the panel on that conversation.
- NOT active: `UCT_AGENT_NEWS` defaults OFF (`news.py:16`); the box renders only when `available === true` AND admin AND the browser Agent switch (`TradeExchangeNewsParts.jsx:297-301`, `newsAsk.js` header). Activation is "a separate decision" (#692 body). Also still admin-only like the whole Agent.
- Housekeeping gaps: #684 and #665 remain open drafts although merged by content; an independent agent-qa verdict and a News re-run on the exact SHA were listed as "Pending" in #692 before it merged (not verifiable here whether they happened).

---

## 3. Research workstream (RS-1 / agent-rs)

- `api/services/uct_agent/research/` does NOT exist; no `app/src/agent/capabilities/research*.js`; no `contracts/RS-1-*.md`; no `status/agent-rs.md`. Ownership rows are reserved only: `docs/agent/program/OWNERSHIP.md:69-74`; `docs/agent/program/README.md:12` "agent-rs (B: Trading Research & Reasoning, RS-1) joins in Sprint 2, once MD-1 is integrated". Sprint 2 (RC `f479b0ae32`, in HEAD; agent-qa GO in #672) shipped MD-1 quote activation, not RS-1. RS-1 is unstarted.
- What research exists today: the turn envelope's `research` field (`api/services/uct_agent/turn.py:415-423`, prompt lines 485-488) -> ONE Perplexity query via `_web_search` (`turn.py:938-940` -> `api.services.perplexity_search.web_search`, mode "fast", 600 tokens) -> `_research` returns `{answer[:2400], citations[:6]}` (945-951) -> the model is asked again with `<research_results>`. Metered as `budget.Meter.research` (`api/services/uct_agent/budget.py:396-398`; `RESEARCH_RATES` line 63). News Ask turns never run research (`news.py:5-6`).
- `ai_search_agent.py` / `ai_doors.py` are NOT used by uct_agent (zero references in `api/services/uct_agent/*` and `api/routers/uct_agent.py`).
- Citation / grounding: citations are deduped and capped at 8 in `usage` (`turn.py:1823-1858`), returned by the router (`api/routers/uct_agent.py:395, 425`), surfaced as `sources` on the agent message (`app/src/agent/present.js:186`, `app/src/agent/useAgent.js:1704`). `docs/agent/ROADMAP.md` Stage 7 lists "an https:-only filter on citation links" and "disclosure that research queries are sent to Perplexity" as still-pending member-rollout prerequisites.

## 4. Historical analysis

- Beyond `stock.dailyBars` (`app/src/agent/capabilities/marketDataBars.js`, kind `bars.daily` in `api/services/uct_agent/marketdata/bars_daily.py`: lastClose / change / range52w, completed sessions only, dark unless `UCT_AGENT_DATA` + `UCT_AGENT_DATA_KINDS` include it; `gateway.py:41-50`) and breadth history (`capabilities/breadthHistory.js`, `uct_agent/breadth_history_present.py`, router `/api/agent/breadth/history` at `uct_agent.py:648`), there is no historical-analysis capability.
- `api/services/market_intel/` exists: `event_study.py`, `event_study_answer.py`, `breadth_answer.py`, `breadth_events.py`, `breadth_reads.py`, `price_reads.py`, `series_adapters.py`. The event study ("every time <condition>, what did <symbol> do afterwards", Slice 2) is LOCAL ONLY and model-isolated (`event_study.py:1-15`).
- Wiring to the Agent: only the breadth modules are imported (`breadth_now.py:37`, `breadth_present.py:18`, `breadth_select.py:34,197`, `breadth_history_present.py:13`, `turn.py:838,852`, router 578-658). `event_study` has ZERO callers outside `api/services/market_intel/` (grep across `api` and `app/src`). ROADMAP Stage 3 "Historical questions — planned"; the Slice 2 Agent handoff was never wired.

## 5. Roadmap / plans / handoffs

- **Vision** (`docs/agent/ROADMAP.md`, approved 2026-10-08): "The Agent proposes; UCT executes"; no engine duplicated (indicator, screener, pattern, drawing, historical query, backtest stay with owners); stages: 1 Charts workspace mastery -> 2 visual chart understanding (image input on `/api/agent/turn`, `getSnapshotBlob`) -> 3 historical market intelligence (typed query service + coverage registry) -> 4 NL backtesting (engine audit first) -> 5 chart similarity search -> 6 unified research workflows -> 7 broader UCT + member rollout. Owner approval is required to change access (admin-only), the model (Haiku 4.5), the spend cap, and prod config.
- **Declared done:** Batches 1-6 shipped (`c2d889a0fe`, `e4c3466e38`, `d3ca02f124`); Batch 7 indicators M1 -> M3 + P2 (PRs #465 / #477 / #481 merged); Batch 8 narrow drawings; Charts operator Phases 1, 2, 2b, 2c released (`docs/agent/CHARTS-OPERATOR-PLAN.md` Phases table; PRs #479, #481, #486, #493 MERGED); Phase 2A/2B (#496, #499 MERGED 10-29); Phase 3 WS1-WS5 (#515, #518, #521, #522, #524 all MERGED 10-30/31; `docs/agent/PHASE3-REPORT.md` still says "five draft PRs, all unmerged" — stale); Program Sprint 0-2 (MD-1 quote kinds activated per #672).
- **Deferred and why:** Stages 2-7 all "planned"; Batch 8b anchored drawings (needs deterministic anchors); Batch 9 screener depth (flags / revision column); Batch 10 (no background price-alert monitor — PRODUCT-HANDOFFS section 4); NL-1 model-first stays OFF (needs a paid eval + owner); WS1-E bounded model repair not started (a paid call per failure); WS2 settings eligibility (ownership of `chartSettingsDescriptors.js`); real-model benchmarks owed ("Verification debt" table); float / pop-out / merge (no verifiable readback); IC-1 indicator conditions planning-only (ADR-004); RS-1 unstarted; member-rollout prerequisites (entitlement `available(ctx)`, byte limits, Perplexity disclosure, https citation filter, restore `UCT_AGENT_DAILY_CAP` 3000 -> 300).
- **`docs/agent/UNATTENDED-DEVELOPMENT.md`** (adopted 2026-10-09 after an overnight push loop pushed `b554a9f376`): before autonomous work, list and STOP every remote mutator (push loops, redeploys, variable changes); verify remote state with `git reflog show origin/master` / `git branch -r --contains`, never infer it from a loop log; during unattended work: local feature-branch commits only, no scheduled remote mutations, prod reads only if the brief allows; reports may say "nothing pushed / deployed" only with reflog / deployment evidence; unattended RELEASES need explicit per-session owner authorization naming what may be released, always via `tools/pre_push_guard.py` -> master deploy gate -> promote; worktrees need `railway link` for the guard.
- **`docs/agent/program/STARTUP-PROMPTS.md`** (Sprint 1): per-session prompts for `agent-md` (MD-1 kinds behind `UCT_AGENT_DATA`, 4 PRs: quotes, bars.daily, fundamentals / earnings / news.company, breadth / nhnl / themes / volume / ratings; ADR-003 flow / darkpool spike), `agent-sc` (SC-1 behind `UCT_AGENT_SCAN`: screen.run / count, saved screens, discovery questions, legacy-screener inventory), `agent-qa` (fixtures, conformance, cost / limits, integration; ownership check on every PR). STANDING RULES: admin-only, NL-1 OFF, everything dark behind server flags; never merge / promote / deploy (PRs into `agent/int`; agent-lead integrates; the owner authorizes); own paths only (`OWNERSHIP.md`, `tools/agent_ownership_check.py`); wrap don't fork (no new pipelines / engines / jobs / DBs; "#516 stays on hold"; never restart flow-worker; Voice / Compass / AI Search untouched); MD-1 data honesty (source, as_of, freshness; price reads never trigger alerts); no paid model calls in tests, no paid evals without owner OK, budgets / model unchanged; no `npm install`; suites only via `tools/agent_suite_lock.py`; branch from `origin/agent/int`; update `status/<you>.md` per PR.
- **`docs/agent/PRODUCT-HANDOFFS.md`**: 14 product-safety items from the 2026-10-08 audit; 1 / 2 / 8 fixed; open: 3 pop-out loss (unverified), 4 no background price-alert monitor, 5 digest unsubscribe, 6 saved-screen revision, 7 watchlist save-as flag, 9 indicator plan (done), 10 tab reorder absent, 11 drawings anchors, 12 link colours unvalidated server-side, 13 Main Trading product-level lock, 14 audit.
- **`docs/agent/PHASE2.md`**: Phase 2 (`feat/agent-intelligence-p2`) benchmark 100% tasks, 0.54 model calls / task; M1 live batch "Not run — awaiting owner approval".
- **`docs/agent/handoffs/`**: `INDICATORS-HANDOFF.md` ("two integration seams (Phase 2.5)": parameterised indicator actions + a second seam), `INDICATORS-LIVE-TEST-2026-10-28.md` (owner live-test findings), `dollar_vol_1d.screener.patch`.
- **`.claude/agents/`** (24 files, all `joystick-*`): a role set for a DIFFERENT initiative — the "UCT Glass Joystick Hub" mobile build on worktree `C:\Users\Patrick\uct-worktrees\joystick-hub` (`joystick-director.md` lines 1-15). Director (opus, tools `*`) owns scope / gates / `registry.ts`; leads (architecture, discovery, ux, qa, doc — mostly opus) brief workers; read-only analysts (cartographer, chart-analyst, dataflow, auth-tier — sonnet, Read / Grep / Glob); engineers (registry, gesture, context — sonnet, + Write / Edit / Bash); designers / copy (interaction, visual, copywriter, a11y specialist, mobile-browser specialist — Write); testers (device, gesture, regression, a11y auditor, security reviewer — Bash). None relate to UCT Agent, News or Indicators; no frontmatter `description:` fields.

## 6. Memory / personalization

- Browser `app/src/agent/memory.js` (196 lines): SESSION memory only — result sets (3 x 50 tickers, 30-min TTL), subjects, last change, up to 5 corrections, the last turn's steps / indicators; "cleared on a new chat, a chat switch and a reload (session-only by design: nothing persists)" (lines 1-29); written only by UCT, never the model.
- Server `api/services/uct_agent/store.py`: SQLite `/data/uct_agent.db` with 3 tables — `agent_conversations` (owner, title, pinned), `agent_turns` (member / agent / outcome transcript; the model's history is rebuilt from these), `agent_telemetry` (no text) (docstring 1-20; CREATE TABLE at lines 40, 48, 58). Per-member conversation history persists and is served by `/api/agent/conversations*` and `/api/agent/search` (`api/routers/uct_agent.py:487-534`).
- No preference / personalization store: grep for preference / personaliz / remember in `uct_agent/*.py` finds only the prompt line "Educational, not personalized buy/sell advice" (`turn.py:497`). Browser `preference` hits are UCT app-settings capabilities (`settings.js`, `app.js`, `digest.js`), not Agent memory. Model isolation (ADR-005) forbids UCT-derived values in history / summaries.

## 7. Multimodal

- None. `TurnIn` (`api/routers/uct_agent.py:134-159`) has `message`, `context`, `capabilities`, `routing`, `reference`, `pending` ... and no image / attachment field; no image / base64 / vision handling in `turn.py` or the router. Browser: `app/src/agent/discovery.js:43-46` answers screenshot questions as "planned (Stage 2)"; `app/src/agent/indicatorEntry.js:94` offers a "Screenshot" DOOR that opens the Indicators builder's own image import (not the Agent); `app/src/components/StockChart.jsx:5555 getSnapshotBlob` exists but is used only by the mobile app (`app/src/pages/charts/mobile/MobileChartsApp.jsx:343`), not bound to the Agent. `app/src/agent/AgentPanel.jsx:43-49`: the welcome copy deliberately describes the FINISHED Agent ("screenshot rebuilds" etc.) by owner decision 2026-10-10.

## 8. Guide

- `app/src/agent/guide/`: `registry.js` (GUIDE_FEATURES), `targets.js` (findTarget / rectOf / reveal), `explain.js` (CONCEPTS + catalog explain), `guideStore.js`, `placement.js`, `GuideOverlay.jsx`. Capabilities in `app/src/agent/capabilities/guide.js`: `guide.explain` (126) and `guide.show` (140), both queries on the read-only `guide` target; "Do it for me" is not its own capability — it runs the feature's existing capability via `doItForMe` in useAgent (header 1-12). Surface: `charts` only (line 123).
- Registered features: **11** (`registry.js:32-174`): canvas, link, symbol, timeframe, indicators, charts, watchlists, layouts, hideDrawings, drawing, settings. Distinct step targets: **20** (18 `data-guide` ids: `chart.drawingTools, chart.drawingsHide, chart.settings, chart.symbol, chart.timeframe, chart.timeframeMore, chart.tool.horizontal, chart.tool.trendline, chartSettings.tab.canvas / indicators / price, widget.link, workspace.layoutLibrary, workspace.layoutLibraryMenu, workspace.layouts, workspace.widgets, workspace.widgets.chart, workspace.widgets.watchlist` + 2 object targets). Explain concepts: 3 (`indicator-vs-condition`, `condition`, `link-colours`) plus indicator-catalog rows and settings-descriptor rows.
- Pages carrying `data-guide`: the Charts workspace only (`pages/charts/ChartsWorkspace.jsx`, `LayoutDock.jsx`, `WidgetHeader.jsx`, `widgets/*`, `components/chart/ChartToolbar.jsx`, `ChartSettingsModal.jsx`, `components/chart/pane/*`); two hits in `pages/journal-2-0/components` are unrelated to the Agent guide. Shipped via #499 (2026-10-29) and #521 (2026-10-30).

## Unverified / caveats

- Whether `UCT_AGENT_NEWS`, `UCT_AGENT_DATA(_KINDS)`, `UCT_AGENT_SCAN` are set on Railway (no prod read performed); the code defaults are OFF.
- Whether the agent-qa verdict and the News re-run listed as "Pending" in #692 were completed before its merge.
- Production deployment of cfc35a3b3f itself (not checked).
- `docs/agent/PHASE3-REPORT.md` and `docs/agent/ROADMAP.md` coverage rows are stale versus PR states (Phase 3 and M1-M3 are merged; the roadmap row still says "M1 built locally").
