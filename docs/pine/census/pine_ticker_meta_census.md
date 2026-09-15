# Item (h) — stale `ticker_meta`, and `BF.B`

Instrument: `tools/pine_ticker_meta_census.py` · run as `python tools/pine_ticker_meta_census.py`
from the worktree root. Read-only: no network, no server, no vendor call, no write
outside stdout. **Nothing under `C:\data` was read or written.**

---

## PART 1 — what `ticker_meta` is

### The store: THREE caches with THREE different horizons, and the longest one is the browser's

| layer | where | TTL | key | evidence |
|---|---|---|---|---|
| in-process memory | `TTLCache()` | 24 h (`_TTL = 86400`) | `tmeta_<TICKER>` | `api/services/ticker_meta.py:20`, `:21`, `:187` |
| disk (persistent volume) | `$DATA_DIR/ticker_meta_cache/<TICKER>.json` | 24 h | filename | `api/services/ticker_meta.py:22`, `:25` |
| **browser localStorage** | `tmeta:<SYM>` | **7 days** (`LS_TTL`) | symbol | `app/src/hooks/useTickerMeta.js:18-19`, `:21-46` |

⛔ **THE BROWSER LAYER IS THE ONE THE PINE FOLD READS FIRST.** `useTickerMeta` seeds SWR's
`fallbackData` from localStorage synchronously (`useTickerMeta.js:107`, `:113`), so the
first frame after a reload binds against a row that may be up to **seven days old** while
the server's own contract is 24 hours. SWR revalidates in the background
(`revalidateIfStale: true`, `useTickerMeta.js:116`), so the stale value is transient — but
it is the value present at bind time, and bind time is when `symbolConstantsWith` decides
whether `syminfo.prefix` / `syminfo.tickerid` resolve at all.

### Who writes it

| writer | file:line | kind |
|---|---|---|
| `_base_meta` (the only writer of a row) | `api/services/ticker_meta.py:182`, persists at `:249` via `_disk_put` (`:40`) | request-path, lazy |
| `ticker_names_prewarm` — **background daemon thread, whole `cap_universe`, once per boot** | `api/services/ticker_names_prewarm.py` (calls `_base_meta` at `:154`); scheduled `api/main.py:4337-4344` | prewarmer |
| `ticker_search` autocomplete backfill — bounded 2-worker pool, fire-and-forget | `api/routers/ticker_search.py:105-119`, enqueued at `:199`, `:206` | background |
| `heal_nameless_names` — one-shot flag-gated daemon thread | `api/services/ticker_meta.py:287`, thread at `:345`, flag `:284` | one-shot repair |
| `_name_from_cache` promotes a disk row into memory | `api/routers/ticker_search.py:86` | cache promotion |

⚠️ **`heal_nameless_names` REWRITES A ROW WITHOUT ITS `exchange` FIELD**
(`api/services/ticker_meta.py:329-333` — the `merged` dict names only `name`, `sector`,
`industry`). That is `lesson_a_projection_drops_what_it_does_not_name` again, in the
writer this time. It is **self-limiting rather than harmless**: `_base_meta:195` treats a
disk row with no `exchange` KEY as stale and refetches, so the damage is repaired on the
next read. It is also flag-gated one-shot (`:300`), so on a pod whose
`$DATA_DIR/.ticker_meta_name_heal_v1` already exists it never runs. I did not check
whether that flag exists in production — that would mean reading the live volume.

### Who reads it

| reader | file:line | on the Pine/chart-engine path? |
|---|---|---|
| `GET /api/ticker-meta/{ticker}` | `api/routers/ticker_meta.py:12-18` | **YES — this is the only door the chart uses** |
| `useTickerMeta` (SWR hook + localStorage) | `app/src/hooks/useTickerMeta.js:104-125`, projection `:59-88` | **YES** |
| `StockChart` → `symbolMeta` | `app/src/components/StockChart.jsx:2979`, `:2999-3001` | **YES** |
| `bindConstsFor` → `symbolConstantsWith` | `app/src/components/chart/engine/ast/bind.js:146-160`, threaded `StockChart.jsx:10754` | **YES — the terminus** |
| `ticker_search` autocomplete names | `api/routers/ticker_search.py:72-92`, `:156` | no |
| calendar entry enrichment (cache-hits only) | `api/routers/calendar.py:1477-1495` | no |
| Model Book curation / watermark name | `api/routers/modelbook.py:303`, `:715`, `:827`, `:1478` | no (watermark only) |
| voice tools | `api/services/voice_tool_impls.py:4099-4100` | no |
| `_primary_theme` → `groups.resolve_primary_theme` | `api/services/ticker_meta.py:265-276`; `api/services/groups.py:504` | no |

