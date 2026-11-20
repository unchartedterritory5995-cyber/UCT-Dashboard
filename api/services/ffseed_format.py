"""First-frame seed pack format ("UFFSEED1"), version 1: encoder and reference decoder.

One pack = one timeframe, every symbol's NEWEST N bars, exactly as `/api/bars` serves them
(split-adjusted, 4-decimal store grain, regular-session view for intraday). The browser keeps one
pack per timeframe on the device (OPFS) so a chart's first frame never waits on the network.
Spec, byte layout and a worked example: docs/charts/first-frame-seed-format.md.

It is the history lake's pack and piece format (tools/history_lake/FORMAT.md) with three changes:

* the per-symbol blob is the piece BODY only (no per-piece header: everything the header held is
  in the trailer entry), stored raw or as one gzip member instead of Brotli, so page code can
  inflate it with `DecompressionStream('gzip')` (Chrome's DecompressionStream has no Brotli);
* the bars are the SERVED bars (basis "served": split-adjusted, sanitized), not raw vendor bars;
* a `D` series (tunit 86400: a daily bar's t is UTC midnight of its date).

The body is byte for byte the lake piece body (8 LEB128 columns T O H L C V VF N; N, the
transaction count, is 0 for every bar because `/api/bars` carries none), so the lake's column
decoder (`app/src/data/historyLake/piece.js` `decodeBody`) decodes it unchanged.

Pack layout (all integers little-endian), identical framing to the lake's UBHPACK1::

    blob 0 | blob 1 | ... | trailer JSON | u64 trailer length | b"UFFSEED1"

Prices are exact integers at the smallest power of ten (<= 1e9) that reproduces every served
price of the symbol bit for bit (`int / pscale == price` in IEEE doubles); volume likewise at
`vscale`. A series that no such scale can hold is refused (SeedError), never rounded.

This module is pure (numpy + stdlib): no app imports, so the builder, tests and tools share it.
"""
from __future__ import annotations

import gzip
import json
import struct
import zlib
from datetime import date, datetime, timezone
from typing import Dict, Iterable, List, Optional, Tuple

import numpy as np

MAGIC = b"UFFSEED1"
FORMAT_VERSION = 1
KIND = "ffseed"
BASIS = "served"
GRID = "rth"
#: Seconds per bar-time unit. 60m is 1800: its regular-session buckets start on :30 (09:30 ...).
T_UNIT = {"1": 60, "5": 300, "15": 900, "30": 1800, "60": 1800, "D": 86400}
TFS = tuple(T_UNIT)
COMPRESSIONS = ("gzip", "raw")
#: The trailer entry of one symbol, in this order.
ENTRY_FIELDS = ("off", "len", "bars", "first", "last", "asof", "crc", "body", "pscale", "vscale")
COLUMNS = ("t", "o", "h", "l", "c", "v", "n")
MAX_VALUE = 2 ** 53 - 1
MAX_PRICE = 2 ** 52 - 1
MAX_SCALE_DIGITS = 9
POWERS_OF_TEN = tuple(10 ** k for k in range(MAX_SCALE_DIGITS + 1))
_TAIL = struct.Struct("<Q")
_GZIP_LEVEL = 9


class SeedError(ValueError):
    """A series cannot be encoded exactly, or a pack failed validation."""


# --------------------------------------------------------------------------------------------
# served bars <-> exact integers
# --------------------------------------------------------------------------------------------

def _day_seconds(iso: str) -> int:
    try:
        d = date.fromisoformat(str(iso)[:10])
    except ValueError as exc:
        raise SeedError(f"daily bar time {iso!r} is not YYYY-MM-DD") from exc
    if len(str(iso)) != 10:
        raise SeedError(f"daily bar time {iso!r} is not YYYY-MM-DD")
    return (d - date(1970, 1, 1)).days * 86400


def iso_of_day_seconds(t: int) -> str:
    """The `YYYY-MM-DD` a daily bar's `t` (UTC midnight, epoch seconds) stands for."""
    return datetime.fromtimestamp(int(t), tz=timezone.utc).strftime("%Y-%m-%d")


def _float_column(name: str, bars: List[dict]) -> np.ndarray:
    vals = []
    for b in bars:
        x = b.get(name)
        if x is None or isinstance(x, bool) or not isinstance(x, (int, float)):
            raise SeedError(f"column {name!r} has a non-number value {x!r}")
        vals.append(x)
    arr = np.asarray(vals, dtype=np.float64)
    if not np.isfinite(arr).all():
        raise SeedError(f"column {name!r} has a non-finite value")
    return arr


