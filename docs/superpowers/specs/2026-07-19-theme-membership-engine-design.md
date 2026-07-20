# Theme Membership Engine — Design Spec

**Date:** 2026-07-19
**Status:** design — incorporates the 7 confirmed engine-plan findings of the 8-lens adversarial mega-review (17/17 confirmed, 0 refuted) + the recovered swing-trader and systems-engineer lens reviews of this spec itself
**Feature area:** theme memberships for Groups / Multi-Chart peer-fill + Theme Tracker (111-theme taxonomy)
**Owner decisions locked:** fully autonomous · orphans absorbed proactively · provenance = owner vs engine · guardrailed + logged + reversible

## 1. Goal

A scheduled engine that (a) **absorbs orphans now** — 2,472 of 3,710 cap_universe stocks belong to no theme; each gets an AI-determined best-fit membership so a member never charts a groupless stock — and (b) **self-improves memberships continuously** as stories, relative strength, and peer associations develop, for an initial run of weeks-to-months. The owner's curated taxonomy is inviolable; the engine iterates only on its own additions.

## 2. Architecture — owner baseline + engine overlay, merged in ONE place

- `themes_taxonomy.json` stays the git-tracked, owner-curated baseline (**source: owner**). The engine never writes it.
- New table **`engine_memberships`** in auth.db (WAL, /data volume): `(id PK, theme_id TEXT, sym TEXT, tier TEXT, sub_theme_id TEXT, confidence REAL, rationale TEXT, action TEXT CHECK(action IN ('add','suppress_proposal')), status TEXT CHECK(status IN ('proposed','accepted','dismissed')) DEFAULT 'proposed' /* suppress rows only */, created_at TEXT, created_run_id TEXT, updated_at TEXT, updated_run_id TEXT, UNIQUE(theme_id, sym))` + `CREATE INDEX idx_em_sym ON engine_memberships(sym)` and `idx_em_theme ON engine_memberships(theme_id)` (the sym-side of the merged UNION is on the per-chart watermark hot path). **No FK to `themes`** (mega-review #1: a plain FK permanently blocks the version-gated reseed's `DELETE FROM themes`; CASCADE silently wipes the overlay every bump). `sym` stored in **taxonomy (dot) form** to match `theme_memberships`.
- **Write semantics (systems-lens #2):** Loop-2 changes to an existing engine row are **UPDATE-in-place** — `created_at/created_run_id` immutable, `updated_at/updated_run_id` set. Every mutation also appends to **`engine_membership_events`** `(id PK, run_id, theme_id, sym, event CHECK(add|retier|drop|suppress|dismiss), old_tier, new_tier, at)` — an append-only journal. **Rollback of a run = replay its inverse events** (a re-tier rolls back to the prior tier, an add rolls back to absent), not a blind `DELETE WHERE run_id` (which would destroy a good earlier add whose row a later run had merely re-tiered).
- **`engine_decisions`** `(sym TEXT PK, decision TEXT CHECK(decision IN ('add','none','below_gate')), theme_id TEXT, confidence REAL, run_id TEXT, decided_at TEXT)` — **per-symbol decision memory** (systems-lens #1, critical). Orphan selection = orphans **minus** syms with a decision younger than `THEME_ENGINE_REEVAL_DAYS` (default 35). Without it the liquid-first ordering re-adjudicates last night's skipped names before ever reaching fresh ones — the drain never converges and the nightly cap burns on the same NONE verdicts forever. The re-eval window is also *how* "stories develop → re-examine" is implemented, at a bounded price; and the table is the crash-resume cursor.
- **Sym-form discipline (systems-lens #5):** the engine's internal canonical form is **HYPHEN** (matches cap_universe, rs_ranking, industry_map, `tools/theme_curation/loaders`); `to_taxonomy_sym()` is applied **exactly once, at overlay INSERT**. The orphan set is computed as `{normalize_sym(cap)} − {normalize_sym(taxonomy)}` (else every class share is a false orphan), the cap-membership write gate tests the hyphen form, and the merged-read helper **normalizes its input** (`upper().replace('-', '.')`) so hyphen-passing consumers (voice_position_sizing already passes hyphen syms today) are correct by construction. Required test: BRK.B round-trips through orphan-detection → gate → insert → merged read → `get_themes_for_ticker("BRK-B")`.
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

### 4b. Aggregate engine-invariance (trader-lens CRITICAL)

Theme **returns, rankings, and rotation are computed from `source='owner'` rows only.** `group_return` / `_apply_live_returns` group aggregates / `compute_rotation_signals` never include engine members — otherwise absorbing ~2,000 orphans (~doubling the median-19 theme) dilutes every theme's equal-weight return, compresses cross-theme dispersion, steps every theme's history the night a batch lands, and silently rewires the leaders/laggards board + the hottest-first group-picker ordering. Engine members still appear in holdings drilldowns with their individual returns; they just don't move the theme's number. **Required test:** a theme's 1w return and 1w_rank are byte-identical before/after a 20-name overlay insert.

### 4c. Provenance visibility (trader-lens)

`resolve_peers` / `top_n` rows carry `source`; the grid cell badge and Theme Tracker holdings render a minimal provenance mark (dim dot/tint) on engine-sourced names, and Tracker holdings list owner rows first with engine-peripheral behind a "+N engine" expander. §11's no-explainer-UI non-goal explicitly exempts this one-character mark — a trader who can't tell an engine add from a curated name will distrust the whole fill.

## 5. Primary-theme stability under absorption (mega-review #3 + systems-lens #3)

`resolve_primary_theme` must be **engine-invariant on BOTH sort keys**:
- `_theme_size` counts **owner-baseline rows only** (merged reads expose `source`; the count filters `source='owner'`).
- **`source='owner'` rows sort ahead of engine rows before the tier key.** The sort is tier-first, so without this an engine `relevant` add for a sym the owner holds `peripheral` elsewhere would flip that member's primary theme (and chart watermark) overnight — the exact instability the size fix alone does not close. Required test: an engine `relevant` add never outranks any existing owner membership of the same sym.

Engine adds can therefore never change which group a curated seed fills. `groups.invalidate_sizes()` (new) resets `_SIZES_CACHE`; called from the post-run hook and `seed_from_json`.

## 6. Loop 1 — proactive orphan absorption (nightly until drained, then maintenance)

Pipeline per orphan batch (**200/night**, priority-ordered: liquid/high-RS first via the rs_ranking cache + screener dollar-vol, long tail later):

1. **Candidate themes**: the orphan's Finviz industry (industry_map) → themes whose `theme_finviz_industries` sets contain it, plus themes holding ≥2 of the orphan's top AI peers.
2. **AI adjudication** (one Anthropic call per orphan, `TAXONOMY_LLM_MODEL`, grounded with: candidate themes' rosters, the orphan's industry/sector, its RS + dollar-vol, and Perplexity-sourced closest-peers/narrative for names where industry alone is ambiguous): pick the best-fit theme + tier ∈ {relevant, peripheral} (engine may not mint core) or **NONE** ("genuinely thematic-less" — e.g. a diversified regional insurer that belongs to no narrow theme). Confidence self-rated, corroboration-adjusted exactly as the curation pipeline does.
3. **Write gate — scaled with visibility** (trader-lens: tier gives zero rank protection for names with live data, so a liquid mis-add headlines the fill):
   - **Liquid orphans** (pass the swing-gate liquidity floor: px ≥ $5, $vol ≥ $20M): confidence ≥ **0.85** AND **hard corroboration** — the orphan's Finviz industry ∈ the theme's `theme_finviz_industries` set, OR ≥ 2 of the orphan's top AI peers already in the theme roster.
   - **Long tail**: confidence ≥ 0.75.
   - Always: theme exists, sym ∈ cap_universe, (theme_id, sym) not owner-held, per-theme add cap respected.
   - **Beat-the-incumbent test**: today an orphan already fills via its Finviz industry cohort (a genuinely tight deterministic peer set). The chosen theme must contain ≥ 2 members of the orphan's industry cohort (or satisfy the AI-peer overlap above) — else record **NONE** and keep the wave-A industry fill. A 0.76-confidence squeeze into a loose theme must never replace a better deterministic cohort.
   - Below gate or NONE → run-ledger `skipped` (the runtime industry fallback still covers those stocks in Groups).
4. Mis-fit self-correction belongs to Loop 2 — the engine may drop/re-tier **its own** rows freely, and the §7 co-movement audit auto-corrects.

Absorbed orphans surface in Groups immediately (post-run invalidation) and in Theme Tracker holdings immediately with returns on the next recompute (§4).

## 7. Loop 2 — self-improvement (weekly, heat-ordered — not round-robin)

**Ordering (trader-lens):** the weekly ~15 themes are picked by rotation heat — `compute_rotation_signals`' rotating-in themes + the biggest 1w_rank movers always first; the cold long tail fills remaining slots. A flat round-robin would refresh the hot theme 6+ weeks after its move (adding the new uranium name after the squeeze).

Per theme: AI closest-peer search over its current merged roster + RS snapshot deltas (rs_ranking's multi-period returns — a proxy, not true history) + Perplexity narrative refresh, **plus 60-day return correlation vs the theme basket/ETF** (from the bars cache) as ADD corroboration — co-movement is the trader's ground truth for "does this name trade with the theme". Typed outputs:
- **ADD** (new name central to the theme) → overlay insert, same gate as §6.
- **RETIER / DROP of engine rows** → applied directly (provenance makes them the engine's to manage).
- **Owner-row concerns** (a curated name gone off-theme, a tier misfit) → `suppress_proposal` rows, **never applied**; they appear in a weekly owner report (Discord post + `engine_runs` ledger) for one-command acceptance later.

**Post-add co-movement audit (the outcome-feedback loop):** 30 days after any engine ADD, compute the name's 60-day correlation vs its theme basket; persistently low co-movement (below a tunable floor across two consecutive audits) → the engine **auto-drops its own row** (run-ledgered). This closes the loop that makes "self-improving" a measured property rather than an aspiration — nothing else ever verifies an absorption actually behaved like a member.

## 8. Guardrails & operations

- **Flags**: `THEME_ENGINE_ENABLED` (master, default 0), **`THEME_ENGINE_DRY_RUN`** (full pipeline, decisions + proposals written to the ledger/report only, NO overlay writes — this is how the §10 hand-check artifact is produced before enablement; systems-lens #8), `THEME_ENGINE_ORPHAN_BATCH` (200), `THEME_ENGINE_CONFIDENCE_MIN` (0.75), `THEME_ENGINE_REEVAL_DAYS` (35), `THEME_ENGINE_DAILY_COST_CAP` ($5 soft-stop), `THEME_ENGINE_MAX_ADDS_PER_THEME_PER_RUN` (10).
- **Cost model (systems-lens #4)**: model pinned to **`claude-opus-4-8`** (no-Haiku-for-judgment rule) with a **prompt token budget** — candidate rosters passed as syms-only, ≤2.5k input tokens/orphan target. Every LLM call logs to a per-call cost table (`engine_cost_log`, mirroring `catalyst_cost_log`) which is the substrate the daily cap actually reads (committed per call, so a killed run's spend still counts). At these budgets 200 orphans ≈ $2.5-4/night; if fat-prompt nights trip the soft-stop the batch shrinks loudly (ledger row notes `cost_capped`), never silently. The Anthropic **Message Batches API** (50% discount, async) is the stated v2 cost path.
- **Write discipline (systems-lens #6)**: engine writes are **per-row autocommit** — a transaction never spans an LLM/Perplexity/network call (auth.db carries sessions/journal/watchlists with a 3s busy timeout; one held write transaction = member-facing 500s). Bounded retry on `SQLITE_BUSY`. The merged read is ONE SQL statement (UNION in SQL, not two Python-merged queries).
- **Never touch owner rows; never mint core; never delete a theme; never write themes_taxonomy.json.**
- **Run ledger** `engine_runs(run_id, kind, started_at, finished_at, examined, added, retiered, dropped, skipped, cost_usd, error)`. **Run recovery (systems-lens #7)**: at startup and at each run start, any `engine_runs` row with `finished_at IS NULL` older than 3h is marked `error='aborted'`; resume is decision-table-driven (§2 `engine_decisions` — already-judged syms are skipped for free). **Rollback = inverse-event replay for a run_id** (§2), exposed via a **`require_admin`** endpoint (never the repo's no-auth-diagnostic pattern — this one deletes data).
- **Scheduling**: APScheduler in `api/main.py`, `_ET`-pinned — orphan loop nightly **11:00 PM ET** weekdays (clear of the ≥4:20 PM deploy band where mid-run pod deaths are routine; systems-lens #7), improvement loop Saturday 10:00 AM ET; `max_instances=1`; per-call LLM timeouts (`.with_options(timeout=…)`); never touches the request path.
- **Suppress-proposal lifecycle (systems-lens #8)**: suppress rows carry `status` (§2); the weekly report queries `status='proposed'` only; owner dismiss → `dismissed` (never resurfaces), owner accept (curates the taxonomy) → `accepted`, and the §3 GC also sweeps accepted suppress rows.
- **Kill switch** = unset `THEME_ENGINE_ENABLED`; merged reads keep serving existing overlay rows (inert data, no engine writes).

## 9. Library adaptations (confirmed medium)

`tools/theme_curation` is reused as the proposal/validation library with three adaptations: (a) validation helpers accept a membership-row context (not only the whole-taxonomy dict), (b) artifact/ledger paths become parameters (server runs use `/data/theme_engine/`), (c) the interactive/git-clean CLI gates are bypassed by the engine entrypoint (server-side module `api/services/theme_engine/`, importing the shared pure functions).

## 10. Testing

- Merge: owner-precedence dedup; suppression exclusion; dangling-theme filter; `source` tagging; `get_themes_for_ticker` shape unchanged.
- Reseed GC: populated overlay → reseed succeeds, orphaned + owner-dup overlay rows swept, counts logged.
- Stability: `_theme_size` ignores engine rows; `invalidate_sizes` resets the cache.
- Enrichment: id-first lookup hits for a curated-only theme under name drift; overlay member appended with null return.
- Orphan gate: below-confidence skip, non-cap reject, owner-held reject, NONE recorded; per-theme add cap enforced.
- Cost breaker: run halts at the cap with a truthful `cost_capped` ledger row; per-call cost rows survive a killed run.
- Decision memory: a NONE-decided sym is not re-adjudicated inside the re-eval window; is re-adjudicated after it; a crash-resumed run skips already-decided syms.
- Rollback: add→retier→rollback(retier run) restores the prior tier; rollback(add run) removes the row; event journal drives both.
- Sym round-trip: BRK.B through orphan-detection → gate → insert → merged read → `get_themes_for_ticker("BRK-B")` (§2).
- Primary stability: engine `relevant` add never outranks an owner membership (§5); theme sizes owner-only.
- Provenance: an engine 'drop' of an owner row is impossible via the public API (only `suppress_proposal`); suppress lifecycle (proposed→dismissed never resurfaces; accepted swept by GC).
- Aggregate invariance: theme 1w return + 1w_rank byte-identical before/after a 20-name overlay insert (§4b).
- Visibility-scaled gate: a liquid orphan at 0.80 confidence without corroboration is skipped; the same at 0.86 with industry corroboration writes; beat-the-incumbent NONE path exercised.
- LLM classification *quality* is validated by a one-time hand-check report before `THEME_ENGINE_ENABLED=1` — covering **the first liquid batch specifically** (the highest-visibility adds), not a random 50 (owner reviews the dry-run output).

## 11. Non-goals (v1)

Editing `themes_taxonomy.json`; creating/deleting themes autonomously; replacing the morning-wire push (handshake only); ETF-holdings ingestion; a member-facing "why this group" UI beyond the existing rationale fields; multi-theme orphan placement (one best-fit membership per orphan in v1 — Loop 2 may add more later).
