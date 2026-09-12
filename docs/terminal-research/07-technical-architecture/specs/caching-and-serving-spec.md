---
id: SPEC-D4-CACHING-AND-SERVING
title: D4 — Caching & Serving — Technical Specification
role: ratify the caching system that already exists, name its canonical shape, and size the adoption gap with a measured census. Not a design for a new cache — there is no new cache in this document.
phase: 3
group: technical-architecture
category: spec
scope: The tiers that exist today and their measured TTLs; which are authoritative and which derived; the two-tier live-prices pattern as the shape D4 generalises; a counted census of modules that fetch what a cache already holds or cache by request-set instead of per-key; five ranked adopters each with a concrete key; and the boundaries D4 must not cross.
status: DRAFT — evidence complete, NOTHING AUTHORIZED. Pairs with GATE-D4-CACHING-AND-SERVING, whose approval block is empty.
date: 2026-09-12
measured_against: origin/master @ 5ff6fc04a
pairs_with: GATE-D4-CACHING-AND-SERVING
---

# D4 — Caching & Serving — Technical Specification

## 0. What this document is, and what it is not

**D4 was never built as a named system. It already exists, in production, spread across five
tiers and a hundred and nineteen files, and it is under-adopted.** This specification ratifies
what is there and sizes the gap between the modules that use it and the modules that should.

It is not a design for a new cache. Every mechanism named below is running today; every claim
carries a `file:line` this pass read. Where a number appears, §3.1 says which script produced
it and what its controls were. Where a number could not be established, the words are
**not measured** — never an estimate.

⛔ **One deliberate omission.** No production hit-rate, miss-rate or memory figure appears
anywhere in this document. This session had no production access and the caches carry no
instrumentation that a static read can recover. See §6.

---

## 1. The tiers that exist, with measured TTLs

Five tiers, plus the durable stores underneath them. Read down: each row's value is derived
from the row below it.

| # | Tier | Where | Bound | TTL, as measured | Authoritative? |
|---|---|---|---|---|---|
| 1 | Browser IndexedDB (bars only) | `app/src/utils/barsIDB.js` | `INTRADAY_MAX_BARS = 3000` per entry on read (`:90`, applied `:218-220`) | Intraday: bar-data freshness vs the last closed session (`:205`). D/W/M: `DAILY_MAX_AGE_MS = 48h` (`:82`). Whole-store invalidation via `CACHE_LOGIC_VERSION = 7` (`:62`, enforced `:197`) | **DERIVED** |
| 2 | Process memory — the shared singleton | `api/services/cache.py:148` `cache = TTLCache()` | LRU `_MAX_SIZE = 1000` entries (`:23`), evicted in `set` (`:90-91`) | Per-entry, passed at every `set` (`:85`) | **DERIVED** |
| 3 | Process memory — dedicated instances | 26 modules construct their own `TTLCache(...)` (§3.2) | Per instance. `api/routers/live_prices.py:84` derives `CACHE_MAX_SIZE = _universe_size() * 2 + 1000` = **8,484** today (`api/data/cap_universe.json` holds 3,742 symbols, measured) | Per-entry | **DERIVED** |
| 4 | Disk, on the Railway volume | `api/services/bars_disk_cache.py:21` `<DATA_DIR>/bars_cache`; `api/services/ticker_meta.py:22` `<DATA_DIR>/ticker_meta_cache`; `api/services/ticker_logos.py:39` `<DATA_DIR>/logo_cache` | Filesystem | `bars_disk_cache.py:26-32` — 5m **7,200s** · 30m **14,400s** · 60m **28,800s** · D **172,800s** · W **259,200s**; default `14400` for an unlisted tf (`:92`). `ticker_meta.py:21` `_TTL = 86400`. The **deep** bars cache at `bars_disk_cache.py:35` has **no TTL at all** and says so (`:45`) | **DERIVED** |
| 5 | Durable snapshot of tier 2 | `api/services/cache_snapshot.py` | `MAX_VALUE_BYTES = 256 KiB` per entry (`:75`) | None of its own — it restores each entry with its **remaining** TTL, because `TTLCache` stores an absolute `expires_at` (`cache.py:111-131`; rationale `cache_snapshot.py:22-27`) | **DERIVED** |
| — | The stores underneath | SQLite on `/data` (`ohlcv`, `breadth_monitor`, `cot`, `catalysts`, `auth`), `/data/wire_data.json`, and the vendors themselves | — | — | **AUTHORITATIVE** |

### 1.1 Why every cache tier is DERIVED, stated rather than assumed

`bars_disk_cache.py:4-8` names its own position — *"1. In-memory TTLCache … 2. Disk cache here
… 3. Massive API"* — so the disk tier is a memo of the provider, not a record. `cache_snapshot`
is a memo of tier 2. `barsIDB` is a memo of `/api/bars`, and treats a logic-version mismatch as
**absent** rather than as data (`:197`).