⚠️ **NAME COLLISION, NOT A SECOND READER.** `api/darkpool_eod.py:381::_ticker_meta` and
`_load_ticker_metadata` in `api/massive_ws_worker.py:840` / `api/massive_flatfiles_worker.py:168`
are *different stores* (FlowDB / darkpool) that happen to share the word. They are
Options-Flow-owned and out of scope here; they are named only so a future grep for
"ticker_meta readers" does not count them.

### Staleness policy, and the per-row timestamp

- **There is no timestamp field on a row.** A row is `{name, sector, industry, exchange}`
  and nothing else (`ticker_meta.py:199`, `:229-235`). Freshness is the **file mtime**:
  `_disk_get` refuses a file older than `_TTL` (`ticker_meta.py:32`).
- **A row with `exchange: null` is FRESH, and that is the load-bearing case.** The
  staleness clause is `if disk is not None and "exchange" in disk` (`:195`) — it tests for
  the KEY, not for a value. A row written while the exchange lookup returned nothing
  therefore pins `exchange = None` for the full 24 h server-side and up to 7 days in the
  browser, and for that whole window the Pine fold refuses `syminfo.prefix` and
  `syminfo.tickerid` on that symbol with the *"this engine has not measured it"* sentence,
  which is not the reason.
- **An all-null answer is never persisted** (`:249`, `if any(data.values())`), so a symbol
  no provider answers for is re-fetched from three vendors on **every single request**,
  uncached, forever. `ticker_names_prewarm.py:25-30` records this in production terms
  (~20 dead symbols cost 47 s of every cold start, 40 cold starts in a day).

**Distribution of row ages: NOT REPORTED.** The only place the age lives is the mtime of
files under `$DATA_DIR/ticker_meta_cache`, and on this box `DATA_DIR` defaults to
`/data` — the owner's live production volume. **I did not read live data and I did not
stat anything under `C:\data` or `/data`.** What can be said from schema and code alone:
every row's age is exactly `now - mtime`, every row older than 86400 s is invisible to
readers (`_disk_get` returns `None`), and the prewarmer's skip condition is that same
function (`ticker_names_prewarm.py:139-147`), so in steady state the on-disk population is
bounded at 24 h by construction and the *observable* staleness lives entirely in the
browser's 7-day layer.

---

## PART 2 — which Pine scripts depend on it

Population: **269 scripts** — `corpus/committed/*.pine` (266) + `tests/fixtures/member/*.pine` (3).
Comments and string literals stripped before matching. "reaches output" is
interprocedural: `pine_time_input_census.consumers_of`, which walks assignments to a fixed
point **and** binds across user-function parameter lists, plus a direct-use check for a
read written inside the output call itself.

| field | uses | files | files where it reaches an output | resolves THROUGH `ticker_meta`? | engine status | a named script |
|---|---:|---:|---:|---|---|---|
| `syminfo.tickerid` | **318** | 77 | 64 | **YES** — the exchange half only | folds where witnessed | `3-level-zigzag-semafor__3078.pine` |
| `syminfo.mintick` | 175 | 37 | 19 | no — never resolves | refused by name | `72s-strategy-adaptive-hull-moving-average-pt…` |
| `syminfo.ticker` | 60 | 22 | 13 | **no** — the chart symbol STRING | folds for every symbol | `72s-strategy-adaptive-hull-moving-average-pt…` |
| `syminfo.type` | 43 | 8 | 7 | no — never resolves | refused by name | `72s-strategy-adaptive-hull-moving-average-pt…` |
| `syminfo.basecurrency` | 22 | 7 | 6 | no — never resolves | **unlisted** | `open-interest-profile-fixed-range-by-leviath…` |
| `syminfo.prefix` | 17 | 5 | 5 | **YES** — the exchange | folds where witnessed | `blackflag-fts__GdkmXaTINI.pine` |
| `syminfo.timezone` | 13 | 6 | 4 | no — never resolves | **unlisted** | `candlestick-patterns-on-backtest__c85b9d3ec6…` |
| `syminfo.pointvalue` | 7 | 3 | 0 | no — never resolves | refused by name | `72s-strategy-adaptive-hull-moving-average-pt…` |
| `syminfo.currency` | 5 | 1 | 0 | no — never resolves | refused by name | `rsi-vwap-indicator__pTI5ZVw9n4.pine` |
| `syminfo.session` | 5 | 1 | 1 | no — never resolves | refused by name | `mgi-levels-suite__285168ddfb.pine` |
| `syminfo.description` | 1 | 1 | 0 | no — never resolves | refused by name | `relative-volume__LnFmPEoFXQ.pine` |
| `syminfo.root` | 1 | 1 | 0 | no — never resolves | **unlisted** | `position-size-calc__a42db1a620.pine` |

