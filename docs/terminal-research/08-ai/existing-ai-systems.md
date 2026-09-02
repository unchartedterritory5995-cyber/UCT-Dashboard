---
id: D-12
title: Existing AI systems — surfaces, lanes, retrieval, cost rails, evaluation
role: Existing AI systems specialist
wave: 1
group: D
category: internal-system
scope: uct-dashboard (terminal-research worktree) primary; uct_intelligence (Discord bot), morning-wire, uct-intelligence (engine) as boundaries
confidence: 🟡 medium-high
evidence_ceiling: "No Railway variable read permitted by this contract, so EVERY flag state below is a CODE DEFAULT (a CLAIM), never the live value. No logs, no health endpoints, no runtime observation — nothing here is OBSERVED-CALLED. `railway variables --service web --json | keys` would settle flag state; `/api/admin/{catalyst-stats,ai-search/admin/stats,voice/cost}` would settle actual call volume."
sources: api/routers/ai_search.py, api/services/ai_search_*.py, api/services/ai_search_eval/, api/services/journal_two/coach*.py, api/services/voice_*.py, api/services/catalyst/, api/services/llm_batch.py, api/services/llm_timeouts.py, api/services/narrative_cost_guard.py, api/services/journal_two/compass_cost_guard.py, api/services/brain_*.py, api/main.py, C:\Users\Patrick\uct_intelligence\brain\, C:\Users\Patrick\morning-wire\, C:\Users\Patrick\uct-recaps\desk_insights_polish.py
uct_relevance: high
status: draft
date: 2026-09-02
---

# D-12 — Existing AI systems

## HOW TO READ THIS FILE

Everything below was derived by reading code in the `terminal-research` worktree
(HEAD `a4ef6f240`) plus read-only cross-reference into the three sibling repos.
**No production service was called, no log was read, no Railway variable was
inspected** — the contract's tool list is Read/Glob/Grep/Bash only. Therefore:

* Every statement about *what the code does* is **CONFIRMED (by source)** and
  cited to `path:line symbol`.
* Every statement about *what production is doing* is a **CLAIM**, because the
  only way to promote it is a flag read, a log line, or an admin endpoint.
* A `*_ENABLED` default in code says **nothing** about the live value. The repo
  itself makes this point: `api/services/feature_flag_index.py:1-22` exists
  because "a gate that ships defaulting off and is never set is
  indistinguishable, from outside the repo, from a gate that is off ON PURPOSE",
  and measured **973 env names read** across `api/`, `scripts/`, `tools/` with
  **twelve `*_ENABLED` gates defaulting off and set on no Railway service**.

Vocabulary: TERMINAL-CURRENT = the `/calendar` route display-named "UCT
Terminal"; TERMINAL-NEXT = the product this program designs.

---

## 0. HEADLINE

The ecosystem is not "adding AI to a dashboard" — it already runs **a
tool-calling agent platform with one shared tool registry (154 tools), four
distinct answer lanes, two graded exam harnesses with deploy-gate exit codes, a
prompt-cache-aware cost guard family, a durable Batch-API ledger, and a
de-identified query capture log built as the seed corpus for a house brain.**

The three things TERMINAL-NEXT should treat as load-bearing infrastructure
rather than rebuild:

1. **`api/services/voice_tools.py::_REGISTRY`** — one registry, 154 tools,
   consumed by voice, Compass text chat, and the AI-Search agent lane. "One
   engine, three doors" is literally implemented.
2. **The cost-guard + eval pair.** `narrative_cost_guard` /
   `catalyst/cost_guard` / `compass_cost_guard` / `flow_explain` + the two
   report cards (`scripts/run_report_card.py`, `scripts/run_search_report_card.py`)
   with **exit 1 = do not ship**.
3. **`_grounded_system()`** (`api/routers/ai_search.py:2223`) — the intent-gated
   desk-context assembler that decides what internal data reaches a model, and
   records **which packs fired** so retrieval can be audited free.

The single most reusable idea in the whole surface is
`run_grounding_audit()` (`api/services/ai_search_eval/runner.py:412`):
**measure retrieval before paying for answers.**

---

## 1. SURFACES — what a person can invoke or receive

### 1a. Member-facing, on-demand (user types/clicks, waits)

| Surface | Route / entry | User class | What it does | Latency class | Output cached |
|---|---|---|---|---|---|
| **AI Search** (page) | `/ai-search` → `app/src/pages/AiSearchPage.jsx`; `POST /api/ai-search`, `POST /api/ai-search/stream` | **paid** (`ai_search.py:38 require_paid`) | Ask-anything markets research; web-grounded + desk-grounded, cited, ticker-linked, streaming | seconds (fast) → tens of seconds (agent) | yes — Perplexity leg cached 15 min (fast/lite), 30 min (reasoning), 1 h (deep): `perplexity_search.py:89 _CACHE_TTL` |
| **AI Search widget** | `/charts` workspace widget `AiSearchWidget.jsx` (registered in `app/src/widgets/registry.js`) | paid | same lane, embedded | same | same |
| **Ask AI (earnings modal)** | `components/research/sections/AskAiSection.jsx` → **composes `AiSearchWidget`**, scoped to the symbol | paid | per-ticker Q&A inside `EarningsResearchModal` | same | same |
| **Ask AI (notebook)** | `pages/journal-2-0/components/notebook/AiSearchEmbed.jsx` | paid | same widget in a note | same | same |
| **Deep Research** | `POST /api/ai-search/deep` (+ `GET /deep`, `/deep/{job_id}`) | paid | async multi-step job; plan model + deep model | minutes (job) | job rows persisted (`ais_deep_jobs`) |
| **Standing briefings** | `POST /api/ai-search/briefings` | paid | member-authored recurring briefs, run on a schedule | async | persisted |
| **Compass Chat** | `POST /api/j2/accounts/{id}/coach/chat/stream` (`api/routers/journal_two.py:2276`) | paid/trial | 44-tool trading coach over the member's own journal | streaming seconds | messages persisted `j2_chat_messages` |
| **Pre-Trade Verdict** | `POST /api/j2/accounts/{id}/coach/pre-trade-verdict` (`:2474`) | paid/trial | 🧭 on AddPositionModal → GO/HOLD/SKIP | seconds | persisted `j2_verdicts` |
| **Per-trade review** | `.../coach/trade-reviews` (`:2491`) | paid/trial | post-mortem prose on one trade | seconds | idempotent, persisted |
| **Voice assistant (Realtime)** | `POST /api/voice/session_token`, `/exec`, `/transcript` | paid/trial (`auth_middleware.py:80 requires_voice_access`) | full duplex spoken assistant over the 154-tool registry | realtime | transcripts + sessions persisted |
| **Voice dictation** | `POST /api/voice/transcribe` | paid/trial | Whisper STT + `gpt-4o-mini` cleanup | ~1–3 s | no |
| **Read-aloud (TTS)** | `POST /api/voice/tts`, `/tts/stream` | paid/trial | `tts-1` | seconds | audio cached; purged nightly (`voice_audio_cache_purge`) |
| **Chart vision** | `POST /api/voice/vision/describe`, `/vision/upload` | paid/trial | `gpt-4o` native vision reads a chart screenshot | seconds | no |
| **Indicator-from-image** | `POST /api/indicator-vision/candidates` (`api/routers/indicator_vision.py`) | paid | screenshot of an indicator → ranked candidate formulas | seconds | n/a |
| **Definition concierge** | `components/chart/builder/ConciergeBox.jsx` → `definition_concierge.py` | paid | plain English → a SCAN definition | seconds | n/a |
| **Flow print explainer** | `POST /api/flow-explain` (`api/flow_explain.py`) | paid | narrates one options print from pre-computed facts | seconds | yes — SQLite `/data/flow_explain.db` + in-mem |
| **COT weekly read** | `POST /api/cot/{symbol}/narrative` | paid | ~150-word positioning prose, grounding-gated | seconds (usually pre-warmed) | yes — `cot_narratives` table, per (symbol, week, facts hash) |
| **Ask Compass in chat** | `POST /api/community/chat/channels/{slug}/ask` (`community.py`, `require_chat`) | community members | "/ask" answers in-channel as **UCT Mentor** | async, arrives by SSE | no (per-user 20 s cooldown, `community_ask.py:21`) |
| **Stock brief / dossier** | `GET /api/stock-brief/{sym}` | paid | per-symbol profile + narrative | instant (pre-generated) | **generate-once**, background thread, daily cap |
| **Earnings preview/analysis/transcript summary** | `/api/earnings/*`, `engine.py` | paid | AI preview + post-print recap + transcript digest | instant when warm | yes — 12 h hit / 5 min miss + disk-persisted |
| **Call recap (grounded)** | `GET /api/earnings/call-recap/{ticker}` | paid | earnings-call recap, Opus + Perplexity | instant when warm | yes; **warmed via Batch API** |