⭐ **The one place this could go wrong is guarded in code.** `cache_snapshot` could have become
a second authority — a value that outlives the thing that computed it. It does not, because
`TTLCache` stores an absolute expiry and the snapshot restores the remainder: *"A deploy
therefore does not extend any value's life by even a second"* (`cache_snapshot.py:26-27`). That
one design choice is what keeps tier 5 a carry-over instead of a refresh.

### 1.2 The TTL distribution, counted

Over `api/services/**` and `api/routers/**`, excluding test modules, there are **247**
`<something>cache.set(...)` call sites. Every one passes a TTL — **zero** omit it.

- **67** pass an integer or float literal. Those 67 use **14 distinct values**, from **12s** to
  **604,800s** (7 days): `12·1 · 15·5 · 30·5 · 60·7 · 120·1 · 300·15 · 900·2 · 1800·3 ·
  3600·14 · 14400·2 · 21600·2 · 82800·2 · 86400·6 · 604800·2`.
- **180** pass a named constant or an expression (`_TTL`, `_CACHE_TTL`,
  `_CACHE_TTL.get(tf, 300)`, `max(60, int(ttl - age))`, `_TTL if all_answered else _FAIL_TTL`).
  Those 180 were **not resolved exhaustively** — see §6.

⛔ **There is no TTL policy.** The values above are per-module decisions, and the closest thing
to a shared rule is `api/services/cache_policy.py:29-57`, which does not set a TTL — it chooses
between two TTLs the caller supplies, on a completeness predicate the caller supplies. It is a
good primitive and it is used by two modules (`watchlist_performance.py:72`, and
`earnings_table.py`, whose implementation `cache_policy.py:3-4` names as the pattern it
generalises).

---

## 2. The canonical shape — `/api/live-prices`, and the failure it fixed

**This is the model D4 should generalise. Everything in §4 is an application of it.**

### 2.1 What it does

`api/routers/live_prices.py` serves a batch quote request for up to 250 tickers (`:30`) out of
**two** caches with **one** 15-second TTL (`:31`):

1. **Whole-set fast path** (`:584-589`). `whole_key = live_prices_{md5(sorted set)}`. A member
   polling an unchanged list every 2 seconds pays one dictionary lookup.
2. **Shared per-ticker cache underneath it** (`:591-601`). `live_px1_{TK}`, one entry per
   symbol, read on a tier-1 miss; only the symbols still missing are fetched (`:603`).

The second tier is the whole point. It is stated at the top of the file (`:8-11`): *"different
users' overlapping tickers reuse each other's fetches instead of each firing its own Massive
call (the old per-user cache-key fragmentation). One user fetching AAPL warms it for
everyone."*

### 2.2 The valve, and the re-check that makes it a valve

```
:609   acquired = _MASSIVE_SEM.acquire(timeout=_SEM_WAIT_S)     # Semaphore(6), 8.0s  (:94-95)
:612-620   # herd collapse — re-read every missing key AFTER the wait
:621-629   # fetch only what is STILL missing; write each into live_px1_{TK}
:630-631   # not acquired within the wait: serve what the cache gave us, add no call
:633-634   _MASSIVE_SEM.release()
```

⭐ **The re-check at `:612-620` is the load-bearing half and it is easy to omit.** A semaphore
alone serialises the herd; it does not shrink it. Without the re-read, 200 browsers resuming a
poll after a deploy queue up six at a time and each one still fires its own upstream fetch — the
same total call volume, spread over a longer wall clock. With it, the first holder fills the
per-ticker keys and every waiter behind it finds them warm and fetches nothing.

⛔ And the shed at `:630-631` is deliberate: when the valve cannot be acquired in 8 seconds the
request returns **whatever the cache had** rather than adding another call to a saturated
upstream. A totally empty result — no cache, no fetch, no breadth pseudo-tickers — is the only
503 (`:645-646`).

### 2.3 The failure it fixed: the post-deploy cold herd, and the 2026-07-01 524 class

The mechanism is documented in the source, in two places that agree:

- `api/routers/live_prices.py:13-16` — *"after a deploy clears the cache, 200 browsers resuming
  their 2s polls would otherwise fan out to ~200 simultaneous Massive fetches and exhaust the
  shared threadpool (the launch-day 524 scenario)."*
- `api/services/cache.py:14-22` — the second, subtler instance of the same class. The LRU bound
  used to be read module-wide inside `set()`, so it capped the dedicated live-prices instance
  too. *"Above ~970 distinct tickers that cache thrashed permanently (31.7% miss / ~3.1k
  upstream fetches per 2s poll round at 200 users × 50 tickers), which funnels into
  `live_prices._MASSIVE_SEM` and reproduces the launch-day 524 from a different direction."*

