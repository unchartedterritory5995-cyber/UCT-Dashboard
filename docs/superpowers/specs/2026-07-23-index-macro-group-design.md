# Index & Macro group — Multi-Chart Groups mode

**Date:** 2026-07-23
**Status:** design approved, ready for implementation plan
**Surface:** `/charts` → Multi Chart → Groups mode
**Scope:** backend-only (`api/services/groups.py`); no frontend changes

## Problem

In Groups mode, typing a broad index ETF produces nothing. `resolve_peers("SPY")`
walks its fallback chain and dead-ends:

1. `resolve_primary_theme("SPY")` → None (SPY is in no theme's holdings)
2. `_industry_peers("SPY")` → SPY's Finviz industry is `Exchange Traded Fund`,
   which is in `_NON_PEER_INDUSTRIES` (`groups.py:451`) → refused by design
3. `_ai_peers("SPY")` → validation requires a sector/industry match against a
   catch-all pseudo-industry → effectively empty

Result: *"No group found for SPY — kept your board."* The same is true for QQQ,
IWM, DIA, TLT, GLD and every other broad/macro ETF.

Typing an index should instead produce an **index-and-macro screen**: the four
index proxies, a VIX product, and the risk-appetite / cross-asset gauges that
tell you what kind of tape you're in.

A second, related gap: a theme's **ETF ticker** resolves to nothing either. SMH,
ARKK and XLF are stored as `etf_ticker` on their themes, not as holdings, so
`get_themes_for_ticker("SMH")` misses and typing SMH dead-ends exactly like SPY.

## Solution overview

Two additive steps in the `resolve_peers` fallback chain, plus one synthetic
group in `list_groups()` / `top_n()`. Everything is a **fallback below existing
theme resolution**, so no ticker that has a real peer group today changes
behavior.

### Routing precedence (new steps in bold)

| # | Step | Examples |
|---|------|----------|
| 1 | Theme membership (owner > engine) — existing `resolve_primary_theme` | IBIT → Bitcoin & Crypto |
| 2 | **Symbol fronts a theme (`etf_ticker` match)** | SMH → Semiconductors · ARKK → Disruptive Innovation · XLF → Financials · GDX → Gold & Precious |
| 3 | **Symbol is in the macro trigger set** | SPY/QQQ/IWM/DIA/TLT/GLD/VIXY/… → **Index & Macro** |
| 4 | Industry cohort → AI peers → none — existing | unchanged |

Because macro sits below theme resolution, the trigger list can be generous
without risk: any symbol that gains a theme membership later automatically stops
routing to macro.

## The board

**Group id:** `index_macro` · **Display name:** `Index & Macro`

```
Pinned, fixed order:   SPY  QQQ  IWM  DIA
Then by |today's %|:   VIXY SMH ARKK IBIT TLT HYG GLD SLV UUP RSP XLK XLF
```

Rationale for the roster: four index proxies (large / tech / small / dow), one
vol proxy, three risk-appetite gauges (semis, high-beta growth, crypto), rates
and credit (TLT, HYG), metals (GLD, SLV), the dollar (UUP), equal-weight breadth
(RSP), and the two sector poles that most often diverge (XLK, XLF).

### Ordering rules

- **Core four are always present and always first**, in `SPY QQQ IWM DIA` order.
  Ranking purely by today's move would let SPY fall off a 3×3 on a quiet day.
- **The typed seed comes first**, ahead of the core four, then the remaining
  core, then movers. Typing IWM on a risk-off day yields
  `IWM SPY QQQ DIA VIXY TLT GLD ARKK SMH`.
- The seed is deduped out of the pinned block when it is itself a core name.
- Remaining slots fill by **descending absolute** today's % change (a −4% VIXY
  day and a +4% VIXY day are equally worth seeing).
- 4×4 shows all 16; 2×2 shows the core four; 3×3 shows core + top 5 movers.

### Trigger set

Broad index and clones: `SPY VOO IVV SPLG VTI QQQ QQQM QQQE IWM IJR IJH DIA RSP MDY`
Vol: `VIXY VXX UVXY UVIX VIXM SVXY`
Cross-asset macro: `TLT IEF SHY HYG LQD GLD SLV UUP UDN XLK`

SMH, ARKK, IBIT and XLF are **members but not triggers** — step 1/2 routes them
to their own themes, which is the more useful answer when you type them
directly. XLK has no theme, so it is both a member and a trigger.

## Ranking mechanics

