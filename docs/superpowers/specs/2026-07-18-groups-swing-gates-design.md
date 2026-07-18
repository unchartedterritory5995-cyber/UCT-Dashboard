# Live Swing Gates for Groups — Design Spec

**Date:** 2026-07-18
**Status:** design — awaiting owner sign-off before the implementation plan
**Feature area:** `/charts` Multi-Chart Groups ranking (`api/services/groups.py`)
**Sub-project:** ① of 2 in the theme-constituent curation initiative (② = taxonomy curation pipeline, separate spec)
**Grounded by:** adversarial multi-lens design analysis (5 lenses + opus synthesis, all claims code-verified) — this spec incorporates its load-bearing findings.

## 1. Goal

Make Groups surface **tradable-first** names on any theme — always fresh — by biasing its *existing* live ranking toward swing-quality names (liquid, high relative-strength, good range, real price), **without dropping any names** (the grid still fills) and **without touching the taxonomy JSON** (that is sub-project ②). Applies to **both** theme-fill (`top_n`) and peer-fill (`resolve_peers`), because both flow through `rank_holdings`.

## 2. Problem / context

Groups already ranks a theme's chartable holdings live: today's-move → RS → 1-month → curated tier → list position (`rank_holdings`, `groups.py`). What it lacks is a *quality floor*: on a thin or junky theme it will happily surface an illiquid, low-RS, no-range name in a chart cell. The taxonomy also carries stale/low-quality constituents — but rather than prune the map (which re-introduces staleness the moment RS/liquidity shift), we judge quality **at query time** so it never goes stale. The map only needs to be *correct* (sub-project ②); *strength* is the gate's job here.

## 3. Final decisions

1. **Quality-first with fallback, never drop** (owner decision): gate-passers lead; weaker names backfill only to fill the grid. Implemented as extra **outer sort bands** on `rank_holdings`'s existing key — no name is removed.
2. **Liquidity is a HARD prefilter; RS+ADR are a momentum sub-score** (not a flat 0–4 pass-count). A liquidity/price failure can never be bought back by momentum — an untradable penny name must never outrank a solid liquid one.
3. **"Missing" ≠ "failed."** A name with no screener data (e.g. a sub-3-month IPO with no 3-month RS, or a name with no local daily bars) lands in a middle *liquidity-unconfirmed* band — it gets a fair shot above confirmed-illiquid names, but never scores "full" on partial data.
4. **Live price for the price/$-vol gates**, EOD for ADR. Reuse the intraday move `rank_holdings` already fetches.
5. **Default-OFF (dark-launch).** Ships behind a flag defaulting to `0`, matching every comparable "changes what live members see" system in this codebase (`BRAIN_PACK_ENABLED`, `COMPASS_AUTOMATION_ENABLED`, `AWARENESS_ENGINE_ENABLED`). Owner flips it on after a visual check; `0` = instant, byte-identical revert to today's ordering.
6. **Buyout-exclusion deferred** — no pending-deal list exists in the dashboard; it needs genuinely new data and is a follow-on gate.

## 4. Model — the ranking key

Let the per-name gate inputs be `rs_rank`, `dollar_vol`, `adr_pct`, `price` (see §5 for sources). Thresholds: `RS_MIN=70`, `DVOL_MIN=$20M`, `ADR_MIN=4.0%`, `PX_MIN=$5` (all env-tunable, §8).

**Liquidity band** (the hard prefilter):
- `0` = **confirmed liquid**: `price` and `dollar_vol` both present *and* `price ≥ PX_MIN` and `dollar_vol ≥ DVOL_MIN`.
- `1` = **unconfirmed**: `price` or `dollar_vol` missing (no/stale screener row, no live price) — can't tell.
- `2` = **confirmed illiquid**: both present but `price < PX_MIN` or `dollar_vol < DVOL_MIN`.

**Momentum sub-score** (`0–2`): `(1 if rs_rank present and ≥ RS_MIN else 0) + (1 if adr_pct present and ≥ ADR_MIN else 0)`. Missing RS or ADR contributes `0` — it is an *unmet* momentum gate, not a demotion below confirmed-illiquid.

