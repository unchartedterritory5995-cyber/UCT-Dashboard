---
id: E-06
title: AI inference, infrastructure and feature cost attribution — per-feature unit economics at six member scenarios, the ARPU crossover, and the guard constraints ARCH-05 inherits
role: Cost modeller — AI inference and feature attribution (Group E, cost pod)
wave: 2
group: E
category: synthesis
scope: uct-dashboard (terminal-research worktree) AI lanes as the unit-cost anchors; public Anthropic / OpenAI / Perplexity price pages; sibling reports D-12, D-04, E-01, E-02, E-03, F-03b, ORCH-RAILWAY-01; four competitor dossiers §L for comparable price points
confidence: 🟡 medium overall (public prices 🟢 dated 2026-09-02; per-call unit costs 🟡 anchored on two in-code MEASURED figures; calls-per-user-per-day for features that do not yet exist 🔴 ASSUMPTION; the current spend baseline is a second-hand Console read)
evidence_ceiling: "No spend ledger was readable (`auth.db llm_route_cost_log`, `catalyst_cost_log`, `engine_cost_log`, `voice_usage_monthly`, `/data/llm_batches.json` all sit on the production volume); the $515/month Anthropic baseline is an owner Console read recorded in session memory on 2026-08-24, not re-read by me; OpenAI and Perplexity spend are unaudited anywhere; the member count (OI-01), the spend baseline and ceiling (OI-10), and the commercial model (OI-12) are all pending, so every scenario number is a labelled assumption. Two admin reads (`GET /api/ai-search/admin/stats`, `GET /api/admin/catalyst-stats`) plus a Console 'group by API key' export would convert most 🔴 cells to 🟡."
sources: 08-ai/existing-ai-systems.md (D-12), 01-existing-system/database-and-infrastructure.md (D-04), 02-data-providers/railway-flag-state.md (ORCH-RAILWAY-01), 02-data-providers/provider-ledger.md (F-03b), 09-security-licensing-cost/{data-use-classification,realtime-and-exchange-classification,vendor-terms-evidence}.md (E-02, E-03, E-01), 00-program-control/{OWNER_INPUTS_REQUESTED,RESEARCH_GAPS}.md, charter/OWNER_SEED_FACTS.md §5–6, 03-competitive-research/{unusual-whales,koyfin,tradingview,benzinga-pro}/dossier.md §L, api/services/narrative_cost_guard.py, api/services/catalyst/cost_guard.py, api/flow_explain.py, api/services/journal_two/compass_cost_guard.py, api/services/voice_cost_service.py, api/services/pattern_vision/orchestrator.py, api/routers/ai_search.py, api/services/{ai_search_agent,ai_search_deep,ai_search_briefings,ai_search_dossier,perplexity_search,llm_batch,definition_concierge,cot_narrative,transcripts,engine}.py, api/services/journal_two/{coach_chat,coach,pre_trade_verdict,trade_review}.py, api/services/stock_brief/service.py, api/services/stripe_service.py, app/src/pages/Pricing.jsx, https://platform.claude.com/docs/en/about-claude/pricing (2026-09-02), https://developers.openai.com/api/docs/pricing (2026-09-02), https://docs.perplexity.ai/guides/pricing (2026-09-02), C:\Users\Patrick\.claude\projects\C--Users-Patrick\memory\{project_llm_cost_doctrine_2026_08_28,reference_subscription_vs_api_credit_map_2026_08_23,lesson_a_per_user_cap_does_not_bound_a_population}.md
uct_relevance: high
status: draft
date: 2026-09-02
---

# E-06 — AI inference, infrastructure and feature cost attribution

**Vocabulary.** TERMINAL-CURRENT = the `/calendar` surface display-named "UCT Terminal" (route, keys and `/api/calendar/*` unchanged). TERMINAL-NEXT = the product this program designs. UT is the parent brand; UCT Intelligence is the product.

**This is a LABELED-ASSUMPTION model, per the contract.** Every number carries one of four tags:

| Tag | Meaning |
|---|---|
| **LIST** | A public price page, with the read date. |
| **MEASURED** | A figure produced by a run and recorded in code, a report, or the owner's own session record; the artifact is cited. Not re-run by me. |
| **ASSUMPTION** | A value I chose so the arithmetic can proceed; the range is stated and the owner question that bounds it is named (§7). |
| **DERIVED** | Arithmetic over the three above. |

Nothing here is a fact about what TERMINAL-NEXT *will* cost. It is a fact about what the stated assumptions imply, so that changing one assumption changes one number.

---

## 0. HEADLINE

