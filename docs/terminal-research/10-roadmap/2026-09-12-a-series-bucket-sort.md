---
id: ROADMAP-A-SERIES-BUCKET-SORT
title: The A-series application systems — what already exists, and what is honestly buildable
role: Phase 3 roadmap input — a bucket sort of the un-started application systems against the platform they would compose on
status: draft — analysis only. No code was written, no branch was cut, nothing is authorized by this file.
date: 2026-09-12
measured_against: origin/master @ 5ff6fc04a
---

# The A-series bucket sort

## 0. What I was asked, and what the roster actually says

The instruction named **"the seven un-started application systems — A1 Markets, A2 Charts,
A9 Screening, A10 Options, A11 Breadth, A12 Watchlists, A13 Journal, A14 Portfolio"** and
glossed the range as "A1, A2, A9–A14".

⚠️ **That list is EIGHT systems, not seven, and the range expands to eight as well**
(A1, A2, A9, A10, A11, A12, A13, A14). The instruction's own enumeration and its own range
agree with each other and disagree only with the word "seven". This file covers all eight.
The word, not the list, is what drifted — the same defect shape this program keeps
recording (a hand-typed count beside the list it describes).

**Roster resolved against the source.** `product-architecture.md` §4.2's map
(`05-product-strategy/product-architecture.md:175-181`) declares **fifteen** application-tier
entries: A1–A14 plus **E1 People/Company Intelligence (evaluate only)**. Each has a block in
§6 (`product-architecture.md:640-724`). Cross-referencing that roster against
`00-program-control/LEDGER.md`'s manifest of shipped application code:

| status per LEDGER | systems |
|---|---|
| shipped by this program | A3/A4 (`LEDGER.md:76`), A4 (`:83`), A5 (`:81-82`, ⛔TC), A6/A7 (`:80`), A8 (`:84`), I1 (`:85-86`) |
| **no row anywhere in the ledger** | **A1, A2, A9, A10, A11, A12, A13, A14** — the eight below |
| explicitly not designed | E1 (`product-architecture.md:723`) |

So "un-started" is true **of this program**, and only of this program. It is false of the
product for six of the eight. That gap is the whole subject of this file.