### 1b. Member-facing, pushed (they receive it without asking)

| Surface | Producer | Lands where |
|---|---|---|
| **Stock Catalysts tile** (top-20 daily) | `api/services/catalyst/` (sources → score → tag → select → Opus synthesis) | Dashboard tile + `/catalysts/history` |
| **Compass "noticed"** proactive insights | `api/services/awareness/engine.py` + `voice_proactive_service.add_insight` | `CompassTodayTile.jsx`, voice session-start speak, email/Discord at importance ≥ 8 |
| **EOD recap / Weekly review / Weekly email digest** | `journal_two/coach.py`, `coach_email_digest.py` | Compass tab + Sunday 8 am ET email |
| **AI-Search premarket/postmarket briefings** | `ai_search_briefings.py` | member's briefings list |
| **Desk session chapters / recap / cover art / title** | `desk_session_insights.py`, `desk_creative.py` | YouTube + The Desk player + TSDR Discord |
| **Discord `/buzz`, close note, community heartbeat** | `discord_close_note.py`, `community_signals.py`, `buzz_*` | Discord |
| **Theme membership decisions** | `theme_engine/orphans.py`, `improve.py` | Theme Tracker provenance dots |

### 1c. Staff/admin-only

`GET /api/ai-search/admin/{stats,log}` · `POST /admin/{reindex,synthesize}` ·
`/api/admin/catalyst-*` (stats, notes, learned-rules, coverage, tuning, rejections) ·
`/api/voice/{cost,hallucinations,sessions,reward/scoreboard,failure-patterns}` ·
`/api/admin/{fundamentals-health,reconciliation-status,call-recap-status}` ·
`/api/theme-engine/*`.

**EVIDENCE** — surface table derived by AST over the routers
(`api/routers/{ai_search,voice,earnings_intel,catalysts,stock_brief,community,cot,user_definitions}.py`),
extracting each `@router.*` path with its `Depends(...)` gate. CONFIRMED by source.
Frontend consumers found by grepping `app/src` for the endpoint strings.

**INTERPRETATION.** Two things stand out. First, **AI Search is the hub, not a
page**: the earnings modal and the notebook both *compose* `AiSearchWidget`
rather than growing a second chat (`AskAiSection.jsx:5-13` says so explicitly).
That is the pattern TERMINAL-NEXT should inherit — one ask-box component,
scoped. Second, **the money route is paid-gated but the gate is recent and was
wrong once**: `ai_search.py:38-64` documents that `POST ""`, `/stream` and
`/signal` were `get_current_user` only, i.e. a free signup could spend the
firm's Perplexity + Anthropic budget in a loop. Note the corollary the docstring
draws: *"the per-user daily cap is NOT this gate — a cap on free usage is a
budget for giving the product away."*

⚠️ **The contract's premise about `chat_stream.py` is wrong.** `api/chat_stream.py`
is the in-memory pub/sub hub for The Floor's live *human* chat (presence,
typing, message fan-out) — **no LLM anywhere in it** (`api/chat_stream.py:1-22`).
The AI in community chat is `POST /chat/channels/{slug}/ask` → `community_ask.py`.
Likewise **support chat has no AI**: `grep` for anthropic/claude/llm across
`api/routers/support*.py` and `api/services/support*.py` returns nothing.

**RELEVANCE TO UCT.** TERMINAL-NEXT does not need to introduce AI; it needs to
decide **which of ~20 existing surfaces it re-hosts, and whether the ask box is
one component or many**. The current answer (one widget, scoped) is the cheap one.

**CONFIDENCE** 🟢 high on the inventory and the gates (read from source, AST-derived).
🔴 low on which surfaces are *live in production* — flag state not readable here.
**EVIDENCE CEILING:** flag values. `railway variables --service web --json` piped to
key names, plus `GET /api/ai-search/admin/stats` and `/api/admin/catalyst-stats`,
would promote most of §1 from CLAIM to OBSERVED-CALLED.

**RECOMMENDATION.** Before designing TERMINAL-NEXT AI, run the flag ledger
(`tools/flag_ledger_audit.py`, exit 2 = "did not look") against the live services
and publish which of these surfaces are actually armed. Designing on top of a
dark surface is the repo's most-repeated defect.

**OPEN QUESTION.** Which of `COMMUNITY_ASK_ENABLED`, `AI_SEARCH_AGENT_AUTOROUTE`,
`AI_SEARCH_CLAUDE_SYNTH`, `PATTERN_VISION_ENABLED`, `THEME_ENGINE_ENABLED`,
`BRAIN_TOOLS_ENABLED`, `COMPASS_MENTOR_MODE` are set on `web` today?

---

## 2. LANES AND MODELS

### 2a. AI Search — four lanes behind one ask box

| Lane | Module | Provider / model | Selection | Cost rail |
|---|---|---|---|---|
| **fast** (default) | `ai_search.py:1926 fast_lane_answer` | **Perplexity** `sonar-pro` (`perplexity_search.py:29 _MODELS`) | default | 1 quota unit; per-user `AI_SEARCH_DAILY_LIMIT`=40, global `AI_SEARCH_GLOBAL_DAILY_LIMIT`=2000 |
| **fast + Claude synthesis** | `ai_search.py:1859` | Anthropic `AI_SEARCH_SYNTH_MODEL` = `claude-sonnet-5` | gated `AI_SEARCH_CLAUDE_SYNTH` (**default `"0"`**, `:1809`) | `AI_SEARCH_SYNTH_DAILY_CAP`, `_PERUSER_CAP`=20, `_COST_HARD` |
| **agent** | `ai_search_agent.py` | Anthropic `AI_SEARCH_AGENT_MODEL` = `claude-sonnet-5`; 6 steps max, 1400 max_tokens | pinned by `mode`, or `AI_SEARCH_AGENT_AUTOROUTE` (**default `"0"`**, `:618`) via `_intent_breadth` | `AI_SEARCH_AGENT_COST_CAP_DAILY`=$15/day; **bills 2 quota units** |
| **deep** | `ai_search_deep.py` | plan `AI_SEARCH_DEEP_PLAN_MODEL`=`claude-sonnet-5`; answer `AI_SEARCH_DEEP_MODEL`=`claude-opus-5` | explicit `POST /deep` | `AI_SEARCH_DEEP_COST_CAP_DAILY`=$10; `_PERUSER_CAP`=3; **`_SCHED_BUDGET_FRAC`=0.6** |
| **degraded** (fallback) | `ai_search.py:2415 _degraded_answer` | `AI_SEARCH_DEGRADED_MODEL`=`claude-sonnet-5`, 600 tokens, 25 s | fires when Perplexity is down **and** desk context exists | flagged `degraded:true` to the UI |

