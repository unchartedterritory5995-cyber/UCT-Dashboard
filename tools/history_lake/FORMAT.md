# History lake piece format (`.ubh`), version 1

One piece = one symbol, one series, one period, RAW (unadjusted) prices and
volume. The encoder and the reference decoder are `piece.py`; the builder is
`build.py`; the bucket grid is `bucketing.py` (pinned to
`api/services/bar_rollup.py::tv_bucket_bounds` by test).

## 1. What is in a piece

| series | bars                                      | period  | example   | `tunit` (s) |
|--------|-------------------------------------------|---------|-----------|-------------|
| `1`    | the raw minutes                           | month   | `2026-11` | 60          |
| `5`    | 5-minute floor                            | quarter | `2026Q4`  | 300         |
| `15`   | 15-minute floor                           | year    | `2026`    | 900         |
| `30`   | 30-minute floor                           | year    | `2026`    | 1800        |
| `60`   | 60-minute, 09:30-anchored ("rth" grid)    | year    | `2026`    | 1800        |
| `60e`  | 60-minute, ET clock hours ("eth" grid)    | year    | `2026`    | 3600        |

* Every series keeps every bar the raw data has, pre-market and after-hours
  included. A bucket with no trade has no bar.
* A bar's period is the ET calendar date of the bar's start.
* On the `60` grid, minutes outside the regular session are clock-hour bars
  (04:00 ... 08:00, a 09:00 bar holding 09:00-09:29, then 16:00 ... 19:00); the
  regular session is 09:30, 10:30, ... 14:30 and a 15:30 half bar (12:30 half
  bar and clock hours from 13:00 on a 13:00 early-close day). That is exactly
  what `tv_bucket_bounds(ts, "60", "rth")` returns.
* Aggregation: open = first minute's open, high = max, low = min,
  close = last minute's close, volume = sum, transactions = sum.
* `basis` is always `"raw"`. Split adjustment happens at read time (later step).

## 2. Paths

```
<root>/v1/<series>/<encoded symbol>/<period>.ubh
<root>/v1/index/<encoded symbol>.json
<root>/ledger.json
```

Encoded symbol = `s-` followed by the ticker, where every character outside
`A-Z` and `0-9` is replaced by `_` plus the two upper-case hex digits of each
of its UTF-8 bytes:

| ticker  | encoded      |
|---------|--------------|
| `NVDA`  | `s-NVDA`     |
| `BRK.B` | `s-BRK_2EB`  |
| `BACpB` | `s-BAC_70B`  |
| `CON`   | `s-CON`      |

JavaScript: `"s-" + [...new TextEncoder().encode(sym)].map(b => (b >= 48 && b <= 57) || (b >= 65 && b <= 90) ? String.fromCharCode(b) : "_" + b.toString(16).toUpperCase().padStart(2, "0")).join("")`.

Why: `CON` and `PRN` are real tickers and reserved Windows device names (the
prefix makes every name safe); `BCPC`/`BCpC` and `TPC`/`TpC` differ only by
case and must not collide on a case-insensitive file system (lower-case letters
are escaped).

## 3. File layout

All integers little-endian.

```
offset  size  field
0       3     magic "UBH" (0x55 0x42 0x48)
3       1     format version = 1
4       2     H = header length in bytes (uint16)
6       H     header: UTF-8 JSON object (compact, keys sorted, ASCII)
6+H     4     CRC-32 of bytes [0, 6+H)                    (uint32)
10+H    ...   body: one Brotli stream, to the end of the file
```

CRC-32 is the IEEE one (zlib / PNG / `crc32` in every standard library).

### Header

```json
{"bars":4640,"basis":"raw","body":82340,"crc":2553041821,"first":1794214800,
 "last":1794617940,"period":"2026-11","pscale":1000000,"series":"1",
 "symbol":"SPY","tunit":60,"v":1,"vscale":1000000}
```

(A real header: SPY, five trading days of November 2026, 4,640 minute bars in a
48,109-byte file. It is written on one line; wrapped here.)