⭐ **That second instance is the most instructive thing in the whole system.** The two-tier
design was correct and shipped, the per-ticker keys were genuinely shared, and the pattern still
failed — because a bound belonging to a *different* cache silently applied to this one. The fix
was not a bigger global bound (which would have changed the memory profile of the singleton that
caches MB-scale bars payloads, `cache.py:56-58`) but an instance stating its **own** bound from
its **own** working set: `_universe_size() * _KEYS_PER_TICKER + _SET_KEY_HEADROOM`
(`live_prices.py:59-84`), with `_universe_size()` refusing to shrink below a floor if
`cap_universe.json` is unreadable (`:76-79`).

### 2.4 The shape, stated as four rules

Any surface adopting D4 satisfies all four, or it is not this pattern:

1. **The per-entity key is the real cache.** One entry per entity, shared across every member.
2. **The request-set key, if present, is a fast path over the per-entity cache** — never the
   only cache, and never the thing that gets refilled on a miss.
3. **A valve caps concurrent upstream calls, and re-checks the per-entity keys after acquiring
   it.** The re-check, not the semaphore, is what collapses the herd.
4. **The instance states its own bound when its working set is knowable.** A shared default is
   a default, not a ceiling (`cache.py:14-22`).

### 2.5 What live-prices does NOT do, and shouldn't be copied

Two whole-market close maps live in **module state**, not in the TTLCache, and the reason is
written down (`live_prices.py:101-107`): they are two entries whose payload dwarfs every other
key in that instance combined, so two LRU slots holding ~24k rows would be *"a size-blind bound
pretending to be a memory bound."* Correct — and it means **`TTLCache`'s bound is an entry
count, never a memory bound.** Any D4 policy that claims to bound memory is claiming something
this implementation cannot deliver.

---

## 3. THE CENSUS

**This is the evidence.** Everything above describes a shape; this measures how much of the
codebase is outside it.

### 3.1 Method, and the four times it was wrong before it was right

**One script, `ast` over `api/services/**` and `api/routers/**` at `5ff6fc04a`.** Comments and
docstrings never become `ast.Call` nodes, so the scan structurally cannot match its own
documentation — the "strip comments before you grep" rule is satisfied by not grepping. Test
modules (`test_*.py`, `*_test.py`) and files that fail to parse are skipped and counted: **158**
skipped, **158** files carrying at least one measured call (140 services, 18 routers).

**A call is DIRECT NETWORK EGRESS** when it is not a regex/sqlite/qrcode constructor and either
(a) its receiver's leftmost name is `requests` / `httpx` / `urllib` / `yf` / `yfinance` /
`aiohttp` with an HTTP verb, or (b) its callee tail is an HTTP verb and its first positional
argument or `url=` kwarg is — directly, or after resolving a name assigned exactly once in the
same function or at module scope, or after folding a single-assignment string constant
interpolated at the head of an f-string — a string whose literal text **starts with**
`http://` or `https://`.

**A call is a CACHE OP** when the receiver's dotted tail ends in `cache` (case-insensitively)
and the method is one of `TTLCache`'s public methods.

**A key is PER-SET** when the resolved key expression contains `.join(` / `md5(` / `sha1(` /
`sha256(` / `sorted(` — i.e. it is built from a collection. Otherwise PER-KEY.

⛔ **Four versions of these rules were wrong, and each was caught by a control rather than by
review. They are recorded because the corrections are the reason to trust the final numbers:**

| # | What the rule did | How it was caught |
|---|---|---|
| 1 | Counted **132** dict `s.get("key")` reads as network calls (`s`, `client`, `session` were in the receiver allow-list) | Reading the label histogram: `s.get` was the single most common "network call" in the repo |
| 2 | Reported **zero** per-set keys in `live_prices.py` — the file the pattern is named after | A **positive control** asserting that file must yield at least one. The key is passed as the bare name `whole_key`; the fix is single-assignment name resolution |
| 3 | Counted an email HTML template, four sqlite `file:` URIs, a TOTP `otpauth` URI and five compiled **regexes** containing `https` as egress | **Negative controls** on `email_service.py`, `totp_service.py`, `screener/dividend_join.py`, `tweet_store.py`, each of which must read 0 |
| 4 | Reported **48** modules with "zero cache ops" — including `stocktwits_sentiment.py`, `sec_filings.py` and `implied_store.py`, which own a `TTLCache`. The receiver test was **case-sensitive**, so `_CACHE.get(...)` matched nothing | Cross-checking the uncached list against the independent TTLCache-construction census, which listed the same files as cache **owners** |