⚠️ **A naming collision worth knowing before reading the ledger.** `LEDGER.md`'s Wave-3
sections use `A1` and `A2` as *action* labels — `LEDGER.md:1189` ("✅ A1 — WEB DEPLOY
CONFIRMED BY ANCESTRY") and `LEDGER.md:1096` ("⛔⛔ A2 STOPPED — `SMOKE_LOGIN_LINK_ENABLED`").
Neither is about A1 Markets or A2 Charts. A grep for `A2` in the ledger returns the flag
incident, not the chart system.

---

## 1. Method — what I measured and how

Every count in this file was taken by reading or executing against the working tree at
`C:\Users\Patrick\uct-worktrees\s7-price-level`. No count is restated from a comment, a
CLAUDE.md section, or another document; where an existing artifact disagreed with the tree,
the tree wins and the disagreement is recorded.

- **Routes** — read from `app/src/App.jsx`'s `<Route path=…>` table (91 route elements).
  Cited by line number.
- **Widget types** — the object literals were brace-matched and their top-level keys counted
  by script, from `app/src/widgets/registry.js:152` (`WIDGET_REGISTRY`) and
  `app/src/pages/charts/WidgetHost.jsx:46` (`WORKSPACE_WIDGETS`). Both return **20**, and the
  fact that two independently-parsed tables agree is itself the non-vacuity control.
- **File counts** — `find`/`ls` with `*.test.*` excluded, per directory.
- **Line counts** — `wc -l`.
- **D2's address book** — `api/data/canonical_address_book.json` parsed with `json.load`, its
  `metrics` object enumerated and its `store` values histogrammed.
- **The D1 census** — `python tools/fmp_guard_census.py` was *run*, not quoted.

**Absence claims carry a control.** Two are load-bearing here:

1. *"No route serves A14."* — control: the same regex over `App.jsx` that returns **0** for
   `portfolio|risk|heat` returns **10** for `journal|breadth`, off a table of 91 routes. The
   probe can see routes; there is no portfolio route to see.
2. *"`pct_above_50sma` is not in D2's address book."* — control: the same walk enumerated
   **137** metric names and printed two of them (`above_50sma`, `adr_pct`). A "not present"
   from an empty read would have shown zero names.

⚠️ **One thing I could not verify: the tree's identity.** The frontmatter records
`origin/master @ 5ff6fc04a` because the instruction supplied it (and `LEDGER.md:662` records
that SHA). I was instructed not to run git commands, so **I did not confirm that this
worktree equals that commit.** Every measurement below is a fact about the working tree I
read; treat the SHA as a label the caller supplied, not one I checked.

---

## 2. Platform status — the dependency table every paragraph below reads from

Per `product-architecture.md:767`, the boundary matrix gives **every** application the same
permitted platform edges (S3 ● S4 ● S5 ● S6 ● S8 ● S9 ● S10 ● S11 ● S12 ● D2 ● D3 ● D4 ● D5 ●;
S1/S2/S7/I1 through a registration; **D1 ✗ except the time-boxed adapter-only exception**).
So "which platform systems does A_n compose on" is not a per-application question at the
matrix level — what differs is which edges are *load-bearing* for that application's CP1.
Those are named per system.

| system | exists now? | evidence (LEDGER.md unless noted) |
|---|---|---|
| **S3 Entity Master** | ✅ SHIPPED | 11 commits, `:37-47`; totals line `:91` |
| **S8 Provenance & Freshness** | ✅ SHIPPED | 5 commits, `:69-73`; `<Cited>` ET fix `e909279e1` `:821` |
| **S11 Session & Market Clock** | ✅ SHIPPED | `e14a5836b` `:74`; Seam-7 extension `:97` |
| **D1 Provider Abstraction** | ✅ SHIPPED, adoption partial, **census GREEN (measured)** | 21 commits `:48-68`; census re-run below |
| **S10 Presentation Primitives** | ✅ SHIPPED `3c539d011` | `:902`; five pure functions, four adopters `:933-937` |
| **S12 Rollout & Cohort** | ⚠️ FIRST MIGRATION MERGED `56df6803f` | `:731`, `:781-796`; cohorts are `user_tags` rows with a `rollout:` prefix (`:621`, `:627`) |
| **D2 Canonical Data Model** | ⚠️ CP1 MERGED `b9783d509`, **addresses one store** | `:730`, `:740-742`, `:776-777`, `:1081` |
| **S7 Alerts** | ⚠️ **4 of 8 trigger types** | see below |
| **S1 Terminal Shell** | ⛔ narrow slice only, PROVISIONAL-SHIPPED | `product-architecture.md:332-359`; D1/DEC-01 gated on OI-06 (`:329`) |
| **S2 Command/Search** | ⛔ narrow slice only, PROVISIONAL-SHIPPED | `LEDGER.md:78-79`; grammar default gated on OI-06/DEC-02 (`product-architecture.md:228`, `:361-369`) |
| **S9 Entitlements** | ⛔ NOT BUILT (mechanism exists, numbers owner-bound) | `product-architecture.md:524-535` — D5 / OI-03(a)(b) / OI-12 |
| **S4 Context Bus** | ⛔ NOT BUILT | no LEDGER row; seed is the colour groups (`product-architecture.md:404-415`) |
| **S5 Persistence & User State** | ⛔ NOT BUILT | no LEDGER row (`product-architecture.md:417-428`) |
| **S6 Personalization** | ⛔ NOT BUILT | no LEDGER row |
| **D3 Streaming** · **D4 Caching** · **D5 Corp-Actions** | ⛔ NOT BUILT **as platform systems** | no LEDGER row |

**S7's four shipped trigger types**, against the eight-type taxonomy at
`product-architecture.md:271`:

| type | state | evidence |
|---|---|---|
| `document-arrival` | ✅ | `e994f5337` `LEDGER.md:77` (+ `:123-125` extensions) |
| `catalyst-match` | ✅ CP1+CP2 | `faaa30146` / `d9631afa5` `LEDGER.md:903-904` |
| `event-proximity` | ✅ CP1+CP2 | `LEDGER.md:1297` |
| `price-level` | ✅ CP1–CP3, **dark run armed, not delivering** | `LEDGER.md:1459`, `:1525` |
| `indicator-condition` | ⛔ | sequenced behind D2 CP1 **plus a non-screener store** `LEDGER.md:775-777` |
| `scan-membership-change` | ⛔ | no row |
| `regime-change` | ⛔ | no row |
| `position-risk` | ⛔ | no row |

⚠️ **A correction to the brief, measured not quoted.** The instruction says "D1 … census
GREEN". `LEDGER.md:604-609` and `:227` say the opposite — a pre-existing red on
`api/services/news/adapters/fmp_news.py:37`. I ran the tool. **The brief is right and those
ledger lines are now stale:**

```
UNQUARANTINED financialmodelingprep.com literals outside api/services/fmp_client.py: 0
UNQUARANTINED _fmp_get-shaped function definitions outside api/services/fmp_client.py: 0
QUARANTINE (11 entries):  … api/services/news/adapters/fmp_news.py — G5 RULING 2026-09-12:
    contract mismatch, not migration debt … Deliberately outside.
```

It went green by the G5 ruling *moving* `fmp_news.py` into quarantine with a stated reason,
not by a migration. The 11-entry quarantine list printed by the same run is the control: a
zero from a dead walk would have printed an empty list too.

⚠️ **And the measurement that reshapes six of the eight paragraphs below.** D2 CP1's book
is real and useful, but its reach is one store — measured, not inferred:

```
metrics: 137        stores: Counter({'screener_rows': 137})
pct_above_50sma present: False
```

`pct_above_50sma` — the metric `product-architecture.md:712` names as *the* worked example
for D2's address book — **is not in it**. There is a near-miss, `above_50sma`, whose own
sentence reads *"whether the price is above its 50-day average"*: a per-symbol boolean column
in `screener_rows`, not the breadth aggregate. A reader skimming for "50sma" would call that
coverage. It is not.

---

## 3. The eight systems

### A1 — Markets

**What it is.** Per `product-architecture.md:645`: quotes, snapshots, movers, index/ETF/futures
strips, ticker meta and logos; it owns the quote panel and the movers surface and must not own
the tick transport (D3), the entity (S3), or an unauthenticated read path. **Composes on** S3
(the quoted thing is an entity), S8 (as-of and source on every printed number), S11 (pre/RTH/post
decides whether a quote is stale or merely closed), D1 (the vendor leg), D4 (serving policy),
D3 (the tick), S10 (the formatter), S12 (cohort), D2 (an address for each quoted number so I1
can cite it). **Of those: S3, S8, S11, D1, S10, S12 exist** (`LEDGER.md:37-47, 69-74, 48-68,
902, 731`); **D2 exists but addresses only `screener_rows`**, so no quote field is addressable
(measured above); **D3 and D4 are not built as platform systems**, though the product code they
would formalise is live (`api/routers/stream.py`, `api/services/cache.py`,
`api/services/serve_stale.py`, `api/services/cache_snapshot.py`, `app/src/lib/priceStreamManager.js`,
`app/src/lib/barsStreamManager.js` — all present). **CP1 size: S.** ⭐ **What already exists:**
a lot. `/dashboard` (`App.jsx:526`) is 313 lines that mount seven live surfaces —
`FuturesStrip`, `MarketBreadth`, `ThemeTracker`, `JournalSnapshotTile`, `FlowScoreboardTile`,
`CatalystTable` and `MoversSidebar` (`Dashboard.jsx:43-49`, rendered at `:215-302`), drawn from the
**18 tile components** in `app/src/components/tiles/`. The serving legs are mounted and named:
`api/routers/live_prices.py:555`, `movers.py:7`, `snapshot.py:7` and `:15`,
`ticker_search.py:123`. `/post-market` (`App.jsx:608`) is a further live page. The entity page
`/research/:sym` (`App.jsx:534`) already carries an `OverviewTab` among its 11 tabs. A CP1 that
"builds A1 Markets" as a new quote surface would be a second authority over quote and mover values
that these surfaces already serve. (How many components read `/api/live-prices`: not measured.)

### A2 — Charts & Analytics

**What it is.** Per `product-architecture.md:648`: the price chart, drawings, the indicator/formula
platform, the multi-chart grid and compare. Its boundary rule is unusually strong — *"must not be
refactored inside TERMINAL-NEXT scope; mount `ChartPane`, never `StockChart`; treat the file as a
black box with a contract"*. **Composes on** S4 (a chart is the canonical context subscriber),
S1 (it is the panel the shell hosts), S2 (its frozen key-binding table is named as *the* seed for
the keyboard registry — `product-architecture.md:224`), S5 (the workspace document), S3, S8, S10,
S11, D3, D4, and S7's `indicator-condition` and `price-level` types. **Of those: S3, S8, S10, S11
exist; S4 and S5 do NOT; S1 and S2 exist only as the PROVISIONAL-SHIPPED palette slice
(`product-architecture.md:332-359`) whose foundations OI-06 was supposed to decide; S7's
`indicator-condition` is un-started and `price-level` is dark (`LEDGER.md:775-777`, `:1502`).**
**CP1 size: L** — and I do not believe a member-facing A2 CP1 exists that is not duplicative;
the smallest honest increment is a *contract*, not a surface (see the note in §4).
⭐ **What already exists:** the largest surface in the product. `/charts` (`App.jsx:530`) mounts
`ChartsWorkspace.jsx` (2,890 lines) hosting **20 widget types** — measured twice, from
`registry.js:152` and `WidgetHost.jsx:46`, which agree: chart, watchlist, themes, scanner,
fundamentals, breadth, indexes, marketcontext, aisearch, news, notebook, profile, alerts,
calendar, optionsflow, periodsort, nhnl, nhnlPulse, volumescan, scatter. Under
`app/src/pages/charts/` there are **180 non-test files**; `charts/widgets/` alone holds **54
non-test `.jsx` widget modules** (79 `.jsx` files including their tests).
`StockChart.jsx` is **17,297 lines**. `/theme-tracker`, `/watchlists` and `/multi-chart` are all
`LegacyRedirect`s into it (`App.jsx:531-533`). `/compare` (`:432`) and the formula routes
(`:548`, `:572`) are live. ⭐ **The panel-manifest primitive S1 is supposed to provide already
has a working instance here** — `product-architecture.md:327` says so explicitly: *"the
`WIDGET_REGISTRY` shape … adopt as the panel manifest; add `menus.terminal`."*

### A9 — Screening & Discovery

**What it is.** Per `product-architecture.md:706`: screener, scans, definitions, starter library,
concierge, candle library, lift ledger, the universe gate. It owns `CoverageLine`'s *evaluator*
(S8 owns the renderer) and is named as the DataGrid's first consumer. **Composes on** D2 (its
metrics are the addressable ones), S5 (saved screens as documents), S8 (the four-count receipt),
S10 (the grid), S3 (universe membership by entity), S12 (cohort), S11 (cadence), and S7's
`scan-membership-change`. **Of those: D2 exists AND — uniquely among the eight — actually covers
this application**, because all 137 addressed metrics are `store: screener_rows` (measured);
S8, S10, S3, S11, S12 exist; **S5 does not** (though `user_definitions.py`, which
`product-architecture.md:301` calls "the strongest persistence design in the repo", is its seed);
**S7's `scan-membership-change` is one of the four un-started types.** **CP1 size: M.**
⭐ **What already exists:** `/screener` (`App.jsx:538`) → `Screener.jsx` (92 lines) →
`pages/screener/shell/ScannerShell.jsx` (370 lines), with **14 non-test files** in
`pages/screener/` and **9** in `components/screener/`. ⚠️ Note the door has *moved* since
CLAUDE.md was written — it documents `/screener → SavedScreensPanel`; the tree says
`ScannerShell`. The nightly sweep is real and its artifacts are retained per session:
`scan_evaluator.sweep_job()` (`api/services/screener/scan_evaluator.py:2422`) writes through
`scan_store`, whose tables are keyed `(def_hash, tf, as_of)` — `scan_hits(def_hash, tf, as_of,
ticker, value)` and `scan_coverage` (`scan_store.py:179-183`, `:249`, `:263`, `:412`).

