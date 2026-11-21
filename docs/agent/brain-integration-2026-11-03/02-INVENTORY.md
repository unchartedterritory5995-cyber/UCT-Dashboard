# 2 — Existing integration inventory: how much of the brain already reaches which surface

Objective 2. Verified on master `e6740b5b08` by reading each consumer. "Reaches a model" means brain content is placed in a model prompt or returned to a model as a tool result on that surface.

## 2.1 The bridge itself (shared infrastructure, shipped 2026-07-02; both flags ARMED on web per `docs/feature_flags.json`)

| Module | Role | Flags / env | Notes |
|---|---|---|---|
| `api/services/brain_sync.py` | pull `brain/latest.txt` + `brain/<ts>.tar.gz` from R2, path-traversal guard, required members, `PRAGMA integrity_check`, atomic swap into `<DATA_DIR>/brain`, marker `.brain_last_ts`, `on_install` callbacks, boot pull + 6 h daemon | `BRAIN_PACK_ENABLED=1` (armed), `BRAIN_DIR`, `DATA_SYNC_*` (the bars rail's names) | engine *code* needs a restart; the *DB* re-reads per connection; wired in `api/main.py:5773-5786` |
| `api/services/brain_service.py` | facade over `uct_intelligence.api`: `available()`, `aggregate_heat_cap_pct()`, `lookup_playbook`, `setup_winrate`, `find_historical_analogs`, `size_a_trade` (hard 2 % cap, stop-below-entry, regime from `voice_regime_classifier.band_of`); the Wisdom team archive rides beside each answer under `team_archive` | `UCT_INTEL_PATH` (auto-set to the pack dir), `WISDOM_ARCHIVE_ENABLED` for the beside-source | never raises; `{ok: False, error: "brain not available"}` when no pack |
| `api/services/brain_kb_service.py` | semantic index: `reindex()` (active rows only, chunks of 1,500 chars, sha256 incremental, OpenAI `text-embedding-3-small` 1536-d), `search(query, k)` (numpy cosine, in-memory cache keyed on index mtime), `ask_the_brain(question, k)` (passages with title / category / trader / source / score / excerpt ≤ 900 chars) | index at `<DATA_DIR>/brain_index.db` (`BRAIN_INDEX_DB`); registered as an AI door in `ai_doors.py:84` | no category / trader / epoch / source filter; no score floor; one embedding call per query with a 20 s timeout |
| `api/routers/intelligence.py` | paid REST reads over the engine: `/api/setup-templates[/{name}]`, `/api/setup-performance/{setup}`, `/api/confidence-scores/{symbol}`, `/api/leader-persistence/{symbol}`, `/api/analogs`, `/api/risk-summary`, `/api/psychology-events`, `/api/coaching-notes`, `/api/skill-assessments`, `/api/pre-trade-checklist`, `/api/model-examples` | `UCT_INTEL_PATH`, `require_paid` | member-facing JSON, not model-facing |

## 2.2 Consumers today

| Surface | Module(s) | What it uses | Reaches a model? | Gate |
|---|---|---|---|---|
| **Compass coach chat (Journal 2.0)** | `journal_two/coach_chat_tools.py:1734` `_BRAIN_TOOLS` (ask_the_brain, lookup_playbook, setup_winrate, find_historical_analogs, size_a_trade, grade_ticker, portfolio_heat, grade_watchlist) + `coach_prompts.py` §11 verdict protocol | KB passages, templates, win rates, analogs, sizing, the composed GO/HOLD/SKIP verdict | yes (Sonnet chat; tool results) | `BRAIN_TOOLS_ENABLED=1` (read at import → restart to flip), `COMPASS_MENTOR_MODE` (`0/1/admin`) |
| **Compass voice** | `voice_tool_impls.py:3761` (`ask_the_brain` et al.), `voice_agents.py:461,516` | same five + verdict tools | yes (Realtime voice) | `BRAIN_TOOLS_ENABLED=1` |
| **AI Search** | `routers/ai_search.py:2202` `_brain_context` (k = 3 → ≤ 2 passages above `_BRAIN_MIN_SCORE`, labelled "UCT PLAYBOOK … timeless craft, not today's data"); `ai_search_agent.py` tool list includes `ask_the_brain` and `grade_ticker` | KB passages | yes (Perplexity-grounded answer + Sonnet) | `AI_SEARCH_BRAIN_ENABLED` (default **on**) |
| **Community /ask** | `community_ask.py` | `ask_the_brain` → one short Claude synthesis | yes | its own gate |
| **Catalysts (Source 11)** | `catalyst/brain_grades.py` | `setup_winrate(setup, "ALL")` as enrichment of a candidate | indirectly (curated text) | `brain_service.available()` |
| **Terminal GRADE / CHK** | `routers/terminal_grade.py` (thin read over `grade_ticker`); CHK via the Wisdom archive route | verdict object; archive stats / analogs | no (deterministic display) | brain-gated; `WISDOM_ARCHIVE_ENABLED` |
| **Decision Record** (Research page tab) | `decision_record.py` reads `wire_universe × wire_issues` from the installed pack `?mode=ro` | the Wire's per-ticker consider / reject record | no | `DECISION_RECORD_ENABLED` — armed, but member visibility awaits an owner ACT (TERM-088) |
| **Ticker History** `setups` lane | `ticker_history.py:611` reads `setup_triggers` | the engine's per-ticker trigger ledger (win / loss / never / void with R) | no | `TICKER_HISTORY_LANES2_ENABLED`; owner call pending on members seeing the firm's win/loss record |
| **EP base rate** | `ep_base_rate.py` reads `ep_candidates × ep_follow_throughs` | follow-through rate beside the EP flag | no | TERM-090 |
| **Journal chart plan sizing** | `journal_two/chart_plan.py:206` | `brain_service.size_a_trade` (ruling P3: no second sizing formula) | no | — |
| **Wisdom capture** | `wisdom/capture/families/wire_inputs.py` reads `leadership_snapshots` | Wire inputs as a dataset | no | `WISDOM_CAPTURE_ENABLED` |
| **Wisdom team archive** | `wisdom/archive/team_record.py`, `ask_setup.py`, `tools.py` (`trader_archive_search / ticker / setup / rhymes`) | the ledger import (scored calls, playbooks), scrubbed, price-gated at 20 sessions | yes (Ask AI SETUP CONTEXT block; Compass beside-source) | `WISDOM_ARCHIVE_ENABLED` (armed 2026-10-16), `WISDOM_ARCHIVE_ASK_ENABLED` |
| **Compass report card** | `compass_eval/` (50 golden questions, 5 rungs, mechanical checks + Haiku judge) | grades the above | — | `scripts/run_report_card.py`; last recorded baseline 12/50 (2026-07-02), Rungs 3–5 hedging |
| **UCT Agent** (`/charts` panel, admin-only) | `api/services/uct_agent/**`, `app/src/agent/**` | **nothing** — `grep -ri brain api/services/uct_agent app/src/agent` → 0 files; no kind, capability, prompt text or test mentions the KB, templates, coaching or statistics | no | — |

What the Agent *does* have that is adjacent: `guide.explain` (answers "what does ADR mean" from the indicator catalog, three UCT concepts and chart-setting descriptors, `app/src/agent/guide/explain.js`; anything else falls to the model's general knowledge), `nl1_glossary.json` (UCT-specific word meanings for NL-1), `definition.search / describe` (indicator definitions), and the research tool (`research.web`, one Perplexity call per turn). So today "what is a VCP according to UCT?" is answered from the model's own training, not the firm's playbook — the exact gap the brief names.

## 2.3 Partner-side training material (not production)

- `uct-agent-training-data`: 266 education-video transcripts with chapters and ticker moments, 35-step learning paths, 101 Substack posts (emails redacted), the 32-term / 359-alias UCT vocabulary, and a copy of `voice_kb/` (`trading_principles.json` 36 entries, `causal_model.json`). Its README says "the UCT Agent already exists here: ~50 `api/services/voice_*.py` modules" — i.e. it describes **Compass voice**, not the `/charts` UCT Agent. The two are different products; this design does not merge them.
- `tsdr-ledger` (GitHub copy): 23,183 record files, 1,444 structured files (taxonomy v8, 45-setup library with n / win20 / edgeR z / teachings / examples per setup), scored outputs, `drills.html`, `setup-library.html`, `study-guide.html`. Images are referenced, not shipped (the 8.6 GB stays on the PC). The Windows checkout of this repo fails on long paths; read it through `git show`.

## 2.4 Bottom line for objective 2

Roughly **all** of the brain is reachable on the web pod today, and most of it already reaches a model on the Compass and AI Search surfaces under armed flags. **None of it reaches UCT Agent.** The integration is therefore a matter of exposing existing, flag-gated facades to the Agent through its own permission-controlled contract — not of moving data.
