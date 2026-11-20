# First-frame seed: pack format `UFFSEED1`, version 1

A chart opened at random (any stock, any timeframe, a ticker nobody has viewed) must draw in under
20 ms. One network round trip is longer than that, so the bars a chart's FIRST FRAME needs are kept
on the member's device: one file per timeframe, every symbol's newest N bars, read by a Worker in
~0.3-2 ms. This document is the byte-level contract between the server that builds those files
(`api/services/ffseed.py`, `api/services/ffseed_format.py`) and the browser that reads them.

It is the history lake's pack (`tools/history_lake/FORMAT.md` section 9, `UBHPACK1`) with a lighter
per-symbol blob: the lake's piece BODY only, raw or gzip, never Brotli (Chrome's
`DecompressionStream` has no Brotli; it has `gzip`, `deflate`, `deflate-raw`). The body is byte for
byte a lake piece body, so `app/src/data/historyLake/piece.js` `decodeBody` decodes it unchanged.

## 1. What a pack holds

| tf   | `tunit` (s) | N (newest bars) | which bars                                                         |
|------|-------------|-----------------|--------------------------------------------------------------------|
| `1`  | 60          | 600             | regular session only                                               |
| `5`  | 300         | 300             | regular session only                                               |
| `15` | 900         | 300             | regular session only                                               |
| `30` | 1800        | 300             | regular session only                                               |
| `60` | 1800        | 1000            | regular session only, the `'60'` key's stored 09:30-anchored grid  |
| `D`  | 86400       | 350             | every daily bar; W and M are derived on the device from D          |

* **The bars are `/api/bars`' bars**, value for value: the builder reads them through the two calls
  `/api/bars` answers a warm request with (`bars_sqlite.get_bars` + `bars_fetch._fmt_sqlite_bars`:
  split-adjusted, sanitized, 4-decimal store grain), reading the same row count the chart's first
  paint asks for. A chart that paints the seed and then receives the server's answer sees the same
  bars where they overlap (pinned by `tests/test_ffseed.py`, which runs the real serve path).
* **Regular session** = the client's `isRthBar` (`app/src/components/chart/barTime.js`):
  09:30 <= ET minute of the bar's START < the session close, 16:00, or 13:00 on an NYSE early-close
  day. On `60` that keeps 09:30, 10:30 ... 14:30 and the 15:30 half bar (12:30 on a half day); the
  pre-market 09:00 bar and every clock hour are dropped. The `60e` (clock-hour, extended) grid is
  not seeded.
* **As-of session.** Only bars of sessions up to the build's as-of session (the last closed
  session) are included, so a build never freezes a forming bar. A symbol whose newest bar is older
  than the as-of session is LEFT OUT (its server answer would differ: the request path heals it).
* A symbol may hold fewer than N bars (a recent listing): the server has no more either.
* A stored 60m series still on the pre-2026-11-10 clock-hour layout is left out (`old_grid`):
  `/api/bars` rebuilds such a series (a store write) before serving it, and the builder never writes.

## 2. Files and manifest

```
R2 (DATA_SYNC_BUCKET)                          edge URL (seed.js, entitlement required)
ffseed/latest.json                             /api/seed/v1/latest.json            private, max-age=60
ffseed/<build>/<tf>.ffs                        /api/seed/v1/<build>/<tf>.ffs       private, immutable, 1 year
```

`<build>` is the build's UTC time `YYYYMMDDTHHMMZ`; `<tf>` is one of `1 5 15 30 60 D`. Packs are
uploaded first and `latest.json` last, so a manifest never names a pack that is not there. The two
newest builds are kept.

`latest.json` (compact JSON, keys sorted; wrapped here):

```json
{"asof":"2026-11-18","basis":"served","build":"20261119T0131Z","built_at":1795138260,
 "comp":"gzip","grid":"rth","kind":"ffseed","v":1,"universe":{"count":3639},
 "tfs":{"5":{"bars":1085400,"bytes":5839102,"depth":300,"key":"ffseed/20261119T0131Z/5.ffs",
             "sha256":"9f2c...","short":12,"symbols":3618,"tunit":300,
             "skipped":{"error":0,"inexact":0,"no_bars":9,"old_grid":0,"stale":12},
             "url":"/api/seed/v1/20261119T0131Z/5.ffs"}, "...": {}},
 "splits":{"session":"2026-11-19","symbols":{"BRK-B":2.0,"ZZREV":0.1}}}
```