### A10 — Options & Flow

**What it is.** Per `product-architecture.md:709`: live tape, options-flow page, scoreboard, dark
pool, GEX/dealer positioning, implied move, chain and Greeks — *"owns the differentiator"*.
**Composes on** D3 (the OPRA transport), D4, D2 (flow metric addresses), S8 (the receipt that
must say a gap is permanent until T+1), S9 (the public-scoreboard exposure question, OQ-16),
S3, S10, S11, S12. **Of those: S3, S8, S10, S11, S12 exist; D2 does not reach any flow store;
D3 and D4 are not built as platform systems; S9 is not built.** **CP1 size: L.**
⭐ **What already exists — and the binding constraint is ownership, not absence.** Four live
routes: `/options-flow` (`App.jsx:576`, via `OptionsFlowRoute` at `:307`), `/live-massive`
(`:593`), `/flow-scoreboard` (`:599`), `/dark-pool` (`:607`). `OptionsFlow.jsx` is **9,692 lines**;
`DarkPool.jsx` is **3,606**; `app/src/pages/optionsFlow/` holds **17 non-test files**. Backend:
**42 modules** under `api/` whose names begin `flow_`, `massive_`, `liveflow`, `top_flow`,
`notable_flow` or `darkpool`. `GOVERNING_PRINCIPLES §5` and `product-architecture.md:135` put
`OptionsFlow.jsx`, `schwab_router.py`, `live_massive_router.py`, `massive_ws_worker.py` and
`massive_processor.py` **outside every boundary** — A10's architectural job is a wrapper, and
proposing a CP1 that renders flow is proposing to edit or duplicate partner-owned code.

