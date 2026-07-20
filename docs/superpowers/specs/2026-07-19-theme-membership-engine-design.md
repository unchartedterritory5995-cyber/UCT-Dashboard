# Theme Membership Engine — Design Spec

**Date:** 2026-07-19
**Status:** design — incorporates the 7 confirmed engine-plan findings of the 8-lens adversarial mega-review (17/17 confirmed, 0 refuted)
**Feature area:** theme memberships for Groups / Multi-Chart peer-fill + Theme Tracker (111-theme taxonomy)
**Owner decisions locked:** fully autonomous · orphans absorbed proactively · provenance = owner vs engine · guardrailed + logged + reversible

## 1. Goal

A scheduled engine that (a) **absorbs orphans now** — 2,472 of 3,710 cap_universe stocks belong to no theme; each gets an AI-determined best-fit membership so a member never charts a groupless stock — and (b) **self-improves memberships continuously** as stories, relative strength, and peer associations develop, for an initial run of weeks-to-months. The owner's curated taxonomy is inviolable; the engine iterates only on its own additions.

## 2. Architecture — owner baseline + engine overlay, merged in ONE place

- `themes_taxonomy.json` stays the git-tracked, owner-curated baseline (**source: owner**). The engine never writes it.
- New table **`engine_memberships`** in auth.db (WAL, /data volume): `(id PK, theme_id TEXT, sym TEXT, tier TEXT, sub_theme_id TEXT, confidence REAL, rationale TEXT, action TEXT CHECK(action IN ('add','suppress_proposal')), run_id TEXT, created_at TEXT, UNIQUE(theme_id, sym))`. **No FK to `themes`** (mega-review #1: a plain FK permanently blocks the version-gated reseed's `DELETE FROM themes`; CASCADE silently wipes the overlay every bump). `sym` stored in **taxonomy (dot) form** to match `theme_memberships`.
- **The merge lives inside `theme_db` — nowhere else** (mega-review #2: merging in groups.py leaves `get_themes_for_ticker`/`get_theme_holdings` consumers — voice sizing, watermark, risk paths — on baseline-only data). One private helper backs all three read functions:
  - `get_all_themes()`, `get_themes_for_ticker()`, `get_theme_holdings()` return `theme_memberships UNION engine_memberships(action='add')`, **deduped by (theme_id, sym) with owner precedence**, each row carrying `source: 'owner'|'engine'`. `get_themes_for_ticker` keeps its JOIN shape (watermark hot path).
  - Engine rows whose `theme_id` no longer exists in `themes` are filtered out of every merged read (second line of defense under the reseed GC).
- An engine "drop" of an owner name is **never a deletion**: `action='suppress_proposal'` rows are excluded from merges entirely and only surface in the owner's review report (§7).

## 3. Reseed ⇄ overlay contract (mega-review #1)

`seed_from_json()` gains, inside its existing transaction, an **overlay GC sweep** after reinsert: delete `engine_memberships` rows whose `theme_id` is not in the incoming taxonomy, and rows now present in `theme_memberships` (owner curated the same sym — owner wins); log both counts. `seed_from_json_safe` semantics unchanged. **Required test:** reseed with a populated overlay succeeds and leaves zero orphaned/duplicate rows. Additionally, the version gate gets a **content-hash fallback** (store sha256 of the canonicalized themes payload beside the version string; reseed when either differs) so a hand edit that forgets the version bump can no longer strand the DB stale (confirmed medium).

## 4. Single membership authority — Theme Tracker propagation (mega-review #0, #6, #8, #7)

The merged `theme_db` read becomes the membership authority for **every** surface, not just Groups:

- **`theme_performance`**: `_run_computation` resolves each theme's holdings as the **union of wire holdings + merged DB members** (wire-only data like UCT20/leadership untouched), so overlay members get computed returns on the next recompute. `_enrich_with_taxonomy` additionally **appends** merged members missing from the wire holdings (return `null` until the next recompute — visible immediately, priced within one cycle) and **indexes `theme_lookup` by `t["id"]` first**, then name/etf (mega-review #8 — the wire key for all 48 curated-only themes IS the id; name-string joins break on any rename drift).
- **`theme_index.resolve_theme`** resolves holdings from the merged read (falls back to wire when the DB is cold).
- **`groups._rotation_order`** keys by the rankings entry's `ticker` (= etf-or-id wire key), lowercased-name retained as fallback (mega-review #8, second site).
- **Post-run invalidation hook**: after every engine run (and inside `seed_from_json`), call `groups.invalidate_sizes()` + bust the theme_performance memory cache + theme_index caches so overlay writes take effect immediately, not after up to 1h of mixed state.
- **Wire handshake (mega-review #7)**: morning-wire adds `"taxonomy_version": <loaded version>` to its push; the dashboard's push handler compares it to the stored `theme_seed_version` and fires a `chart_health_alerts` + Discord warning on mismatch — the hand-sync can no longer drift silently. (Full retirement of the hand-sync — engine fetches the taxonomy over HTTP — is a stated follow-up, out of v1 scope.)
- **Voice correctness rider** (confirmed medium): `engine.get_themes('Today')` must stop feeding the 48 curated-only pseudo-tickers (`ai_gpu_chips`, …) to the Massive snapshot and defaulting misses to 0.00% — skip non-ETF keys (they have no single quote) rather than reporting flat zero.

## 5. Primary-theme stability under absorption (mega-review #3)

`resolve_primary_theme`'s smallest-theme tiebreak must be **engine-invariant**: `_theme_size` counts **owner-baseline rows only** (merged reads expose `source`, so the count filters `source='owner'`). Engine adds can therefore never flip which group a curated seed fills — a member's NVDA keypress fills the same grid before and after a background run. `groups.invalidate_sizes()` (new) resets `_SIZES_CACHE`; called from the post-run hook and `seed_from_json`.

## 6. Loop 1 — proactive orphan absorption (nightly until drained, then maintenance)

Pipeline per orphan batch (**200/night**, priority-ordered: liquid/high-RS first via the rs_ranking cache + screener dollar-vol, long tail later):

1. **Candidate themes**: the orphan's Finviz industry (industry_map) → themes whose `theme_finviz_industries` sets contain it, plus themes holding ≥2 of the orphan's top AI peers.
2. **AI adjudication** (one Anthropic call per orphan, `TAXONOMY_LLM_MODEL`, grounded with: candidate themes' rosters, the orphan's industry/sector, its RS + dollar-vol, and Perplexity-sourced closest-peers/narrative for names where industry alone is ambiguous): pick the best-fit theme + tier ∈ {relevant, peripheral} (engine may not mint core) or **NONE** ("genuinely thematic-less" — e.g. a diversified regional insurer that belongs to no narrow theme). Confidence self-rated, corroboration-adjusted exactly as the curation pipeline does.
3. **Write gate**: confidence ≥ 0.75 AND theme exists AND sym ∈ cap_universe AND (theme_id, sym) not already owner-held → insert overlay row. Below gate or NONE → recorded in the run ledger as skipped (the runtime industry-fallback from wave A still covers those stocks in Groups).
4. Mis-fit self-correction belongs to Loop 2 — the engine may drop/re-tier **its own** rows freely.

Absorbed orphans surface in Groups immediately (post-run invalidation) and in Theme Tracker holdings immediately with returns on the next recompute (§4).

## 7. Loop 2 — self-improvement (weekly rotation, ~15 themes/week ⇒ full sweep ≈ 7-8 weeks)

Per theme: AI closest-peer search over its current merged roster + RS trajectory (rs_ranking) + Perplexity narrative refresh. Typed outputs:
- **ADD** (new name central to the theme) → overlay insert, same gate as §6.
- **RETIER / DROP of engine rows** → applied directly (provenance makes them the engine's to manage).
- **Owner-row concerns** (a curated name gone off-theme, a tier misfit) → `suppress_proposal` rows, **never applied**; they appear in a weekly owner report (Discord post + `engine_runs` ledger) for one-command acceptance later.

## 8. Guardrails & operations

- **Flags**: `THEME_ENGINE_ENABLED` (master, default 0), `THEME_ENGINE_ORPHAN_BATCH` (200), `THEME_ENGINE_CONFIDENCE_MIN` (0.75), `THEME_ENGINE_DAILY_COST_CAP` ($5 soft-stop, catalyst-engine precedent), `THEME_ENGINE_MAX_ADDS_PER_THEME_PER_RUN` (10 — no theme balloons overnight).
- **Never touch owner rows; never mint core; never delete a theme; never write themes_taxonomy.json.**
- **Run ledger** `engine_runs(run_id, kind, started_at, finished_at, examined, added, retiered, dropped, skipped, cost_usd, error)`; every overlay row carries its `run_id`. **Rollback** = `DELETE FROM engine_memberships WHERE run_id = ?` (admin endpoint) or truncate the table — owner data untouched by construction.
- **Scheduling**: APScheduler in `api/main.py` via the existing `_ET`-pinned pattern — orphan loop nightly 8:30 PM ET weekdays, improvement loop Saturday 10:00 AM ET; `max_instances=1`; the job body runs in the scheduler thread with per-call LLM timeouts (`.with_options(timeout=…)`) and never touches the request path.
- **Kill switch** = unset `THEME_ENGINE_ENABLED`; merged reads keep serving existing overlay rows (inert data, no engine writes).

## 9. Library adaptations (confirmed medium)

`tools/theme_curation` is reused as the proposal/validation library with three adaptations: (a) validation helpers accept a membership-row context (not only the whole-taxonomy dict), (b) artifact/ledger paths become parameters (server runs use `/data/theme_engine/`), (c) the interactive/git-clean CLI gates are bypassed by the engine entrypoint (server-side module `api/services/theme_engine/`, importing the shared pure functions).

## 10. Testing

- Merge: owner-precedence dedup; suppression exclusion; dangling-theme filter; `source` tagging; `get_themes_for_ticker` shape unchanged.
- Reseed GC: populated overlay → reseed succeeds, orphaned + owner-dup overlay rows swept, counts logged.
- Stability: `_theme_size` ignores engine rows; `invalidate_sizes` resets the cache.
- Enrichment: id-first lookup hits for a curated-only theme under name drift; overlay member appended with null return.
- Orphan gate: below-confidence skip, non-cap reject, owner-held reject, NONE recorded; per-theme add cap enforced.
- Cost breaker: run halts at the cap with a truthful ledger row.
- Provenance: an engine 'drop' of an owner row is impossible via the public API (only `suppress_proposal`).
- LLM classification *quality* is validated by a one-time 50-orphan hand-check report before `THEME_ENGINE_ENABLED=1` (owner reviews the engine's first batch dry-run output).

## 11. Non-goals (v1)

Editing `themes_taxonomy.json`; creating/deleting themes autonomously; replacing the morning-wire push (handshake only); ETF-holdings ingestion; a member-facing "why this group" UI beyond the existing rationale fields; multi-theme orphan placement (one best-fit membership per orphan in v1 — Loop 2 may add more later).
