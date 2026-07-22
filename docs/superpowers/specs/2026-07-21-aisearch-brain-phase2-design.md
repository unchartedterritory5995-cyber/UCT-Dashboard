# AI Search — Phase 2: Retrieval-Memory "House Brain" (design)

- **Date:** 2026-07-21
- **Status:** Design approved — building
- **Builds on:** `docs/superpowers/specs/2026-07-21-aisearch-learning-loop-design.md` (the capture foundation)
- **Reuses:** `api/services/brain_kb_service.py` (embedding + pack/unpack + numpy-matrix search pattern)

## 1. Goal
Make AI Search actually get smarter as members ask more: past **evergreen** answers get
retrieved and blended into new answers alongside live grounding, so the desk's accumulated
house knowledge compounds. The current answer pipeline + the Phase-1 capture layer are unchanged;
this reads the captured log and adds a retrieval step.

**Owner decisions (2026-07-21):** *auto-ingest all eligible evergreen answers* (fully autonomous
compounding; owner pin/exclude still override) · *Phase 2 (retrieval) first* — Phase 3 synthesis
into house-view dossiers is a later follow-up.

## 2. Constraints (carried from Phase 1)
- **Fresh, always** — retrieved memory is labeled "may be dated"; live grounding stays authoritative
  for price/regime/flow. A stale figure in an old answer can never override fresh data (the leakage
  firewall).
- **Fast** — retrieval = one small embedding call + a numpy dot product (ms). Indexing is background,
  off the request path.
- **Cheap** — `text-embedding-3-small` (~$0.02/1M tokens). Flag-gated dark.
- **De-identified** — the memory only ever holds evergreen, non-first-person answer text (no user id,
  no personal content). Enforced by the gate, not by trust.
- **Reversible** — own module + own DB file + `AI_SEARCH_MEMORY_ENABLED` (default 0). Off ⇒ zero
  behavior change.

## 3. Architecture — two isolated units

### 3.1 `api/services/ai_search_memory.py` — indexer + search (mirrors brain_kb_service)
- Own vector index at `AI_SEARCH_MEMORY_DB` (default `<DATA_DIR>/ai_search_memory.db`), table
  `ais_memory(answer_id UNIQUE, answer_hash, query, answer, tickers, primary_ticker, question_type,
  pinned, citation_count, embedding BLOB, model, created_at)`.
- Reuses `brain_kb_service._default_embed / _pack / _unpack` (import) — one embedding stack, one model.
- **`reindex()`** — incremental: pulls eligible rows from `ai_search_log` NOT already in the index
  (by `answer_id`), embeds `query + "\n" + answer` (query gives the answer retrieval context),
  dedups by `answer_hash` (the ~50 near-identical "is NVDA a buy" answers collapse to one),
  removes rows that became `excluded`. Batched.
- **`search(query, k)`** — in-memory float32 matrix (module cache, mtime-stamped like brain_kb),
  cosine top-k. Pinned rows get a score boost so owner-curated knowledge ranks first.
- **`_maybe_index()`** — throttled (≥ `AI_SEARCH_MEMORY_INDEX_THROTTLE_S`, default 600) background
  daemon-thread reindex, kicked from `retrieve_context`. Self-contained — **no main.py wiring**;
  the brain warms opportunistically as questions come in.

### 3.2 The eligibility gate (what enters the brain) — SQL, structural
`freshness = 'evergreen' AND answer_kind = 'ok' AND first_person = 0 AND excluded = 0`.
`pinned` and `citation_count` boost retrieval ranking; **pin force-includes, exclude force-removes**.
Time-sensitive / first-person / refused / empty / error answers are never indexed — the firewall
against poisoning the brain with stale or personal content.

### 3.3 `retrieve_context(query, question_type) -> str` — the blend (request-time)
- Returns "" unless `AI_SEARCH_MEMORY_ENABLED=1` **and** the question is retrieval-eligible.
- **Eligible question types:** concept-education / valuation / compare / setup-technical / catalyst-news
  — NOT why-move / options-flow / idea-screen / portfolio-risk (those are live-only; memory adds
  nothing but staleness). Gated on `question_type` (already classified in Phase 1) + a min similarity
  threshold so weak matches never inject noise.
- Formats the top 1–3 hits as one labeled block:
  `PRIOR DESK RESEARCH (context only — may be dated; prefer the live UCT desk data above): …`
- Injected into `_grounded_system` AFTER the live-grounding block, so live data is visually + textually
  primary. Best-effort — any failure returns "" and the answer proceeds ungrounded-by-memory.

## 4. Router wiring (`ai_search.py`)
- In `_grounded_system(query)`, after building the live-grounding system, append
  `ai_search_memory.retrieve_context(query, meta.question_type)` when non-empty. The memory block is
  part of the cache key already (it's in the system prompt, which `_cache_key` hashes in full).
- Retrieval runs in the sync `ai_search` (threadpool — safe) and in `ai_search_stream`; the stream
  builds the system BEFORE the generator opens (already the case), so no event-loop blocking.
- `question_type` is computed once (reuse `ai_search_log.classify_question_type`) and passed to both
  grounding + logging.

## 5. Admin
- Extend `/api/ai-search/admin/log` insights with a `memory` block: index size, last-index time,
  eligible-row count, enabled flag. Surface it in `AiSearchInsightsPanel` (a small "House brain"
  stat row). A `POST /api/ai-search/admin/reindex` (admin) to force a rebuild.

## 6. Cost / rollout
- `AI_SEARCH_MEMORY_ENABLED=0` default (dark). Flip to 1 to turn on retrieval + indexing.
- Embedding cost is negligible; indexing is throttled + background; retrieval adds one embed per
  eligible query. Measure via the admin block before/after flipping.

## 7. Testing (`tests/test_ai_search_memory.py`)
- Gate: only evergreen + ok + non-first-person + non-excluded rows get indexed; time-sensitive /
  refused / first-person / excluded are skipped.
- Dedup by `answer_hash`; `excluded` flip removes a row on reindex; `pinned` boosts rank.
- `search` returns the semantically-nearest indexed answer (with a stub embed_fn).
- `retrieve_context`: returns "" when flag off; "" for live-only question types; a labeled block for
  an eligible type with a hit; empty index ⇒ "".
- Injection: the memory block is labeled "may be dated" and lands AFTER the live-grounding block.
- Flag-off ⇒ `_grounded_system` output byte-identical to Phase-1 behavior (invariance).

## 8. Out of scope (Phase 3, later)
Synthesis into evolving per-ticker/theme house-view dossiers; cross-answer consolidation; a
"what changed since last time" delta. The memory built here becomes their retrieval substrate.