⭐ **The degraded lane is the shape worth copying.** It only answers when
`meta["ctx_block"]` is non-empty — "a web-only question deserves an honest
error" (`:2419`). It never silently substitutes a worse answer for a better one
without labelling it.

**The agent lane's allowlist is the tool-permission model.**
`ai_search_agent.py:39-46 _AGENT_ALLOWED` names **16 read-only** tools out of the
shared 154. The docstring states the invariant: *"READ-ONLY BY CONSTRUCTION…
Actions from the ask box go through the PROPOSAL chips (the member's tap is the
consent), not through the model."* Off-allowlist tool calls are rejected at
`:226`.

### 2b. Model inventory (whole dashboard `api/`)

Derived by grep over `api/**/*.py`:

| Model | Occurrences | Notable lanes |
|---|---|---|
| `claude-sonnet-4-6` | 22 | Compass default (`coach.py:46`, `coach_chat.py:438`, `pre_trade_verdict.py:25`, `trade_review.py:21`), `MODELBOOK_LLM_MODEL`, `transcripts.py:45`, `DEEP_RESEARCH_MODEL` |
| `claude-opus-4-8` | 16 | `FLOW_EXPLAIN_MODEL`, `THEME_ENGINE_LLM_MODEL`, `DESK_RECAP_MODEL`, `CATALYST_HUNTER_MODEL`, pattern-vision judge |
| `claude-sonnet-5` | 14 | AI-Search synth/agent/deep-plan/degraded, `EARNINGS_AI_MODEL`, `CALL_RECAP_MODEL`, `CATALYST_CURATOR_MODEL`, `DESK_TICKERS_MODEL` |
| `claude-haiku-4-5` | 10 | `DESK_CHAPTERS_MODEL`, `GROUPS_AI_PEERS_MODEL`, `ABOUT_BRIEF_MODEL`, **the report-card judge** (`compass_eval/judge.py:9`) |
| `claude-opus-5` | 9 | `AI_SEARCH_DEEP_MODEL`, `COT_NARRATIVE_MODEL`, `CONCIERGE_MODEL`, `INDICATOR_VISION_MODEL`, `DESK_CREATIVE_MODEL` |
| `claude-opus-4-7` | 4 | `call_recap.py:48` default (stale relative to the others) |
| `claude-haiku-4-5-20251001` | 2 | `COMMUNITY_ASK_MODEL`, `trader_profile_auto.py:21` |
| `claude-sonnet-4-20250514` | 1 | legacy string |

OpenAI: `gpt-realtime` (`OPENAI_REALTIME_MODEL`, voice), `whisper-1`,
`gpt-4o-mini` ×3 (intent classify `voice_openai.py:233`, transcript cleanup
`:304`, session summarizer `voice_summarizer.py:12`), `gpt-4o` vision
(`voice_chart_vision.py:23`), `tts-1` (`:40`), `text-embedding-3-small`
(`brain_kb_service.py:23`, `voice_embeddings_service.py:25`), `gpt-image-1`
(desk cover art).
Perplexity: `sonar` / `sonar-pro` / `sonar-reasoning-pro` / `sonar-deep-research`.

**⭐ Model routing is by ENVIRONMENT VARIABLE, per surface — there is no router
module.** ~40 distinct `*_MODEL` env names. That is a real design position:
retuning one surface is a Railway var, not a deploy. It is also the reason a
model-tier change is 40 edits, and why `claude-opus-4-7` still sits as a default
in `call_recap.py:48` while everything else moved to 4-8/5.

### 2c. Structured outputs, streaming, tool use

* **Tool use** — Anthropic tool-calling in three registries:
  `voice_tools._REGISTRY` **154 tools** (AST count of `voice_tool(...)`
  registrations in `voice_tool_impls.py`); `coach_chat_tools.TOOLS` **44 tools**
  (incl. `_BRAIN_TOOLS` merged at `:1836` under `BRAIN_TOOLS_ENABLED`);
  `ai_search_agent._AGENT_ALLOWED` **16**, a strict subset of the voice registry
  dispatched through the same `voice_tools.dispatch`.
* **Structured output** is enforced by *post-hoc validation*, not schema-forced
  decoding: JSON parsed then checked (`coach_validation.py`,
  `cot_narrative.py`'s grounding gate, `desk_creative.py`'s deterministic gates).
* **Streaming**: `POST /api/ai-search/stream` (SSE, with `emit` callbacks so the
  member sees "checking grade_ticker…"), Compass `/coach/chat/stream`, voice
  Realtime. The agent loop itself is **blocking** and run in an executor
  (`ai_search_agent.py:22-24`) — deliberate, because the pod is one event loop.
* **Batch API**: `api/services/llm_batch.py` — a **durable ledger on the volume**
  (`/data/llm_batches.json`, tmp→`os.replace`), 50% discount constant
  `BATCH_DISCOUNT = 0.5`, `MAX_AGE_HOURS` reaper, results keyed **strictly by
  `custom_id`** because "results come back UNORDERED". Gate `LLM_BATCH_ENABLED`
  **default `"1"`**; `"0"` makes `submit()` return `None` and every caller falls
  back to its synchronous path — the documented rollback.
  ⚠️ **Exactly ONE consumer today**: `call_recap_warmer.py:300,323,325,358,396`.
  The infrastructure is general; the adoption is one lane.
* **Prompt caching**: 6 call sites, all `cache_control: {"type":"ephemeral"}` —
  `ai_search.py:1890` (system prefix), `ai_search_agent.py:158,160` (tools +
  system), `coach.py:85,112,135`, `coach_chat.py:470,478,481`,
  `pre_trade_verdict.py:49`, `trade_review.py:44`, `catalyst/hunter.py:213`
  (with a `kwargs.pop` fallback at `:226` for SDKs that reject it).
* **Fallbacks**: catalyst Opus→Haiku (`synthesize.py:25-26`); AI-Search
  Perplexity→degraded-Claude→honest error; `flow_explain` → a
  **`deterministic-fallback`** model name (`:81`) so a failed LLM call still
  produces the same facts in prose; `voice_openai.cleanup_transcript` returns
  the original text on any error so dictation is never lost.

**CONFIDENCE** 🟢 high (all source-derived, counts AST-derived not typed).

**RECOMMENDATION.** TERMINAL-NEXT should adopt the agent lane's shape
(one registry + a per-door allowlist) rather than a per-surface tool list, and
should widen Batch-API adoption — every *warmer* in the codebase
(`earnings_preview_warm`, `call_recap_warmer`, `stock_brief`, `significant_catalysts`,
`ai_search_dossier`) matches the module's own stated criterion ("anything a
WARMER generates"), and only one uses it.

**OPEN QUESTION.** Is `AI_SEARCH_CLAUDE_SYNTH` on in production? If it is `"0"`
as the code defaults, **every member AI-Search answer today is written by
Perplexity `sonar-pro`, not by Claude** — which changes the voice, the citation
behaviour, and the licensing analysis (E-02) materially.