(Numbers in this example are illustrative; section 7 has measured sizes.) A client compares
`build` with what it holds, downloads each changed `url`, checks `bytes` and `sha256`
(`crypto.subtle.digest('SHA-256', ...)`), and only then swaps the file in. A pack that fails the
check is discarded whole.

### `splits`: the next session's basis changes (the device's split guard)

The packs are split-adjusted AS OF `asof`. On the next session the server's answer for a symbol
that splits that day is on a new basis (every older bar rescaled), so a device copy of that symbol
must not be joined to it. `splits` tells the device which symbols those are:

```json
"splits": {"session": "2026-11-19", "symbols": {"BRK-B": 2.0, "ZZREV": 0.1, "ZZODD": null}}
```

| key       | meaning                                                                          |
|-----------|----------------------------------------------------------------------------------|
| `session` | the first NYSE trading day after `asof` (`nextSessionISO(asof)` on the device)   |
| `symbols` | an OBJECT: seed symbol (seed spelling, `BRK-B`) -> ratio, shares after per share before (`2.0` a 2-for-1, `0.1` a 1-for-10 reverse), `null` when the vendor gave no usable ratio. Every seed symbol with a split executing on `session`. |

* `symbols` is an object, not an array, because the device reads `Object.keys(splits.symbols)`
  (`app/src/data/deviceStore/engine.js` `_splitsOf`): an array there would yield the keys `"0"`,
  `"1"`, ... and name nobody, i.e. fail OPEN.
* **Field present** = the source answered completely for `session`. `{}` therefore means "no seed
  symbol splits next session", never "could not ask". **Field absent** = the source could not
  answer (no key, an error on any page, a truncated answer): the device keeps its guard closed and
  uses no copy past `asof`. A build never fails for want of this list; it publishes without it.
* **Source.** The store's bars are Massive aggregates fetched `adjusted=true`, which adjust for
  splits only (forward and reverse; never dividends or spin-offs), and the serve path heals a split
  factor the store missed from FMP's split list (`bars_sanitize._fetch_meta`). So a split is the
  only corporate action that rebases a served series. The list is:
  1. Massive `/v3/reference/splits` with `execution_date` = `session`, one paginated read for the
     whole market (`reference_corp_actions.fetch_confirmed_splits_strict`, the D5 confirmed
     source). Announced splits carry their future execution date, so this can answer at build time
     (20:15 ET on `asof`). It is the only source whose answer can produce the field.
  2. plus any seed symbol whose split list in the serve path's FMP cache dates a split on `session`
     (cache only: the build never calls the vendor). It can add a name, never remove one, and its
     silence proves nothing (the cache can be cold or a week old), which is why it cannot be the
     source of the field on its own.
* **What it cannot know.** A split announced after the build (after 20:15 ET on `asof`) and executed
  the next morning, or one Massive has not recorded by then. Exchanges require notice well ahead of
  a split's execution date, so this is the residual case, not the common one; the server's own
  answer still reaches the chart and repaints it.
* Only the session after `asof` is covered. A device whose seed is older than that (no build for a
  session) has no list for today and keeps its guard closed.

## 3. Pack layout

All integers little-endian.

```
blob 0 | blob 1 | ... | blob k-1 | trailer (ASCII JSON) | u64 trailer length | "UFFSEED1"
```

The last 8 bytes are the magic `55 46 46 53 45 45 44 31` ("UFFSEED1"); the 8 bytes before them are
the trailer's length T; the trailer is the T bytes before those. Blobs are in symbol order (sorted
by code point) and do not overlap; a pack is a pure function of its inputs.

### Trailer

```json
{"asof":"2026-11-18","basis":"served","build":"20261119T0131Z","comp":"gzip","depth":300,
 "fields":["off","len","bars","first","last","asof","crc","body","pscale","vscale"],
 "grid":"rth","kind":"ffseed","tf":"5","tunit":300,"v":1,
 "symbols":{"AAPL":[0,1612,300,1794326400,1795110900,20261118,3711563254,2611,10000,1], ...}}
```