| key      | meaning                                                              |
|----------|----------------------------------------------------------------------|
| `v`      | format version, equals byte 3                                        |
| `basis`  | `"raw"`                                                              |
| `symbol` | the vendor's ticker, verbatim                                        |
| `series` | `1` `5` `15` `30` `60` `60e`                                         |
| `period` | `YYYY-MM`, `YYYYQn` or `YYYY`                                        |
| `bars`   | N, the number of bars (>= 1)                                         |
| `first`  | start of the first bar, epoch seconds UTC                            |
| `last`   | start of the last bar, epoch seconds UTC                             |
| `tunit`  | seconds; every bar start is a multiple of it                         |
| `pscale` | power of ten (1 ... 1e9); price = integer / `pscale`                 |
| `vscale` | power of ten (1 ... 1e9); volume = integer / `vscale`                |
| `body`   | length in bytes of the decompressed body                             |
| `crc`    | CRC-32 of the decoded columns (below)                                |

`pscale` and `vscale` vary per piece: the encoder writes the smallest power of
ten that holds every value of the piece exactly. The vendor prints 6 decimals;
in 2026 about 1.2% of prices use the 5th/6th decimal and about 30% of minute
volumes are fractional, so `1000000` is common but not universal.

### Body

The decompressed body is 8 columns. Each column is exactly N unsigned LEB128
varints (7 data bits per byte, least-significant group first, high bit set on
every byte except the last). The columns follow one another with no padding
and no lengths:

| # | column | value for bar i (i = 0 .. N-1)                               |
|---|--------|--------------------------------------------------------------|
| 1 | `T`    | `t[0] / tunit`, then `(t[i] - t[i-1]) / tunit` (always >= 1)  |
| 2 | `O`    | `zz(o[i] - c[i-1])`, with `c[-1] = 0`                         |
| 3 | `H`    | `zz(h[i] - max(o[i], c[i]))`                                  |
| 4 | `L`    | `zz(min(o[i], c[i]) - l[i])`                                  |
| 5 | `C`    | `zz(c[i] - o[i])`                                             |
| 6 | `V`    | `floor(v[i] / vscale)` (whole shares)                         |
| 7 | `VF`   | `v[i] mod vscale` (fraction numerator, 0 when `vscale` = 1)   |
| 8 | `N`    | `n[i]` (transactions)                                         |

`t` is epoch seconds, `o h l c` are integers at `pscale`, `v` is an integer at
`vscale`. `zz` is zigzag: `zz(x) = 2x` for `x >= 0`, `-2x - 1` for `x < 0`.

`crc` = CRC-32 of the seven DECODED columns `t, o, h, l, c, v, n` in that
order (`v` recombined: `V * vscale + VF`), each value written as an 8-byte
little-endian unsigned integer.

### Limits

* Every decoded value is in `[0, 2^53)`; prices are also `< 2^52`, so a
  zigzagged price delta is `< 2^53`. A JavaScript decoder can therefore hold
  every number in a plain `Number`.
* Every varint is canonical (no trailing zero group) and at most 8 bytes.
* The encoder refuses anything outside these limits; the decoder rejects it.
  (A fractional volume at `vscale = 1000000` tops out at 9,007,199,254 shares
  per bar.)

## 4. Decoding, step by step

Written so it ports line for line to JavaScript
(`piece.decode_piece_reference` is this procedure in Python).

1. Need at least 10 bytes. Bytes 0-2 must be `UBH`; byte 3 must be `1`
   (otherwise: unsupported version).
2. `H = bytes[4] + 256 * bytes[5]`. Need at least `10 + H` bytes.
3. CRC-32 of `bytes[0 .. 6+H)` must equal the uint32 at `6+H`.
4. Parse `bytes[6 .. 6+H)` as JSON. Check: all 13 keys present; `v == 1`;
   `basis == "raw"`; `series` known and `tunit` is that series' unit;
   `bars >= 1`; `pscale` and `vscale` are powers of ten.