**667 reads across 119 of 269 files.** 41 lines put a symbol-scoped read inside a `str.*`
predicate — the exact shape the bind-time fold exists to decide.

### The trace, not an assumption

`bind.js::symbolConstantsWith` (`:146-160`) is the only producer of `syminfo.*` values, and
it reads exactly two fields off the symbol object:

- **`syminfo.ticker` ← `symbol.ticker`** (`bind.js:151`), which is the chart's own symbol
  string (`StockChart.jsx:3000`, `ticker: sym`). **`ticker_meta` is not in this path at all** —
  so the 60 corpus reads of the most-obviously-symbol-shaped field do not depend on the
  store. This matters for the `BF.B` question below.
- **`syminfo.prefix` ← `symbol.exchange`**, looked up in `symbolScope.json::confirmed`
  (`bind.js:152-155`). `symbol.exchange` is `tickerMeta.exchange` (`StockChart.jsx:3000`),
  which is the store's `exchange` field (`ticker_meta.py:229-235`, `:90`). **This one goes
  through `ticker_meta`.**
- **`syminfo.tickerid` ← `` `${pine}:${ticker}` ``** (`bind.js:156`) — assembled, so its
  exchange half goes through the store and its symbol half does not.

Everything else in the table is refused **by name at the door** (`pine.js:1240-1244`, read
off `symbolScope.json::unserved`) or is **unlisted** — `basecurrency`, `timezone` and `root`
are in neither roster and fall through the namespace default. `symbolScope.json`'s own
`_why_unserved_is_a_ROSTER_and_not_a_default` note says a fallthrough is for "names nobody
has ruled on yet"; these three are 36 uses across 14 files, which is more than
`pointvalue`, `currency`, `session` and `description` combined (14 uses), all four of which
*were* ruled on. That is a ranking worth revisiting, and it is a finding, not a fix.

### An adjacent absence, recorded

`interpret.js:3059` is the **only** reader of `opts.symbols`, and **no file under `app/src`
that calls `interpret` writes a `symbols` key into an options object**. Consequence in the
source: a `sym('<other>', …)` node in the browser lane has no series supplied and returns
`nan(length)` (`interpret.js:3066`). ⛔ This contradicts the sentence in
`closedTable.json::_benchmarks` — *"The chart lane serves `sym('<any ticker>', …)` for
whatever bars it can fetch"* — which is a claim about a run. **I am not claiming what a
live chart passes**; I am reporting that the source contains no supplier. That is the
weaker claim and it is the only one the instrument can support. The instrument's supplier
scan carries a synthetic positive control so its zero is a measurement rather than an
untested regex.

---

## PART 3 — `BF.B`

### The symbol-resolution path used by the Pine engine

1. `SymbolSearch.submit` (`app/src/components/chart/SymbolSearch.jsx:183-184`) —
   `(ticker || '').trim().toUpperCase()`. **Upper-case and nothing else.** A typed query
   with no exact index match is still offered as a destination row
   (`SymbolSearch.jsx:149`, `:165`, `:360`), and `tools/mobile_discovery.py:191-199`
   exercises exactly that with the literal string `BRK.B`.
2. `useTickerMeta(sym)` → `GET /api/ticker-meta/<sym>` (`useTickerMeta.js:110`).
3. `ticker_meta.get_ticker_meta` → `_base_meta` (`ticker_meta.py:182-183`), whose entire
   normalisation is `(ticker or "").upper().strip()`.
