# AI Search — Phase 3: House-View Dossier Synthesis (design)

- **Date:** 2026-07-21
- **Status:** Design approved — building
- **Builds on:** Phase 1 (capture: `ai_search_log`) + Phase 2 (retrieval: `ai_search_memory`)
- **Reuses:** `ai_search_memory` (index + retrieval), `catalyst/cost_guard` (budget), `engine._get_anthropic_client`
  (LLM), `fundamentals`/`analyst_intel`/`insider`/`brain_kb_service` (desk data sources)

## 1. Goal
Complete the learning loop: a background job distills accumulated evergreen knowledge into evolving
**per-ticker and per-theme "house-view" dossiers** that become the top retrieval targets in the
Phase-2 memory — so answers lead with the desk's synthesized house view, then supporting prior Q&A,
then live grounding.

**Owner decisions (2026-07-21):** dossiers synthesize from *accumulated Q&A + existing desk data*
(useful immediately, not dormant while the brain is near-empty) · granularity *ticker + theme*.

## 2. Constraints (carried through)
- **Fresh, always** — a dossier is EVERGREEN house-view only (business / moat / competitive position /
  structural bull-bear debate / recurring setups). The synthesis prompt FORBIDS prices, levels, and
  dated figures; the dossier is labeled "durable — verify current figures against live data." Live
  grounding still owns every current number. This is the freshness firewall.
- **Cost-safe** — cheap model, `cost_guard` soft/hard daily cap, skip-if-stable content hash, bounded
  batch per run, question-count threshold. Flag-gated dark ⇒ no surprise LLM spend.
- **Isolated / reversible** — own table, own flag (`AI_SEARCH_DOSSIER_ENABLED=0` default), best-effort
  everywhere. Off ⇒ zero behavior change.

## 3. Architecture — synthesis unit + a retrieval hook

### 3.1 Storage (owned by `ai_search_memory`, which owns the DB file)
New table in `ai_search_memory.db`:
`ais_dossiers(entity_key PK, entity_type, title, dossier_text, source_hash, embedding BLOB,
synthesized_at, model)` — `entity_key` = `"NVDA"` (ticker) or `"theme:ai-infrastructure"` (theme).
`ai_search_memory` exposes `upsert_dossier()`, `get_dossier(key)`, `dossier_count()`,
`search_dossiers(query, k)` (vector search over dossier embeddings, own matrix cache). Keeps the DB +
schema owned by ONE module; synthesis writes through these helpers.

### 3.2 `api/services/ai_search_dossier.py` — the synthesis engine
- **`select_entities()`** — tickers whose question count in `ai_search_log` (query/answer/primary
  tickers) ≥ `AI_SEARCH_DOSSIER_MIN_Q` (default 3), UNION a seed set (UCT20 leadership) so popular
  names get a dossier early; themes from `primary_themes`/taxonomy likewise. Bounded to
  `AI_SEARCH_DOSSIER_BATCH` (default 5) per run, prioritizing most-asked + stalest.
- **`_gather_sources(entity)`** — accumulated evergreen Q&A for the entity (from `ai_search_log`,
  gated evergreen+ok+non-first-person) + desk data: `fundamentals.get_fundamentals`,
  `analyst_intel.get_analyst_intel`, `insider.get_insider_activity` (ticker) +
  `brain_kb_service.search(entity + " business moat competitive")`. Assembled into a source bundle;
  `source_hash = sha256(bundle)`.
- **`_synthesize(entity, bundle)`** — one LLM call (`_get_anthropic_client`, model
  `AI_SEARCH_DOSSIER_MODEL` default a cheap Sonnet/Haiku, **`thinking={"type":"disabled"}`** per the
  Sonnet-5 gotcha, explicit timeout). Prompt: produce a durable house-view dossier (~200-400 words),
  evergreen only, NO prices/levels/dates. Returns `{title, dossier_text}`.
- **`synthesize_entity(entity)`** — skip-if-stable (unchanged `source_hash` ⇒ no LLM call);
  `cost_guard.may_synthesize` gate + `record`; on success `ai_search_memory.upsert_dossier(...)`
  (stores text + embeds it). Best-effort — never raises.
- **`run_batch()`** — select → synthesize each (bounded, cost-capped). Called by the admin endpoint
  and a throttled self-trigger (`_maybe_run`, mirrors the indexer — no main.py wiring).

### 3.3 Retrieval hook (in `ai_search_memory.retrieve_context`)
Extended to `retrieve_context(query, question_type, primary_ticker=None)`:
1. **Dossier first** — `get_dossier(primary_ticker)` (guaranteed keyed hit for the named ticker) ELSE
   `search_dossiers(query)` top hit above a score floor (catches theme + company-name questions).
   Injected as `UCT HOUSE VIEW on <entity> (durable context — verify current figures against the
   live desk data above):\n<dossier>`.
2. **Then supporting Q&A** — the existing `search(query)` hits, labeled "prior desk research."
Both under the freshness firewall (live data above stays authoritative). The router passes
`meta.query_tickers[0]` as `primary_ticker`.

## 4. Router (`ai_search.py`)
- `_grounded_system` passes the primary ticker to `retrieve_context`.
- `POST /admin/synthesize` (admin) → `ai_search_dossier.run_batch()` (inline, off the user path).
- `/admin/log` `memory` block gains `dossiers` count.
- Admin panel: dossier count on the "House brain" row + a "Synthesize" button.

## 5. Cost / rollout
`AI_SEARCH_DOSSIER_ENABLED=0` default (dark). `AI_SEARCH_DOSSIER_MODEL`, `_MIN_Q` (3), `_BATCH` (5),
`_COST_CAP` via cost_guard env. Skip-if-stable keeps steady-state near-zero. Flip the flag + run a
batch (admin button) to populate; watch spend via cost_guard + the admin count.

## 6. Testing (`tests/test_ai_search_dossier.py`)
- Entity selection: threshold + UCT20 seed + batch bound.
- Source gathering assembles Q&A + mocked desk data; stable `source_hash`.
- Skip-if-stable: unchanged hash ⇒ no LLM call; changed ⇒ re-synthesizes.
- `synthesize_entity` (mock LLM) stores + embeds a dossier; `dossier_count` increments.
- Retrieval: a ticker with a dossier surfaces it FIRST, labeled "UCT HOUSE VIEW" + "verify current";
  supporting Q&A below.
- cost_guard hard-cap halts synthesis; flag-off ⇒ `run_batch` no-ops + `retrieve_context` unchanged.
- Freshness: dossier block carries the "verify current figures against live data" firewall label.

## 7. Out of scope
Multi-dossier fan-out per answer (one house-view + Q&A is enough); a "what changed" dossier diff;
user-facing dossier browser. Phase 3 = the synthesis substrate; surfacing it richly is a later polish.
