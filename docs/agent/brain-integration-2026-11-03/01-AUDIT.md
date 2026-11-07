# 1 — Architecture audit: the Trading Brain, and the Agent seams it would plug into

Scope: objective 1 (the brain's actual architecture) and the parts of objective 2 that concern the Agent's own shape. All counts were computed from `uct-brain/tables/*.jsonl` (snapshot 2026-11-01) with a throwaway script; no row content is reproduced here.

## 1.1 The system the brain lives in (four repos, one database)

```
 tsdr-ledger (partner's PC, private)          uct-intelligence (partner's PC)              UCT-Dashboard (Railway web pod)
 Discord bot pull -> reviewed records         data/uct_intelligence.db  <-- kb syncs       /data/brain/  (Brain Pack, installed by brain_sync.py)
 -> structured calls -> scored vs bars.db ->  scripts/*_kb_sync.py (additive, dry-run      +- uct_intelligence/*.py   (engine code, imported by brain_service)
 -> lab/knowledge/build.py (de-identified      by default, backup, BEGIN IMMEDIATE,         +- data/uct_intelligence.db (SQLite backup copy)
    setup knowledge, 98 entries)               deadline 20:55 CT)                            +- data/*_brain.json (optional files)
                                               scripts/autonomous_brain.py (5 runs/day:     +- PACK_MANIFEST.json {ts, kb_rows, template_rows, db_bytes, data_files}
 morning-wire (partner's PC)                   premarket/open/midday/preclose/postmarket    /data/brain_index.db (embeddings; survives pack swaps)
 morning_wire_engine.py imports                -> analysis_log, market_regimes, ep_*,
 uct_intelligence.api (line 76) and            coaching_notes via self-review)
 writes wire_issues / wire_universe /          scripts/brain_pack_export.py --upload
 wire_prompt_config / book_plans               (Task Scheduler, weekdays 21:00 CT) -> R2 brain/<ts>.tar.gz + brain/latest.txt
```

Evidence: `uct-brain/README.md`; `uct-intelligence/scripts/brain_pack_export.py` (pack layout, `OPTIONAL_DATA_FILES`, keep 5 packs); `UCT-Dashboard/api/services/brain_sync.py` (verify + atomic install + `on_install` callbacks + 6 h daemon); `UCT-Dashboard/CLAUDE.md` §"Compass Brain Bridge" (the LOCKED two-repo contract: pack layout = `uct_intelligence/` + `data/uct_intelligence.db` + `PACK_MANIFEST.json`); `morning-wire/morning_wire_engine.py:76`; `tsdr-ledger/lab/HOW_CONTENT_TRAINS_THE_BRAIN.md`.

## 1.2 The knowledge base (`knowledge_base`, 19,024 rows)

Schema (`uct-intelligence/uct_intelligence/db.py:143-158`): `id, category, title, content, tags, trader, source_ref, regime_context, priority (1-5), active, source, knowledge_epoch, created_at, updated_at`. There is **no review/approval column, no licence column, no expiry and no content hash** at the engine level (the Wisdom adapter computes `content_sha256` on its own side, `wisdom/publish/adapters/kbrow.py`).

| Dimension | Measured | What it means for the Agent |
|---|---|---|
| Categories | 26; RULE 5,172 · MACRO 3,622 · SETUP 2,620 · PSYCHOLOGY 1,530 · CASE_STUDY 1,166 · FRAMEWORK 869 · EXECUTION 660 · SECTOR 613 · SCREENING 595 · REGIME 415 · SIZING 291 · TOOLS 249 · JOURNAL 249 · DEFINITION 223 · MOMENTUM 218 · SHORTING 137 · BIOGRAPHY 118 · EARNINGS 74 · … · TEST 3 | Category is a usable retrieval filter; MACRO / REGIME / SECTOR are time-sensitive observations, the rest is mostly evergreen craft |
| Source families | `intake` 11,890 · `trader_archive` 5,172 · `self_review` 1,840 · `setup_knowledge` 98 · `chart_intake` 21 · `manual` 3 (93 distinct source strings) | Licence class must be derived from the source family (`03-DESIGN.md` §5.3) |
| Largest single sources | `trader_archive` 5,172; `intake:substack_unchartedterritory_sunday_scans_2026-02-21` 4,399; `self_review` 1,840; `intake:discord_tsdr` 591; `intake:substack_jeffsun_…` 407; seventeen `intake:x_<handle>_2026-10-20` tweet intakes (≈ 3,500 rows) | The partner's own report flags the attributed Feb Substack intake (≈ 4,800 rows) as "an open owner call" whether to deactivate (`HOW_CONTENT_TRAINS_THE_BRAIN.md` §1c) |
| Trader labels | 134 distinct; TSDR 4,840 · Bracco 3,557 · UCT Brain 1,828 · (blank) 1,466 · Qullamaggie 881 · Manrav 692 · Jeff Sun 396 · … with spelling variants (`TSDR` / `TSDR_Trading`, `Chartmaster` / `1ChartMaster`) | A normalisation map is needed before "cite by trader" is reliable; the archive plan also records 456 rows mislabelled "Bonde" (`ARCHIVE-INTEGRATION-PLAN.md` Tier 2 #9) |
| Priority | 4: 9,246 · 2: 3,515 · 3: 3,331 · 1: 2,783 · 5: 149 | The engine's prompt injection (`api.get_knowledge_context`) uses priority 1 always, 2 on setup tag, 3 on regime; the Agent should not reuse that logic (it was built for one 800-char prompt block) |
| Epoch | 2026: 12,823 · 2024: 4,024 · 2025: 2,177 | A freshness hint for observations; meaningless for evergreen rules |
| Regime context | blank 11,313; 2,351 distinct non-blank strings, e.g. "Bull,Uptrend" 2,077 | Free text, not an enum; filterable by substring only |
| Content length | p50 375 chars · p90 1,099 · max 7,565 · total 9.77 M chars | Fits the existing 1,500-char chunking; ≈ 12–14 k chunks, ≈ 80 MB float32 in memory |
| Provenance | `source_ref` present on 16,879 rows (89 %); 2,145 rows have none | Rows without a locator are cited as "firm KB" only |
| Hygiene | 149 duplicated titles (max 5 copies); all 19,024 rows `active = 1`; MACRO rows: 2,952 created 2026-10, 668 in 2026-02, 2 otherwise | Duplicate collapse and an age rule for MACRO are QA items before the Agent cites them |
| Tags | 15,129 distinct; tickers (QQQ, SPY, NVDA, …) and themes dominate | Tag = ticker lets "what has the team said about X" work without embeddings |

**How knowledge enters** (objective 5 baseline): three additive, idempotent, backup-first, never-delete sync scripts on the partner's PC — `trader_archive_kb_sync.py` (LESSON / MACRO posts, priority 4, `source_ref = trader_archive:<record id>`), `setup_knowledge_kb_sync.py` (the 98 de-identified playbook entries, priority 2, also writes `data/setup_knowledge_brain.json`), and the Wisdom programme's `tools/wisdom/publish_kb_sync.py` (dashboard side, `source = wisdom`, flag `WISDOM_BRAINKB_PUBLISH_ENABLED`, OFF because the direct sync already loaded the archive rows). Ad-hoc intake is `scripts/knowledge_intake.py` (Claude parses notes into rows, preview, confirm; it has a MiniLM cosine ≥ 0.85 contradiction check that writes `data/pending_review/conflicts.json`). The autonomous brain's post-market self-review writes `coaching_notes` and `self_review` KB rows. **All of these finish before the 21:00 CT export; the pack is the only hand-off.**

## 1.3 The 48 setup templates

`setup_templates`: 48 rows, 6 families (Momentum Continuation 10, Classical Pattern 10, Base Breakout 9, Remount & Recovery 8, Gap & Catalyst 6, Short Setup 5), 12 origin traders (TSDR 8, O'Neil 6, Brandt 6, various 5, Qullamaggie 4, Morales 4, Wyckoff 4, Minervini 3, Kell 3, Weinstein 3, Darvas 1, Dr. Wish 1). Fields: `aliases, description, ideal_regime, entry_triggers, stop_methods, max_stop_pct, profit_logic, invalidation, common_mistakes, addon_rules, catalyst_types, float_requirements, hold_time_range, liquidity_min, ma_alignment, rs_requirements, sector_conditions, trend_requirements, notes`. All 48 were created 2026-03-29 and never updated since (`created_at = updated_at`). Resolution is `api.resolve_setup_name` (aliases, cached) and `get_setup_template`; the dashboard facade exposes them as `brain_service.lookup_playbook` (`brain_service.py:223`).

**Naming is the integration hazard, not the data.** At least six setup vocabularies are in play: the engine's 48 template names; the ledger taxonomy v8 (`structured/taxonomy.json`, ids like `ep`, `kicker`, `delayed_earnings`, with per-trader aliases); the Wisdom vocabulary v1 (`docs/wisdom/vocabulary/setup-vocabulary-v1.json`, "the ONE setup-name authority", 32 entries, mapped to pattern-engine ids and ENGINE strings); the Setup Library catalog (`app/src/pages/modelbook/setupCatalog.js`); `constants/setupGroups.js`; and the `setup_triggers.setup_name` strings (20 distinct, e.g. "Stage 2 Momentum", "Tight Flag", "20EMA Hold", "U&R", "VCP", "HTF", "EP"). The Wisdom map (`wisdom/archive/setup_map.py`) and the vocabulary rail (`tests/test_wisdom_vocab_authority.py`) are the existing authority; the Agent must resolve a member's word through it and the engine's aliases, and refuse by name when the authorities disagree (the `concept_vocabulary.py` rule: "a word the firm cannot ground is refused BY NAME").

## 1.4 Chart-pattern analysis and examples

- `model_examples`: 18 rows (`symbol, chart_date, setup_type, grade A+/A/B+, entry/stop/target prices, outcome_pct, days_held, annotations, failure_analysis, chart_path, kb_entry_id`), 16 from `chart_intake_backfill`. Small, hand-graded, with prices. Already served at `GET /api/model-examples` (`api/routers/intelligence.py:477`, `require_paid`).
- `CASE_STUDY` KB rows: 1,166 (the 10-section chart analyses described in `uct-intelligence/CLAUDE.md`).
- The ledger's chart work (`tsdr-ledger/lab/*`): 47,228 described images (not in the GitHub copy), the learned auto-drawer, detector evaluations with blind precision, and the **Chart Reader experiment (Claude vision, top-1 28 % / top-3 44 % on trader screenshots, n = 39, "not pursued")** — `ARCHIVE-INTEGRATION-PLAN.md` "Measured and NOT shipped". This bounds what P7 Multimodal can promise (`04-WAVES.md`).
- Chart similarity / lookalike models recognise the team's charts (AUC ≈ 0.91) but show "no edge" on forward returns; only setup votes are used in the brain. Not an Agent input.

## 1.5 Coaching knowledge

`coaching_notes`: 724 rows, every one `note_type = pattern`, `source = ai_review` (`content, note_date, trigger_event, related_trades`), continuous through 2026-10-30. **These are the brain's self-review of its own trades, not a human coach and not about any member.** The `self_review` KB rows (1,840) are the same lineage. Label accordingly ("the brain's own post-market self-review"). The human coaching lineage is different: the 36 `voice_kb/trading_principles.json` entries Compass voice loads (`voice_kb_service.py`), and the ledger's LESSON records (3,033) that reach the KB as `trader_archive` rows.

## 1.6 Win-rate statistics — three grades of trust

| Store | Rows | Method | Floor today | Base-rate controlled? | Freshness |
|---|---|---|---|---|---|
| `setup_performance` | 25 (`setup_type × regime_phase`) | the engine's own logged trades (`api.update_setup_performance`) | n ≥ 5 in `get_setup_performance` (`api.py:3268`) | no | `updated_at` 2026-10-30 |
| `trigger_performance` | 69 | `setup_triggers` (1,083 published triggers from the leadership list: win 283 · loss 276 · never_triggered 338 · open 124 · void 61), returns at 3/5/10/20 d, R multiple | none in the table | no | 2026-10-31 |
| `team_setup_forward` | 266 (all `open`) | forward capture of `undercut_reclaim` / `pullback_ma` / `ep` with a control pool and excess returns vs SPY | — | yes (controls) | scored 2026-10-30 |
| Ledger scorecard (`tsdr-ledger/scored/`) | 28,013 scored calls | each call vs the same stock on a random other day; edge at 1/5/20/60 sessions, MFE/MAE, R | **|z| ≥ 3 and n ≥ 40** before "EDGE" | yes | rescored nightly (keep-alive) |
| Wisdom team archive (`wisdom/archive/team_record.py`) | import of the above | verdict "measured edge" only at |z| ≥ EDGE_Z and n ≥ MIN_CONTEXT_N | yes; no prices ever | flag `WISDOM_ARCHIVE_ENABLED` |

The ledger's own headline must shape the Agent's wording: across the six traders no setup type proves edge on its own, "idea" and "watch" posts measure negative, and context (QQQ regime, extension) matters more than the setup name (`tsdr-ledger/scored/SCORECARD.md` preamble; `uct-agent-training-data/README.md` §2.4 "Only |z| ≥ 3 counts as a finding"). The Agent must therefore never present a win rate as advice, always beside n, a window and a verdict, and prefer the control-relative source when both exist.

## 1.7 Market observations and the Morning Wire pipeline

- `market_regimes` (190 rows: `phase, trend_score, risk_score, exposure_pct, breadth_50ma/200ma, distribution_days, vix`; sources `autonomous_brain` 94, `morning_wire` 92) and `market_breadth` (167) are **UCT-derived readings**. The breadth numbers are the same class ADR-005 isolates (`breadth.current`); the *phase label* is a derived signal.
- `wire_issues` (83 issues since 2026-04-29: `regime_classification, regime_snapshot, todays_story, prompt_config_version, source_counts`), `wire_universe` (30,540 issue × ticker funnel rows), `wire_prompt_config` (36 versions of learned narrative guidance from the owner's critic feedback, rendered by `morning-wire/learned_guidance.py`), `book_plans` (1,220), `leadership_snapshots` (5,976), `ep_candidates` (589) and `ep_follow_throughs` (14,061). The dashboard already reads `wire_universe × wire_issues` for the Decision Record (`api/services/decision_record.py`, flag `DECISION_RECORD_ENABLED`, owner call pending on member visibility) and `setup_triggers` for Ticker History (`ticker_history.py`, flag `TICKER_HISTORY_LANES2_ENABLED`).
- The Wire reads the brain at generation time (`uct_intelligence.api`, `team_recognitions`, `learned_levels`, `levels`, `trigger_quality`) and the brain reads the Wire's outputs back (`analysis_log`, `market_regimes source=morning_wire`). **The Agent should treat the Wire as a published member surface whose regime call and "today's story" are quotable observations with an `as_of`, not as a knowledge source to re-derive.** The partner's rule for the Wire itself: "NO win rates/records, NO trader names" in letter prose (`ARCHIVE-INTEGRATION-PLAN.md` Tier 2 #13).

## 1.8 The Agent side: the seams that matter (objectives 2 and 3)

| Seam | Where | Why it matters for knowledge |
|---|---|---|
| Browser capability registry | `app/src/agent/capabilities.js:43` (`registerCapability`: closed args schema, `query: true` → `answer(snapshot, args, host)`), 133 capabilities in `contract/manifest.golden.json` at this master | A knowledge capability is a QUERY (nothing committed, no Undo); the model may route to it so answers come from real data, and the fast path may answer without a model call |
| Server-backed kinds | `app/src/agent/capabilities/marketDataFacts.js` (`kindServed`, `readData` → `POST /api/agent/data`; only `{text, table, present, link, chart}` leave the module; dark when the server does not list the kind) | The pattern to copy for knowledge kinds; proven by the four company-data kinds in Wave 1 (BOARD C-02) |
| MD-1 gateway | `api/services/uct_agent/marketdata/gateway.py` — `Kind(name, fn, freshness, category, owner, validate, model_isolated)`; `REGISTRARS` (line 59) and `CATEGORIES` (line 60) are hard-coded tuples; per-turn caps lines 52-56; `read()` validates the envelope and stamps isolation | Adding a `knowledge` category and a registrar is a two-line agent-lead change; everything else is a new package |
| DataEnvelope (MD-1) | `marketdata/envelope.py` — required `as_of, freshness ∈ live/delayed/periodic/historical/unavailable, source, coverage, notes, provider_calls` | Provenance, freshness and floors have a place to live without a new contract |
| Planner v1 | `turn.py` — Haiku 4.5 JSON envelope, `MAX_CONTEXT_BYTES = 24000` (line 60), 60-capability window + routing; the NEWS block shows how the server injects a labelled data block (`turn.py:1705`) | Knowledge must not be injected into every prompt; it is retrieved on demand through a routed query capability, or on the fast path |
| Planner v2 | `turn_v2.py` — tool search + 12 domain tools (line 44) + one deferred strict tool per manifest capability; the server-side research tool executed in-loop (`_research_step`); `MAX_RESULT_CHARS = 2000` (line 38); `_DOMAIN_OF` prefix map (line 47; unknown prefixes → `history`) | Knowledge capabilities become tools for free; passage results must fit 2,000 chars; the prefix map decides which domain tool lists them |
| Budget / limits | `budget.py` (daily cap, per-request call ceiling, research metered), `limits.py` (rate windows), gateway provider-call cap 20/turn | An embedding call is a paid provider call and must be metered as one |
| Isolation | ADR-005 (`docs/agent/program/decisions/ADR-005-model-isolation.md`), `turn.LOCAL_ONLY_ACTIONS` (line 712), F-16 rails (ratings/scores/flow never reach the model) | Knowledge kinds are **not** isolated kinds; the regime phase is the one borderline item |
| Flags & access | `require_admin_dark` on every `/api/agent/*` route; prod flags verified 2026-11-03 (`UCT_AGENT_DATA=1` with an explicit `UCT_AGENT_DATA_KINDS` list, fail-closed) | A knowledge kind is dark until the owner lists it in `UCT_AGENT_DATA_KINDS`; no new flag is strictly required (one is proposed for clarity) |
| Ownership | `docs/agent/program/OWNERSHIP.md`: `api/services/uct_agent/**` and `app/src/agent/**` default to agent-lead; specialists own sub-paths; Voice / Compass / AI Search untouched | The design proposes a new owned sub-path (`uct_agent/knowledge/**`, `capabilities/knowledge*.js`) and requests the two agent-lead one-liners through the contract |

## 1.9 Gaps found that the design has to close

1. No approval / licensing / freshness metadata at the row level → derive on the dashboard side (policy by source family + category + epoch); propose additive manifest fields to the partner.
2. `brain_kb_service.search` has no filters and no floor → add a filtered search (category, source family, trader, epoch, min score) in the **Agent's** wrapper, leaving the Compass facade byte-identical.
3. Statistics floors differ (5 vs 30/40) → the Agent adopts the stricter floor and labels; the Compass facade is not changed.
4. Setup names are six vocabularies → the Agent resolves through the Wisdom vocabulary + engine aliases and refuses ambiguous words by name.
5. Duplicate titles, trader spelling variants, undated MACRO rows → a reindex-time health report and lints (QA), not a data rewrite.
6. Embeddings are an external paid call (OpenAI) with a 20 s timeout → meter it, cache query vectors, and add a zero-cost FTS first stage so the Agent can still answer when the embedding door is down.