4. `symbolMeta = {ticker: sym, exchange: tickerMeta.exchange || null}` (`StockChart.jsx:2999-3001`).
5. `bindConstsFor` → `symbolConstantsWith` (`bind.js:146-160`).

`request.security` translates through `pine.js::securityAsNode` (`:7186`) →
`otherSymbolNameOf` → `tickerWithoutVenue` (`:3122`) → `TICKER_SHAPE`
(`parse.js:226`, `/^[A-Z][A-Z0-9.-]{0,9}$/`). **The dot passes every one of those gates** —
the Pine *grammar* has no problem with `BF.B`. The scan lane cannot reach it either: the
benchmark roster (`closedTable.json::_benchmarks`) is fifteen non-dotted ETFs and
`scan_definition.py:496-506` refuses anything else. So the break is not in the grammar and
not in the sweep.

### The reproduction

**Smallest concrete input:** type `BF.B` (or `BRK.B`) into the chart's symbol box and press
Enter on the "Go to BF.B" row.

**The function that mishandles it:** `api/services/ticker_meta.py:183` — the one line that
is `_base_meta`'s entire symbol normalisation.

```
ticker = (ticker or "").upper().strip()
```

**What it produces vs. what it should.** It produces the key `BF.B`. The app-canonical form
for charting is `BF-B`, and this repo already owns that rule in two places, neither of
which `ticker_meta` calls:

- `api/services/groups.py:59-61` — `normalize_sym`, docstring: *"App-canonical form for
  **charting**/search/cells: uppercase, dot->hyphen."*
- `api/services/ticker_search_index.py:69-71` — `_share_class_alias`, `BRK.B → BRK-B`, which
  `api/routers/ticker_search.py:140` and `api/services/discord_render/symbols.py:78`
  deliberately reuse as "one copy of the rule".

The instrument asserts on every run that `ticker_meta.py` mentions **neither** name (0
occurrences of each), with a positive control showing the same scan finding both where they
do live. **`ticker_meta` is the only symbol-keyed store in the chart's chain with no
share-class normalisation.**

**Consequence, in the source:** `_from_yfinance` / `_from_fmp` / `_from_finnhub` are each
handed `BF.B`. `api/services/massive.py:42-54` records the measured vendor split —
*"the universe list, SQLite cache, FMP and yfinance all use the HYPHEN form (BF-B) …
Verified empirically: Massive returns n=0 for 'BRK-B'/'BF-B' but full fresh data for
'BRK.B'/'BF.B'"* — so the hyphen is what those three legs expect. If all three miss,
`ticker_meta.py:249` does not persist, so the row is **re-fetched from three vendors on
every request** and `exchange` is `null`, which at `bind.js:152` leaves `syminfo.prefix`
and `syminfo.tickerid` unemitted. The member's script is then told
`symbolScope.json::pending_measurement`'s sentence — *"a TradingView string this engine has
not measured"* — when the actual cause is that our own store was asked in a spelling it
does not key on. **A refusal naming the wrong cause is the defect the whole `unserved`
roster exists to prevent.**

**UNVERIFIED — and exactly which half.** Everything above is checked source text. What I did
**not** observe is the vendor responses themselves: that `yfinance.Ticker("BF.B").info`,
FMP `stable/profile?symbol=BF.B` and Finnhub `profile2?symbol=BF.B` all return nothing.
Reason: that requires live vendor calls, which this task forbids. The repo's own committed
measurement (`massive.py:44-49`) covers the *Massive* boundary only; it is evidence that two
spellings are alive by design, **not** evidence about yfinance's or FMP's answer to a dotted
symbol. The main session can settle it with one read-only command and no server:

```
python -c "import yfinance as yf; i=yf.Ticker('BF.B').info; j=yf.Ticker('BF-B').info; \
print('BF.B ->', i.get('longName'), i.get('exchange')); \
print('BF-B ->', j.get('longName'), j.get('exchange'))"
```

Expected on the hypothesis: the dot row is empty and the hyphen row names Brown-Forman.
If the dot row answers, this reproduction is **wrong** and the store is fine — say so.