def smallest_exact_scale(values: np.ndarray) -> Optional[Tuple[int, np.ndarray]]:
    """(scale, ints) for the smallest power of ten <= 1e9 at which every value is EXACTLY
    `int / scale` in IEEE doubles, or None when there is none. Values must be >= 0."""
    if values.size == 0:
        return 1, np.zeros(0, dtype=np.int64)
    top = float(np.abs(values).max())
    for scale in POWERS_OF_TEN:
        if top * scale >= 2.0 ** 53:
            return None
        ints = np.rint(values * scale)
        if (ints / float(scale) == values).all():
            return scale, ints.astype(np.int64)
    return None


def served_to_ints(bars: List[dict], tf: str) -> dict:
    """Served bars (`/api/bars` rows: t, o, h, l, c, v) -> exact integer columns.

    Returns {"t","o","h","l","c","v","n": int64 arrays, "pscale", "vscale"}. Intraday `t` is
    epoch seconds; a daily `t` ('YYYY-MM-DD') becomes UTC midnight in epoch seconds. Raises
    SeedError on anything the format cannot hold exactly (a null, a non-positive price, a
    negative volume, a value no power-of-ten scale <= 1e9 reproduces bit for bit).
    """
    if tf not in T_UNIT:
        raise SeedError(f"unknown timeframe {tf!r}")
    if not bars:
        raise SeedError("no bars")
    if tf == "D":
        t = np.asarray([_day_seconds(b.get("t")) for b in bars], dtype=np.int64)
    else:
        ts = []
        for b in bars:
            x = b.get("t")
            if isinstance(x, bool) or not isinstance(x, (int, float)) or x != int(x):
                raise SeedError(f"intraday bar time {x!r} is not whole epoch seconds")
            ts.append(int(x))
        t = np.asarray(ts, dtype=np.int64)
    prices = np.stack([_float_column(k, bars) for k in "ohlc"])
    if (prices <= 0).any():
        raise SeedError("a price is not positive")
    vol = _float_column("v", bars)
    if (vol < 0).any():
        raise SeedError("a volume is negative")
    ps = smallest_exact_scale(prices.reshape(-1))
    if ps is None:
        raise SeedError("prices are not exact at any power-of-ten scale up to 1e9")
    vs = smallest_exact_scale(vol)
    if vs is None:
        raise SeedError("volumes are not exact at any power-of-ten scale up to 1e9")
    pscale, pints = ps
    vscale, vints = vs
    pints = pints.reshape(4, -1)
    return {"t": t, "o": pints[0], "h": pints[1], "l": pints[2], "c": pints[3],
            "v": vints, "n": np.zeros(t.size, dtype=np.int64),
            "pscale": int(pscale), "vscale": int(vscale)}


def ints_to_served(cols: dict, tf: str) -> List[dict]:
    """Exact integer columns -> served bars: `int / scale` is the double `/api/bars` sent."""
    ps, vs = float(cols["pscale"]), float(cols["vscale"])
    out = []
    for i in range(len(cols["t"])):
        t = int(cols["t"][i])
        v = int(cols["v"][i])
        out.append({
            "t": iso_of_day_seconds(t) if tf == "D" else t,
            "o": int(cols["o"][i]) / ps, "h": int(cols["h"][i]) / ps,
            "l": int(cols["l"][i]) / ps, "c": int(cols["c"][i]) / ps,
            "v": v if cols["vscale"] == 1 else v / vs,
        })
    return out


# --------------------------------------------------------------------------------------------
# body: the lake piece body (8 varint columns)
# --------------------------------------------------------------------------------------------

_SHIFTS = np.arange(8, dtype=np.uint64) * np.uint64(7)
_THRESH = [np.uint64(1) << np.uint64(7 * k) for k in range(1, 8)]
_KIDX = np.arange(8)[None, :]


def _varint_encode(values: np.ndarray) -> bytes:
    u = np.ascontiguousarray(values, dtype=np.uint64)
    nbytes = np.ones(u.shape, dtype=np.int64)
    for thr in _THRESH:
        nbytes += u >= thr
    groups = ((u[:, None] >> _SHIFTS[None, :]) & np.uint64(0x7F)).astype(np.uint8)
    groups |= (_KIDX < (nbytes[:, None] - 1)).astype(np.uint8) << 7
    return groups[_KIDX < nbytes[:, None]].tobytes()