**Controls standing at the final run** — every one of these is in the script and passes:

```
POS massive.py egress                                     = 16   (primary market-data adapter)
POS routers/live_prices.py egress                         = 2    (grouped-aggs https URL)
POS routers/live_prices.py cache ops                      = 8
POS live_prices PER-SET keys       = ["f'live_prices_{hashlib.md5(sorted_key.encode()).hexdigest()}'"]
POS live_prices PER-KEY keys       = ['_exvol_key(t)', '_exvol_key(ticker)', '_px_key(tk)']
NEG services/cache.py egress                              = 0
NEG email_service.py egress (HTML template)               = 0
NEG totp_service.py egress (otpauth URI)                  = 0
NEG screener/dividend_join.py egress (sqlite file: URI)   = 0
NEG tweet_store.py egress (compiled regex)                = 0
```

⭐ **Every absence claim below rests on those positives.** "Zero unanchored prefix deletes" is
worth something only because the same scan found 21 prefix-delete call sites; "5 entity-keyed
uncached modules" is worth something only because the entity discriminator finds 6 in
`massive.py` and 1 in `sec_filings.py` and correctly finds **0** in `youtube_client.py` while
still seeing its 7 egress sites.

⛔ **One discriminator was measured and thrown away.** "Is this module reachable from a router?"
was computed first, by AST import-graph walk from every module under `api/routers/**`. It
reaches **961 of 1,210** api modules. It separates nothing, so it is not used
(`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`). It is recorded here so nobody
re-derives it and treats the answer as signal.

### 3.2 The headline numbers

| Measurement | Count |
|---|---|
| Cache operations (`get`/`set`/`invalidate`/`delete_prefix`/…) | **581**, across **119** files |
| …of which the key resolves to a **PER-SET** expression | **9**, across **6** files |
| …of which the key is an unresolved bare name (**not measured**) | 28 |
| Distinct literal key templates | **150** — **25** use a `::` namespace separator, **125** use `_` or none |
| Distinct literal key prefixes | **132** |
| Files importing the shared singleton `api.services.cache.cache` | **82** |
| Files constructing their **own** `TTLCache(...)` | **26** (including `cache.py` itself) |
| Files binding a module-level bespoke dict named `*cache`/`*memo` | **14** |
| Direct network-egress call sites | **137**, across **67** files |
| …under `api/services/**` | **124** sites, across **61** files |
| **`api/services` modules with egress and ZERO cache ops** | **37** (70 egress sites) |
| …of those, whose URL is **entity-keyed** (interpolates ticker/symbol/sym/cik/isin/figi) | **5** |
| `cache.delete_prefix` call sites | 21 |
| …that are **not** separator-anchored (the over-match hazard) | **0** |

**THE HEADLINE: 581 cache operations, 132 key prefixes, 26 cache instances, and no policy over
any of it — while 37 service modules reach the network with no cache at all.**

### 3.3 The exact-key vs prefix hazard — measured clean, and why the number is not zero by luck

`cache.delete_prefix(prefix)` (`cache.py:133-144`) removes **every** key starting with `prefix`.
The earnings-table key is `f"earnings_table::{ticker}"` (`earnings_table.py:586`) with **no
trailing separator**, so `delete_prefix("earnings_table::A")` would wipe `earnings_table::AAPL`,
`::AMD`, `::AMZN` — a self-heal for one ticker silently evicting a hundred others.

All 21 call sites were enumerated by AST. Every entity-scoped one is separator-anchored:

- `earnings_table.py:655` and `:671` invalidate the **exact** key — `cache.invalidate(f"earnings_table::{s}")`.
- `earnings_table.py:674` and `fundamentals_monitor.py:452` use `delete_prefix(f"mb_year_earnings_{s}_")` — anchored, and it *must* be a prefix because it spans the per-year suffix. The reason is written at `fundamentals_monitor.py:450-451`.
- `bars_fetch.py:224`, `bars_reconciliation.py:237` and `routers/bars.py:1335-1339` all anchor on a trailing `_`.
- The remainder (`'bars_'`, `'breadth_history_'`, `'theme_index::'`) are whole-family wipes, which is what they intend.

⭐ **This is a discipline currently held by comments, not by code.** Nothing prevents the 22nd
call site from passing an unanchored entity prefix, and the failure would be a silent
over-eviction — extra upstream load, never an error. A D4 that does one thing could make the
key shape enforce it.

### 3.4 The fragmentation table — every PER-SET cache key in the codebase

Nine cache operations across six modules build a key from a collection. This is the whole
population, not a sample.