---

## 3. RETRIEVAL AND GROUNDING

### 3a. What reaches the model

Two philosophies run side by side, and the repo knows it:

**(i) Intent-gated context packs (fast lane).** `_uct_context()`
(`ai_search.py:1988`) + `_grounded_system()` (`:2223`). Regexes decide which desk
feeds are stuffed into the system prompt. Sources observed in code:
`regime`, `quote`, `catalyst`, `tape`, `patterns`, `flow`, `fundamentals`,
`analyst`, `insider`, `earnings_deep`, `call_recap`, `posture`, `verdict`,
`levels`, `news_ticker`, `playbook`, plus `_INTENT_SPECS` extras (movers,
breadth, earnings, UCT20, scanner, headlines, macro calendar, COT, short interest).

⭐ **Declared gaps, not silence.** When a question opens a pack and the pack
returns nothing, the module appends to `meta["grounding_gaps"]` rather than
saying nothing — with the reason stated in-file: *"Silence reads to the model as
'the desk didn't mention it', and it invents flow"* (`:2054-2057`). One symbol
answering is enough to suppress the gap (`:2088-2092`) — declaring a gap while
handing over real data for the other name would be a second lie.

**(ii) Model-chosen tools (agent lane).** *"Instead of regex-gated context packs
guessing what to attach, the model itself decides which desk tools to call"*
(`ai_search_agent.py:1-8`). Same implementations, same `dispatch()`.

**This is a live architectural fork, unresolved.** Two authorities over "what
data does the model see". The fast lane is cheap and deterministic; the agent
lane is correct more often but costs 2 quota units and $15/day. `AI_SEARCH_AGENT_AUTOROUTE`
defaulting to `"0"` means the fork is currently resolved *in favour of regexes*
unless an operator flipped it.

### 3b. Vector stores, embeddings, FTS5