def _zigzag(x: np.ndarray) -> np.ndarray:
    x = x.astype(np.int64)
    return ((x << 1) ^ (x >> 63)).astype(np.uint64)


def columns_crc(cols: dict) -> int:
    """CRC-32 of t, o, h, l, c, v, n, each value as 8 bytes little-endian (lake piece `crc`)."""
    crc = 0
    for name in COLUMNS:
        crc = zlib.crc32(np.ascontiguousarray(cols[name], dtype="<u8").tobytes(), crc)
    return crc & 0xFFFFFFFF


def encode_body(cols: dict, tf: str) -> Tuple[bytes, dict]:
    """The decompressed body of one symbol and its trailer facts (bars, first, last, crc, body,
    pscale, vscale). Validates everything the decoder will check."""
    tunit = T_UNIT[tf]
    t = np.asarray(cols["t"], dtype=np.int64)
    n = int(t.size)
    if n == 0:
        raise SeedError("a series needs at least one bar")
    if int(t.min()) < 0:
        raise SeedError("a bar time is negative")
    if (t % tunit).any():
        raise SeedError(f"bar times must be multiples of {tunit}s for timeframe {tf!r}")
    if n > 1 and (np.diff(t) <= 0).any():
        raise SeedError("bar times must be strictly increasing")
    o, h, l, c = (np.asarray(cols[k], dtype=np.int64) for k in "ohlc")
    v = np.asarray(cols["v"], dtype=np.int64)
    nn = np.asarray(cols["n"], dtype=np.int64)
    pscale, vscale = int(cols["pscale"]), int(cols["vscale"])
    if pscale not in POWERS_OF_TEN or vscale not in POWERS_OF_TEN:
        raise SeedError("scales must be powers of ten up to 1e9")
    for name, a in (("o", o), ("h", h), ("l", l), ("c", c), ("v", v), ("n", nn)):
        if a.size != n:
            raise SeedError("columns have different lengths")
        if int(a.min()) < 0:
            raise SeedError(f"column {name!r} has a negative value")
    if max(int(x.max()) for x in (o, h, l, c)) > MAX_PRICE:
        raise SeedError("a price is too large for the format (>= 2**52 at its scale)")
    if max(int(t[-1]), int(v.max()), int(nn.max())) > MAX_VALUE:
        raise SeedError("a time, volume or count is above 2**53 - 1")
    prev_c = np.empty_like(c)
    prev_c[0] = 0
    prev_c[1:] = c[:-1]
    t_delta = np.empty_like(t)
    t_delta[0] = t[0]
    t_delta[1:] = t[1:] - t[:-1]
    stream = np.concatenate([
        (t_delta // tunit).astype(np.uint64),
        _zigzag(o - prev_c),
        _zigzag(h - np.maximum(o, c)),
        _zigzag(np.minimum(o, c) - l),
        _zigzag(c - o),
        (v // vscale).astype(np.uint64),
        (v % vscale).astype(np.uint64),
        nn.astype(np.uint64),
    ])
    body = _varint_encode(stream)
    facts = {"bars": n, "first": int(t[0]), "last": int(t[-1]), "body": len(body),
             "pscale": pscale, "vscale": vscale,
             "crc": columns_crc({"t": t, "o": o, "h": h, "l": l, "c": c, "v": v, "n": nn})}
    return body, facts


def compress(body: bytes, comp: str) -> bytes:
    if comp == "raw":
        return bytes(body)
    if comp == "gzip":
        return gzip.compress(body, compresslevel=_GZIP_LEVEL, mtime=0)
    raise SeedError(f"unknown compression {comp!r}")


def decompress(blob: bytes, comp: str) -> bytes:
    if comp == "raw":
        return bytes(blob)
    if comp == "gzip":
        try:
            return gzip.decompress(bytes(blob))
        except (OSError, EOFError, zlib.error) as exc:
            raise SeedError(f"blob is not one whole gzip member: {exc}") from exc
    raise SeedError(f"unknown compression {comp!r}")


# --------------------------------------------------------------------------------------------
# pack writer
# --------------------------------------------------------------------------------------------

def _json(obj) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")


def asof_int(asof: str) -> int:
    return int(date.fromisoformat(asof).strftime("%Y%m%d"))


class PackBuilder:
    """Collect one timeframe's symbols, then `finish()` -> the whole pack as bytes.

    Symbols are written in sorted order whatever order they were added in, so a pack is a pure
    function of (timeframe, as-of, build id, compression, depth, the bar sets)."""

    def __init__(self, tf: str, *, asof: str, build: str, depth: int, comp: str = "gzip"):
        if tf not in T_UNIT:
            raise SeedError(f"unknown timeframe {tf!r}")
        if comp not in COMPRESSIONS:
            raise SeedError(f"unknown compression {comp!r}")
        self.tf, self.asof, self.build, self.depth, self.comp = tf, asof, build, int(depth), comp
        self._asof_int = asof_int(asof)
        self._items: Dict[str, Tuple[bytes, dict]] = {}

    def add_served(self, symbol: str, bars: List[dict]) -> dict:
        """Encode one symbol's served bars. Raises SeedError (the symbol is then not in the pack)."""
        return self.add_ints(symbol, served_to_ints(bars, self.tf))

    def add_ints(self, symbol: str, cols: dict) -> dict:
        if not isinstance(symbol, str) or not symbol or not symbol.isascii():
            raise SeedError(f"bad symbol {symbol!r}")
        if symbol in self._items:
            raise SeedError(f"{symbol} twice in one pack")
        body, facts = encode_body(cols, self.tf)
        self._items[symbol] = (compress(body, self.comp), facts)
        return facts

    def __len__(self) -> int:
        return len(self._items)

    def finish(self) -> bytes:
        parts, entries, off = [], {}, 0
        for sym in sorted(self._items):
            blob, f = self._items[sym]
            parts.append(blob)
            entries[sym] = [off, len(blob), f["bars"], f["first"], f["last"], self._asof_int,
                            f["crc"], f["body"], f["pscale"], f["vscale"]]
            off += len(blob)
        trailer = _json({
            "v": FORMAT_VERSION, "kind": KIND, "tf": self.tf, "tunit": T_UNIT[self.tf],
            "basis": BASIS, "grid": GRID, "comp": self.comp, "depth": self.depth,
            "asof": self.asof, "build": self.build, "fields": list(ENTRY_FIELDS),
            "symbols": entries,
        })
        parts.append(trailer)
        parts.append(_TAIL.pack(len(trailer)))
        parts.append(MAGIC)
        return b"".join(parts)


# --------------------------------------------------------------------------------------------
# reference reader (the procedure of the spec, written the obvious way: the JS port's shape)
# --------------------------------------------------------------------------------------------

_TRAILER_KEYS = ("v", "kind", "tf", "tunit", "basis", "grid", "comp", "depth", "asof", "build",
                 "fields", "symbols")


def _is_count(x) -> bool:
    return isinstance(x, int) and not isinstance(x, bool) and 0 <= x <= MAX_VALUE


def read_trailer(data: bytes) -> dict:
    """Validate the framing and the trailer of a whole pack; returns the trailer with
    `blob_bytes` (where the blobs end) added. Raises SeedError."""
    data = memoryview(bytes(data)) if not isinstance(data, memoryview) else data
    size = len(data)
    if size < len(MAGIC) + _TAIL.size:
        raise SeedError("too short to be a seed pack")
    if bytes(data[size - len(MAGIC):]) != MAGIC:
        raise SeedError("not a seed pack (no UFFSEED1 end marker)")
    (tlen,) = _TAIL.unpack(bytes(data[size - len(MAGIC) - _TAIL.size:size - len(MAGIC)]))
    blob_end = size - len(MAGIC) - _TAIL.size - tlen
    if tlen <= 0 or blob_end < 0:
        raise SeedError("trailer length does not fit the file")
    try:
        tr = json.loads(bytes(data[blob_end:blob_end + tlen]).decode("ascii"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise SeedError(f"trailer is not ASCII JSON: {exc}") from exc
    if not isinstance(tr, dict) or any(k not in tr for k in _TRAILER_KEYS):
        raise SeedError("trailer is missing required keys")
    if tr["v"] != FORMAT_VERSION or tr["kind"] != KIND:
        raise SeedError(f"unsupported seed pack version/kind {tr.get('v')!r}/{tr.get('kind')!r}")
    if tr["tf"] not in T_UNIT or tr["tunit"] != T_UNIT[tr["tf"]]:
        raise SeedError("trailer tf/tunit are inconsistent")
    if tr["comp"] not in COMPRESSIONS or tr["basis"] != BASIS or tr["grid"] != GRID:
        raise SeedError("unsupported comp/basis/grid")
    if tr["fields"] != list(ENTRY_FIELDS) or not isinstance(tr["symbols"], dict):
        raise SeedError("trailer entry layout is not this version's")
    for sym, e in tr["symbols"].items():
        if not (isinstance(e, list) and len(e) == len(ENTRY_FIELDS) and all(_is_count(x) for x in e)):
            raise SeedError(f"bad trailer entry for {sym!r}")
        if e[0] + e[1] > blob_end:
            raise SeedError(f"entry for {sym!r} reaches past the blobs")
        if e[2] < 1 or e[8] not in POWERS_OF_TEN or e[9] not in POWERS_OF_TEN:
            raise SeedError(f"entry for {sym!r} has no bars or a bad scale")
    tr["blob_bytes"] = blob_end
    return tr


def decode_body(body: bytes, *, bars: int, first: int, last: int, crc: int, body_len: int,
                tunit: int, pscale: int, vscale: int) -> dict:
    """Spec section 5 steps 3-5, value by value (no numpy in the algorithm)."""
    if len(body) != body_len:
        raise SeedError(f"body is {len(body)} bytes, the entry says {body_len}")
    n = bars
    if n * 8 > len(body):
        raise SeedError("body holds fewer values than the entry claims")
    pos, columns = 0, []
    for _ in range(8):
        col = []
        for _ in range(n):
            value, mult, count = 0, 1, 0
            while True:
                if pos >= len(body):
                    raise SeedError("body ends inside a varint")
                byte = body[pos]
                pos += 1
                count += 1
                if count > 8:
                    raise SeedError("varint longer than 8 bytes")
                value += (byte & 0x7F) * mult
                mult *= 128
                if byte < 0x80:
                    if byte == 0 and count > 1:
                        raise SeedError("non-canonical varint")
                    break
            if value > MAX_VALUE:
                raise SeedError("value above 2**53 - 1")
            col.append(value)
        columns.append(col)
    if pos != len(body):
        raise SeedError("body has bytes left over after the last column")
    T, O, H, L, C, V, VF, N = columns

    def unzz(u):
        return u // 2 if u % 2 == 0 else -(u + 1) // 2

    t, o, h, low, c, v = [], [], [], [], [], []
    prev_t = prev_c = 0
    for i in range(n):
        ti = prev_t + T[i] * tunit
        oi = prev_c + unzz(O[i])
        ci = oi + unzz(C[i])
        hi = max(oi, ci) + unzz(H[i])
        li = min(oi, ci) - unzz(L[i])
        if VF[i] >= vscale:
            raise SeedError("fractional volume is not below vscale")
        vi = V[i] * vscale + VF[i]
        for x in (ti, oi, hi, li, ci, vi):
            if x < 0 or x > MAX_VALUE:
                raise SeedError("decoded value out of range")
        if i > 0 and ti <= prev_t:
            raise SeedError("decoded bar times are not strictly increasing")
        t.append(ti); o.append(oi); h.append(hi); low.append(li); c.append(ci); v.append(vi)
        prev_t, prev_c = ti, ci
    if t[0] != first or t[-1] != last:
        raise SeedError("first/last bar time does not match the entry")
    cols = {k: np.asarray(x, dtype=np.int64)
            for k, x in (("t", t), ("o", o), ("h", h), ("l", low), ("c", c), ("v", v), ("n", N))}
    if columns_crc(cols) != crc:
        raise SeedError("column CRC mismatch")
    cols["pscale"], cols["vscale"] = pscale, vscale
    return cols


def decode_symbol(data: bytes, trailer: dict, symbol: str) -> Optional[dict]:
    """One symbol's exact integer columns (+ pscale, vscale), or None when it is not in the pack."""
    e = trailer["symbols"].get(symbol)
    if e is None:
        return None
    off, ln, bars, first, last, _asof, crc, body_len, pscale, vscale = e
    body = decompress(bytes(memoryview(data)[off:off + ln]), trailer["comp"])
    return decode_body(body, bars=bars, first=first, last=last, crc=crc, body_len=body_len,
                       tunit=trailer["tunit"], pscale=pscale, vscale=vscale)


def read_served(data: bytes, symbol: str, trailer: Optional[dict] = None) -> Optional[List[dict]]:
    """The served bars of `symbol` from a whole pack (what `/api/bars` sent), or None."""
    tr = trailer or read_trailer(data)
    cols = decode_symbol(data, tr, symbol)
    return None if cols is None else ints_to_served(cols, tr["tf"])


def iter_symbols(trailer: dict) -> Iterable[str]:
    return iter(trailer["symbols"])