### A11 — Breadth, Regime & Positioning

**What it is.** Per `product-architecture.md:712`: breadth monitor, live row and drills, Exposure
Rating, COT positioning rail and narratives, sector/RS, theme tracker, regime. It carries a
precondition no other application has — *"must resolve one boundary before anything else: two
regime classifiers exist … TERMINAL-NEXT names ONE regime authority."* **Composes on** D2 (its
metric registrations are the architecture's worked example), S8, S11, S10, S3, S12, D1, and
S7's `regime-change`. **Of those: S8, S11, S10, S3, S12, D1 exist; D2 exists but does NOT reach
breadth — `pct_above_50sma` is absent from all 137 entries (measured); `regime-change` is one of
the four un-started S7 types; and the one-regime-authority ruling has no LEDGER row.**
**CP1 size: M** (the ruling, not the code, is the long pole).
⭐ **What already exists:** `/breadth` (`App.jsx:529`) → `Breadth.jsx` (1,317 lines) with **five
member tabs plus one admin tab**, read from their single authority `resolveBreadthTabs(isAdmin)`
(`app/src/hub/sections/breadthSection.js:54-65`): Monitor · Views · Daily · COT Data · Data
Charts, + Analogues for admins. `app/src/pages/breadth/` holds **41 non-test files**;
`CotData.jsx` is 971 lines (its CFTC symbol roster: not measured); `ThemeTrackerPage.jsx` is 1,521 lines
(reached as the `themes` widget, since `/theme-tracker` redirects). Backend routers:
`breadth_monitor.py`, `cot.py`, `theme_engine.py`, `theme_index.py`, `theme_performance.py`,
`theme_sets.py`.