5. Brotli-decompress `bytes[10+H ..]` (the whole rest of the file; a decoder
   error or leftover input is a corrupt file). The result must be exactly
   `body` bytes long.
6. Read varints. `pos = 0`. For each of the 8 columns, read N values:
   ```
   value = 0; mult = 1; count = 0
   repeat:
       byte = body[pos]; pos += 1; count += 1      // running out of bytes: error
       if count > 8: error
       value += (byte & 0x7F) * mult               // multiply, do not shift (shifts are 32-bit in JS)
       mult *= 128
   until byte < 0x80
   if byte == 0 and count > 1: error               // non-canonical
   if value > 2^53 - 1: error
   ```
   After the 8th column `pos` must equal `body.length`.
7. Rebuild the bars, in order (`unzz(u) = u / 2` if `u` is even, else
   `-(u + 1) / 2`):
   ```
   t_prev = 0; c_prev = 0
   for i in 0 .. N-1:
       t[i] = t_prev + T[i] * tunit
       o[i] = c_prev + unzz(O[i])
       c[i] = o[i] + unzz(C[i])
       h[i] = max(o[i], c[i]) + unzz(H[i])
       l[i] = min(o[i], c[i]) - unzz(L[i])
       if VF[i] >= vscale: error
       v[i] = V[i] * vscale + VF[i]
       n[i] = N[i]
       t_prev = t[i]; c_prev = c[i]
   ```
8. Check: every value is in `[0, 2^53)`; `t` strictly increases
   (`t[i] > t[i-1]`); `t[0] == first`; `t[N-1] == last`; CRC-32 over `t, o, h, l, c, v, n` (each value as 8 bytes little-endian:
   low 32 bits then high 32 bits) equals `crc`.
9. Prices are `o[i] / pscale` etc., volume is `v[i] / vscale`. Dividing the
   integer by the scale in double precision gives exactly the double the
   vendor's decimal text parses to.

Any failed check means the file is corrupt or truncated: do not use it.

## 5. Merge

`merge_piece(existing, new_bars)`: bars are keyed by `t`. A new bar replaces the
existing bar with the same `t` (the vendor revises bars); bars only in one side
are kept; the result is sorted by `t` with no duplicate times and is re-encoded
at the smallest exact scales. Within `new_bars` the last occurrence of a time
wins. Because the encoding is a pure function of the bar set (at a given Brotli
quality), merging bars the piece already holds reproduces the same bytes.

## 6. Index and ledger

`v1/index/<encoded symbol>.json` (compact JSON, keys sorted) lists every piece
of the symbol:

```json
{"series":{"1":{"2026-11":{"bars":2785,"bytes":29481,"crc":3863332241,
                           "first":1794387600,"last":1794617940}},
           "5":{"2026Q4":{...}}, "15":{"2026":{...}}, ...},
 "symbol":"SPY","v":1}
```

`bytes` is the piece file's size; `bars`, `first`, `last`, `crc` repeat its
header. The builder writes a period's pieces first and the index after them, so
an index entry always describes a file that is already complete on disk.

In pack mode (section 9) the index is written by `publish.py`, not the builder,
and each entry also carries `off`: where the piece starts in its pack. The
published index also carries `splits` and `splits_as_of` (factors.py).

`ledger.json`: `{"v":1,"symbols":null | [...],"days":{"2026-11-13":{"size":27052524,"rows":1807599}}}`
-- the day files already folded in, with each file's size in bytes. A rerun
skips a listed day whose file size is unchanged.

## 7. Why these choices (measured)

Sample: 2026-11-11..13, 481 symbols, 241,275 minute bars, one piece per symbol,
bytes per bar of the whole body.