| # | Module | Key it uses today | Shape | TTL | What it fetches inside the miss |
|---|---|---|---|---|---|
| 1 | `api/services/watchlist_performance.py:47` | `wl_perf:{md5(",".join(sorted deduped tickers))}` | **PER-SET** | 300s ok / 30s partial (`:19-20`) | `_fetch_ticker_returns(t)` per ticker, 2-worker pool (`:54-59`) — **the inner call is already per-ticker** |
| 2 | `api/services/theme_performance.py:889` (get) / `:924` (set) | `theme_ts_extra::{",".join(sorted ts_keys)}` | **PER-SET** | `_LIVE_1D_TTL = 10s` (`:61`) | `get_agg_bars(s, from, to)` in a per-symbol loop (`:902-907`) — **already per-symbol** |
| 3 | `api/services/polygon_extras.py:146` (get) / `:178` (set) | `pgxidx::{",".join(resolved index symbols)}` | **PER-SET** | `_TTL_INDICES = 30s` (`:31`) | One `/v3/snapshot/indices` call with `ticker.any_of` (`:152-155`) — the provider **is** batch here |
| 4 | `api/services/groups.py:217-218` | `",".join(sorted normalized syms)` into the bespoke dict `_TODAY_CACHE` (`:50`) | **PER-SET**, and outside `TTLCache` entirely | `_TODAY_CACHE_TTL = 20s`, hand-checked at `:219`, hand-evicted at `:233-235` | `massive.get_etf_snapshots(norm)` (`:223-225`) |
| 5 | `api/routers/live_prices.py:587` (get) / `:648` (set) | `live_prices_{md5(sorted set)}` | **PER-SET — correctly**, as a fast path over `live_px1_{TK}` (`:597`, `:628`) | 15s (`:31`) | Nothing. A miss falls through to the per-ticker tier, which is the point |
| 6 | `api/services/discord_interactions.py:1770` | `{ticker}:{tf}:{style_sig}[:{to}][:vs:{"+".join(compare)}][:dp]` | **PER-SET by construction** | `cache_ttl_for(req.tf)` (`:1780`) | A rendered PNG of N tickers — has no per-key decomposition, and this row is here so nobody "fixes" it |

⛔ **Rows 1, 2 and 4 are the anti-pattern in its exact form**, and rows 1 and 2 are the clearest
cases in the codebase: the per-set key wraps a loop that is *already* iterating per entity. Two
members whose watchlists share 40 of 50 names share **nothing**; the 41st distinct list is a
41st full recompute of 50 tickers. Row 5 is the same *shape* used correctly, twelve files away.

⭐ **Row 3 is the honest counter-example and it is why "per-set is bad" is the wrong rule.**
`polygon_extras` sends one request carrying every symbol; splitting the key per index would turn
one provider call into up to ten. The correct rule is the one in §2.4: a set key is fine as a
fast path, and wrong as the only cache.

### 3.5 Uncached network egress — 37 modules, 5 of them entity-keyed

Of the 61 `api/services` modules with direct egress, **37** perform no cache operation of any
kind. Most are not caching candidates and saying so is the honest answer: they post to Discord,
upload to YouTube, refresh an OAuth token, or run a one-shot scheduled ingest. Nobody is waiting
on them and a cache would hold nothing anyone reads twice.

The discriminator that separates the candidates is whether the URL is **entity-keyed**. Five
are:

| Module | Entity sites / total | Entity name in the URL | Note |
|---|---|---|---|
| `api/services/ticker_logos.py` | 1 / 14 | `sym` | Has a **disk** cache (`:39` `<DATA_DIR>/logo_cache`) — so it caches, just not in a tier D4 can see or bound |
| `api/services/news_aggregator.py` | 1 / 3 | `sym`, `limit_per_ticker` | Per-symbol news pull |
| `api/services/earnings_audio.py` | 2 / 2 | `sym` | Both egress sites are per-symbol; provider-gated (`EARNINGS_AUDIO_PROVIDER`) |
| `api/services/news/adapters/sec_news.py` | 1 / 2 | `cik` | Per-filer |
| `api/services/cot_prewarm.py` | 1 / 1 | `ticker` | Scheduler-driven; a cache here buys little |

⚠️ **This is a floor, not a total.** The entity discriminator reads four signals (f-string
interpolations, `.format()` kwargs, `{placeholder}` tokens in a plain template, and
`params=`/`json=`/`data=` dict keys) and an entity threaded some other way is missed. Its own
positive control on `sec_filings.py` failed at one signal and passed at four — which is how the
other three signals came to exist.

### 3.6 What the census says, in one sentence

**The codebase has one good caching pattern, applied in one place, and 26 independent cache
instances plus 14 hand-rolled dictionaries that have never been asked to agree with each
other.** D4 is not a missing cache. It is a missing *convention* over caches that already work.

---

## 4. The next five adopters

Ranked. Each row names the module, the size, and the **exact key it would use**. A row without a
concrete key is not a row.