### A12 — Watchlists & Lists

**What it is.** Per `product-architecture.md:715`: lists, flagged, tags, notes, column presets,
digests. *"Lists are S5 saved objects and S2 nouns (`#watchlist` scope)"* — that one sentence
names both of A12's missing dependencies. It must not own its own DnD, its own column store, or
a second alert path (I3's delivery seam moves to S7). **Composes on** S5 (the list document), S2
(the `#watchlist` scope grammar), S3 (rows keyed by entity, not ticker string), S7 (`price-level`
replacing the legacy per-symbol alert), S8, S10, S12, S6 (column presets). **Of those: S3, S8,
S10, S12 exist; S5 does NOT; S6 does NOT; S2 exists only as the PROVISIONAL palette slice; S7's
`price-level` is CP1–CP3 merged but running DARK with no delivery (`LEDGER.md:1459`, `:1502`).**
**CP1 size: M.** ⭐ **This is the row the instruction warned about, and it is stranger than a
plain "it already exists".** `/watchlists` is a `LegacyRedirect` (`App.jsx:532`) and there is **no
Watchlists entry in the nav** — `NAV_ITEMS` (`app/src/components/NavBar.jsx:18-40`) has 16 entries
and none of them is watchlists. Yet `Watchlists.jsx` is **3,108 lines** with a **47,285-byte**
`Watchlists.module.css` and **nine** test files beside it. Its own header (`Watchlists.jsx:1-28`)
is the authority on why:

> *"This component has TWO modes and only ONE of them ships … UNSCOPED (`pickList` null) — the
> My Lists / Community tab bar, the Flagged + colour-tag groups, the multi-list stack … NONE of
> it can render. `/watchlists` was retired into /charts by 7640ef01 … **This is ~half the file.**"*

The live door is `charts/widgets/WatchlistWidget.jsx`, which always passes `pickList`, so a
widget is pinned to exactly one list; anything *across* lists lives in
`charts/widgets/WatchlistPicker.jsx`. Backend is fully mounted (`api/routers/watchlists.py`,
`ticker_tags.py`, `watchlist_alerts.py`; `watchlist_items` at `api/services/auth_db.py:78`,
`ticker_tags` at `:602`). ⭐ So A12 is simultaneously *live* (the per-list surface, inside
/charts) and *dead* (the across-lists surface, unreachable). A CP1 that ignores this would either
rebuild a working widget or resurrect ~1,500 lines the header says to delete in its own PR.

### A13 — Journal & Track Record

**What it is.** Per `product-architecture.md:718`: Journal 2.0 in full (accounts, positions,
trades, notes, notebook, broker mirror, Compass coaching record) plus the firm's track record,
and it is *"the per-ticker history join's consumer"* — `product-architecture.md:41` promotes it
from "an existing tab" to a first-class application precisely because the join is D-13's
top-ranked asset. **Composes on** D2 (the per-ticker history join is D2's deliverable, not
A13's), S5 (typed stores; A13's own store is excepted but the boundary is that nothing else
writes it), S3 (rows keyed by entity id going forward), S7 (`position-risk`), S8, S10, S11, S12,
I1 (through registered tools only). **Of those: S3, S8, S10, S11, S12 exist; D2 addresses zero
journal state — all 137 addresses are `screener_rows` (measured); S5 is not built;
`position-risk` is one of the four un-started S7 types.** **CP1 size: L.**
⭐ **What already exists:** the deepest estate of the eight. `/journal` (`App.jsx:618`) mounts
`JournalShellSelector` with **ten child routes** (`:619-634`) over **12 surfaces** in
`pages/journal-2-0/surfaces/` and **15 tabs**; `app/src/pages/journal-2-0/` holds **528 non-test
files**. Four further deep-link routes at `:637-640`. `api/services/journal_two/db.py` declares
**67 distinct `j2_*` tables** (measured by de-duplicated `CREATE TABLE IF NOT EXISTS` scan).
⚠️ **Journal 1.0 is gone from the tree** — `app/src/pages/journal/` does not exist, though
CLAUDE.md still documents it as seven tabs of live code. A plan written from that document would
target a directory that is not there.

### A14 — Portfolio & Risk

**What it is.** Per `product-architecture.md:720-721`: aggregate risk, scenario and factor
attribution presented as Past/Present/Future over existing regime and breadth data — and it is
the one application the architecture marks **"Not built now (PROVISIONAL / OWNER INPUT REQUIRED:
D8)"**, with the A13 boundary fixed now only so the deferral stays reversible. **Composes on**
A13 (position state, which A14 must never own), D2 (heat/exposure metrics registered by whoever
computes them today), S1 (it would be a new surface), S9 (who may see aggregate risk), S7
(`position-risk`), S8, S10, S11, S12. **Of those: S8, S10, S11, S12 exist; D2 does not address
any position or heat metric; S1 and S9 are the two owner-bound systems; `position-risk` is
un-started.** **CP1 size: M.** ⭐ **What already exists — and this is the sharpest finding of
the eight.** The *computation* is shipped: `api/services/portfolio_heat.py` (7,941 bytes) computes
risk-heat against the 10% aggregate cap, notional exposure against the regime ceiling, per-position
at-risk and by-sector concentration, and it detects broker placeholder stops. **It has no page.**
Zero of 91 routes match `portfolio|risk|heat` (control: 10 match `journal|breadth`). Its only
importers are assistant doors: `api/services/journal_two/coach_chat_tools.py:1672`,
`api/services/voice_tool_impls.py:1870`, `api/services/ai_search_personal.py:24`, and
`api/services/grade_watchlist.py:29-44`. ⭐ So A14 is the one system where *the product has the
answer and no door to it except by asking the assistant* — the mirror image of the other seven,
and a much cheaper problem than "build a portfolio system". It is still owner-bound on D8.