Reuse `_today_map()` as-is. It already carries the `41f6b5cb` latency fix: a
hard `_TODAY_TIMEOUT_S` (3s) wall-clock bound on a dedicated pool plus a 20s
per-sym-set cache, so a stalled Massive snapshot degrades fast instead of
pinning the request path. Sixteen symbols is a trivial batch, and repeated typed
commits within the TTL reuse one snapshot.

**Fallback:** snapshot empty (market closed, timeout, provider error) → fall back
to the **fixed curated roster order** above. The board is never empty, never
slow, and never non-deterministic on a cold cache.

The macro roster does **not** run through `rank_holdings`, which would apply the
swing gates and the `cap_universe` filter — neither is meaningful for broad ETFs.
It uses its own small pinned-then-sorted ordering.

## `cap_universe` exemption

Several roster members are **not** in `cap_universe.json` (3,742 tickers):

| In cap_universe | Not in cap_universe |
|---|---|
| SPY QQQ IWM DIA TLT GLD SLV HYG ARKK SMH XLK XLF | **VIXY UUP RSP IBIT** (and triggers MDY QQQE UVXY VXX SVXY …) |

The normal peer path would silently drop those. The macro roster **bypasses
`is_chartable`**, on the same rationale as the existing theme-ETF pin
(`_theme_etf` / `pinEtf`): ETFs chart via Massive on demand and are deliberately
not cap-universe-filtered.

**Verification gate (implementation task):** hit prod `/api/bars/{SYM}` for every
non-cap-universe roster member and confirm real bars come back. Drop any symbol
that does not — a permanently blank cell is worse than a shorter roster.

## Picker entry

`Index & Macro` joins `/api/groups` as a synthetic row, shaped like every other
group so `GroupPicker`, `MultiChartMenu` prev/next nav, and refresh all work
unchanged:

```json
{"id": "index_macro", "name": "Index & Macro", "sector_id": "macro",
 "etf_ticker": null, "total": 16, "chartable": 16, "sub_theme_count": 0}
```

**Pinned to the top** of the list, ahead of the rotation-sorted themes. It has no
entry in `compute_rotation_signals()`, so without an explicit pin `list_groups()`
would sink it into the alphabetical tail.

`top_n("index_macro", n)` returns the same pinned-core ordering with
`etf: null` (so `pinEtf` is a no-op), `rows[].tier = "core"` for the four and
`"relevant"` for the rest, and `rows[].source = "owner"` (no engine dot).

## Frontend

**No changes required.** Every Groups-mode surface is already generic over
`{group_id, group_name, syms}`:

- `peerFill.js` reseeds the board from whatever `group_id` / `group_name` the
  backend returns
- `GroupHeatHeader` renders the passed `groupName`; `humanizeGroupId` is only a
  last-resort fallback and we always supply a real name
- `pinEtf(syms, null, n)` returns the list unchanged
- `MultiChartMenu` prev/next iterates the `/api/groups` list, so the macro entry
  participates automatically
- `also_in` is empty for macro (no multi-membership switcher), which the header
  already handles

## Testing

Backend (`tests/test_groups*.py`):

- **Routing precedence:** `SMH` → `semiconductors` (not macro) · `IBIT` →
  `bitcoin_crypto` (holding membership wins over ETF-front) · `XLF` →
  `financials_broad` · `SPY`/`TLT`/`VIXY` → `index_macro` · a ticker with a real
  theme never routes to macro
- **Core pinning:** core four present and first at n=4, 9, 16
- **Seed-first:** typed `IWM` returns `IWM` first, then `SPY QQQ DIA`, no dup
- **Cold snapshot:** `_today_map` returning `{}` yields exactly the curated
  roster order
- **Absolute-move ordering:** a −5% mover outranks a +2% mover
- **Non-cap-universe members survive** the fill (VIXY, UUP, RSP, IBIT present)
- **Picker shape:** `list_groups()` first row is the macro entry with the field
  set above; existing themes still rotation-sorted after it
- **ETF-front resolution** covers all 63 etf-backed themes without colliding with
  holdings-based resolution

## Non-goals

- No new taxonomy theme — this is synthetic, and must not appear in Theme
  Tracker, theme performance, or the theme engine's orphan/improve loops
- No sector-ETF → sector-theme mapping beyond the existing `etf_ticker` match
- No second curated board (a separate "Risk Appetite" group was considered and
  folded into this single 16-name superset)
- No changes to `rank_holdings`, the swing gates, or `cap_universe.json`