**OBSERVATION.** At base assumptions, the six AI features the program is likely to propose cost **$2.8–3.6 per member per month** at 1,000–10,000 members and **$7.27** at 100 (fixed warm lanes dominate small populations), on top of a **fixed base of ~$515/month** that already runs today (Anthropic only, MEASURED second-hand). Against the OI-12 default ARPU of **$200/month list** that is **1.4–3.6%** of revenue. Against the comparable-floor ARPU of **~$30/month** (the seed's $7 weekly promo, Benzinga Basic $30.58, Unusual Whales Basic $34 annual-effective) the base case is **9–24%**, and the **high case ($23.5/member/month all-in, inherited Compass and voice included) is 78%** — the crossover sits at roughly **1.3× the high case, or ~4.5× base engagement, at a $30 ARPU**; at $200 it sits at ~32× base engagement. **The per-user caps already in code do not prevent that crossover: summed, they permit ~$600–650 per member per month — three times the list price** — and the only lane that bounds a population today is a lane-level daily dollar cap, of which the chattiest member lane (Compass chat) has none (`COMPASS_COST_CAP_DAILY` default `0` = disabled).

**The single biggest cost driver is not a model rate; it is the shape of the natural-language screen.** `definition_concierge.py` measured itself at **$0.227/call on Opus 5 at 8,192 max_tokens** (worst case $0.454 across two calls) — 7.25× the Sonnet-5 figure it replaced — and at one screen per member per week that one feature is **$0.95/member/month, 27–34% of the six-feature total** at every scenario. The second is the per-member morning brief, the one lane that cannot share a cache across members ($0.89/member/month live on Opus 5; $0.45 via the Batch API). The third is the share/cache hit rate on the two per-symbol lanes ("why is it moving", alert explanations), which is what "answer once, serve many" actually buys.

**EVIDENCE.** §1 (tables), §2 (assumptions per row), §3 (prices and the two measured anchors), §4 (ARPU), §5 (guards). The concierge figure: `api/services/definition_concierge.py:128-141` (a MEASURED note dated 2026-08-26 against the real `estimate_cost`). The synth figure: `api/routers/ai_search.py:1803` `_SYNTH_CAP_DEFAULT = 5.0  # USD/ET-day; ~135 asks at the measured $0.037`. The baseline: session record `reference_subscription_vs_api_credit_map_2026_08_23.md` §MEASURED 8/24 (Console MTD Aug 1–24: $398.42 → ~$515/month).

**INTERPRETATION.** AI is affordable at UCT's list price under every modelled usage pattern below the caps, and unaffordable only where usage approaches the per-user caps or where ARPU falls to the promo floor. The economic risk is therefore not the model bill; it is a **population without a ceiling** — the shape `lesson_a_per_user_cap_does_not_bound_a_population` already caught once on the catalyst budget.

**RELEVANCE TO UCT.** TERMINAL-NEXT can carry a full AI layer at list price. What it cannot carry is an AI layer whose only rails are per-user caps sized for a ~200-member base — and the caps in production today are exactly that.

**CONFIDENCE.** 🟡. **EVIDENCE CEILING:** one Console export grouped by API key and two admin reads would convert the baseline and the calls-per-user rates from second-hand and assumed to measured.

**RECOMMENDATION.** ARCH-05 should size every member-reachable lane with a **population daily dollar ceiling = N × allowance + scheduled reserve**, re-derived at each scenario boundary (100 · 500 · 1,000 · 5,000 · 10,000), and treat the per-user cap as the second rail. §6 states the constraints.

**OPEN QUESTION.** What is the current monthly Anthropic + OpenAI + Perplexity spend **by lane**, and what fraction is member-triggered versus scheduled? The ledgers exist; none was readable (OI-10).

---

## 1. PER-FEATURE COST TABLE AT SIX SCENARIOS (Deliverable 1)

### 1.1 Base case — monthly USD and USD per member

Scenarios per the contract: **internal-only (2–5 users, modelled at 3)** · **100** · **500** · **1,000** · **5,000** · **10,000** members. All six are ASSUMPTIONS about a population that does not exist (OI-01). 21 trading days/month for market-hours features; 25 days for the always-on ask box. Models per lane are the never-downgraded classes (§2). Share-cache hit rates rise with N (§2, each row). No Batch, no pre-warm, no prompt-cache beyond what the lane already does — §1.2 applies the levers.

| Feature (model class) | 3 (internal) | 100 | 500 | 1,000 | 5,000 | 10,000 | Scales with N? |
|---|---|---|---|---|---|---|---|
| **F1 Contextual "why is it moving"** (Sonnet 5 synth + Perplexity `sonar-pro` leg; per-symbol shared cache) | $7 · $2.33 | $117 · $1.17 | $408 · $0.82 | $699 · $0.70 | $2,331 · $0.47 | $3,497 · $0.35 | **Yes** (sub-linear) |
| **F2 Earnings prep brief** (Sonnet 5 preview + Sonnet 4.6 transcript digest + Opus/Perplexity call recap; generate-once per reporter, in-season) | $30 · $10.00 | $300 · $3.00 | $300 · $0.60 | $300 · $0.30 | $300 · $0.06 | $300 · $0.03 | **No** (scales with reporters) |
| **F3 Watchlist morning brief** (Opus 5 synthesis over desk-grounded facts; one per member per trading day; no cross-member cache) | $2.7 · $0.89 | $89 · $0.89 | $446 · $0.89 | $893 · $0.89 | $4,463 · $0.89 | $8,925 · $0.89 | **Yes** (linear) |
| **F4 Natural-language screen** (Opus 5, `definition_concierge` measured $0.227/call; 0.2 calls/member/day) | $2.9 · $0.95 | $95 · $0.95 | $477 · $0.95 | $953 · $0.95 | $4,767 · $0.95 | $9,534 · $0.95 | **Yes** (linear) |
| **F5 Company-page summaries** (Sonnet 5, generate-once per symbol, refresh on print/filing; `stock_brief` shape) | $10 · $3.33 | $50 · $0.50 | $50 · $0.10 | $50 · $0.05 | $50 · $0.01 | $50 · $0.005 | **No** (scales with symbols; + $75–150 cold universe once) |
| **F6 Alert explanations** (Opus 5 narration of deterministic facts, `flow_explain` shape; per-(symbol, alert, 15-min) shared cache) | $1.3 · $0.42 | $34 · $0.34 | $137 · $0.27 | $252 · $0.25 | $945 · $0.19 | $1,680 · $0.17 | **Yes** (sub-linear) |
| **Carry-forward: ask box** (AI-Search fast + Claude synth, MEASURED $0.037/ask; 0.5 asks/member/day) | $1.2 · $0.42 | $42 · $0.42 | $208 · $0.42 | $416 · $0.42 | $2,081 · $0.42 | $4,163 · $0.42 | **Yes** (linear; agent lane adds up to +$0.38/member) |
| **Six features + ask box — TOTAL** | **$55** | **$727 · $7.27** | **$2,026 · $4.05** | **$3,563 · $3.56** | **$14,937 · $2.99** | **$28,149 · $2.81** | |
| **Fixed base already running** (all scheduled/warm lanes, Anthropic only — MEASURED second-hand) | ~$515 | ~$515 | ~$515 | ~$515 | ~$515 | ~$515 | No (but see §1.4) |
| **Inherited member lanes** (Compass chat 30% adoption × $4.00; voice 10% × $15.00 — both 🔴) | ~$8 | ~$270 · $2.70 | ~$1,350 · $2.70 | ~$2,700 · $2.70 | ~$13,500 · $2.70 | ~$27,000 · $2.70 | **Yes** (linear) |
| **ALL-IN per member (features + inherited; fixed base excluded)** | n/a | **$9.97** | **$6.75** | **$6.26** | **$5.69** | **$5.51** | |

*Cell format: monthly USD · USD per member. "3 (internal)" per-member figures are shown for arithmetic only — the internal scenario is dominated by the fixed base.*

### 1.2 With the doctrine levers applied (caching · batching · pre-warm)

The seed facts name the levers: models are never downgraded for cost; **caching and batching** are the cost lever, and caching must be taught to the guard (§5). A third lever is in the codebase's own idiom — **generate-once + skip-if-stable + serve-many** (earnings previews, catalysts, stock briefs, COT reads).

| Lever | Applies to | Effect | Source of the multiplier |
|---|---|---|---|
| **Batch API, 50% off** | F3 (scheduled pre-market), F2, F5 warmers | ×0.5 on the Claude leg | LIST — batch table, platform.claude.com 2026-09-02; `llm_batch.BATCH_DISCOUNT = 0.5` (`api/services/llm_batch.py:48`) |
| **Prompt cache on the stable prefix** | every lane with a ≥1,024-token byte-identical prefix | prefix billed 0.1× on a hit; write 1.25× | LIST — 5-minute write 1.25×, read 0.1×; `ai_search.py:1875-1885` measures `_WIDGET_SYSTEM` at 1,299 tokens and states the break-even (two requests sharing a prefix) |
| **Pre-warm the top movers (scheduled)** | F1 at ≥5,000 members | 150 symbols × 4 refreshes/day × $0.037 = **$466/month fixed**; member misses fall from 15–20% to ~5% | ASSUMPTION (the catalyst engine's own cadence — 5-min pre-market bursts, 30-min midday — is the precedent, CLAUDE.md §Stock Catalysts, CLAIM) |
| **Cached manifest on F4** | the concierge's 4.4k-token prefix | only ~$0.02/call (the $0.227 is Opus-5 output/thinking at 8,192 max_tokens, not input) — **not a material lever** | MEASURED note, `definition_concierge.py:130-134`; no `cache_control` in that module (grep) |

| Scenario | Base total | With levers (F3 batch · F1 pre-warm at ≥5k · F2/F5 batch) | Per member |
|---|---|---|---|
| 100 | $727 | $683 | $6.83 |
| 500 | $2,026 | $1,803 | $3.61 |
| 1,000 | $3,563 | $3,116 | $3.12 |
| 5,000 | $14,937 | $11,423 | $2.28 |
| 10,000 | $28,149 | $21,822 | $2.18 |

**DERIVED.** The levers remove **12–25%** of the six-feature bill, not the 50% a naive "batch everything" reading suggests, because two of the three scaling lanes (F4 and the ask box) are **request-path work a member waits on** — Batch is unavailable to them by construction, and their cost sits in output tokens the cache does not touch.

### 1.3 Low / high bands

| Band | Definition | 1,000 members, per member | 10,000 members, per member |
|---|---|---|---|
| **Low** | calls/user/day ×0.5; levers on; share hit as base | ~$1.25 | ~$0.87 |
| **Base** | §1.1 | $3.56 | $2.81 |
| **High** | calls ×2; unit at top of each range (§2); share hit rate halved; F3 with a per-symbol Perplexity web leg (+$1.76/member) | ~$12.50 | ~$10.00 |
| **High, all-in** | + inherited Compass at 50% × $10 and voice at 20% × $30 | ~$23.50 | ~$21.00 |

The band is asymmetric — the high case is 3.5× base while the low case is 0.35× — because usage assumptions can only fall so far, while unit costs (Opus everywhere, web legs, thinking budgets) can multiply.

### 1.4 The fixed base — what runs today regardless of N

**OBSERVATION.** The product already spends **~$515/month on Anthropic** (MEASURED second-hand: Console MTD Aug 1–24 = $398.42; 107.7M input / 12.45M output tokens; 1,301 web searches; `railway` key 91.7%, `Morning Wire` 4.3%, `UCT Intelligence` 4.0%). Perplexity and OpenAI are **unaudited** — the same record says so. **ASSUMPTION** for the all-in fixed base: Perplexity ~$70/month (the catalyst engine's own forecast of $60–70/month in CLAUDE.md §Stock Catalysts, CLAIM, plus ~$1/month for 1.7 asks/day) and OpenAI $50–150/month (voice, `gpt-image-1` covers, embeddings — NOT DETERMINED) → **~$650–750/month all-in today**.

**EVIDENCE.** `reference_subscription_vs_api_credit_map_2026_08_23.md` §MEASURED 8/24 (session record of an owner Console read; not re-read). Lane inventory: D-12 §7 (catalyst bursts, theme engine ≤$5/day, COT prewarm 62 markets weekly on Opus 5, call-recap warmer ≤$10/day, desk insights over 600k-char transcripts, earnings preview/analysis warmers, Model Book descriptions). The member-triggered rate on the biggest ask surface is **1.7 asks/day across the whole population** (`api/routers/ai_search.py:1883`, MEASURED "logged").

**INTERPRETATION.** ≥80% of today's spend is scheduled or warm-lane work (ASSUMPTION — the split is exactly what the unread ledgers would give). Member-triggered AI is, today, a rounding error: at ~200 members and 1.7 asks/day the ask box costs ~$2/month. **The whole per-member column in §1.1 is therefore a forecast of behaviour that has not been observed**, which is why calls/user/day is the assumption with the widest band.

**RELEVANCE TO UCT.** The fixed base does scale — with *features*, not members. Every warm lane the terminal adds (a company page for 3,742 symbols, an earnings brief for ~200 reporters/week) lands here at ~$25–300/month each and is the cheapest kind of AI cost the product has: population-independent, batchable, cacheable, and guarded by a per-lane cap.

**CONFIDENCE.** 🟡 on the $515 (a dated first-hand read, recorded second-hand). 🔴 on the split and on the OpenAI/Perplexity lines.

### 1.5 Which lines scale with member count — the escalation trigger

The seed facts (§6) escalate **any cost that scales with member count regardless of amount** and any new recurring spend above $250/month. Applied to §1.1:

| Line | Scales with N | Crosses $250/month at | Escalates? |
|---|---|---|---|
| F1 why-moving | yes, sub-linear | ~250 members | **yes (both triggers)** |
| F2 earnings prep | no (reporters) | in-season always (~$300) | yes ($250 trigger only) |
| F3 morning brief | yes, linear | ~280 members live / ~560 batch | **yes (both)** |
| F4 NL screen | yes, linear | ~260 members | **yes (both)** |
| F5 company pages | no (symbols) | never steady-state | no (one-time cold start ~$75–150) |
| F6 alert explanations | yes, sub-linear | ~1,000 members | **yes (both)** |
| Ask box | yes, linear | ~600 members | **yes (both)** |
| Compass / voice (inherited) | yes, linear | ~95 members | **yes (both)** — and already live |

**Every member-facing AI feature is an escalation item on its face.** That is not a reason to avoid them; it is the reason the population ceiling in §6 must be a design input rather than a retrofit.

---

## 2. THE ASSUMPTIONS BEHIND EACH ROW

Each row: model class (per the doctrine — Opus for synthesis, Sonnet for answer/agent lanes, Haiku for judges and labels: `project_llm_cost_doctrine_2026_08_28.md` rule 1; `feedback_opus_for_synthesis`), tokens per call, calls per user per day, cache assumption, unit cost, and the in-code anchor. Token figures are **billed** tokens. ⚠️ Claude 4.7+ models (Opus 5, Sonnet 5) use a tokenizer that produces **~30% more tokens for the same text** (LIST, platform.claude.com 2026-09-02) — any budget calibrated in characters ÷ 4, or on Sonnet 4.6, under-counts those lanes by about a third.

### F1 — Contextual "why is it moving"

* **Model class.** Sonnet 5 synthesis over a desk context pack, with the Perplexity `sonar-pro` web leg the fast lane already uses — this is the AI-Search synth lane pointed at one symbol (`ai_search.py:1859` `AI_SEARCH_SYNTH_MODEL` default `claude-sonnet-5`; `perplexity_search.py:29-34` `_MODELS["fast"] = "sonar-pro"`).
* **Tokens per call (ASSUMPTION, anchored).** Cached prefix 1,299 tokens (MEASURED, `ai_search.py:1875`); uncached desk pack 2,000–4,000 (quote, catalyst signals, headlines, tweets, flow); web leg ~1,500 in / 400 out plus one request fee; output 300–600.
* **Unit cost.** **$0.037 MEASURED** for the fast+synth ask (`ai_search.py:1803`). Range $0.015 (Claude-only, desk-grounded) to $0.05 (high-context Perplexity tier + long output). DERIVED check: Sonnet 5 at 3,000 uncached × $2/M + 450 out × $10/M + cache read = ~$0.011; `sonar-pro` 1,500 × $3/M + 400 × $15/M + $0.006–0.014 request fee = ~$0.017–0.025 → $0.028–0.036, consistent with the measurement.
* **Calls per user per day.** **3** (range 1–6). ASSUMPTION — a terminal user clicking "why" on a few movers. The only observed member ask rate is 1.7/day population-wide (§1.4), so this is a ~350× uplift over today's behaviour; it is the assumption most worth measuring first.
* **Cache.** Per-(symbol, signals_hash) shared across members, 5–15-minute TTL (the `perplexity_search._CACHE_TTL["fast"] = 900` and catalyst skip-if-stable idioms). Miss rate by N: 100%/50%/35%/30%/20%/15% at 3/100/500/1k/5k/10k — ASSUMPTION that member attention concentrates on ~50–150 names (the movers rails, the catalyst top-20).
* **Owner question bounding it.** OI-10 (the ceiling) and a one-week measurement of clicks on the existing TickerPopup / catalyst rows.

### F2 — Earnings prep brief (per reporter, shared)

* **Model class.** As shipped: preview and post-print analysis on **Sonnet 5** (`engine.py:121` `EARNINGS_AI_MODEL` default `claude-sonnet-5`, "generate-once + disk-persisted so the better model is affordable"), transcript digest on **Sonnet 4.6** (`transcripts.py:45`), grounded call recap on **Opus + Perplexity** (`call_recap.py`; batch-warmed under a $10/day cap — D-12 §2c).
* **Tokens per call (ASSUMPTION, anchored).** Preview: 3,000–5,000 in (fundamentals, estimates, beat history, analyst actions), output ceiling 2,800 (`_EARNINGS_PREVIEW_AI_MAX_TOKENS = 2800`, `engine.py:98`, which also absorbs thinking). Transcript digest: ~1,750 in (the 3K+4K-char truncation, CLAUDE.md CLAIM) / 800 out (`_TRANSCRIPT_AI_MAX_TOKENS = 800`, `transcripts.py:46`). Recap: 600–800 out (`call_recap.py:178,341`).
* **Unit cost (DERIVED).** Preview $0.015–0.04; digest ~$0.018; recap $0.05–0.15 including the Perplexity leg. Per reporter, all three, ~$0.10–0.20.
* **Volume.** ~40 reporters/day forward cap (`_build_live` 40, CLAUDE.md), ~150–250/week in season; regenerated ~2× per reporter as estimates revise (skip-if-stable) → ~2,400 preview generations in a peak month. **Fixed ~$300/month in season, ~$60 off-season** (DERIVED); Batch halves the Claude part. Independent of N.
* **Cache.** Generate-once, 12h hit / 5-min miss TTL + disk persistence (`engine.py:108-109`).
* **Owner question.** None — this lane's cost is a function of the calendar, not of members.

### F3 — Watchlist morning brief (per member)

* **Model class.** **Opus 5** — the brief is synthesis, and the firm's own morning rundown runs on Opus 4-8 (D-12 §7, `morning_wire_engine.py:8751`). The existing `ai_search_briefings` lane (Perplexity fast, 1,400 max_tokens, 3 standing briefings per member, `_RUN_CAP = 200`, $5/day cap — `ai_search_briefings.py:10,45,51,223,242`) is the shipped precedent and is **web-grounded**; E-03 §7.2's safest design is **desk-grounded** (EOD + multi-symbol derived facts, never a live single-symbol quote), which is also the cheaper shape.
* **Tokens per call (ASSUMPTION).** Cached prefix ~1,300; per-symbol fact blocks 150–300 × 8–20 symbols = 1,800–3,600 uncached; member context (positions, alerts, notes) ~500; output 600–1,200.
* **Unit cost (DERIVED).** Opus 5: 4,000 × $5/M + 900 × $25/M + cache read ≈ **$0.0425 live, $0.021 Batch**; range $0.03–0.07. Sonnet 5 would be $0.017 — shown only as the multiplier (×0.4), **not as an option**, per the doctrine. Fable 5.1 (LIST $10/$50) would be ×2. A per-symbol Perplexity `sonar` leg adds ~12 × $0.007 = **+$0.08/member/day (+$1.76/member/month)** — the single assumption that most changes this row.
* **Calls per user per day.** 1 per trading day (21/month). Per member: **$0.89 live / $0.45 Batch**.
* **Cache.** None across members (every watchlist differs). Prompt cache on the prefix only. ⚠️ **Batch turnaround is not guaranteed inside the pre-market window** — most batches complete within an hour but the contract is 24h; a synchronous fallback path is needed, and `llm_batch.py` already abandons a batch >24h (`MAX_AGE_HOURS`, D-12 §2c).
* **Owner question.** OI-12 (is the brief a paid-tier deliverable?), OI-10 (ceiling), and whether desk-grounded is acceptable (E-03 Part 5's open question).

### F4 — Natural-language screen (English → scan definition)

* **Model class.** **Opus 5** (`definition_concierge.py:90` `CONCIERGE_MODEL` default `claude-opus-5`, at `MAX_TOKENS` 8,192 because "Opus 5 thinks by default and `max_tokens` caps both").
* **Tokens per call (MEASURED).** Prompt = SYSTEM_PROMPT + vocabulary + tool JSON = 17,724 chars ≈ **4.4k input tokens**; the cost is in the output/thinking budget.
* **Unit cost (MEASURED, 2026-08-26).** **$0.227/call; $0.454 worst case (two calls per proposal)** — `definition_concierge.py:128-141`. The same note records the Sonnet-5 predecessor at $0.0313/call and states the arithmetic: "Price is 1.67× on BOTH legs and the ceiling is 6.83×, so a worst-case proposal is 7.25× dearer." Per-user cap `CONCIERGE_USER_CAP_DAILY` = $0.75 (`:147`) "admits ~1.7 of them where it admitted ~12."
* **Calls per user per day.** **0.2** (one screen a week; range 0.05–0.5). ASSUMPTION — most members never write a screen; a few write many.
* **Cache.** None (queries unique). The 4.4k prefix is cacheable but saves only ~$0.02/call; the lane does not use `cache_control` today (grep, no hits). A tighter thinking budget is a **quality** decision — `lesson_a_token_ceiling_is_not_a_cost_lever` — not a cost lever.
* **Guard shape today.** Shares the catalyst budget ($8 soft / $15 hard) with the scheduled catalyst lanes; `may_member_spend()` stops member lanes at `hard − $6 reserve` (`catalyst/cost_guard.py:107-162`). ⚠️ The per-user check is **a floor test, not a reservation**: "a member at $0.74 may still start a proposal that lands them at $1.19 — 159% of the cap" (`definition_concierge.py:142-146`).
* **Owner question.** OI-14's sibling: is Opus 5 with an 8,192 budget the intended quality bar for this lane? The cost model does not get a vote; it only shows that this one row is 27–34% of the six-feature bill.

### F5 — Company-page summaries (per symbol, shared)

* **Model class.** Sonnet 5 (the `stock_brief` shape: generate-once, background thread, `STOCK_BRIEF_DAILY_CAP` = 300 generations/day — `stock_brief/service.py:53`; `ABOUT_BRIEF_MODEL` is Haiku per D-12 §2b, model for the full brief NOT DETERMINED).
* **Tokens per call (ASSUMPTION).** 4,000–8,000 in (profile, fundamentals, latest filing excerpt via EDGAR, estimates); 600–1,000 out.
* **Unit cost (DERIVED).** Sonnet 5 ~$0.02 (range $0.015–0.04; Opus 5 ×2.5).
* **Volume.** Universe 3,742 symbols (`cap_universe.json`, CLAUDE.md) × $0.02 = **$75 cold start** (×2 on Opus); refresh on each print/major filing ~4×/year → **~$25–50/month steady**; the 300/day cap bounds a cold start to ~13 days. Independent of N once warm.
* **Cache.** Generate-once, refresh on a facts hash. **Licensing note, not a cost note:** the inputs are FMP/Finnhub-sourced (E-02 §2.2 R without a DDLA) — the AI column inherits the display class (E-02 §2.13 §L.1).

### F6 — Alert explanations

* **Model class.** **Opus 5** narration of deterministic facts — the `flow_explain` shape ("the model only narrates them — it can never invent numbers we didn't hand it"), which defaults to `claude-opus-4-8` at 400 max_tokens under a $5/day cap and 50 requests/user/day (`api/flow_explain.py:86-116`). Whether an alert explanation is *narration* (Sonnet-class) or *synthesis* (Opus-class) is an ARCH-05 quality call; the model is priced on Opus 5 so it cannot be read as a downgrade.
* **Tokens per call (ASSUMPTION).** Cached prefix ~800; facts ~700 uncached; output 150–300.
* **Unit cost (DERIVED).** Opus 5: 700 × $5/M + 800 × $0.50/M + 250 × $25/M ≈ **$0.01** (range $0.008–0.02; Sonnet 5 ~$0.004).
* **Calls per user per day.** **2 alerts fired** (range 0.5–5). ASSUMPTION.
* **Cache.** Per-(symbol, alert type, 15-minute bucket), shared across members watching the same name: hit 0%/20%/35%/40%/55%/60% at 3/100/500/1k/5k/10k (ASSUMPTION).
* **Licensing note (E-03 §4.4B).** Server-side alert *evaluation* on live prices is a non-display use category the exchanges price separately ($2,000/month per category on CTA Network A and again on OPRA). That is E-05's line, not this one — but the explanation lane should ground on the level and direction, not a live quote, for the same reason.

### Carry-forward lanes (they will exist in TERMINAL-NEXT whether or not it re-hosts them)

| Lane | Model | Unit (MEASURED / DERIVED) | Calls/user/day (ASSUMPTION) | Per member/month | Guard today |
|---|---|---|---|---|---|
| **Ask box, fast + synth** | Perplexity `sonar-pro` + Sonnet 5 | **$0.037 MEASURED** | 0.5 (range 0.1–2); measured today ≈0.01 | $0.42 | 40 units/user/day (`AI_SEARCH_DAILY_LIMIT=40`, ORCH); 2,000 global units; synth $5/day |
| **Ask box, agent lane** | Sonnet 5, ≤6 steps, 1,400 max_tokens/step, 16-tool allowlist, tools+system cached | per step: cached read ~6k × $0.20/M + 1–10k uncached × $2/M + ≤1,400 out × $10/M ≈ $0.02–0.035 → **$0.06–0.21/ask** (DERIVED) | 20% of asks (ASSUMPTION; `AI_SEARCH_AGENT_AUTOROUTE` default `"0"`, D-12) | +$0.38 | $15/day (`ai_search_agent.py:54`); bills 2 units |
| **Deep research** | Sonnet 5 plan + Opus 5 answer + Perplexity sub-queries | $0.50–2.00/job (DERIVED) | rare | — | $10/day, 3/user/day, **0.6 scheduled fraction** (`ai_search_deep.py:59,75,85`) |
| **Compass chat** | Sonnet 4.6 (`coach_chat.py:438`), ≤8 loops (`MAX_LOOPS = 8`, `:366`), history cached to 80k (`SUMMARIZE_THRESHOLD_TOKENS = 80_000`, `:928`) | per loop: history read 20k × $0.30/M + tools/system read 15k × $0.30/M + 2k new × $3/M + 800 out × $15/M ≈ $0.03; ×2–3 loops = **$0.06–0.10/turn** (DERIVED) | 2 turns among ~30% of members | $4.00 per active member → $1.20 blended | 200 turns/user/day (`COMPASS_CHAT_DAILY_LIMIT`); **global cap default 0 = OFF** (`compass_cost_guard.py:37`) |
| **Voice** | `gpt-realtime` + Whisper + `gpt-4o-mini` + `tts-1` | $0.30/min Mode C (in-code CLAIM dated 2026-05, `voice_cost_service.py:27-30`) | 5 min/day among ~10% | ~$15 per active voice member → $1.50 blended | per-user monthly caps A 7,200 s · B 200 calls · C 6,000 s · D 3,600 s (D-12 §5a); **no global cap** |
| **Flow explain** | Opus 4.8, 400 tokens | ~$0.01 (DERIVED) | — | — | $5/day; 50/user/day; SQLite ledger |
| **COT weekly read** | Opus 5, 450 max_tokens | ~$0.02 (DERIVED) | scheduled, 62 markets/week | fixed ~$5–10/month | 300 generations/day |

---

## 3. PUBLIC PRICES (dated) AND THE MEASURED ANCHORS

### 3.1 Anthropic — LIST, `https://platform.claude.com/docs/en/about-claude/pricing`, read 2026-09-02

| Model | Input | 5-min cache write | 1-h cache write | Cache hit | Output | Batch in / out |
|---|---|---|---|---|---|---|
| Claude Fable 5.1 | $10 | $12.50 | $20 | $0.25 (0.025×) | $50 | $5 / $25 |
| Claude Opus 5 | $5 | $6.25 | $10 | $0.50 | $25 | $2.50 / $12.50 |
| Claude Opus 4.8 / 4.7 / 4.6 / 4.5 | $5 | $6.25 | $10 | $0.50 | $25 | $2.50 / $12.50 |
| **Claude Sonnet 5** | **$2** | $2.50 | $4 | $0.20 | **$10** | $1 / $5 |
| Claude Sonnet 4.6 / 4.5 | $3 | $3.75 | $6 | $0.30 | $15 | $1.50 / $7.50 |
| Claude Haiku 4.5 | $1 | $1.25 | $2 | $0.10 | $5 | $0.50 / $2.50 |

Per-million tokens, USD. Multipliers: 5-minute cache write 1.25×, 1-hour write 2×, cache read 0.1× (0.025× on Fable 5.1). Batch API 50% off input and output; stacks with caching. **Web search $10 per 1,000 searches** (server-side tool). Tool-use system-prompt overhead: Sonnet 5 354 tokens (`auto`), Opus 5 286. Long context: 1M-token window at standard rates on 4.6+. **Sonnet 5's $2/$10 introductory price is now permanent** — "the previously scheduled increase to $3/$15 … on September 1, 2026 will not occur." ⚠️ Claude 4.7+ tokenizer: ~30% more tokens for the same text.

### 3.2 OpenAI — LIST, `https://developers.openai.com/api/docs/pricing`, read 2026-09-02 (redirected from platform.openai.com; openai.com/api/pricing returned 403)

| Model (as used) | Input | Cached | Output | Note |
|---|---|---|---|---|
| `gpt-4o-mini` (intent classify, transcript cleanup, session summary) | $0.15 | $0.075 | $0.60 | per 1M tokens |
| `gpt-4o` (chart vision) | $2.50 | $1.25 | $10.00 | |
| `text-embedding-3-small` (brain KB, voice memory, AI-search memory) | $0.02 | — | — | |
| `gpt-4o-transcribe` | $2.50 | — | $10.00 | ≈ $0.006/minute |
| `tts-1` | — | — | $15.00 per 1M characters | = $0.015 / 1K chars |
| `gpt-image-1` (desk covers) | $10.00 | $2.50 | $40.00 | per 1M tokens |
| `gpt-realtime` audio (voice) | $32.00 | $0.40 | $64.00 | per 1M audio tokens |

`whisper-1` did not appear in the fetched extraction — **NOT DETERMINED** from the page; `voice_cost_service.py:19` carries $0.006/minute (in-code CLAIM, 2026-05). ⚠️ The same file states `gpt-realtime` at "$0.06/M input, $0.24/M output" — a figure that does not match the vendor page's $32/$64 per million audio tokens by three orders of magnitude; its derived `MODE_C_USD_PER_MINUTE = 0.30` is therefore an unaudited constant (§5.2).

### 3.3 Perplexity Sonar — LIST, `https://docs.perplexity.ai/guides/pricing`, read 2026-09-02

| Model | Input / Output per 1M | Request fee per 1,000 requests — low / medium / high context |
|---|---|---|
| `sonar` (lane "lite") | $1 / $1 | $5 / $8 / $12 |
| **`sonar-pro`** (lane "fast", the default) | **$3 / $15** | **$6 / $10 / $14** |
| `sonar-reasoning-pro` | $2 / $8 | $6 / $10 / $14 |
| `sonar-deep-research` | $2 / $8 | no request fee; citation tokens $2/M, reasoning tokens $3/M, **$5 per 1,000 search queries** |

`perplexity_search.py` sets no `search_context_size` (grep, no hits) → the vendor default applies; the pricing page did not state which tier is default, so the model uses **$0.006–0.014 per call** as the fee band. ⚠️ **A per-request fee is not a token cost** — a guard that prices Perplexity from tokens alone under-counts every call by $0.006–0.014 (§5.4).

### 3.4 The measured anchors (MEASURED, in code or session record)

| Anchor | Value | Artifact |
|---|---|---|
| Fast+synth ask, all-in | **$0.037** | `api/routers/ai_search.py:1803` |
| Concierge proposal, Opus 5 @ 8,192 | **$0.227 / $0.454 worst** | `api/services/definition_concierge.py:132-134`, dated 2026-08-26 |
| Concierge, Sonnet 5 @ 1,200 (predecessor) | $0.0313 / $0.063 | same note |
| `_WIDGET_SYSTEM` cached prefix | 1,299 tokens | `ai_search.py:1875` |
| Member ask rate, whole population | ~1.7 asks/day | `ai_search.py:1883` ("logged") |
| Anthropic spend, Aug 1–24 MTD | $398.42 (→ ~$515/month); 107.7M in / 12.45M out; 1,301 searches; `railway` key 91.7% | session record `reference_subscription_vs_api_credit_map_2026_08_23.md` — owner Console read 2026-08-24, **not re-read** |
| Cache read ratio, 7-day, Aug 24 | 13.0% (30.2M of 35.4M input uncached); write amortisation 11.9× on Sonnet 5 | same record |
| Catalyst synthesis | $2–4/day | CLAUDE.md §Stock Catalysts (CLAIM) |

**CONFIDENCE (§3).** 🟢 on every LIST figure (three vendor pages, fetched and dated). 🟡 on the in-code MEASURED figures (dated notes; the arithmetic is shown in-file). 🟡 on the Console figures (first-hand read, second-hand to me).

**OPEN QUESTION.** Which Perplexity search-context tier does the default request actually bill at? One line in the Console's usage export settles it.

---

## 4. THE ARPU CROSSOVER (Deliverable 2)

### 4.1 ARPU inputs

**OBSERVATION.** The code sells **one plan at $200/month or $2,000/year**, 7-day trial, card required (`app/src/pages/Pricing.jsx:1-10`, `Subscribe.jsx:71-77`; `STRIPE_PRICE_ID_PRO` on `web`, `STRIPE_PRICE_ID_ANNUAL` not set — ORCH). OI-12's default is "proceed on the code: Morning Wire free, everything else paid; Terminal-Next assumed paid-tier." The seed facts add a **$7 weekly promo** (≈$30/month) and note that signup is closed (`COMING_SOON_MODE=1`, E-02 §1 finding 3), so today's ARPU is not measurable from the code at all.

⚠️ **A second authority on the annual price.** `api/services/stripe_service.py:21` comments the annual plan as "$228/yr" while `Pricing.jsx` charges "$2,000/yr billed annually" — a stale comment, not a price, but the register should carry the page.

**Comparable retail price points (all read 2026-09-02, from the dossiers' §L):**

| Product | Entry | Mid | Top | AI-relevant note |
|---|---|---|---|---|
| Unusual Whales | Basic $50 list / $34 annual-effective | Pro $75 / $51 | Max $120 / $82 | tiers carry an **AI usage multiplier 1× / 2× / 3×** — a comparable that meters AI by tier |
| Koyfin | Plus $39 | Premium $79 | Advisor $209–299 | no AI metering published |
| TradingView | Essential $12.95 | Plus $29.95 / Premium $59.95 | Ultimate $199.95 | quantity ladder (charts, alerts) |
| Benzinga Pro | Basic $30.58 (annual-equiv.) | Streamlined $124.75 | Essential $166.42 (~$197 monthly) | "Benzinga AI (NEW)" only in Essential |

**Plausible ARPU band: $30 (promo / comparable floor) · $75 (comparable mid) · $200 (UCT list).**

### 4.2 AI cost as a share of ARPU

| Scenario (members) | Base six + ask box | All-in base (+ Compass, voice) | High all-in | at $200 ARPU (base / all-in / high) | at $75 | at $30 |
|---|---|---|---|---|---|---|
| 100 | $7.27 | $9.97 | ~$27 | 3.6% / 5.0% / 13.5% | 9.7% / 13.3% / 36% | 24% / 33% / 90% |
| 500 | $4.05 | $6.75 | ~$24.5 | 2.0% / 3.4% / 12% | 5.4% / 9.0% / 33% | 13.5% / 22.5% / 82% |
| 1,000 | $3.56 | $6.26 | ~$23.5 | 1.8% / 3.1% / 12% | 4.7% / 8.3% / 31% | 12% / 21% / 78% |
| 5,000 | $2.99 | $5.69 | ~$22 | 1.5% / 2.8% / 11% | 4.0% / 7.6% / 29% | 10% / 19% / 73% |
| 10,000 | $2.81 | $5.51 | ~$21 | 1.4% / 2.8% / 10.5% | 3.7% / 7.3% / 28% | 9.4% / 18% / 70% |

(Fixed base excluded from the per-member figures; at 100 members it adds ~$5–7/member and at 1,000 ~$0.65.)

### 4.3 The point where per-member AI cost exceeds plausible ARPU

**OBSERVATION.** Three different answers, because "the point" depends on which rail is doing the bounding.

1. **At modelled usage, it never crosses at the $200 list price.** The high all-in case is 10–14% of list. Crossing $200 needs ~32× base engagement — e.g. ~100 "why" clicks, 6 screens, 16 Compass turns and an hour of voice per member per day.
2. **At the $30 floor it crosses at ~1.3× the high case (~4.5× base engagement)** — roughly 14 "why" clicks, one screen, two Compass turns and 10 voice minutes per day. That is a heavy but not absurd power user; a product priced at the promo level for an engaged desk-style population is inside the crossover band.
3. **At the per-user CAPS already in code, it crosses at every ARPU.** Summing what one member may spend per month at each lane's own cap (DERIVED from §2 unit costs):

| Lane | Per-user cap (code) | Max USD / member / month |
|---|---|---|
| Ask box, fast | 40 units/day × $0.037 × 25 | $37 |
| Ask box, agent (alternative use of the same units) | 20/day × ~$0.15 × 25 | $75 |
| Deep research | 3/day × ~$1.50 × 25 | $112 (global $10/day caps the *population* at $250/month) |
| Concierge | $0.75/day × 21 | $16 (159% overshoot possible) |
| Flow explain | 50/day × $0.01 × 21 | $10 |
| **Compass chat** | **200 turns/day × ~$0.08 × 25** | **$400** (global cap OFF) |
| Voice, all modes at cap | C 100 min × $0.30 + A/B/D | ~$32 |
| Standing briefings | 3 × 25 × $0.037 | $3 |
| **Sum** | | **~$610–650 / member / month** |

**INTERPRETATION.** The per-user caps were sized as anti-abuse rails for a ~200-member base with a $15/day agent budget — as guards they work (no single member can spend more than ~$650), but as an economic bound they permit **3× the list price and 20× the promo price per member**. Compass chat's 200-turn daily limit alone is twice the list price. The only thing that stops N members at cap from spending N × $650 is a **lane-level daily dollar ceiling** — and Compass chat (`COMPASS_COST_CAP_DAILY` default `0`), voice (no global cap) and the concierge (a shared $15 with a $6 reserve) are the three lanes where that ceiling is absent or undersized for any scenario above ~100.

**RELEVANCE TO UCT.** TERMINAL-NEXT's AI is affordable; TERMINAL-NEXT's *guard inheritance* is not, above ~100 members, without re-sizing. The seed's "a per-user cap does not bound population cost" is not a warning about a future design — it describes the production configuration (`lesson_a_per_user_cap_does_not_bound_a_population`: 20 members at the concierge's $0.75 cap could switch off the scheduled catalyst engine, fixed by `may_member_spend()` on that one budget).

**CONFIDENCE.** 🟡 on the crossover arithmetic (unit costs anchored, usage assumed). 🟢 on the cap inventory (read from source and ORCH values).

**RECOMMENDATION.** Publish, per scenario, the two numbers the owner can steer with: the **population daily ceiling per lane** and the **per-member allowance** it implies. At $200 list and a 3% AI-cost target, the per-member allowance is **$6/month ≈ $0.28 per trading day** — comfortably above base usage on every lane except an Opus-5 screen a day.

### 4.4 The three largest sensitivities

| # | Sensitivity | Swing at 1,000 members | Why |
|---|---|---|---|
| 1 | **F4 usage × its Opus-5 unit cost** — 0.05 → 0.5 screens/member/day | $0.24 → $4.77 / member / month (**±$4.5k/month**) | $0.227/call, no cache lever, no batch lever, Opus locked by doctrine |
| 2 | **F3 grounding and model** — desk-grounded Opus 5 (batch) → web-grounded per symbol → Fable 5.1 | $0.45 → $2.65 → $5.30 / member / month (**±$4.9k/month**) | the only lane with no cross-member cache; the per-symbol web leg triples it |
| 3 | **Share/cache hit on F1 + F6** — miss 15% → 50% at 10k | $5.2k → $17.3k / month at 10,000 (**±$12k/month**) | "answer once, serve many" is the lever; it needs a per-(symbol, facts-hash) key, not a per-user one |
| (4) | Inherited Compass + voice adoption | $2.70 → $11.00 / member / month | the two lanes without a population ceiling |

**Not a sensitivity, and stated so nobody makes it one:** model tier. Sonnet 5 in place of Opus 5 on F3/F4/F6 would remove ~45% of the six-feature bill. The doctrine forbids it as a *cost* move (`feedback_opus_for_synthesis`; seed §5). The model class per lane is a quality decision for ARCH-05; this file only prices each choice.

---

## 5. EXISTING BUDGET-GUARD MECHANICS (D-12) AND THE MIS-PRICED TABLE (RG-12)

### 5.1 The rail inventory, re-read for what each one actually bounds

| Rail | Bounds ONE member | Bounds the POPULATION | Durable across a redeploy | Cache-aware | Source |
|---|---|---|---|---|---|
| `ai_search._reserve/_refund` (query units) | yes — 40/day | yes — 2,000 global units/day | write-through to `ai_search_log.bump_usage`, re-seeded per process/day | n/a (units, not USD) | D-12 §5a; `ai_search.py:380,387` |
| `narrative_cost_guard` | no | yes — USD per surface per ET day (synth $5, agent $15, deep $10, briefings $5, dossier $3 hard, narrative $5) | **yes** — `llm_route_cost_log` in `auth.db`; `spend_today_usd() = max(durable, in-process)` | yes (`record_from_response`, 2026-08-28) | `narrative_cost_guard.py:1-40, 57-73` |
| `catalyst/cost_guard` | concierge $0.75/user/day; indicator-vision | yes — $8 soft / $15 hard, **$6 scheduled reserve** (`may_member_spend`) | yes — `catalyst_cost_log` | yes | `catalyst/cost_guard.py:33-60, 107-162` |
| `compass_cost_guard` | 200 turns/user/day (`coach_chat.py:28`) | **only if `COMPASS_COST_CAP_DAILY` > 0 — default 0 = OFF** | **no — in-memory by design** ("sits behind a per-user message cap") | yes | `compass_cost_guard.py:1-70` |
| `flow_explain` | 50 req/user/day | $5/day | yes — `/data/flow_explain.db` | n/a (own table) | `flow_explain.py:109-116` |
| `voice_usage` | monthly seconds/calls per mode | **none** | yes — `voice_usage_monthly` | n/a | D-12 §5a |
| `ai_search_deep._sched_budget_frac` | 3 jobs/user/day | $10/day with **0.6 to the scheduled lane, 0.4 interactive reserve** | via `narrative_cost_guard` | yes | `ai_search_deep.py:59-87` |
| `theme_engine`, `pattern_vision`, `stock_brief`, `cot_narrative` | n/a (scheduled) | $5/day · daily cap · 300/day · 300/day | SQLite / store | — | D-12 §5a |
| `llm_timeouts` | every call must state a timeout | — | — | — | `llm_timeouts.py`; census rail |

**EVIDENCE.** Each file read this pass at the cited lines, except the voice and theme rows (D-12 §5a). CONFIRMED by source. Whether any of these has *fired* in production is a CLAIM (no ledger read).

**INTERPRETATION.** Three shapes coexist: (a) durable USD per lane with a scheduled reserve — the right shape, on two lanes; (b) durable USD per lane with no reserve — most lanes; (c) per-user only, population unbounded — Compass and voice, which are the two lanes with the highest per-active-member cost (§2). The existing **global caps sum to roughly $68/day ≈ $2,000/month across every capped lane** — which is the true population ceiling today regardless of N. At 1,000 members the six-feature base ($3,563/month) already exceeds that sum: **the caps as inherited would refuse members before the product reached its own base case**, and the refusal message on some lanes blames the member ("the formula assistant has reached its spending limit" when the catalyst engine spent the money — the sentence `may_member_spend` was written to make true).

### 5.2 RG-12 verified today — six price authorities, one rail

**OBSERVATION.** `RESEARCH_GAPS.md` RG-12 records the defect from D-12 §5c: five price tables, one pinned by a test, and the 2026-08-30 Sonnet-5 fix landed in one. Re-read at HEAD `a4ef6f240` on 2026-09-02:

| # | Table | Sonnet 5 | Opus 5 | Other | Verdict |
|---|---|---|---|---|---|
| 1 | `narrative_cost_guard._PRICES` (`:64-71`) | **(2.0, 10.0)** ✅ | (5.0, 25.0) ✅ | Haiku 4.5 (1, 5); web search $0.01 | **correct; pinned by `tests/test_narrative_cost_guard_prices.py`** |
| 2 | `catalyst/cost_guard._PRICING` (`:27-36`) | **(3.0, 15.0)** ❌ +50% | (5.0, 25.0) ✅ | docstring header also says Sonnet 5 = $3/$15 | **still mis-priced** — the concierge, indicator-vision, hunter, curator and rule-learner lanes over-report by 50% on Sonnet-5 siblings; the $8/$15 caps fire early |
| 3 | `flow_explain._PRICING` (`:86-92`) | absent | absent | `_FALLBACK_PRICING = (15.0, 75.0)` | fails **safe** (3–7.5× over) — but any move of `FLOW_EXPLAIN_MODEL` to a 5-series model trips the cap at a third of its intended spend |
| 4 | `pattern_vision/orchestrator._PRICE` (`:17`) | absent | absent | Opus 4.8 only | single entry; `PATTERN_VISION_ENABLED=0` in production (ORCH) |
| 5 | `voice_cost_service` constants (`:1-31`) | n/a | n/a | OpenAI rates dated 2026-05; `gpt-realtime` "$0.06/M" vs vendor $32/M audio | **unaudited** — the derived $0.30/min is a constant with no rail |
| 6 | `compass_cost_guard._IN_PER_MTOK/_OUT_PER_MTOK` (`:16-17`) | n/a — hard-wired **3.0 / 15.0** (Sonnet 4.6) | — | env-overridable | correct **for today's `coach_chat` default (Sonnet 4.6)**; wrong the day the lane moves to Sonnet 5, and nothing links the two |

D-12 counted five; the Compass constants are a **sixth** authority over one value. **CONFIRMED** by reading all six.

**INTERPRETATION.** The catalyst table is the one that matters for this model, because **F4 (the concierge) is priced through it** — every F4 figure in §1 uses the corrected Sonnet-5/Opus-5 rates, but production's own spend figure for that lane is 50% high on any Sonnet-5 call and its caps fire early. Under-pricing loosens a cap; over-pricing tightens it and starves the scheduled lanes that share the budget. Both are wrong; only one is visible.

**CONFIDENCE.** 🟢 (six files read at the cited lines).

**RECOMMENDATION.** One module, one table, one pinning test — the existing `test_narrative_cost_guard_prices.py` is the rail to extend. Until then, fix `catalyst/cost_guard.py:33` to `(2.0, 10.0)` (a one-line change; not made in Phase Zero per RG-12's disposition).

### 5.3 The population reserve — two idioms, and they disagree on shape

* **Fraction of a cap** — `AI_SEARCH_DEEP_SCHED_BUDGET_FRAC = 0.6`: the scheduled lane may consume 60%; 40% is the interactive reserve (`ai_search_deep.py:80-87`).
* **Absolute floor for the scheduled side** — `SCHEDULED_LANE_RESERVE_USD = 6.00`: member lanes stop at `hard − reserve` "whatever order the spending arrives in" (`catalyst/cost_guard.py:107-162`), with its own documented residual: the floor is `reserve` minus one in-flight call, because the gate is asked before a call and the call then spends.

**INTERPRETATION.** The two protect opposite parties (deep reserves for *members*; catalyst reserves for the *scheduler*), and both are correct for their lane. What is missing is the rule for choosing: a **scheduled lane that a member product silently depends on** (the morning catalyst table, a morning brief) needs the absolute floor; a **member lane that a scheduler merely also uses** (weekly deep research) needs the fraction. ARCH-05 should name which lanes are which. Neither idiom exists on briefings, theme engine, desk insights, Compass or voice (D-12 §5d).

### 5.4 Guards that are off, absent, or blind

| Gap | Where | Consequence at scale |
|---|---|---|
| Compass global cap OFF | `COMPASS_COST_CAP_DAILY` default `0`; not in the `web` variable list (ORCH) | the chattiest member lane has no population bound; $400/member/month at the per-user cap |
| Voice has no global cap | `voice_usage` is per-user monthly only | same shape; ~$32/member/month at cap |
| Per-user cap is a floor test, not a reservation | `definition_concierge.py:142-146` | 159% overshoot on one proposal; at N members the overshoot is N × |
| **Perplexity request fee** | `perplexity_search.py:214` ledgers to `narrative_cost_guard.record()`; whether the **per-request fee** ($0.006–0.014) is priced, or only tokens, is **NOT DETERMINED** (the pricing branch at `narrative_cost_guard.py:210-230` was not read) | if tokens only, every fast-lane ask under-bills by 15–40% of its Perplexity leg |
| Global caps sized for ~200 members | every `*_COST_CAP_DAILY` default | at 1,000 members the base case exceeds the sum of all caps (§5.1) |
| Voice rate constants unaudited | `voice_cost_service.py` | the voice per-member figure in §2 is the least trustworthy number in this file |

---

## 6. GUARD DESIGN CONSTRAINTS ARCH-05 MUST RESPECT (Deliverable 3)

Observations are not requirements; these are the constraints the evidence above implies, each traceable to a rail that already exists or a defect that already happened.

1. **Population ceiling first, per-user allowance second.** Every member-reachable lane carries an ET-day USD ceiling sized per scenario as `N × allowance + scheduled_reserve`, re-derived at each scenario boundary; the per-user cap is the anti-abuse rail beneath it. Rationale: §4.3 — the per-user caps sum to ~$650/member/month; `lesson_a_per_user_cap_does_not_bound_a_population`.
2. **Durable ledger for any lane a member can reach.** A table on the volume (`llm_route_cost_log` shape), ET-anchored, with `spend_today = max(durable, in-process)` so a failed write tightens rather than uncaps. In-memory counters only behind a per-user cap that is itself durable. Rationale: `narrative_cost_guard.py:1-40` states why; `compass_cost_guard` is the counter-example.
3. **The guard consumes `usage` cache fields.** `record_from_response`, never `record(input_tokens=…)`; cache reads at 0.1×, writes at 1.25×. Turning on caching without teaching the guard is a cap regression, not a saving. Rationale: `project_llm_cost_doctrine_2026_08_28.md` §trap; fixed in three guards 2026-08-28.
4. **One price table, one pinning test.** Six authorities exist today and one is wrong (§5.2). Unknown model → the priciest known rate, never $0; a **fallback that is too punitive is also a defect** (it starves the scheduled lanes sharing the budget).
5. **Count requests, not only tokens.** Perplexity bills per request; Anthropic bills web search per call. A token-only guard under-bills both. Rationale: §3.3, §5.4.
6. **A scheduled reserve on every shared budget, and a named owner per lane.** Absolute floor where a member surface silently depends on the scheduled lane; fraction where the scheduler is the guest. Rationale: §5.3.
7. **Reservation, not a floor test, at the per-user gate** for any lane whose single call costs more than ~10% of the allowance (F4 at $0.227–0.454 against $0.75). Rationale: `definition_concierge.py:142-146`.
8. **Batch for anything a warmer generates; generate-once + skip-if-stable + serve-many keyed by (symbol, facts hash) for anything per-symbol.** Rationale: §1.2 — the levers remove 12–25% and only on those shapes; `llm_batch.py`'s invariants (ledger on the volume, key by `custom_id`, reap on scheduler threads, abandon >24h) are the template. A pre-market batch needs a synchronous fallback (§2 F3).
9. **A stated timeout on every call** (`llm_timeouts.REQUEST_PATH` 60 s / `REQUEST_PATH_LONG` 120 s / `OFFLINE_JOB` 300 s), enforced by the existing census rail. Rationale: D-12 §5f — a missing timeout is a ten-minute pin on one of 64 shared threads, i.e. an availability cost the dollar guard never sees.
10. **Member traffic on the API key, never the subscription seat** — Anthropic's terms prohibit it explicitly and the seat is capacity-dead (`reference_subscription_vs_api_credit_map_2026_08_23.md`); the only lane on the seat today is producer-side (`desk_insights_polish.py`, E-02 OI-E02-13).
11. **Model routing through one registry, not 40 env vars.** A tier migration is currently ~40 edits and the price tables drift with it (`call_recap.py:48` still `claude-opus-4-7`; `CATALYST_OPUS_MODEL=claude-sonnet-4-6` in production under an "OPUS" name, OI-14). The Discord bot's `brain/llm_models.py` (FLAGSHIP / WORKHORSE / CHEAP) is the in-house shape. The cost guard should read the same registry.
12. **Price the 4.7+ tokenizer.** Budgets calibrated on Sonnet 4.6 or on characters ÷ 4 under-count Opus 5 / Sonnet 5 by ~30% (§2 preamble).
13. **Ground the expensive lanes on cheap, licensable inputs.** F3 desk-grounded on EOD + multi-symbol derived facts (E-03 §7.2) is both the cheaper shape (no per-symbol web leg) and the licensing-safer one (E-02 §2.13 §L.1). The cost model and the licensing register point the same way here.
14. **Cost telemetry per lane on an admin surface, with a `surface` tag in the ledger** so that the split scheduled-vs-member is a query, not an assumption (§1.4's largest gap). `/api/ai-search/admin/stats` and `/api/admin/catalyst-stats` are the existing doors.
15. **A refusal names who spent the money.** When a population ceiling trips, the member-facing sentence must distinguish "you reached your allowance" from "the desk's budget is spent today" — the defect `may_member_spend` was written to fix.

**CONFIDENCE.** 🟢 that each constraint traces to a cited rail or defect; 🟡 that the list is complete.

**OPEN QUESTION.** Does ARCH-05 intend the terminal to re-host Compass chat and voice? They are the two lanes without a population ceiling and the two with the highest per-active-member cost; the answer moves the all-in column by ±$2.70/member/month.

---

## 7. OWNER QUESTIONS THAT BOUND THE RANGES

| ID | Question | Bounds | Default in force here |
|---|---|---|---|
| OI-01 | Member count and tier mix | which scenario column is real | ~200 active (CLAUDE.md "LIVE for all ~200 users", CLAIM); <750 community (seed) |
| OI-10 | Current monthly spend by provider **and by lane**; the AI ceiling for member lanes | the fixed base; the population ceilings in §6.1 | $515 Anthropic (second-hand); OpenAI/Perplexity unknown; ceiling unknown |
| OI-12 | Commercial model — Morning Wire free and everything else $200 paid? | ARPU | $200 list; $30 floor as sensitivity |
| OI-14 | Is `CATALYST_OPUS_MODEL=claude-sonnet-4-6` deliberate, and does the never-downgrade doctrine reach the catalyst lane? | F1/F2 model class; the catalyst price row | treated as deliberate; F1 priced on Sonnet 5 |
| **OI-E06-01** (new) | Does the owner want the **natural-language screen on Opus 5 at an 8,192 budget** as the quality bar? It is 27–34% of the six-feature bill at every scenario. | F4 | yes (the code's own note records it as "the owner's call") |
| **OI-E06-02** (new) | Is a **desk-grounded** morning brief (EOD + derived facts, no per-symbol web leg) acceptable? | F3 (×3 swing) | yes (E-03 §7.2's safest design) |
| **OI-E06-03** (new) | Which of Compass chat and voice does TERMINAL-NEXT re-host, and at what target adoption? | the all-in column | 30% / 10% adoption |
| **OI-E06-04** (new) | The AI-cost target as a share of ARPU (3%? 10%?) — this sets the per-member allowance and therefore every population ceiling. | §6.1 sizing | 3% of $200 = $6/member/month |
| **OI-E06-05** (new) | A Console export grouped by API key and by day, plus `GET /api/ai-search/admin/stats` and `GET /api/admin/catalyst-stats` — one owner-present read. | converts §1.4 and the calls/user/day rates from assumption to measurement | — |

---

## GAPS (what the budget did not reach)

* **No spend ledger read.** Every per-lane figure in §1.4 is inferred from the lane inventory; the split scheduled-vs-member is an assumption. The four ledgers and the batch file are named in the frontmatter.
* **Console figures are second-hand.** The $515/month, the 13% cache-read ratio and the key split are an owner read of 2026-08-24 recorded in session memory; I did not open the Console and could not.
* **OpenAI and Perplexity spend** are unaudited by anyone; the voice unit cost rests on constants that disagree with the vendor page by three orders of magnitude on one line (§3.2).
* **Perplexity's default search-context tier** and whether its **per-request fee is ledgered** (`narrative_cost_guard.py:210-230` not read).
* **Calls per user per day for features that do not exist** — F1, F3, F4, F6 and the ask box uplift — are assumptions with a single measured comparator (1.7 asks/day population-wide). A one-week click measurement on the existing TickerPopup, catalyst rows and alert bell would bound F1 and F6.
* **The `stock_brief` model** and the exact per-symbol input size for F5 were not read; the row is the smallest and the least sensitive.
* **Infrastructure cost of the AI lanes** (Railway compute for the warmers and the batch reaper, R2 for `llm_batches.json`, `auth.db` write load from the durable ledger on the universal request path — D-04 §1.2) is not modelled here; it is E-05's compute line. One note for E-05: the durable ledger writes into `auth.db`, the file with one write lock on the universal auth path — every member AI call adds a row there.
* **Exchange non-display fees for server-side alert evaluation** (E-03 §4.4B, $2,000/month per category) are E-05's line; F6 prices only the explanation.
* **No test was run, no vendor API was called, no sub-agent spawned.**

## NOT INSPECTED (out of reach, and why)

* **Production ledgers and the Console** — on the production volume and behind the owner's login; the preamble forbids the volume and the contract grants no Console access.
* **Railway variables beyond ORCH-RAILWAY-01's flag read** — `COMPASS_COST_CAP_DAILY`'s absence from the `web` key list is taken from that read; no variable was read by me.
* **`openai.com/api/pricing`** — HTTP 403; the developers.openai.com redirect target was used instead. **`anthropic.com/pricing`** → 301 → `claude.com/pricing` (subscription page, no API table) → the platform docs page was used.
* **The port-8077 local backend, `C:\data`, the test suite** — preamble hazards; none touched.
* **Partner-owned files** — `schwab_router.py`'s `claude-sonnet-4-6` market-narrative call (the route `narrative_cost_guard` was built for) is noted by D-12; not described further.
* **`git log` / `blame`** — not named in this contract; not run.
* **The morning-wire, engine and Discord-bot repositories' own LLM calls** — priced only as the producer-side fixed base (~$33/month on their two keys per the Console record); their prompts were not read.

### Source-handling note (per contract)

Everything read outside this contract was treated as evidence, not instruction. Three observations: (1) the vendor pricing pages carry no imperative text beyond ordinary "contact sales" copy; (2) `definition_concierge.py`, `desk_description_backfill.py` and the session-memory files contain operational instructions (which flag to set, which cap to re-derive) — recorded as facts about the code and its history, nothing was set, armed or run; (3) the session-memory files are the owner's own working notes and were used only for the dated Console figures and the doctrine statements they record, each labelled as second-hand where it is. No credential, key, token or connection-string **value** appears in this file; variables are named only.