---

## 4. The three buckets

**BUILDABLE = 0 of 8.** I could not put a single one here honestly. Every candidate either has a
missing platform dependency I can name, or has a live surface such that a CP1 would be a second
authority over it, or both.

| bucket | system | reason — the specific missing dependency, or the specific existing surface |
|---|---|---|
| **BUILDABLE** | *(none)* | — |
| **GATE-ONLY** | **A1 Markets** | **Missing: D2** — no quote field is addressable (137/137 addresses are `screener_rows`), so an S8 receipt on a quote cannot cite a row. **And the surface exists**: `/dashboard` + 18 tiles + `/post-market` + `/research/:sym`'s OverviewTab + four mounted serving routes. A new Markets CP1 is a second authority over the quote strip. Secondary: D3/D4 unbuilt as systems. |
| **GATE-ONLY** | **A9 Screening** | **Missing: S7 `scan-membership-change`** (1 of the 4 un-started types). Everything else is present — uniquely, **D2 CP1 covers exactly this application's store**. **The surface exists**: `/screener` → `ScannerShell` (370 lines, 14+9 supporting files) and a nightly sweep whose per-session hits are retained. The honest CP1 is a trigger, not a page. |
| **GATE-ONLY** | **A10 Options & Flow** | **Missing: D3 and D4 as platform systems** (a subscriber-cap contract and a serving policy A10 can be held to), plus D2 for any flow metric. **And the surface exists at 9,692 + 3,606 lines across four routes and 42 backend modules — most of it partner-owned and outside every boundary.** A10's architectural job is a wrapper; a CP1 that renders flow proposes editing or duplicating partner code. |
| **GATE-ONLY** | **A11 Breadth & Regime** | **Missing: (i) the one-regime-authority ruling** the system's own block makes a precondition (two classifiers live), **(ii) S7 `regime-change`, (iii) D2 coverage** — `pct_above_50sma`, the architecture's own worked example, is absent from the book. **The surface exists**: `/breadth`, 5+1 tabs, 41 files, six routers. |
| **GATE-ONLY** | **A12 Watchlists** | **Missing: S5** (the list document has no typed store) **and S6** (column presets), with S2's `#watchlist` scope grammar owner-bound and S7 `price-level` still dark. ⭐ **And the surface is half-live in an unusual way**: the per-list widget ships inside `/charts`; the across-lists half of `Watchlists.jsx` — "~half the file" by its own header, so roughly 1,500 of its 3,108 lines — can render for nobody. Neither "build A12" nor "rebuild Watchlists" is the right move. |
| **GATE-ONLY** | **A13 Journal & Track Record** | **Missing: D2** — the per-ticker history join is D2's deliverable and D2 addresses zero journal state — **and S5**, plus S7 `position-risk`. **The surface exists at 528 files, 10 routes, 12 surfaces, 67 tables.** A CP1 here is a join, not a journal. |
| **BLOCKED** | **A2 Charts & Analytics** | Depends on **S1** (it is the panel the shell hosts; `WIDGET_REGISTRY` is explicitly named as the manifest seed) and **S2** (its key-binding table is explicitly named as the keyboard-registry seed) — both PROVISIONAL-SHIPPED ahead of **OI-06**, whose findings the owner ruled get diffed against what shipped. Also missing S4 and S5. **Say so and stop.** The only non-duplicative increment is a published `ChartPane` contract with no member-visible change, and even that pre-decides part of S1's manifest. |
| **BLOCKED** | **A14 Portfolio & Risk** | Owner-bound twice over: **deferred by D8** in its own block, and its only member-facing door would be a new surface — an **S1** surface-kind decision gated on OI-06 — gated by **S9**'s "who may see aggregate risk", whose numbers are owner-bound on OI-03(a)(b)/OI-12. **Say so and stop.** ⚠️ Record separately that `portfolio_heat.py` already computes the answer and is reachable only through assistant tools; that is a door problem, not a system, and it should not be smuggled in under an A14 CP1. |