| variant                                                        | Brotli q9 | q10   | q11   |
|----------------------------------------------------------------|-----------|-------|-------|
| raw int64 columns                                              | 11.94     | -     | 10.84 |
| every price column as a plain delta from its own previous value| 10.03     | -     | 9.15  |
| row-interleaved varints (same transforms as v1)                | 9.45      | -     | 9.01  |
| v1 transforms, ONE volume column, unsigned H/L                 | 8.83      | 8.11  | 8.09  |
| same, zigzag H/L                                               | 8.80      | -     | 8.05  |
| **v1: zigzag H/L, volume split into whole + fraction**         | 7.53      | 6.76  | 6.76  |
| (not taken) v1 + prices split at 1e-4 with 4 remainder columns | 7.01      | 6.22  | 6.29  |

(The v1 row is the shipped encoder; the others are from the experiment script
that led to it.)

* The volume split is the big one: one fractional volume in a piece forces
  `vscale = 1000000`, which turns every whole-share volume into a 4-5 byte
  varint; splitting keeps whole shares small and the fraction column mostly 0.
* Zigzag on H and L is free after Brotli and keeps a bar whose high is below
  `max(open, close)` representable (none in the sample; raw is kept verbatim).
* Splitting prices the same way would save a further ~8% for four more
  columns; left out to keep the format small.
* Brotli quality, shipped encoder, same sample, single thread, whole
  `encode_piece` call: q5 7.57 B/bar at 280k bars/s; q9 7.53 at 92k; q10 6.76
  at 70k; q11 6.76 at 32k. **q10** is the default: q11's size at twice the
  speed, 10% smaller than q9. q9 buys 0.6% over q5 for three times the time, so
  the realistic alternative to q10 is q5 (`--quality 5`: +9% bytes on a full
  build, about 2.5x faster end to end). Decoding runs at ~1.3M bars/s in the
  numpy decoder at every quality.

## 8. Measured on a full week

`build.py`, all symbols, 2026-11-09..13 (5 day files, 140.8 MB gzipped CSV,
9,312,824 minute rows, 12,823 symbols), one process, Brotli q10:

| series | pieces | bars      | bytes      | bytes/bar | body bytes/bar |
|--------|--------|-----------|------------|-----------|----------------|
| `1`    | 12,823 | 9,312,824 | 63,277,884 | 6.80      | 6.52           |
| `5`    | 12,823 | 3,040,376 | 28,430,466 | 9.35      | 8.52           |
| `15`   | 12,823 | 1,329,388 | 15,955,811 | 12.00     | 10.11          |
| `30`   | 12,823 | 777,908   | 11,168,016 | 14.36     | 11.13          |
| `60`   | 12,823 | 479,708   | 8,354,686  | 17.42     | 12.19          |
| `60e`  | 12,823 | 463,391   | 8,235,984  | 17.77     | 12.34          |

Total 135.4 MB in 76,938 pieces. "bytes/bar" includes the ~196-byte header of
every piece, which weighs on a five-day build of yearly pieces; "body" does not.
Coarser bars cost more bytes each because their deltas are larger.

## 9. Packs (build.py --packs)

A file per piece costs 3-4 random disk operations per piece, and a month of 1m
history is ~11,000 pieces: on a spinning disk ~1,000 s a month, over a day for
the lake, and as long again to merge or upload. In pack mode every symbol's piece
of one series and one period is ONE file, written front to back:

    packs/<series>/<period>.pack
    = piece blob 0 | piece blob 1 | ... | trailer JSON | u64 LE trailer length | "UBHPACK1"

The trailer is `{"v":1,"series":..,"period":..,"pieces":{"<SYMBOL>":[off,len,bars,
first,last,crc],...}}` (compact, keys sorted). Each blob is byte for byte the piece
file section 3 describes. The trailer is inside the file, so a pack is written as
`.tmp` and renamed once: a pack on disk is always whole.

A period built over two runs is folded into its existing pack: a symbol in both
is merged (section 5); a symbol only in the old pack is carried over unchanged.
`publish.py` reads the packs, checks every piece header against its trailer
entry, writes the indexes (section 6, with `off`), and uploads packs and then
indexes. At the edge a piece is one ranged read of its pack.