| key       | meaning                                                                        |
|-----------|--------------------------------------------------------------------------------|
| `v`       | 1. A reader refuses any other value.                                           |
| `kind`    | `"ffseed"`                                                                     |
| `tf`      | `1` `5` `15` `30` `60` `D`                                                     |
| `tunit`   | seconds; the table in section 1; must agree with `tf`                          |
| `basis`   | `"served"` (split-adjusted, sanitized: what `/api/bars` sends)                 |
| `grid`    | `"rth"` (regular-session view)                                                 |
| `comp`    | `"gzip"`: each blob is ONE gzip member (RFC 1952) holding the body; `"raw"`: the blob IS the body |
| `depth`   | N, the most bars any symbol has                                                |
| `asof`    | the as-of session, `YYYY-MM-DD`                                                |
| `build`   | the build id (equals the URL's)                                                |
| `fields`  | the names of a symbol entry's 10 numbers, in order (fixed in version 1)        |
| `symbols` | ticker (as `/api/bars` names it, e.g. `BRK-B`) -> its entry                    |

Symbol entry, 10 non-negative integers:

| # | field    | meaning                                                                      |
|---|----------|------------------------------------------------------------------------------|
| 0 | `off`    | first byte of the symbol's blob in the file                                  |
| 1 | `len`    | blob length in bytes                                                         |
| 2 | `bars`   | bar count n (>= 1)                                                           |
| 3 | `first`  | start of the first bar, epoch seconds UTC (D: UTC midnight of its date)      |
| 4 | `last`   | start of the last bar, same units                                            |
| 5 | `asof`   | the as-of session this symbol's series was read as of, YYYYMMDD              |
| 6 | `crc`    | CRC-32 of the decoded columns (section 4)                                    |
| 7 | `body`   | length of the DEcompressed body                                              |
| 8 | `pscale` | power of ten 1 ... 1e9; price = integer / pscale                             |
| 9 | `vscale` | power of ten 1 ... 1e9; volume = integer / vscale                            |

## 4. Body (identical to the lake piece body, FORMAT.md section 3)

8 columns, each exactly n unsigned LEB128 varints (7 bits per byte, least-significant group first,
high bit set on every byte but the last), one column after another, no padding:

| # | column | value for bar i                                               |
|---|--------|---------------------------------------------------------------|
| 1 | `T`    | `t[0] / tunit`, then `(t[i] - t[i-1]) / tunit` (>= 1)          |
| 2 | `O`    | `zz(o[i] - c[i-1])`, `c[-1] = 0`                               |
| 3 | `H`    | `zz(h[i] - max(o[i], c[i]))`                                   |
| 4 | `L`    | `zz(min(o[i], c[i]) - l[i])`                                   |
| 5 | `C`    | `zz(c[i] - o[i])`                                              |
| 6 | `V`    | `floor(v[i] / vscale)`                                         |
| 7 | `VF`   | `v[i] mod vscale`                                              |
| 8 | `N`    | 0 (`/api/bars` carries no transaction count; kept so the lake decoder reads the body as is) |

`t` is epoch seconds, `o h l c` integers at `pscale`, `v` an integer at `vscale`;
`zz(x) = 2x` for x >= 0, `-2x - 1` for x < 0. `crc` = CRC-32 (IEEE, zlib) of the seven decoded
columns `t o h l c v n` in that order, each value written as 8 bytes little-endian.

Exactness: the encoder picks, per symbol, the smallest power of ten (<= 1e9) at which EVERY price
satisfies `integer / pscale == price` in IEEE doubles (and likewise volume), and refuses a series no
such scale can hold. Division of an exact integer by a power of ten is correctly rounded in both
Python and JavaScript, so `o / pscale` IS the double the JSON answer parses to. Every decoded value
is below 2^53, so plain Numbers hold them.

## 5. Decoding, step by step (the browser)

1. **Trailer** (once per file, keep it in the Worker): `n = file.length`; check bytes
   `[n-8, n)` == "UFFSEED1"; `T` = u64 LE at `n-16`; parse bytes `[n-16-T, n-16)` as JSON; check
   `v == 1`, `kind == "ffseed"`, `fields` equals the list above, `tunit` matches `tf`. Turn
   `symbols` into a Map.
2. **Find the symbol**: `[off, len, bars, first, last, asof, crc, body, pscale, vscale] =
   symbols[SYM]`; a missing symbol is a miss (fall through to the network).
3. **Read the blob**: bytes `[off, off + len)` (an OPFS sync access handle can `read` just those).
4. **Inflate** when `comp == "gzip"`: `new Response(new Blob([blob]).stream().pipeThrough(new
   DecompressionStream('gzip'))).arrayBuffer()` (or any sync inflate); the result must be exactly
   `body` bytes. `comp == "raw"`: the blob is the body.
5. **Decode the columns**: `decodeBody({bars, first, last, tunit, vscale, body, crc}, bodyBytes)`
   from `app/src/data/historyLake/piece.js` does exactly FORMAT.md section 4 steps 6-8: read 8 x n
   varints (multiply, never shift: shifts are 32-bit in JS), rebuild
   `t += T*tunit; o = cPrev + unzz(O); c = o + unzz(C); h = max(o,c) + unzz(H); l = min(o,c) - unzz(L);
   v = V*vscale + VF`, check `t` strictly increases, `t[0] == first`, `t[n-1] == last`, and the
   column CRC. Any failed check: the entry is corrupt, do not paint it.
6. **Served bars**: `t` as is for intraday (epoch seconds); for `D`
   `new Date(t * 1000).toISOString().slice(0, 10)`. `o/h/l/c = integer / pscale`;
   `v = vscale === 1 ? integer : integer / vscale`. These are the `{t,o,h,l,c,v}` rows
   `/api/bars` sends, already in the regular-session view.

**Cost, measured** (Node 24 on the dev PC, real 1m/60m/D packs, per symbol, after the trailer is
parsed once in ~0.05 ms): inflate with `DecompressionStream('gzip')` 0.25-0.37 ms, with a sync
gunzip 0.04-0.10 ms; `decodeBody` including its column CRC 0.18-0.58 ms (60m, 1000 bars, is the
top of the range). So ~0.5-1 ms a symbol on the async path, ~0.25-0.7 ms with a sync inflate; a
`raw` pack (section 7: about 1.6x the bytes) skips the inflate entirely.

`tests/test_ffseed_format.py` (Python reference reader `ffseed_format.read_served`) and
`edge/bars-edge-router/seed.test.mjs` (the steps above in JavaScript, against packs built by the
Python encoder) pin this procedure.

## 6. Worked example

A 5m pack holding one symbol, `XYZ`, three bars of 2026-11-19 (as-of 2026-11-19), built with
`comp = "raw"` so the body is visible (reproduce: `PackBuilder("5", asof="2026-11-19",
build="20261120T0131Z", depth=300, comp="raw")`, `add_served("XYZ", bars)`, `finish()`):

| t (ET)  | t (epoch)  | o      | h      | l      | c      | v     |
|---------|------------|--------|--------|--------|--------|-------|
| 09:30   | 1795098600 | 101.25 | 101.50 | 101.10 | 101.40 | 12000 |
| 09:35   | 1795098900 | 101.40 | 101.45 | 101.00 | 101.05 | 8500  |
| 09:40   | 1795099200 | 101.05 | 101.30 | 101.05 | 101.30 | 9100  |

Every price is exact at 2 decimals, so `pscale = 100` (o = 10125, 10140, 10105 ...); every volume
is whole, so `vscale = 1`. The file is 353 bytes:

```
bytes 0-31    the body (32 bytes):
  T   ae 9b ed 02 | 01 | 01      5983662 (= 1795098600/300), +1, +1
  O   9a 9e 01 | 00 | 00         zz(10125-0)=20250, zz(10140-10140)=0, zz(10105-10105)=0
  H   14 | 0a | 00               zz(10150-10140)=20, zz(10145-10140)=10, zz(10130-10130)=0
  L   1e | 0a | 00               zz(10125-10110)=30, zz(10105-10100)=10, zz(10105-10105)=0
  C   1e | 45 | 32               zz(15)=30, zz(-35)=69, zz(25)=50
  V   e0 5d | b4 42 | 8c 47      12000, 8500, 9100
  VF  00 | 00 | 00
  N   00 | 00 | 00
bytes 32-336  the trailer (305 bytes of ASCII JSON):
  {"asof":"2026-11-19","basis":"served","build":"20261120T0131Z","comp":"raw","depth":300,
   "fields":["off","len","bars","first","last","asof","crc","body","pscale","vscale"],
   "grid":"rth","kind":"ffseed",
   "symbols":{"XYZ":[0,32,3,1795098600,1795099200,20261119,3736269093,32,100,1]},
   "tf":"5","tunit":300,"v":1}                          (one line in the file)
bytes 337-344 31 01 00 00 00 00 00 00                   trailer length 305 (u64 LE)
bytes 345-352 55 46 46 53 45 45 44 31                   "UFFSEED1"
```

Reading `XYZ`: entry `[0, 32, 3, ...]` -> bytes 0-31 -> (raw, no inflate) -> T gives
`t = 5983662*300, +300, +300`; O/C give `o0 = 0 + 10125`, `c0 = 10125 + 15 = 10140`,
`o1 = 10140 + 0`, `c1 = 10140 - 35 = 10105`, ...; H/L give `h0 = max(10125, 10140) + 10 = 10150`,
`l0 = min(10125, 10140) - 15 = 10110`; dividing by `pscale` gives back 101.25, 101.5, 101.1, 101.4.
The column CRC over the decoded t/o/h/l/c/v/n is 3736269093.

With `comp = "gzip"` (the default) the same symbol's blob is 48 bytes, one gzip member starting
`1f 8b 08 00 00 00 00 00 02 ff`, and its entry is `[0, 48, 3, 1795098600, 1795099200, 20261119,
3736269093, 32, 100, 1]` (`len` 48, `body` still 32). On real windows (hundreds of bars) gzip
roughly halves a body; see section 7.

## 7. Measured sizes, cap universe

Measured 2026-11-20 with `tools/ffseed_measure.py` (as-of 2026-11-18, `api/data/cap_universe.json`,
3,639 symbols; the builder's own selection and encoder). Intraday bars came from the history lake on
this PC brought to the store's grain (4-decimal prices, whole shares), D from a copy of `bars.db`
through the real serve formatter; the production worker's store will differ slightly (and
split-adjusts intraday), not by enough to move these sizes.

| tf | N | symbols | bars | pack (gzip blobs) | bytes/bar | raw blobs (approx.) | whole file gzipped again |
|----|---|---------|------|-------------------|-----------|---------------------|--------------------------|
| `1`  | 600  | 3,545 | 2,100,421 | **11.2 MB** | 5.2  | 22.3 MB | 11.0 MB |
| `5`  | 300  | 3,545 | 1,059,160 | **7.4 MB**  | 6.7  | 12.4 MB | 7.2 MB  |
| `15` | 300  | 3,545 | 1,062,400 | **8.7 MB**  | 7.9  | 13.4 MB | 8.4 MB  |
| `30` | 300  | 3,545 | 1,062,037 | **9.3 MB**  | 8.5  | 13.9 MB | 9.0 MB  |
| `60` | 1000 | 3,545 | 3,520,114 | **30.2 MB** | 8.5  | 47.0 MB | 30.0 MB |
| `D`  | 350  | 3,545 | 1,224,231 | **12.8 MB** | 10.2 | 18.8 MB | 12.6 MB |
| all  |      |       | 10.0 M    | **79.5 MB** |      | 127.8 MB |        |

(MB = 10^6 bytes. bytes/bar excludes the trailer, ~0.28-0.29 MB per pack.)

* 94 of the 3,639 symbols were left out of every timeframe: no bars, or a series that ends before
  the as-of session (names no longer trading). 0 refused as inexact.
* `60` at N = 1000 is 38% of the total; N = 500 would save ~15 MB.
* Gzipping the whole file again saves ~2%: the edge serves the packs as stored.
* `raw` blobs are ~1.6x the bytes and skip the per-symbol inflate (section 5).
* The ~13k barspack universe (`FFSEED_UNIVERSE=barspack`) would be roughly 3x these, mostly
  smaller names (fewer bars, smaller varints).

## 8. Versioning

* The magic's trailing `1` and the trailer's `v` are the version. A change to the body, the entry
  layout or the framing is version 2 with a new magic (`UFFSEED2`); a reader refuses what it does not
  know and falls back to the network. Adding a trailer key is not a version change (readers ignore
  unknown keys); changing `fields` is.
* The manifest's `v` versions the manifest; `build` changes every build and is the only cache key a
  client needs. `splits` was added to manifest v1 on 2026-11-20 (a new key: older readers ignore it,
  and a reader that needs it treats its absence as "unknown").

## 9. Freshness: the nightly build and a daily delta (design)

**Where it runs.** On the `worker` service (`start_ffseed_builder()` in `api/worker_main.py`, dark
until `FFSEED_ENABLED=1`), next to the D/W/M barspack: the worker holds the fullest `bars.db` and
makes zero provider calls to build. Once per closed session, after 20:15 ET (the extended session
has ended and the regular-session bars' repair window has had hours to land), it builds every
timeframe, uploading each pack as soon as it is built (one pack in memory at a time) and the
manifest last. Worker deploys are manual (`docs/runbooks/worker-deploys.md`).

**1m for the whole universe** (`api/services/ffseed_onemin.py`). The worker's prewarm keeps 1m current only
for its ACTIVE intraday set (watchlists, breadth drill lists, UCT20, candidates, theme holdings;
`PREWARM_1M_CAP`), so the first builds seeded 1m for 1,270 symbols against ~3,545 elsewhere. Each nightly
build (`ffseed.nightly`) therefore runs, in order:

1. **the 1m pass** (it also runs on its own as soon as the session has closed: from 16:20 ET,
   `FFSEED_1M_AFTER_MIN`, and on the first builder tick after a worker boot past that point, recorded in
   `<DATA_DIR>/.last_ffseed_1m_pass` once it completed; the run inside the build then costs nothing for
   the symbols it already brought current, and the build never starts before it): every cap_universe
   symbol whose stored 1m does not reach the as-of session's last
   regular minute gets that session's 1m (plus the session before when the store lacks it too) from the
   provider's split-adjusted range read, written the way the serve path's range repairs write
   (`provider_check` + `put_bars`). Symbols the prewarm keeps current cost no call. 2 threads
   (`FFSEED_1M_WORKERS`), at most 45 min (`FFSEED_1M_DEADLINE_S`, past it the build goes ahead with what
   it has); `FFSEED_1M_BACKFILL=0` turns it off;
2. the build and publish (unchanged), then the marker;
3. **the 1m retention**: a symbol keeps its newest 5 sessions of 1m (`FFSEED_1M_KEEP_SESSIONS`, 0 = off;
   `bars_sqlite.prune_before`, a prefix trim that bumps the series' history revision) ONLY when the pass
   itself filled it (the long-tail ledger `<DATA_DIR>/ffseed_1m_longtail.json`: per symbol the first
   session the pass ever fetched and the newest day it was in the active set), it is not in today's
   active set and has not been for `FFSEED_1M_INACTIVE_DAYS` (default 10) days, and it holds no 1m older
   than the pass's first fetch for it (so rows the pass could not have written, e.g. a once-active
   symbol's deep history, are never touched). Nothing is trimmed while the active set is unknown (no
   prewarm pass in this process yet). A trim does not travel through the R2 deltas (a serving pod merges
   them by INSERT only); web and bars-api keep the rows until they install a whole snapshot. Neither 1
   nor 3 can stop a publish.

**Forcing a rebuild of a session already built** (e.g. to rebuild 2026-11-20 with full 1m over the weekend):
set `FFSEED_FORCE_ASOF=2026-11-20` on the worker (a variable change needs the worker to restart to be read:
deploy it as usual). On its next tick (at most 30 min after boot plus `FFSEED_BOOT_DELAY`) the builder runs
the whole nightly sequence for that session once and records it in `<DATA_DIR>/.last_ffseed_forced`, so
the variable may stay set; unset it at your convenience. It is refused (logged, nothing built) unless the
session IS the newest closed session: publishing an older build after a newer one would roll every device
back. `status()` reports `forced_session`.

**Daily delta**: built, section 10.

## 10. The daily delta (`UFFSDLT1`)

A device that holds build N of a timeframe downloads only what changed to reach build N+1; anyone else
(no copy, another base, a failed check) downloads the full pack, which is always published. Builder:
`api/services/ffseed_delta.py`; reference applier: `ffseed_delta.apply_delta_iter`.

### Files and manifest

```
R2 ffseed/<build>/<tf>.delta.ffs          edge /api/seed/v1/<build>/<tf>.delta.ffs   private, immutable
```

The manifest's timeframe entry gains, ONLY when the delta was proven (below):

```json
"delta": {"base": "20261120T1430Z", "base_asof": "2026-11-19", "bytes": 2034411,
          "key": "ffseed/20261121T0131Z/5.delta.ffs", "ops": {"keep": 3, "merge": 3480, "remove": 4, "replace": 61},
          "sha256": "...", "symbols": 3548, "url": "/api/seed/v1/20261121T0131Z/5.delta.ffs"}
```

A client holding exactly build `base` of that timeframe (and nothing else) may apply it; it checks
`bytes` and `sha256` as for a pack. No `delta` key: take the full pack.

### Layout

The pack framing of section 3 with its own magic, so neither reader can take one for the other:

```
blob 0 | ... | blob k-1 | trailer (ASCII JSON) | u64 trailer length | "UFFSDLT1"
```

Trailer: `v` 1, `kind` `"ffseed-delta"`, `tf`, `tunit`, `basis`, `grid`, `comp`, `depth`, `asof` and
`build` (the NEW build), `base` and `base_asof` (the build it applies to), `fields`, `symbols`.
`fields` = `["op","off","len","rows","bars","first","last","asof","crc","body","pscale","vscale"]`:

| field           | meaning                                                                          |
|-----------------|----------------------------------------------------------------------------------|
| `op`            | 0 keep, 1 merge, 2 replace, 3 remove                                             |
| `off`, `len`    | the blob in the file (0, 0 for keep and remove)                                  |
| `rows`          | bars in the blob                                                                 |
| `bars` `first` `last` `crc` | the NEW window, exactly as its full-pack entry states them (section 3) |
| `asof`          | the new as-of session, YYYYMMDD                                                  |
| `body`          | the blob's decompressed length                                                   |
| `pscale` `vscale` | the NEW window's scales; a blob is encoded at them                             |

Every symbol of the base and of the new build has exactly one entry. A blob is a body (section 4) at the
entry's scales, raw or gzip per `comp`; a merge blob's own rows carry no CRC: the applied window's does.

### Applying one symbol (the device)

* **remove** (3): drop the symbol.
* **replace** (2): the blob is the whole new window: decode it exactly as a pack entry (section 5).
* **keep** (0) and **merge** (1):
  1. take the base window's rows with `first <= t <= last` (base entry, decoded as in section 5);
  2. rescale them to the entry's `pscale`/`vscale`: multiply by `new / old` when the new scale is larger,
     divide when smaller (exact by construction: every kept row is part of the new window);
  3. merge only: decode the blob's `rows` rows (section 5 step 5, without its CRC check) and put each one
     in place of the kept row with the same `t`, or add it;
  4. the result must have `bars` rows, start at `first`, end at `last`, and its column CRC (section 4)
     must equal `crc`. Anything else: discard the delta and download the full pack.

### Which op the builder picks

`replace` for a symbol new in the build, for every symbol the BASE manifest's next-session `splits`
names for this as-of session (its basis changed), and whenever a merge cannot reproduce the new window
(a bar the server removed inside the overlap, a base row that is not exact at the new scales) or would
not be smaller than the full window. `keep` when the kept base rows ARE the new window. Otherwise
`merge`, whose blob holds the new session's bars plus every overlapping bar whose values changed.

### Fail-safe

Before a delta is uploaded the builder applies it to the base with the independent reference applier
and compares the result with the new pack, every symbol, every column, both scales, and the symbol set.
Any difference, a base whose bytes do not match the base manifest's `sha256` (it is read from the
worker's own copy of the last build, `<DATA_DIR>/ffseed_cache/`, else from R2), or any error: no delta
for that timeframe, and the manifest carries none. The full packs are uploaded first and never depend on
it.