**Counts: BUILDABLE 0 · GATE-ONLY 6 · BLOCKED 2.**

**Live member-facing surface today: 6 of 8** — A1 (`/dashboard`, `/post-market`), A2 (`/charts`),
A9 (`/screener`), A10 (`/options-flow`, `/live-massive`, `/flow-scoreboard`, `/dark-pool`),
A11 (`/breadth`), A13 (`/journal`). **A12 is a seventh, half-counted**: its per-list surface is
live inside `/charts` while its across-lists surface reaches no route — so "6 with a live page,
7 with a live surface, 1 with neither". **A14 alone has no member door of any kind.**

---

## 5. What I would build first, and why — ONE recommendation

> ### Build S7's `scan-membership-change` trigger type, for A9, for an admin `rollout:` cohort.

Not a page. Not a system. One trigger type, the fifth of eight, on the surface that already works.

**Why this one, against the alternatives:**

1. **It is the only candidate whose every platform dependency is genuinely present.** A9 is the
   single application D2 CP1 actually reaches — all 137 addresses are `store: screener_rows`
   (measured), which is A9's store and nobody else's. Every other GATE-ONLY row is blocked on D2
   coverage it does not have.
2. **The data it needs is already retained.** `scan_store` keys `scan_hits` on
   `(def_hash, tf, as_of)` (`api/services/screener/scan_store.py:179-183`), so yesterday's and
   today's membership both exist on disk. A membership *change* is a diff over two rows of a
   table the 05:00 sweep already writes — not a new pipeline.