### 1 — `api/services/watchlist_performance.py` · size **S** · **rank 1**

**Key:** `wl_returns::{TICKER}::{as_of_date}`
*(as_of_date = the ET session date the returns are computed against; the 5-minute TTL stays for
the intraday leg, the date segment makes a settled session's row self-expiring rather than
merely stale.)*

**Why first.** It is the pattern's exact inverse, and the transformation is mechanical: the
function that computes one ticker's returns already exists and already takes one ticker
(`_fetch_ticker_returns(ticker)`, `:27-35`). The per-set key at `:47` wraps a loop over exactly
that function (`:54-59`). Moving the key inside the loop is the whole change; the outer
`wl_perf:` key can survive as a fast path exactly like `live_prices_{md5}` does.
Sharing is total — every member's watchlist overlaps every other member's on the liquid names.

⭐ It also inherits a correctness improvement for free. Today one failed ticker forces the
**whole batch** to the 30-second partial TTL (`:67-73`); per-key, the failure is confined to the
ticker that failed and its 49 healthy peers keep the 5-minute TTL.

⛔ It is **not** in flow-worker's import closure (§5.4), which is why an S sits first.

### 2 — `api/services/theme_performance.py::live_returns_for_syms` · size **S** · **rank 2**

**Key:** `theme_ts_extra::{TS_KEY}` — where `TS_KEY` is `_ts_key(sym)`, the normalisation the
module already uses to build the joined key at `:889`.

**Why second.** Identical shape to rank 1, identical inner loop (`get_agg_bars(s, …)` per symbol
at `:904`), and the key is *already* namespaced with `::` and *already* built from `_ts_key`, so
the per-key spelling is the joined spelling with the join removed. The 10-second TTL (`:61`)
means the fragmentation costs a full per-symbol bar fetch every ten seconds per distinct
off-taxonomy set a member has added.

⚠️ Ranked second, not first, because the module is in flow-worker's import closure and unwatched
(§5.4) — the change is smaller than rank 1 but the merge is not.

### 3 — `api/services/groups.py::_TODAY_CACHE` · size **S** · **rank 3**

**Key:** `groups_today::{TICKER}` — in the shared `TTLCache`, replacing the module-level dict at
`:50`.

**Why third.** This is the cleanest deletion in the list: a bespoke dict with a hand-rolled TTL
comparison (`:219`), a hand-rolled eviction sweep (`:233-235`) and a hand-rolled 256-entry bound
— all three of which `TTLCache` already provides, correctly, under a lock (`cache.py:57`,
`:74-91`). It fetches `massive.get_etf_snapshots(norm)` per set (`:224`), and the snapshot map
it returns is already keyed by symbol, so the split is a dict comprehension.

⭐ Ranked third rather than first because it is the only one of the five that **deletes** a
mechanism rather than adding one, and a deletion in a module flow-worker runs (§5.4) deserves to
go after the two that do not touch it.

### 4 — `api/services/fundamentals.py` + `api/services/earnings_table.py` · size **M** · **rank 4**

**Key:** `fundamentals::{TICKER}::{period}` — `period ∈ {quarter, annual}`, joining the existing
`earnings_table::{ticker}` (`earnings_table.py:586`) under one namespace instead of beside it.

**Why fourth, and why M.** The key is already per-ticker, so this is not a fragmentation fix — it
is the **namespace** fix, and it is the row that pays for §3.3. `earnings_table::{ticker}` has no
trailing separator, which is precisely the shape that makes `delete_prefix` unsafe; adding the
`::{period}` segment gives every family member an anchored prefix and makes
`delete_prefix("fundamentals::AAPL::")` correct by construction rather than by comment. It is M
because it touches the self-heal path (`fundamentals_monitor.py:439-455`), the
stale-while-revalidate serve path (`earnings_table.py:693-720`) and the disk snapshot behind
both.

⛔ Neither file is in flow-worker's closure (§5.4).

### 5 — `api/services/ticker_logos.py` · size **M** · **rank 5**

**Key:** `ticker_logo::{TICKER}::{source}` — `source ∈ {logodev, parqet, fmp, finnhub,
clearbit, miss}`, mirroring the resolution order the module already walks.

**Why fifth.** It is the clearest case of a tier D4 cannot see: 14 egress sites, no `TTLCache`
op, and a **disk** cache at `<DATA_DIR>/logo_cache` (`:39`) with a `.miss` sidecar (`:76`)
carrying its own negative-caching semantics. Nothing bounds it, nothing expires it, and no policy
reaches it. Bringing the *resolution decision* (which source answered, or that all of them
missed) into the addressed tier — while leaving the PNG bytes on disk where they belong — is what
makes the tier legible.