**Sort keys** (lower tuple sorts first):
- **`top_n` (theme fill):** `(liq_band, -momentum, existing_bands(by), original_index)`
- **`resolve_peers` (peer fill):** `(liq_band, sub_theme_band, -momentum, existing_bands(by), original_index)` where `sub_theme_band = 0 if same sub_theme_id as the seed else 1`.

`existing_bands(by)` is the **current** `rank_holdings` ordering (today's-move → RS → 1m → tier), unchanged. `by='rs'` is **not** exempt — the liquidity prefilter applies regardless of `by`; `by` only affects ordering *within* a tier.

**Why peer-fill differs from theme-fill:** the two are deliberately asymmetric. Peer-fill keeps sub-theme *relevance* as the primary signal **within the confirmed-liquid tier** (typing RKLB should surface similar Space names first) — but the liquidity floor still leads, so a penny same-sub-theme peer never outranks a tradable adjacent one. This replaces `resolve_peers`'s current separate post-`rank_holdings` sub-theme `.sort()`, which would otherwise override the gate entirely.

The whole feature is: one new module + these outer bands on the existing key. No name is dropped; `top_n`/`resolve_peers` slicing to `n` then yields "confirmed-liquid high-momentum first, progressively-relaxed backfill."

## 5. Components / files

**New — `api/services/groups_gates.py`** (keeps `groups.py` lean):
- `THRESHOLDS` — module constants read from env with **defensive parsing** (each `try/except` → documented default + one warning log; mirrors the un-guarded `_AI_PEERS_TIMEOUT` cast that this fixes). `GROUPS_GATE_RS_MIN` / `_DOLLARVOL_MIN` / `_ADR_MIN` / `_PRICE_MIN`.
- `gates_enabled() -> bool` — reads `GROUPS_SWING_GATES_ENABLED` (default `"0"`).
- `swing_metrics(syms, rs, today) -> {sym: {rs_rank, dollar_vol, adr_pct, price}}` — takes the **already-built** `rs` dict (from `_rs_map()`) and `today` dict (from `_today_map()`) so it never re-fetches. Batches screener rows via `snapshot_db.get_rows(...)` (§ below). Derives `current_price = screener.price × (1 + today_pct/100)` (the `theme_performance._apply_live_returns` idiom) and `dollar_vol = current_price × screener.avg_volume_30d` with an explicit `None`-guard. **`rs_rank` comes only from `rs`** — the screener row's own `rs_rank` column (a different metric from `research_ratings.db`) is explicitly ignored.
- `gate_key(metrics, sub_theme_match=None) -> tuple` — builds `(liq_band, [sub_theme_band], -momentum)` per §4; the shared key so `top_n` and `resolve_peers` stay consistent.
- `gate_summary(metrics) -> {gate_score, liq_band, momentum, rs_ok, dvol_ok, adr_ok, px_ok}` — for observability (§9).

**New — `api/services/screener/snapshot_db.py::get_rows(tickers) -> {ticker: row}`** — one connection, `WHERE ticker IN (…)` (today only per-ticker `get_row` exists, opening a fresh `sqlite3.connect()` + PRAGMAs per call). Wrapped by `groups_gates` in a short in-process TTLCache (1h, mirroring `groups._SIZES_CACHE`/`_CAP_CACHE`; screener rows change once/night). **Staleness guard:** a row whose `built_at` is older than ~2 trading days is treated as missing (guards a silently-stalled nightly build).

**Modified — `api/services/groups.py`:**
- `rank_holdings(holdings, by, seed)` — when `gates_enabled()`, call `swing_metrics(cands, rs, today)` **once** and prepend the gate bands to the existing sort key. When disabled, **skip `swing_metrics` entirely** (no screener reads — the flag is also a load lever) and the key is byte-identical to today.
- `resolve_peers` — drop the separate post-sort; pass `sub_theme_match` into the shared `gate_key` so ordering is one coherent pass.
- `top_n` — add `gate_score` (+ the per-gate flags) to each `rows[]` entry (§9).

## 6. Data flow

```
top_n(theme_id, n, by)            resolve_peers(sym, n)
   └─ _theme_holdings                └─ resolve_primary_theme → _theme_holdings
        └───────────── rank_holdings(holdings, by, seed) ─────────────┘
              1. filter chartable + non-seed (unchanged)
              2. rs = _rs_map()   today = _today_map()   (already fetched today)
              3. if gates_enabled():
                   metrics = swing_metrics(cands, rs, today)   # ONE batched get_rows + TTLCache
                 sort key = (gate_key(metrics[sym], sub_theme_match?), existing_bands(by), idx)
              4. return ordered holdings           ← seed re-inserted by caller as before
   └─ slice top n   (grid fills: liquid-high-momentum lead, relaxed backfill)
```

The **seed** (typed ticker in peer-fill) is excluded from `rank_holdings` and re-inserted as cell 0 by the caller exactly as today — gating never hides it. The **pinned ETF** (`_theme_etf`) is added outside `rank_holdings` and is structurally gate-proof.

## 7. Edge cases

| Case | Behavior |
|---|---|
| Fresh IPO (no 3-month RS, but liquid) | liq_band 0, momentum +0 for RS — leads dead names; not buried |
| No screener row / no local bars | liq_band 1 (unconfirmed) — mid-tier fair shot, not confirmed-illiquid |
| Screener build silently stalled | rows > ~2 trading days old treated as missing → unconfirmed band |
| Penny / illiquid name (real data) | liq_band 2 — backfill only, never above a tradable name |
| Weak market (few clear RS/ADR) | momentum compresses; liquidity band still separates tradable from not (graceful) |
| Screener entirely cold (fresh deploy) | most names unconfirmed → gating ≈ no-ops, falls back to today's-move |
| Flag off | `swing_metrics` skipped; ordering byte-identical to today |
| Seed (peer-fill) | excluded from ranking, re-inserted as cell 0 — never gated out |
| Pinned ETF | added outside `rank_holdings` — unaffected |
| Malformed `GROUPS_GATE_*` env | caught → default + warning log; never 500s the fill |

## 8. Config / flags

- `GROUPS_SWING_GATES_ENABLED` — default **`"0"`** (dark). `"1"` enables. Off = skip the fetch entirely + identical ordering.
- `GROUPS_GATE_RS_MIN` (`70`, 1–99 percentile) · `GROUPS_GATE_DOLLARVOL_MIN` (`20000000`) · `GROUPS_GATE_ADR_MIN` (`4.0`, %) · `GROUPS_GATE_PRICE_MIN` (`5.0`, $). All defensively parsed.

## 9. Observability

- `top_n` `rows[]` carry `gate_score` + the four pass/fail flags (~1 line; spares a future admin endpoint — "why did X rank there" is answerable).
- Per-fill (or aggregate) **per-gate pass-rate** logging so the owner sees ADR/$-vol co-collapse in quiet tape. (RS is a 1–99 percentile — ~30% clear ≥70 in any regime, so it can't collapse market-wide; the absolute gates are the ones to watch.)

## 10. Testing

- `gate_key` / `swing_metrics`: confirmed-liquid+high-momentum → top tuple; confirmed-illiquid → bottom; **unconfirmed (missing data) strictly between** confirmed-liquid and confirmed-illiquid; missing-RS IPO with good liquidity bands above a dead name.
- **Liquidity-hard invariant:** an illiquid 2-of-2-momentum name never outranks a confirmed-liquid 0-momentum name.
- `rank_holdings` gated mixed fixture: qualifier-first ordering **and all names still present** (grid fills, nothing dropped).
- **`resolve_peers` sub-theme × gate:** a confirmed-liquid different-sub-theme peer outranks an illiquid same-sub-theme peer; within the liquid tier, same-sub-theme leads.
- **Flag-off golden-list byte-equality** on a tie-heavy multi-tier fixture (ordering identical to pre-feature).
- **Weak-market** case: all *real* values below thresholds → distinct from cold/None (confirmed-fail vs unconfirmed).
- **Cold-data:** all-None metrics → order == today's-move order.
- **Malformed env** resilience (bad `GROUPS_GATE_*` → default, no raise).
- `snapshot_db.get_rows` batch correctness + the >2-day staleness guard.
- **ETF-pin invariant:** cell-0 ETF unchanged across flag on/off.

## 11. Non-goals

No taxonomy/JSON edits (sub-project ②); no buyout-exclusion (deferred, needs new data); no frontend change; no change to chartability, ETF-pin, Undo, or the seed path; no name-dropping (fallback always fills); no market-relative/percentile thresholds in v1 (revisit if the per-gate logging shows drift).
