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
             "skipped":{"error":0,"inexact":0,"no_bars":9,"stale":12},
             "url":"/api/seed/v1/20261119T0131Z/5.ffs"}, "...": {}}}
```

(Numbers in this example are illustrative; section 7 has measured sizes.) A client compares
`build` with what it holds, downloads each changed `url`, checks `bytes` and `sha256`
(`crypto.subtle.digest('SHA-256', ...)`), and only then swaps the file in. A pack that fails the
check is discarded whole.

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

Being measured; this section is filled in by the same PR.

## 8. Versioning

* The magic's trailing `1` and the trailer's `v` are the version. A change to the body, the entry
  layout or the framing is version 2 with a new magic (`UFFSEED2`); a reader refuses what it does not
  know and falls back to the network. Adding a trailer key is not a version change (readers ignore
  unknown keys); changing `fields` is.
* The manifest's `v` versions the manifest; `build` changes every build and is the only cache key a
  client needs.

## 9. Freshness: the nightly build and a daily delta (design)

**Where it runs.** On the `worker` service (`start_ffseed_builder()` in `api/worker_main.py`, dark
until `FFSEED_ENABLED=1`), next to the D/W/M barspack: the worker holds the fullest `bars.db` and
makes zero provider calls to build. Once per closed session, after 20:15 ET (the extended session
has ended and the regular-session bars' repair window has had hours to land), it builds every
timeframe, uploading each pack as soon as it is built (one pack in memory at a time) and the
manifest last. Worker deploys are manual (`docs/runbooks/worker-deploys.md`).

**Daily delta (not built).** A returning device holds yesterday's packs. The new session adds, per
symbol, at most 390 / 78 / 26 / 13 / 7 / 1 bars (1 / 5 / 15 / 30 / 60 / D) and drops as many old
ones. A delta pack per timeframe, same format, `ffseed/<build>/<tf>.delta-<base build>.ffs`, would
hold per symbol either:

* `append`: only the bars after the base build's `last` (the overlap with the base was compared
  value for value at build time and is unchanged), or
* `replace`: the whole window, when any overlapping bar changed (a split re-based the history, a
  repair rewrote a bar) or the symbol is new.

The entry gains a `mode` and the base build id. The device applies it by decoding the base window,
appending, keeping the newest N, and re-encoding locally (or keeping two blobs until the next full
download). Because a 1m delta is 390 of 600 bars, the saving is largest on 5m-60m and D; measure
the full packs first (section 7): a full nightly download may be small enough not to need it.