⚠️ **M, and the honest reason: the negative cache is the hard part.** A logo that genuinely does
not exist must not be re-resolved through five providers on every request, and a logo that was
temporarily unavailable must not be pinned as absent. That is exactly the distinction
`cache_policy.set_by_completeness` (`cache_policy.py:29-57`) exists to draw, which is what makes
this an adopter rather than a rewrite.

### 4.1 Ranking rationale, in one table

| Rank | Module | Size | Ranked here because |
|---|---|---|---|
| 1 | `watchlist_performance` | S | Largest sharing win per line changed; inner function already per-ticker; outside flow-worker's closure |
| 2 | `theme_performance` | S | Same transformation, key already namespaced; inside the closure, so it merges harder |
| 3 | `groups` | S | Deletes a hand-rolled cache rather than adding one; inside the closure |
| 4 | `fundamentals`/`earnings_table` | M | Buys the prefix-safety property for the whole family; touches self-heal and SWR paths |
| 5 | `ticker_logos` | M | Makes an invisible disk tier addressable; blocked on getting negative caching right |

---

## 5. What D4 must NOT become

### 5.1 Not a second authority over any value

A cache entry is a memo of something that has an owner. The moment a D4 tier is the only place a
value exists, it stops being a cache and becomes an undocumented database with an eviction
policy. The system already gets this right in the one place it would be easiest to get wrong:
`cache_snapshot` persists to `/data` and still refuses to extend any value's life, because it
restores the **remaining** TTL off an absolute `expires_at` (`cache.py:111-131`,
`cache_snapshot.py:22-27`).

⛔ Concretely: D4 never becomes the place a computed value is *published*. `/api/push` writes
`/data/wire_data.json` and seeds the cache from it; the file is the authority and the cache is
the memo. That direction is not negotiable.

### 5.2 Not a place for correctness guards

**`cache.py`'s LRU bound is a cache. `sync._locks` is a correctness guard. They look alike and
they are not alike.**

- The LRU bound (`cache.py:23`, evicted at `:90-91`) decides how much to *keep*. Evicting the
  wrong entry costs a refetch. Nothing is wrong afterwards.
- `api/services/journal_two/broker/sync.py::_locks` is a per-account `asyncio.Lock` — the
  idempotency guard against two concurrent syncs of one brokerage account. Dropping an entry
  from it does not cost a refetch; it costs a double-import.

⛔ **Do not move a correctness guard into a D4 tier because the data structure fits.** A guard
that can be *evicted* is not a guard. The repo already enumerates its per-process guards —
`sync._locks`, `recent_orders._last_poll` (a contractual ≤1 poll/5min/account),
`manual_refresh._last_trigger` (BILLED calls), `notifications._failure_pinged` — and it also
shows the correct answer when a repeat is genuinely costly: a durable table
(`j2_broker_member_stale_notify`, `j2_broker_digest_dedup`), not a cache.

⚠️ The same test separates the 14 bespoke dicts in §3.2. `groups._TODAY_CACHE` is a **cache** and
belongs in §4 rank 3. A dedup set that must not lose a member is **not**, and putting it in a
TTLCache would be this defect.

### 5.3 Not multi-instance state while the web pod is one uvicorn process

The web pod is one uvicorn process — one event loop, one anyio threadpool — and it is that way
on purpose: SSE and live-price state are in-process, so multi-worker is unsafe. Every tier in §1
except tiers 4 and 5 is therefore **per-process**, and correct only because there is one process.

⛔ **D4 must not encode an assumption that survives scale-out, and must not pretend to solve
it.** Two specific prohibitions:

1. **No cross-instance invalidation protocol.** `delete_prefix` on one pod would be a no-op on
   the other, and a coherence protocol built now would be a design against an architecture that
   does not exist, validated by nothing.
2. **No shared-cache dependency for correctness.** If a second instance would produce a wrong
   answer rather than a slower one, the thing depending on the cache was a correctness guard
   (§5.2) and is in the wrong tier.

⭐ The honest posture: D4 makes the single-process assumption **legible** — every tier in §1 says
which process owns it — so that the day scale-out is real, the list of things to fix is a
document rather than an archaeology project.

### 5.4 Not a change that strands flow-worker without saying so

Measured this pass with `tools/flow_worker_watch_coverage.py` at `5ff6fc04a`, not guessed:

- `reachable_paths()` — the AST import closure from `api/flow_worker_main.py` — is **154** api
  modules. ⚠️ The tool's own header says **162**; today it measures 154. Read the function, not
  the header.
- `watched_paths()` — what actually triggers a flow-worker redeploy — is **24** patterns.
- **21** modules are both reachable and watched. **133** are reachable and **not** watched: code
  flow-worker *runs* and will *not* redeploy for.