| Store | Tech | Where |
|---|---|---|
| Brain KB semantic index | OpenAI `text-embedding-3-small` → SQLite + in-memory numpy matrix | `brain_kb_service.py`; `<DATA_DIR>/brain_index.db`; reindexed on every Brain Pack install |
| Voice memory / documents / KB | `text-embedding-3-small` | `voice_embeddings_service.py`, `voice_kb_service.py`, `voice_document_service.py`, `voice_memory_service.py` |
| AI-Search memory (Phase 2) | embeddings over the de-identified query log | `ai_search_memory.retrieve_context` (blocking — hence the executor at `:2802`) |
| AI-Search dossier (Phase 3) | background synthesis over the log | `ai_search_dossier.maybe_run()` (`:2263`, dark unless flagged) |
| Desk archive search | **SQLite FTS5** | `desk_store.py:115-163` (feature-detected; *"an unguarded CREATE VIRTUAL TABLE here would take the WHOLE Desk down"*) |
| Education/video search | FTS5, probed once per process | `education_search.py:73-78` |
| Transcript index | FTS5 `porter` stemming, on the volume | `transcript_index.py:18,77` |
| **Discord bot episodic memory** | **LanceDB** (+ ChromaDB per that repo's CLAUDE.md) | `C:\Users\Patrick\uct_intelligence\brain\retrieval.py:17` |

**⛔ A cross-repo drift worth naming:** the bot's `CLAUDE.md` says *"Vector DB:
ChromaDB … all-MiniLM-L6-v2 … NO OpenAI dependency"*, but `brain/retrieval.py`
imports **`lancedb`** and the KB claim reads "766 entries" while the dashboard's
Brain Pack section describes "8,500+-entry KB". Both are CLAIMS in prose; the
import is CONFIRMED. Treat the bot's CLAUDE.md as stale.

### 3c. Citation and provenance

* **Web**: numbered `[n]` citations from Perplexity, rendered by the widget.
  The judge rubric scores grounding 0 when a live/web claim has no `[n]`
  (`ai_search_eval/runner.py` `SEARCH_RUBRIC`).
* **Desk**: the system prompt orders attribution in words — *"internal desk data
  — authoritative for price, percent move, and market regime; prefer these
  figures over web sources and attribute them to 'UCT desk data'"* (`:2233-2237`).
* **Context visibility to the member is SHIPPED**: the answer carries
  `grounding: {sources, intents}` (`:2606`, `:2632`, `:2827`) and the widget
  renders them as **"grounded on" chips** (`AiSearchWidget.jsx:80,101,391,680`).
  This is a real answer to "what did it look at", and it is rare.
* **`cot_narrative.py`** goes further: a **grounding gate** — every number in the
  prose must appear in the supplied facts, 100–230 words, no markdown; one
  retry, then `status:"error"` and **nothing is stored**, and the rail falls back
  to its templated read.
* **`flow_explain.py`** computes the FACTS deterministically first; *"the model
  only narrates them — it can never invent numbers we didn't hand it."*

### 3d. Time / market-status context

⚠️ **Not found as an explicit block.** There is no "current time / market status"
preamble in `_WIDGET_SYSTEM`. `ai_search.py:1414` states the position
deliberately: *"Today is deliberately excluded: the live quote pack already
answers it."* Freshness is instead handled by **cache salting**: `_fresh_salt()`
(`:1969-1980`) appends a ~5-minute `_time_bucket` to the cache key when
`_auto_recency(query) == "day"`, and Perplexity gets a `recency_filter`.
**NOT DETERMINED** whether any lane tells the model the wall-clock time or the
session state (pre-market / RTH / after-hours). That would be settled by reading
`_WIDGET_INTRO` in full, which this pass did not do.

### 3e. Entity resolution

`_extract_tickers()` (`ai_search.py:731-770`) is a three-tier resolver and is
exactly the shape user memory's `lesson_a_symbol_universe_does_not_settle_a_ticker_match`
demands:

* `$CASHTAG` (incl. `$BRK.B`/`$BRK-B`) always trusted; `(?![A-Za-z])` stops
  `$NVIDIA` matching a fragment.
* Bare UPPERCASE must be in `cap_universe` **and not stop-listed**; a stop-listed
  word that *is* a real ticker (`NOW`, `LOW`, `HAS`) needs a **strong position cue**.
* Bare lowercase needs cue **+** universe **+** not-stop-listed — *"thoughts on
  nvda" grounds; "the gap up" and "buy now" stay English.*

Order is preserved (single left-to-right pass) because grounding caps at the
first 2–3 symbols.

**CONFIDENCE** 🟢 high on mechanism; 🟡 on §3d (absence of a time block is an
absence-of-evidence read over a partial file).

**RECOMMENDATION.** TERMINAL-NEXT should treat `grounding.sources` chips as a
**product requirement, not a debug affordance** — it is the single cheapest
trust feature already built. And it should resolve the packs-vs-tools fork
explicitly rather than letting a default-off flag decide it.

**OPEN QUESTION.** Does any lane inject wall-clock ET time / session state, and
if not, how does a model answer "is the market open" or "what happened in the
last hour" without inventing it?

---

## 4. EVALUATION — two graded exams with deploy-gate semantics

| | Compass exam | AI-Search exam |
|---|---|---|
| Corpus | `compass_eval/golden_set.json` — 50 questions, 5 rungs | `ai_search_eval/golden_set_search.json` — **30 questions, verified by loading the JSON** |
| Runner | `scripts/run_report_card.py` | `scripts/run_search_report_card.py` |
| Drive path | replays through `coach_chat.handle_user_turn` on a **seeded sandbox DB**, reads fired tools out of `j2_chat_messages.tool_calls` | `run_agent(..., capture=[])` returns answer + per-call `{name,args,result}` directly |
| Mechanical checks | `compass_eval/checks.py` — tool gate + fabricated-price detection | same module, reused |
| Judge | `claude-haiku-4-5` (`compass_eval/judge.py:9`), 4 axes | same judge, **different rubric** (`SEARCH_RUBRIC`) |
| Bars | `RUNG_BARS` (per-axis) + `RUNG_PASS_BARS = {1:6, 2:6, 3:0, 4:0, 5:0}` | scaled rung bars |
| Exit codes | 0 pass · 1 fail · 2 no questions · 3 ungraded | identical contract, cloned |

Each golden-set row carries `must_call_tools` (OR-groups), `must_cite`,
`forbidden`, and a `great_answer` for judge calibration — e.g. `S1-01-quote-nvda`
requires `(get_quote OR grade_ticker)` **and** `(get_regime OR get_breadth OR get_movers)`,
forbids `price_without_tool`.

### ⭐⭐ `--grounding-audit` — the finding most worth carrying forward

`ai_search_eval/runner.py:412 run_grounding_audit()`. **No provider call, no
judge, seconds, $0.** It calls `_grounded_system(q)` for each golden question and
reports, per question, which packs fired and which required tool-groups nothing
fired for — **by name**.

Its own docstring records why it exists: *"The first honest fast-lane run scored
13/30 with ELEVEN gate misses, and several of those answers scored 4/4/4/4 from
the judge — a fluent answer built without the desk pack the question needed. That
is a RETRIEVAL failure wearing an answer-quality costume."* And: *"paying for 90
Perplexity calls plus 90 judge calls to discover which packs fire is absurd when
`_grounded_system` alone answers it in seconds for nothing."*

It also carries an anti-vacuity fix: the fast lane *always* makes a web call, so
the audit injects a synthetic `<web leg>` capture (`:441-446`) — otherwise five
questions read as missing a `web_search` **the lane cannot fail to have**, i.e.
*"an audit reporting a miss that is impossible."*

Sandboxing is load-bearing and documented in `run_search_report_card.py:15-22`:
`AUTH_DB_PATH` → a sandbox file so **cost-guard ledger rows land in the sandbox,
not in live `C:\data\auth.db`, and not against the members' shared $15/day cap**;
`BRAIN_TOOLS_ENABLED=1` staged **before any `api.*` import** or `grade_ticker`/
`ask_the_brain` never register and every gate naming them false-fails;
`COMPASS_EVAL_DB` → a sibling trend DB.

**The A/B hazard is documented, not folklore.**
`docs/superpowers/plans/2026-08-29-ai-search-fast-lane-threshold.md:22-23`:
*"Fast-lane scores are only comparable WITHIN one session. This lane's grounding
is live market data. Never A/B across hours; run before-and-after back to back,
or use `--grounding-audit`, which is deterministic and free."*

**CONFIDENCE** 🟢 high. **RECOMMENDATION.** TERMINAL-NEXT should ship a
grounding-audit-equivalent **before** its first answer-quality exam. Cheap
retrieval measurement first is the single highest-leverage practice in this
codebase.

---

## 5. COST CONTROL

### 5a. The rail inventory

| Rail | Scope | Durability | Default |
|---|---|---|---|
| `ai_search._reserve/_refund` | per-user **query units**, ET day | in-memory hot path **write-through** to `ai_search_log.bump_usage`, re-seeded once per process/day | 40/user, 2000 global |
| `narrative_cost_guard` | per-surface **USD**, ET-anchored | **table in `auth.db`** + in-process accumulator; `spend_today_usd() = max(durable, in-process)` | $5/day (`SCHWAB_NARRATIVE_COST_CAP_DAILY`) |
| `catalyst/cost_guard` | catalyst synthesis USD | SQLite `catalyst_cost_log` | soft $8 / hard $15 |
| `compass_cost_guard` | Compass chat aggregate USD | **in-memory only, by design** (sits behind a per-user message cap) | `COMPASS_COST_CAP_DAILY` default `0` = **disabled** |
| `flow_explain` | daily USD + per-user/day | SQLite `/data/flow_explain.db` | $5/day, 50 req/user/day |
| `theme_engine/store.day_cost_usd` | orphan loop | SQLite | $5/ET-day |
| `pattern_vision/orchestrator` | vision judging | store | daily cap + skip-if-stable |
| `ai_search_agent` / `_deep` / `_dossier` / `_briefings` | per-lane USD | via `narrative_cost_guard` surfaces | $15 / $10 / hard / cap |
| `voice_usage` | **per-user monthly seconds/calls** | `voice_usage_monthly` in auth.db | A 7200 s · B 200 calls · C 6000 s · D 3600 s |

### 5b. Caching vs the guard — the claim is TRUE and was FIXED

**CONFIRMED.** `compass_cost_guard.py:52-62`:

> *"Cache-aware (2026-08-28): with prompt caching on, the prefix reports under
> `cache_read_input_tokens` (0.1x input rate) / `cache_creation_input_tokens`
> (1.25x) **INSTEAD of** `input_tokens` — ignoring them silently loosens the cap."*

Same fix at `ai_search.py:1901-1906`: *"⛔ `record_from_response`, not
`record(input_tokens=...)` … a guard fed only `input_tokens` mis-bills every
cached call."* And `catalyst/cost_guard.py:47-53`, same date, same reason.

`ai_search.py:1878-1885` also carries **honest economics** for the caching
decision itself: a 5-minute write bills 1.25x and a read 0.1x, so break-even is
**two** requests sharing the prefix; at the logged ~1.7 asks/day nearly every
call is a cold write costing ~$0.03/month more, and at 30k asks it saves ~$70/mo.
Plus: *"⛔ Do NOT 'fix' this with `ttl:'1h'` — that doubles the write to 2x."*
Cache hit/miss is surfaced back to the caller (`cache_read_tokens` /
`cache_write_tokens`, `:1917-1920`) *"so a silent cache miss is observable."*

### 5c. 🔴 FINDING — the Sonnet-5 price fix landed in ONE of four price tables

`narrative_cost_guard.py:57-73` documents the defect and its fix:

> *"`claude-sonnet-5` sat at (3.0, 15.0) — Sonnet 4.6's rate — until 2026-08-30,
> so EVERY lane on Sonnet 5 over-reported spend by 50%: caps fired early and the
> admin spend figure was wrong in the direction nobody investigates."*

It now reads `"claude-sonnet-5": (2.0, 10.0)`. **But `api/services/catalyst/cost_guard.py:33`
still reads `"claude-sonnet-5": {"input": 3.0, "output": 15.0}`** — and
`CATALYST_CURATOR_MODEL`, `CATALYST_HUNTER_LIGHT_MODEL` and `CATALYST_OPUS_MODEL`
(in `calendar_sector_read.py`) all resolve to Sonnet 5 or a Sonnet-5 sibling. So
the catalyst soft/hard caps ($8/$15) still fire ~50% early on those lanes, and
`/api/admin/catalyst-stats` still over-reports.

`api/flow_explain.py:86-92` carries a **third** table with no `claude-opus-5` /
`claude-sonnet-5` entry at all — but its `_FALLBACK_PRICING = (15.0, 75.0)` is
punitive, so it fails *safe*. `pattern_vision/orchestrator.py:17` carries a
**fourth**, single-entry `_PRICE`. `voice_cost_service.py:1-31` carries a fifth
(OpenAI rates, as prose + constants).

This is `lesson_a_second_authority_over_one_value` in its exact canonical shape:
five copies of one price list, a fix applied to one, and only the fixed copy has
a rail (`tests/test_narrative_cost_guard_prices.py`).

### 5d. Population reserve for scheduled lanes — SHIPPED, one lane

`ai_search_deep.py:80-87 _sched_budget_frac()`:

> *"Fraction of the daily dollar cap the SCHEDULED lane may consume; the
> remainder is an interactive reserve for members."* — `AI_SEARCH_DEEP_SCHED_BUDGET_FRAC`,
> default **0.6**.

This is the direct implementation of `lesson_a_per_user_cap_does_not_bound_a_population`.
⚠️ It exists on **deep research only**. The AI-Search briefings lane, the catalyst
lane, the theme-engine loops and the desk insights pass all share their caps with
member traffic with no reserve carved out.

### 5e. Doctrine — member traffic never on the owner's Max seat

**CONFIRMED at the code level.** Every module that constructs an LLM client reads
`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `PERPLEXITY_API_KEY` from the
environment; the shared client is `engine.py::_get_anthropic_client()`
(`api_key = os.environ.get("ANTHROPIC_API_KEY")`, raises if unset,
`timeout=60.0`). Twenty modules read a provider key; **none** shells out to a
Claude Code session. Grep for `claude -p` across `api/`, `scripts/`, `tools/`:
zero hits.

**The one subscription-backed lane is off-box and producer-side.**
`C:\Users\Patrick\uct-recaps\desk_insights_polish.py:1-35` — a Windows Task
Scheduler script on the owner's PC that *"rewrites the headline/summary/chapter
titles with `claude -p` (your Claude Code **SUBSCRIPTION** — no Anthropic API
credits)"*, pushes results to `POST .../insights-store` and to the YouTube
description. It explicitly replaces the pod's `generate_ticker_moments` +
`_apply_recap_polish`, and states the cutover requires
`DESK_TICKER_MOMENTS_ENABLED=0`, `DESK_CHAPTERS_TICKER_BACKFILL=0` **and**
`DESK_RECAP_POLISH=0` together — *"the ticker-backfill safety net will otherwise
re-call the API for exactly the videos this script is about to handle."*

⚠️ **This is not member request traffic** (no member triggers it, nobody waits on
it), so it does not breach the "member traffic on the Max seat is PROHIBITED"
rule as stated. But it *does* produce artifacts members and the public consume
(YouTube chapter titles, session recaps). Whether that is inside the seat's terms
is an **E-02 licensing question, flagged here, not answered here.**

### 5f. Timeouts as a cost/availability rail

`api/services/llm_timeouts.py` — *"the `anthropic` and `openai` SDKs default to a
**600 s** read timeout. An LLM client constructed without `timeout=` on a request
path is a ten-minute pin of one of the web pod's 64 shared anyio worker
threads."* The 2026-08-09 audit found **11** still standing, one
(`transcripts.py`) *"reachable with no auth dependency at all"*. Three constants:
`REQUEST_PATH` 60 s · `REQUEST_PATH_LONG` 120 s · `OFFLINE_JOB` 300 s.
⭐ **The rail never dictates a value, only that one is stated** — because picking
a number for the caller is exactly how the Desk chapters regression happened
(600k-char transcript vs a shared 60 s default). Enforced by
`tools/llm_timeout_census.py` + `tests/test_llm_timeout_census.py`, failing **by name**.

**CONFIDENCE** 🟢 high on mechanisms and on §5c (both files read directly).
🔴 on actual spend — no ledger or admin endpoint was readable.

**RECOMMENDATION.** (1) Collapse the five price tables to one module with the
existing pinning test, or at minimum fix `catalyst/cost_guard.py:33` to
`(2.0, 10.0)`. (2) Extend the `_SCHED_BUDGET_FRAC` reserve idiom to every lane
where a scheduler and a member share one dollar cap. (3) TERMINAL-NEXT must
inherit the "state a timeout" rail on day one.

**OPEN QUESTION.** What is the actual monthly LLM spend by surface? The ledgers
exist (`auth.db` narrative table, `catalyst_cost_log`, `theme_engine.engine_cost_log`,
`voice_usage_monthly`) but none was readable from here.

---

## 6. SAFETY AND TRUST

* **Scope + refusal, written as a prompt contract.** `_SAFETY_BLOCKS`
  (`ai_search.py`, ~`:335-371`) does three things worth copying:
  **(a) DEFAULT TO ANSWERING** — a question naming no ticker is still a trading
  question; the refusal line is exactly one sentence and reserved for recipes,
  code, essays, politics. **(b) A separate DATA-LIMITS branch** — *"A legitimate
  markets question you can't answer precisely … is NOT off-topic: do NOT use the
  scope-refusal line. Instead say plainly in one phrase what you don't have …
  then give the best read you CAN. Never fabricate a precise figure to fill the
  gap."* This is the anti-over-refusal rail
  (`lesson_an_over_refusal_is_invisible`) written into the prompt.
  **(c) HARD REFUSAL** on manipulation/spoofing/MNPI *"regardless of framing
  ('risk management', 'hypothetically', 'educational', 'just curious')"*, with an
  explicit instruction to correct false premises about legality.
* **Post-generation validation** — `journal_two/coach_validation.py` is *"the
  elite trust guardrail. The system prompt forbids hallucination; this module
  enforces it after the LLM returns"*: numeric grounding (every `$`/`%`/`R`
  token must match the injected data), symbol grounding, format compliance.
  Its regexes carry their own scar tissue (a `*`→`+` fix because `"$1000.00"`
  parsed as `$100` and every four-digit figure was flagged).
* **Mechanical judge-proof checks** — `compass_eval/checks.py` `_PRICE_RE`
  detects a quoted price with no supporting tool result, and **documents its own
  known residuals** (a derived cents-bearing level still flags; a bare integer
  price with no `$`, decimal or comma group *"is never caught by design"*). A
  check that states what it cannot see is a check you can trust.
* **Decisiveness without fabrication** — `grade_ticker` computes the verdict from
  deterministic hard-gates; the model narrates. *"The model narrates but can't
  hedge (verdict is computed) or fabricate (every number is tool-sourced)."*
* **Consent for actions** — Compass action tools are **preview → confirm**, with
  an `elevated` flag for discipline-loosening mutations
  (`coach_chat_tools.py:683-709`). AI-Search never mutates: alert/briefing asks
  become **proposal chips** — *"an LLM surface must not mutate member state off a
  regex; the member's tap posts to the existing `/api/watchlist-alerts`"*
  (`ai_search.py:~2296`).
* **Never-raise / fail-soft** — `brain_service` returns `{"ok": False, "error":
  "brain not available"}`; `community_ask` *"Never raises"*; `flow_explain`
  degrades to `deterministic-fallback`; `cot_narrative` stores nothing on a
  grounding-gate failure. The morning-wire analogue is confirmed:
  `morning-wire/substack/formats.py:962` `def _safe(fn): try: return fn() except
  Exception: return ""` with the reason in the comment — *"a NoneType in
  `continuity_block` sank the 7/31 draft entirely."*
* **Disclaimer** — `AiSearchWidget.jsx:1174`: *"AI-generated research — verify
  before trading. Questions are retained de-identified to improve the research
  desk."* ⭐ Gated OFF for a **personal** (position-aware) turn, because those are
  never logged — the disclaimer tells the truth per-turn rather than blanket.
* **De-identification** — `ai_search_log.py:1-21`: stores question + answer +
  metadata but **not who asked**, only a keyed, day-rotating, redeploy-stable
  HMAC bucket, *"secret never persisted"*. The usage counters key off the same
  bucket (`ai_search.py:_usage_key`) *"so the durable ledger never stores a raw
  user id next to the de-identified Q&A log."*

### ⚠️ `.catch(() => null)` — fixed in the fetcher, NOT swept

`app/src/components/research/sections/sectionFetch.js:1-25` is the fix, and it
names the incident: the old idiom *"collapses a 502, a dropped connection, a
redeploy and a genuinely quiet ticker into the same `null`. NewsSection reads
that `null` and renders 'No recent news for this ticker.' — a confident, WRONG
factual claim. It was reported against NVDA on 2026-08-23 while
`/api/research/news/NVDA` was returning 15KB of headlines in 260ms."*

**But the pattern survives in siblings that did not migrate:**
`research/sections/SetupSection.jsx:27`, `research/sections/StatementPanels.jsx:28`,
`research/QuoteStrip.jsx:24`, `calendar/KeywordAlerts.jsx:15`, `RsBadge.jsx:4`,
`admin/AiSearchInsightsPanel.jsx:14`. Each renders a failed request as an
empty-but-authoritative state. 🟡 — I did not read each renderer to confirm every
one produces a *factual* claim rather than a blank; `SetupSection` and
`StatementPanels` are the two most likely to.

**CONFIDENCE** 🟢 high on the controls; 🟡 on the blast radius of the surviving
`.catch(() => null)` sites.

**RECOMMENDATION.** TERMINAL-NEXT should adopt `sectionFetch.js` as the only
fetcher for any surface that can render "we hold nothing" — and add the sweep
rail the fix did not get.

---

## 7. SCHEDULED AI — what runs unattended

AST-extracted from `api/main.py` (147 `add_job` / `_add_compass_job` calls total;
AI-relevant subset). **Times are the CronTrigger in code — a CLAIM about
production until D-14 confirms the scheduler and the gating flags.**

| Job id | Line | Cadence (ET) | Produces / lands |
|---|---|---|---|
| `catalyst_premarket` / `_hunt` / `_late` / `preopen` | 5666–5689 | 6–9 am, several/hour | top-20 catalyst rows + Opus theses → `catalysts.db` → Dashboard tile |
| `catalyst_amc_burst` / `_hunt` / `eod_final_hunt` | 5699–5710 | 4–5 pm | after-hours catalysts |
| `catalyst_morning_digest` | 5782 | 8:00 am | Discord digest |
| `catalyst_coverage_audit` / `rule_learner` / `autotune` / `premarket_health` | 5726–5771 | 8 pm, 8:30 pm, 5 am, hourly am | self-tuning loop (learned rules, weight autotune) |
| `ai_search_briefings_premarket` / `_postmarket` | 5588–5591 | 8:20 am / 4:45 pm | member standing briefings |
| `ai_search_weekly_deep` | 5599 | Sun 10:00 | weekly deep-research pass (per-user cap 1) |
| `compass_daily_focus` | 5972 | 7:30 am | today's focus insight |
| `awareness_engine_scan` | 5958 | Mon–Fri 4 am–8 pm, **every 20 min** | proactive insights → CompassTodayTile + email/Discord ≥8 |
| `voice_proactive_premarket` / `_scan` / `_after_hours` | 5924–5934 | 7–9 am /15, 9–15 /30, 16–20 /30 | voice-surface proactive insights |
| `compass_eod_recap` | 6115 | 4:30 pm | EOD recap + this-week focus |
| `compass_weekly_email_digest` | 6149 | Sun 8:00 | member email |
| `compass_health_email` | 6171 | Mon 1:30 pm | **owner ops email — deliberately NOT under `_add_compass_job`** |
| `voice_nightly_consolidate` | 5997 | 3:30 am | memory consolidation |
| `voice_audio_cache_purge` | 6069 | 3:30 am | TTS cache sweep |
| `desk_daily_session_process` / `_safety` | 5486–5488 | */5, 6 pm | Zoom→YouTube publish |
| `desk_session_insights` | 5494 | minute `7/15` | transcript → chapters/ticker moments/recap |
| `desk_cover_retry` | 5510 | minute `2/15` | AI cover art retry queue |
| `desk_session_audit` | 5527 | 9:00 am | "did everything land?" — reads the ARTIFACT, not a counter |
| `desk_article_audit` | 5445 | 9:10 am | archive audit |
| `theme_engine_orphans` | 6375 | Mon–Fri 11 pm | 1 grounded Opus call/orphan, $5/day cap |
| `theme_engine_improve` | 6382 | Sat 10 am | self-improve + co-movement audit |
| `cot_narrative_prewarm` / `_retry` | 4755–4756 | Fri 5:05 pm / Sat 9 am | COT weekly reads for every market |
| `call_recap_warm_boot` / `call_recap_batch_reap` | 2151, 2172 | boot / */20 | **the Batch API lane** |
| `floor_premarket_brief` / `floor_signal_cycle` / `floor_daily_heartbeat` | 4343–4359 | — | community chat content |
| `buzz_poll` / buzz digest | 5308, 5335 | interval / daily | Discord `/buzz` |
| `wire_detector` / `_slow` / `wire_coverage_monitor` | 5619–5645 | */20 s in windows | morning-wire arrival detection |
| `fundamentals_reporters_warm` | 6314 | */15 in windows | earnings-table warm |

**Cross-repo (boundary, two lines each — D-14 maps them structurally):**
* **`C:\Users\Patrick\morning-wire`** — the pre-market pipeline. `morning_wire_engine.py`
  makes ~6 Claude calls per run (Haiku `:7882`, Sonnet 5 `:8058`, Opus 4-8 at
  `:8751/:8829/:9284`, Sonnet 4-6 at `:9714/:9855/:9904`) producing the rundown,
  Top-5 picks and theses; `substack/` adds commentary/title/cover-director lanes
  (incl. `gpt-image-1`). `wire_critic.py` is the **nightly Opus critic** that
  pulls owner 👍/👎 + notes from `/api/wire-feedback/recent-internal` and writes
  distilled guidance into `wire_prompt_config` — a closed feedback loop into the
  next morning's prompt, *"guardrailed + reversible + best-effort."*
* **`C:\Users\Patrick\uct_intelligence`** (Discord bot, not a git repo) —
  `brain/llm_models.py` is the ONE model registry (FLAGSHIP `claude-opus-5`,
  WORKHORSE `claude-sonnet-5`, CHEAP `claude-haiku-4-5` unused), deliberately a
  **mirrored copy** of the engine's registry with the reasons written out.
  `brain/retrieval.py` is a hybrid RAG: LanceDB episodic Discord memory +
  the engine KB + a cached trader profile → Claude.
* **`C:\Users\Patrick\uct-intelligence`** (engine) — `uct_intelligence/ai_analysis.py`
  + `llm_models.py`; models observed: Sonnet 4-6 ×7, **Opus 4-6 ×3 (a tier no
  dashboard lane uses)**, Sonnet 5 ×2, Opus 5, Haiku 4-5. Its
  `scripts/brain_pack_export.py` is the producer half of the Brain Pack contract.

⭐ **`brain/llm_models.py` is worth reading for two production-only traps it
documents:** Claude 5 models run **adaptive thinking by default**, so
`response.content[0]` is usually a `ThinkingBlock` with `.thinking` and **no
`.text`** — hence `text_of()`; and Claude 5 **rejects `temperature`/`top_p`/`top_k`
with a 400**. The dashboard carries the same warning at `CLAUDE.md`'s COT
narrative section (*"⛔ No `temperature=` kwarg"*).

**CONFIDENCE** 🟢 on the job table (AST-derived from `main.py`); 🔴 on whether each
is armed. **EVIDENCE CEILING:** scheduler state and flag values.

---

## 8. GAP TABLE FOR TERMINAL-NEXT AI

Status: **EXISTS** = shipped and reusable · **PARTIAL** = built for one surface,
not generalized · **ABSENT** = nothing to extend.

| # | Capability | Status | Seed module | What's missing for TERMINAL-NEXT |
|---|---|---|---|---|
| 1 | **Context-aware actions** ("do this to what I'm looking at") | **PARTIAL** | `ai_search.py` proposal chips (`_ALERT_ASK_RE` → confirm chip); voice `open_page`/`open_ticker`/`change_chart_timeframe`; `AskAiSection` passes `scope={sym}` | No general "current surface state" object reaches the model. The voice path has `setVoicePageHint` / `"=== CURRENT PAGE ==="`; the typed ask box has only a symbol scope. Unify on one page-context contract. |
| 2 | **Entity resolution** | **EXISTS** | `ai_search.py:731 _extract_tickers` (cashtag / universe / stop-list / position-cue) | Only tickers. No resolution for themes, sectors, indicators, saved scans, or the member's own accounts/notes. |
| 3 | **Tool permissions** | **EXISTS** | `ai_search_agent._AGENT_ALLOWED` (16 read-only) + Compass preview/confirm + `elevated` flag | Permissions are per-**lane** constants, not per-**user** or per-**entitlement**. `entitlements.py` ships one toolkit (`"all"`). A tiered product needs the allowlist to be a function of the plan. |
| 4 | **Context visibility** ("what did it look at") | **EXISTS** | `meta.grounding_sources` → `grounding` in the response → **"grounded on" chips** (`AiSearchWidget.jsx:80,101,391`) | Chips name packs, not *values*. No drill-through from a chip to the row it used. Agent lane emits step events but no persistent trace a member can reopen. |
| 5 | **Internal-source citation** | **PARTIAL** | Prompt-level attribution (*"attribute them to 'UCT desk data'"*), judge rubric axis, `cot_narrative` grounding gate, `flow_explain` facts-first | Web gets numbered `[n]` markers; **desk data gets a prose instruction and a judge**. There is no `[desk:quote]`-style marker a renderer can link. That asymmetry is the single biggest trust gap. |
| 6 | **Caching policy** | **EXISTS, uneven** | `perplexity_search._CACHE_TTL` (15/15/30/60 min); prompt caching at 6 sites; generate-once + disk persistence (earnings, stock brief, catalysts); `llm_batch` ledger | No policy *module* — TTLs, salts and cache keys are per-surface literals. One lane (`call_recap_warmer`) uses the Batch API; four other warmers qualify and don't. |
| 7 | **Model routing** | **PARTIAL** | ~40 `*_MODEL` env vars; `_auto_mode` / `_wants_agent` / `_intent_breadth`; Perplexity 4-tier `_MODELS`; Opus→Haiku fallback | Routing is *lane* selection, not *model* selection: within a lane the model is a constant. No capability-based router, no per-question cost/latency budget. And 40 env vars means a tier migration is 40 edits (`call_recap.py:48` still on `claude-opus-4-7` proves it drifts). |
| 8 | *(added)* **Retrieval measurement** | **EXISTS ⭐⭐** | `run_grounding_audit()` | Exists for the AI-Search golden set only. Compass has no free retrieval audit. |
| 9 | *(added)* **Unified spend accounting** | **PARTIAL** 🔴 | 5 price tables, 1 rail | See §5c. One module + one pinning test. |
| 10 | *(added)* **Scheduled-vs-member budget reserve** | **PARTIAL** | `AI_SEARCH_DEEP_SCHED_BUDGET_FRAC`=0.6 | One lane only; briefings, catalysts, theme engine, desk insights share caps with members with no reserve. |

---

## GAPS (what the budget did not reach)

* **`_WIDGET_INTRO`** was not read in full — so §3d's "no time/market-status
  block" is an absence read over ~2/3 of the system prompt, not a proof.
* **Prompt *locations*** were catalogued only where the model constant lives.
  `coach_prompts.py` (`MENTOR_TWO_LANE`, §11 verdict protocol, §11b),
  `voice_prompts/compass.py`, `desk_creative.py`'s gates and
  `catalyst/synthesize.py`'s prompt were not read line by line.
* **`compass_eval/golden_set.json`** was not opened (the 50-question/5-rung shape
  is taken from `golden_set.py`'s `RUNG_BARS`/`RUNG_PASS_BARS` and the repo
  CLAUDE.md, which is a CLAIM). The AI-Search set **was** loaded and counted (30).
* **Latency classes** in §1a are inferred from timeouts and cache TTLs, not
  measured. No p50/p95 exists in anything readable here.
* **`ai_search_member.py`, `ai_search_memory.py`, `ai_search_dossier.py`,
  `ai_search_personal.py`** were read only at their headers/constants — the
  personal (position-aware) branch's data-minimisation story is under-covered
  and matters for E-02.
* **Voice sub-system depth**: 154 tools were enumerated but the Realtime session
  lifecycle, `voice_agents._compass_tool_union()`, the hallucination-audit
  endpoint and `voice_active_learning` were not opened.
* **Discord bot + engine** were sampled to the two-line boundary the contract
  asked for; their prompts, caps and schedules are D-14's.
* **No test suite was run** (contract does not authorise it), so no claim here is
  backed by a green rail — only by reading the rail's source.

## NOT INSPECTED (and why)

* **Railway variables / live flag state** — contract tool list is
  Read/Glob/Grep/Bash with **no network**; `railway variables` is out of scope.
  This is the single largest ceiling on this report: every `*_ENABLED` above is a
  code default.
* **Production logs, `/api/health`, `/api/admin/*`** — no network permitted, so
  nothing reached **OBSERVED-CALLED**. Provider status for Anthropic / OpenAI /
  Perplexity in this report tops out at **CODE-REFERENCED**.
* **The port-8077 local backend** — preamble forbids probing it, and it serves
  stale data.
* **`C:\data`** — not touched. No script was run that could resolve a `/data` path.
* **Partner-owned files** (`OptionsFlow.jsx`, `schwab_router.py`,
  `live_massive_router.py`, `massive_ws_worker.py`, `massive_processor.py`) — I
  noted only that `schwab_router.py:295` constructs a `claude-sonnet-4-6` call
  (the market-narrative route `narrative_cost_guard` was built for). Deliberately
  not described further.
* **`api/routers/earnings_router.py`** — unmounted per CLAUDE.md's unreachable
  table; not analysed as a live AI surface.
* **`git log` / `git blame`** — this contract does not name them.

## SOURCE-HANDLING OBSERVATIONS

Two artifacts read during this pass contain text that could be mistaken for
instructions to an agent. Both were treated as evidence only:

1. `C:\Users\Patrick\uct_intelligence\CLAUDE.md` asserts *"NO OpenAI dependency"*
   and *"Vector DB: ChromaDB"* while `brain/retrieval.py:17` imports `lancedb`
   and `brain/llm_models.py` documents a Claude-5 registry. Recorded as drift,
   not followed.
2. `api/services/desk_description_backfill.py` and `uct-recaps/desk_insights_polish.py`
   both contain operational cutover instructions (which flags to set to `0`).
   Recorded; nothing was set or run.