Separately **UNMEASURED IN THIS REPO**: what TradingView's `syminfo.ticker` returns for a
dual-class symbol. The only tickerid capture
(`tests/fixtures/vendor/barstate-realtime-spy-2026-09-09.json::tickerid_shape_five_symbols`)
covers SPY, AAPL, EURUSD, BTCUSD and SPX — **no dotted-class symbol**. This matters because
`bind.js:147-151` serves `syminfo.ticker` **ungated**, on the written reasoning that *"the
plain symbol is the string our own store is keyed by, so there is no vendor question in
it."* For a dual-class symbol there demonstrably **is** a spelling question inside our own
system (that is what `to_polygon_symbol` exists for), so the exemption's premise does not
hold for this symbol class. Whether the vendor also disagrees is a capture nobody has taken:
add a dotted-class symbol to `exchange-spelling.pine`'s witness run and read
`str.length(syminfo.ticker)` — 4 means `BF.B`, 4 means `BF-B` too, so read
`str.contains(syminfo.ticker, ".")` instead.

### Who owns the fix

**NOT this branch.** The writer is `api/services/ticker_meta.py`, a platform/data service,
and the normalisers that should be called live in `api/services/groups.py` and
`api/services/ticker_search_index.py`. The owning workstream is **symbol resolution /
ticker-search on the web pod** (the same workstream that already owns `cap_universe`
canonical spelling, `_share_class_alias` and `to_polygon_symbol`). This branch — the
Pine→chart-engine translator — owns exactly one adjacent thing and it is a *sentence*, not a
lookup: when `symbol.exchange` is null, the refusal currently blames an unmeasured vendor
string, and it should be able to distinguish "our store had no exchange for this symbol"
from "this exchange spelling has no witness". Recording that here; not changing it.

---

## The CONTROL, verbatim

```
--- CONTROLS ---
CONTROL: stripper sees the real reads                             expected 2     got 2     OK
CONTROL: stripper declines the comment                            expected 0     got 0     OK
CONTROL: stripper declines the string                             expected 0     got 0     OK
CONTROL: this file contains 0 of its own needle                   expected 0     got 0     OK
CONTROL: item (b) committed: input.timeframe -> request.security  expected 97    got 97    OK
CONTROL: citation api/services/ticker_meta.py:22                  expected True  got True  OK
CONTROL: citation api/services/ticker_meta.py:21                  expected True  got True  OK
CONTROL: citation api/services/ticker_meta.py:32                  expected True  got True  OK
CONTROL: citation api/services/ticker_meta.py:183                 expected True  got True  OK
CONTROL: citation api/services/ticker_meta.py:249                 expected True  got True  OK
CONTROL: citation api/routers/ticker_meta.py:12                   expected True  got True  OK
CONTROL: citation app/src/hooks/useTickerMeta.js:86               expected True  got True  OK
CONTROL: citation app/src/components/StockChart.jsx:3000          expected True  got True  OK
CONTROL: citation app/src/components/StockChart.jsx:10754         expected True  got True  OK
CONTROL: citation app/src/components/chart/engine/ast/bind.js:151 expected True  got True  OK
CONTROL: citation app/src/components/chart/engine/ast/bind.js:156 expected True  got True  OK
CONTROL: citation api/services/groups.py:61                       expected True  got True  OK
CONTROL: citation api/services/massive.py:54                      expected True  got True  OK
CONTROL: citation app/src/components/chart/SymbolSearch.jsx:184   expected True  got True  OK
CONTROL: citation app/src/components/chart/SymbolSearch.jsx:149   expected True  got True  OK
CONTROL: ticker_meta.py mentions normalize_sym                    expected 0     got 0     OK
CONTROL: ticker_meta.py mentions _share_class_alias               expected 0     got 0     OK
CONTROL: positive control: normalize_sym exists in groups.py      expected True  got True  OK
CONTROL: positive control: _share_class_alias exists in ticker_search_index.py expected True  got True  OK
CONTROL: opts.symbols READERS under app/src (positive control)    expected 1     got 1     OK
CONTROL: supplier regex can fire (synthetic probe)                expected True  got True  OK
CONTROL: opts.symbols SUPPLIERS in a file that calls interpret    expected 0     got 0     OK
CONTROL: BUILTIN_SYMBOL_SCOPED members                            expected 3     got 3     OK

RESULT: all controls OK
```

Exit code 0. A failing control exits 1.

**The reproduced committed number is item (b)'s 97** — `input.timeframe` uses consumed by
`request.security`, re-derived by item (b)'s own walk over item (b)'s own file roster
(`pine_time_input_census.SOURCES`), the same control `tools/pine_security_census.py:225-245`
uses. It is reproduced, not re-typed: the walk is `B.consumers_of`, imported.