| Module | flow-worker RUNS it | flow-worker REDEPLOYS for it |
|---|---|---|
| `api/services/cache.py` | **yes** | **no** |
| `api/services/cache_policy.py` | **yes** | **no** |
| `api/services/theme_performance.py` | **yes** | **no** |
| `api/services/groups.py` | **yes** | **no** |
| `api/services/rs_ranking.py` | **yes** | **no** |
| `api/services/massive.py` | **yes** | **no** |
| `api/services/bars_disk_cache.py` | **yes** | **no** |
| `api/services/ticker_meta.py` | **yes** | **no** |
| `api/services/sec_filings.py` | **yes** | **no** |
| `api/services/watchlist_performance.py` | no | no |
| `api/routers/live_prices.py` | no | no |
| `api/services/fundamentals.py` | no | no |
| `api/services/earnings_table.py` | no | no |

⛔⛔ **`api/services/cache.py` — the file D4 is about — is run by flow-worker and is not on its
watch list.** Any edit to `TTLCache` itself leaves flow-worker executing the previous definition
until some unrelated push happens to touch a watched file. That is the single most important
operational fact in this specification, and it is why §4 ranks two closure-free modules ahead of
three smaller ones.

---

## 6. Not measured

Stated rather than estimated.

1. **Hit rate, miss rate, or eviction rate of any tier, in production or anywhere.** No tier
   carries a counter a static read can recover, and this session had no production access. The
   31.7% / 68.7% figures quoted in §2.3 are what `cache.py:14-22` records about a **past**
   configuration; they are not a current measurement and must not be re-used as one.
2. **Memory footprint of any cache instance.** `TTLCache`'s bound is an entry count, not bytes
   (§2.5). Nothing in the codebase measures the bytes.
3. **The TTL behind 180 of the 247 `cache.set` sites.** They pass a named constant or an
   expression; 67 literals were resolved, the rest were not resolved exhaustively.
4. **The key shape of 28 cache operations.** Their key argument is a bare name not assigned
   exactly once in the enclosing scope, so the resolver declines rather than guessing. They are
   neither counted as PER-SET nor as PER-KEY.
5. **Whether `CACHE_SNAPSHOT_ENABLED` is set in production.** The code default is `"1"`
   (`cache_snapshot.py:69`); the Railway value was not read. A flag's state is not inferable from
   its default.
6. **Whether the entity-keyed uncached list (§3.5) is complete.** It is a floor produced by a
   four-signal discriminator; an entity threaded through a path none of the four sees is missed.
7. **The frontend's own cache surface beyond `barsIDB`.** `localStorage` keys, SWR's in-memory
   deduplication and the prefetch queues were not censused; this document's tier 1 is bars only.

---

## SOURCES

Read directly this pass, at `origin/master @ 5ff6fc04a`:

- `api/services/cache.py` (whole file, 149 lines)
- `api/routers/live_prices.py` (docstring, capacity block `:34-95`, helpers `:100-260`, handler `:555-660`)
- `api/services/bars_disk_cache.py` (`:1-100`)
- `app/src/utils/barsIDB.js` (`:14-100`, `:185-232`)
- `api/main.py` (`:925-1100` warm-on-boot, `:1147-1200` RS re-warmer, call sites `:3371`, `:3412`)
- `api/services/rs_ranking.py` (`:26-27`, `:155-254`)
- `api/services/cache_snapshot.py` (`:1-125`)
- `api/services/cache_policy.py` (`:1-57`)
- `api/services/earnings_table.py` (`:30-32`, `:586-720`)
- `api/services/fundamentals_monitor.py` (`:438-456`)
- `api/services/watchlist_performance.py` (whole file, 74 lines)
- `api/services/theme_performance.py` (`:56-72`, `:865-925`)
- `api/services/polygon_extras.py` (`:28-31`, `:135-180`)
- `api/services/groups.py` (`:48-50`, `:205-236`)
- `api/services/ticker_meta.py` (`:15-45`)
- `api/services/ticker_logos.py` (`:1-80`)
- `api/services/sec_filings.py` (`:23-45`, `:130-145`)
- `api/services/discord_interactions.py` (`:1758-1790`)
- `api/services/massive.py` (egress sites, enumerated by AST)
- `tools/flow_worker_watch_coverage.py` (`:1-60`, `:120-150`; `reachable_paths` and
  `watched_paths` executed against this tree)
- `api/data/cap_universe.json` (length only: 3,742)

Scripts written to produce §3, kept in the session scratchpad, each carrying its controls in
source: `d4_census4.py` (egress + cache ops + key shape), `d4_entity.py` (the entity
discriminator and its four signals), `d4_tiers.py` (singleton vs own-instance vs bespoke),
`d4_reach.py` (the router-reachability discriminator that was measured and discarded).