3. **The pattern is proven four times.** `document-arrival`, `catalyst-match`, `event-proximity`
   and `price-level` have each gone through the same CP1/CP2/CP3 checkpoint sequence in this
   program (`LEDGER.md:77`, `:903-904`, `:1297`, `:1459`). A fifth instance is the lowest-variance
   work available, and the filing-watch parity rail already carries a control
   (`test_CONTROL_document_arrival_is_still_the_only_trigger_type_in_the_package`,
   `LEDGER.md:545`) that flips by design the day a new type lands.
4. **The cohort mechanism shipped four days of work ago and is proven in production.** S12's first
   migration put both S7 projections' cohorts onto `user_tags` `rollout:` rows and the swap was
   measured as a no-op (`LEDGER.md:781-796`; seed verified in production read-only, `:610`,
   `:621`). An admin-cohort CP1 needs nothing from S9.
5. ⭐ **Most importantly: it adds a capability no member has today rather than a second authority
   over one they use.** A member can define a scan and read tonight's hits; nobody can be told
   *"AMD entered your scan and MSFT left it."* Every other candidate on this list would build a
   second version of something already on screen.

**What it is explicitly not.** It is not "build A9 Screening". `/screener` is the product; the
CP1 registers a trigger type beside it. If the work starts producing a new results page, the
scope has failed.

**Sequencing note, not part of the recommendation.** The cheapest *separate* item on this list is
A14's door problem — `portfolio_heat.py` computes an answer with no page — but it is owner-bound
on D8 and should be raised as a question ("should the heat number have a door?"), never started
as a CP1.

---

## 6. What I could not measure

- **The tree's identity.** I was instructed not to run git commands, so I did not confirm this
  worktree equals `5ff6fc04a`. All measurements are facts about the working tree at
  `C:\Users\Patrick\uct-worktrees\s7-price-level`, whose branch name is `s7-price-level`, not
  `master`. **If that branch carries unmerged S7 price-level work, some A-series-adjacent counts
  could be ahead of master.** Not measured.
- **Runtime reachability.** Every "the surface exists" claim is a static read of routes, imports
  and mounts. I did not run the app, log in, or load a page. `Watchlists.jsx`'s unreachable half
  is asserted on its own header comment plus the `LegacyRedirect` at `App.jsx:532` and the absent
  nav entry — three static signals agreeing, but not an observation.
- **Whether any of the six live surfaces actually satisfies its A_n contract.** I measured that
  code exists and is routed; I did not audit whether `/breadth` honours S8's receipt rules or
  whether `/screener` keys rows by entity id. Those are per-system audits, each its own piece of
  work.
- **Production data.** No database was read. In particular I could not check how many members
  hold a `rollout:` tag beyond the 6 rows `LEDGER.md:621` records, nor how many scan definitions
  are live — both bear on the cohort size of the recommendation. Note this is the same class of
  gap the ledger already records for itself (`LEDGER.md:1059-1067`, a production
  `/data/catalysts.db` probe refused by tooling policy).
- **E1 People/Company Intelligence.** Out of the named roster; not measured, not bucketed.