⛔ **THE `syminfo.*` COUNTS ARE A NEW BASELINE, NOT A REPRODUCTION, AND I AM SAYING SO
PLAINLY.** The only committed `syminfo.*` census — `docs/pine/SESSION-STATE.md:1376-1387`,
`tickerid` 70/26, `ticker` 53/13, `mintick` 31/20 — was taken over *"161 corpus files"*. The
committed corpus is **266** files today (`corpus/index.json::counts.committed`), so that
number describes a different population and reproducing it is not possible from here. It is
printed by the tool as a drift record and asserted nowhere. (That committed table also does
not add up internally: its rows sum to 177 and its prose says 176.)

---

## What I did NOT verify, and why

1. **Any vendor response.** No call to yfinance, FMP, Finnhub, Massive or TradingView. The
   `BF.B` reproduction's vendor step is marked UNVERIFIED above with the exact command.
2. **Anything under `C:\data` or `/data`.** Not read, not stat'd, not listed, not written.
   That is why the row-age distribution is described from schema and code rather than
   measured, and why I cannot say whether `.ticker_meta_name_heal_v1` exists in production.
3. **Any running process.** No server started, no request issued, no browser driven. Every
   claim about what a *request* carries is therefore worded as a claim about **source
   text** — most importantly the `opts.symbols` absence, which says "no file writes this
   key", never "no chart passes one".
4. **TradingView's `syminfo.ticker` on a dual-class symbol.** Unmeasured in this repo; the
   only tickerid capture covers five non-dotted symbols. Named as the capture that would
   settle whether the `syminfo.ticker` exemption at `bind.js:147-151` is safe for this
   symbol class.
5. **Whether a dotted spelling actually reaches production charts today.** I showed the path
   exists in the source (`SymbolSearch.jsx:149`/`:184`) and that a committed tool drives it
   (`tools/mobile_discovery.py:191`). I did not measure how often a member takes it.
6. **The engine's Python twin.** `api/services/ast_bind.py:186-212` mirrors
   `symbolConstantsWith`; I read it and it matches, but the census population is the JS
   lane's corpus and I did not run the twin.
7. **`git`, `vitest`, `npm`, `pytest`.** Not run — forbidden by the task.

---

## Defects found in this instrument while building it

**Two, both caught by the instrument's own controls before any number was reported.**

1. **A false-positive supplier: the absence scan could not distinguish two different
   `symbols` keys.** Version 1 scored any `symbols:` key inside `app/src/components/chart/engine/`
   as a supplier of `opts.symbols`, and reported `ast/pcf.js:927` — which is
   `PCF_VOCABULARY.symbols`, the TC2000 reader's **operator-punctuation list**. Had it not
   been controlled, this census would have published "the chart lane does supply foreign
   series" on the strength of a key that has nothing to do with `interpret`. Fixed: a
   supplier now only counts in a file that actually calls `interpret`, and the reason is
   written at the site. `lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`.
2. **Two wrong line citations, reported as FAIL rather than as prose.** The `bind.js`
   citations were written as 152 and 157; the real lines are 151 and 156 — off by one
   because they were transcribed from an offset-adjusted `sed` window rather than from the
   file. The citation control re-reads every cited line on every run and requires the named
   substring to be on it, so both failed loudly on the first run. This is the reason the
   citations are checked at all: *a citation that is not checked is a citation that rots*.

**Also checked, and clean:** the stripper both ways on this tool's own needle (it sees two
real reads, declines one in a `//` comment and one inside a string literal); that this file
contains zero occurrences of its own needle (every needle is assembled at runtime by
concatenation); that the supplier regex can fire at all, against a synthetic probe, so its
zero is a measurement and not an untested pattern; and that
`pine.js::BUILTIN_SYMBOL_SCOPED` still holds exactly three members, so the served/refused
split is read off the manifests rather than typed here.

**One thing I deliberately did not build:** a second comment/string stripper and a second
reachability walk. `pine_time_input_census`'s are imported, exactly as
`pine_security_census.py` imports them, because a second copy would be a second authority
over *what counts as a use* — and the two would drift silently in the direction of a demand
number the neighbouring censuses disagree with.
