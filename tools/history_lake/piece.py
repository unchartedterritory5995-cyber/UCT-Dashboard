"""The history-lake piece: one symbol, one series, one period, RAW prices.

A piece is the unit a client downloads: e.g. every 1-minute bar of NVDA for
November 2026. Prices and volume are UNADJUSTED ("basis": "raw"); split
adjustment is applied at read time from a separate factor file (a later step).

Series and periods (period boundaries are the ET calendar date of the bar)::

    series  bucket grid (bucketing.py)        period        example
    1       the raw minutes                   month         2026-11
    5       5-minute floor                    quarter       2026Q4
    15      15-minute floor                   year          2026
    30      30-minute floor                   year          2026
    60      60-minute, 09:30-anchored (rth)   year          2026
    60e     60-minute, ET clock hours (eth)   year          2026

File layout, format version 1 (all integers little-endian)::

    offset  size  field
    0       3     magic  "UBH"  (55 42 48)
    3       1     format version = 1
    4       2     H = header length in bytes (uint16)
    6       H     header: compact UTF-8 JSON object, keys sorted
    6+H     4     CRC-32 (IEEE, zlib) of bytes [0, 6+H)          (uint32)
    10+H    ...   body: ONE Brotli stream, to the end of the file

Header keys::

    v        1                      format version (equals byte 3)
    basis    "raw"                  unadjusted prices and volume
    symbol   "NVDA"                 the vendor's ticker, verbatim
    series   "1"|"5"|"15"|"30"|"60"|"60e"
    period   "2026-11" | "2026Q4" | "2026"
    bars     N                      number of bars (>= 1)
    first    epoch seconds (UTC) of the first bar's start
    last     epoch seconds (UTC) of the last bar's start
    tunit    seconds; every bar time is a multiple of it (60/300/900/1800/1800/3600)
    pscale   power of ten; price = integer / pscale        (e.g. 10000, 1000000)
    vscale   power of ten; volume = integer / vscale       (1 when all volumes are whole)
    body     length in bytes of the DEcompressed body
    crc      CRC-32 of the decoded columns (see below)

Decompressed body = 8 columns, each exactly N unsigned LEB128 varints, one
column after another, in this order (i = 0..N-1; "zz" is zigzag,
zz(x) = 2x for x >= 0, -2x-1 for x < 0; a[-1] means 0)::

    T    t[0]/tunit, then (t[i] - t[i-1])/tunit        (>= 1 after the first)
    O    zz(o[i] - c[i-1])                             open vs previous close
    H    zz(h[i] - max(o[i], c[i]))
    L    zz(min(o[i], c[i]) - l[i])
    C    zz(c[i] - o[i])
    V    v[i] div vscale                               whole shares
    VF   v[i] mod vscale                               fractional shares numerator
    N    n[i]                                          transactions

where t is epoch seconds, o/h/l/c are integers at ``pscale``, v is an integer
at ``vscale`` and n is a count. ``crc`` is the CRC-32 of the seven decoded
columns t, o, h, l, c, v, n in that order, each value written as an 8-byte
little-endian unsigned integer.

Limits (so a JavaScript decoder can use plain Numbers): every decoded value is
in [0, 2**53), prices are also < 2**52 (so a zigzagged price delta stays below
2**53), and every varint is canonical and at most 8 bytes. The encoder refuses
anything else; the decoder rejects it.

The encoder always writes the SMALLEST exact ``pscale``/``vscale`` for the bars
it is given, so a piece's bytes are a pure function of
(symbol, series, period, bar set, Brotli quality). That is what makes builds
idempotent and resumable: merging the same bars again reproduces the same file.

Why these transforms (measured on 2026-11-11..13, 481 symbols, 241k minute
bars, Brotli q10, bytes per bar): raw int64 columns 10.8; plain per-column
deltas 9.1; the transforms above with one volume column 8.1; splitting volume
into whole + fraction (the vendor reports fractional shares on ~30% of 2026
minutes, to 6 decimals) 6.8. Zigzag on H and L costs nothing after Brotli and
keeps a bar whose high is below its close representable. Brotli q10 is within
0.3% of q11 at twice the speed; q9 is 9% larger.
"""
from __future__ import annotations

import json
import re
import zlib
from typing import Dict, Optional

import brotli
import numpy as np

try:  # package import (tests, `python -m tools.history_lake.build`)
    from . import bucketing
except ImportError:  # script mode: `python tools/history_lake/build.py`
    import bucketing  # type: ignore[no-redef]

MAGIC = b"UBH"
FORMAT_VERSION = 1
DEFAULT_QUALITY = 10
#: bar-time unit per series (seconds). 60 is 1800: its buckets start on :00 or :30.
T_UNIT = {"1": 60, "5": 300, "15": 900, "30": 1800, "60": 1800, "60e": 3600}
SERIES_IDS = tuple(T_UNIT)
COLUMNS = ("t", "o", "h", "l", "c", "v", "n")
#: the scale ``bars_from_floats`` works at (the vendor prints 6 decimals)
WORK_SCALE = 10 ** 6
MAX_VALUE = 2 ** 53 - 1          # Number.MAX_SAFE_INTEGER
MAX_PRICE = 2 ** 52 - 1
_MAX_SCALE_DIGITS = 9
_HEADER_KEYS = ("v", "basis", "symbol", "series", "period", "bars", "first", "last",
                "tunit", "pscale", "vscale", "body", "crc")


class PieceError(ValueError):
    """A piece could not be encoded, or failed validation on decode."""


# --------------------------------------------------------------------------
# periods and paths
# --------------------------------------------------------------------------

def period_of(series: str, day) -> str:
    """Period id that holds bars of ET calendar date ``day`` for ``series``."""
    if series not in T_UNIT:
        raise PieceError(f"unknown series {series!r}")
    ymd = bucketing.to_ymd(day)
    y, m = ymd // 10000, ymd // 100 % 100
    if series == "1":
        return f"{y:04d}-{m:02d}"
    if series == "5":
        return f"{y:04d}Q{(m - 1) // 3 + 1}"
    return f"{y:04d}"


_PERIOD_RE = {"1": re.compile(r"^\d{4}-(0[1-9]|1[0-2])$"),
              "5": re.compile(r"^\d{4}Q[1-4]$")}
_YEAR_RE = re.compile(r"^\d{4}$")


def _check_period_form(series: str, period: str) -> None:
    rx = _PERIOD_RE.get(series, _YEAR_RE)
    if not isinstance(period, str) or not rx.match(period):
        raise PieceError(f"period {period!r} is not a valid period for series {series!r}")


_SAFE = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")


def encode_symbol(symbol: str) -> str:
    """File-system-safe, case-safe, reversible path component for a ticker.

    ``s-`` + the ticker with every character outside ``[A-Z0-9]`` replaced by
    ``_`` and the two upper-case hex digits of each of its UTF-8 bytes:
    ``NVDA -> s-NVDA``, ``BRK.B -> s-BRK_2EB``, ``BACpB -> s-BAC_70B``.
    The prefix is there because ``CON`` and ``PRN`` are real tickers and
    reserved Windows device names; the hex escape because ``BCPC`` / ``BCpC``
    differ only by case and NTFS is case-insensitive.
    """
    if not isinstance(symbol, str) or not symbol:
        raise PieceError("symbol must be a non-empty string")
    out = ["s-"]
    for ch in symbol:
        if ch in _SAFE:
            out.append(ch)
        else:
            out.extend(f"_{b:02X}" for b in ch.encode("utf-8"))
    return "".join(out)


def decode_symbol(component: str) -> str:
    """Inverse of ``encode_symbol``."""
    if not component.startswith("s-"):
        raise PieceError(f"not an encoded symbol: {component!r}")
    body, raw, i = component[2:], bytearray(), 0
    while i < len(body):
        ch = body[i]
        if ch == "_":
            hexpair = body[i + 1:i + 3]
            if len(hexpair) != 2 or not re.fullmatch(r"[0-9A-F]{2}", hexpair):
                raise PieceError(f"bad escape in encoded symbol: {component!r}")
            raw.append(int(hexpair, 16))
            i += 3
        elif ch in _SAFE:
            raw.append(ord(ch))
            i += 1
        else:
            raise PieceError(f"bad character in encoded symbol: {component!r}")
    try:
        symbol = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise PieceError(f"bad escape in encoded symbol: {component!r}") from exc
    if not symbol or encode_symbol(symbol) != component:
        raise PieceError(f"non-canonical encoded symbol: {component!r}")
    return symbol


def piece_relpath(series: str, symbol: str, period: str) -> str:
    """``v1/<series>/<encoded symbol>/<period>.ubh`` (forward slashes)."""
    if series not in T_UNIT:
        raise PieceError(f"unknown series {series!r}")
    _check_period_form(series, period)
    return f"v{FORMAT_VERSION}/{series}/{encode_symbol(symbol)}/{period}.ubh"


def index_relpath(symbol: str) -> str:
    """``v1/index/<encoded symbol>.json`` (forward slashes)."""
    return f"v{FORMAT_VERSION}/index/{encode_symbol(symbol)}.json"


# --------------------------------------------------------------------------
# varints / zigzag
# --------------------------------------------------------------------------

_SHIFTS = np.arange(8, dtype=np.uint64) * np.uint64(7)
_THRESH = [np.uint64(1) << np.uint64(7 * k) for k in range(1, 8)]
_KIDX = np.arange(8)[None, :]


def _varint_encode(values: np.ndarray) -> bytes:
    """Unsigned LEB128 of each value (all < 2**56), concatenated."""
    u = np.ascontiguousarray(values, dtype=np.uint64)
    nbytes = np.ones(u.shape, dtype=np.int64)
    for thr in _THRESH:
        nbytes += u >= thr
    groups = ((u[:, None] >> _SHIFTS[None, :]) & np.uint64(0x7F)).astype(np.uint8)
    groups |= (_KIDX < (nbytes[:, None] - 1)).astype(np.uint8) << 7   # continuation bit
    return groups[_KIDX < nbytes[:, None]].tobytes()


def _varint_decode(buf: bytes, count: int) -> np.ndarray:
    """Exactly ``count`` canonical varints (<= 8 bytes each) filling ``buf``."""
    b = np.frombuffer(buf, dtype=np.uint8)
    if b.size == 0:
        raise PieceError("body is empty")
    is_last = (b & 0x80) == 0
    if not is_last[-1]:
        raise PieceError("body ends inside a varint")
    ends = np.flatnonzero(is_last)
    if ends.size != count:
        raise PieceError(f"body holds {ends.size} values, expected {count}")
    starts = np.empty_like(ends)
    starts[0] = 0
    starts[1:] = ends[:-1] + 1
    lens = ends - starts + 1
    if int(lens.max()) > 8:
        raise PieceError("varint longer than 8 bytes")
    if ((b[ends] == 0) & (lens > 1)).any():
        raise PieceError("non-canonical varint")
    pos = np.arange(b.size, dtype=np.int64) - np.repeat(starts, lens)
    contrib = (b & 0x7F).astype(np.uint64) << (pos * 7).astype(np.uint64)
    vals = np.add.reduceat(contrib, starts)
    if int(vals.max()) > MAX_VALUE:
        raise PieceError("value above 2**53 - 1")
    return vals


def _zigzag(x: np.ndarray) -> np.ndarray:
    x = x.astype(np.int64)
    return ((x << 1) ^ (x >> 63)).astype(np.uint64)


def _unzigzag(u: np.ndarray) -> np.ndarray:
    u = u.astype(np.uint64)
    return (u >> np.uint64(1)).astype(np.int64) ^ -(u & np.uint64(1)).astype(np.int64)


def _columns_crc(cols: Dict[str, np.ndarray]) -> int:
    crc = 0
    for name in COLUMNS:
        crc = zlib.crc32(np.ascontiguousarray(cols[name], dtype="<u8").tobytes(), crc)
    return crc & 0xFFFFFFFF


# --------------------------------------------------------------------------
# bars helpers
# --------------------------------------------------------------------------

def _as_int_column(name: str, a) -> np.ndarray:
    arr = np.asarray(a)
    if arr.ndim != 1:
        raise PieceError(f"column {name!r} must be one-dimensional")
    if arr.dtype.kind not in "iu":
        raise PieceError(f"column {name!r} must be an integer array, got {arr.dtype}")
    if arr.dtype.kind == "u" and arr.size and int(arr.max()) > MAX_VALUE:
        raise PieceError(f"column {name!r} has a value above 2**53 - 1")
    return arr.astype(np.int64, copy=False)


def _exact_scaled(name: str, a, scale: int) -> np.ndarray:
    x = np.asarray(a, dtype=np.float64)
    if not np.isfinite(x).all():
        raise PieceError(f"column {name!r} has a non-finite value")
    if x.size and (np.abs(x).max() * scale >= 2.0 ** 53):
        raise PieceError(f"column {name!r} is too large to hold exactly at scale {scale}")
    ints = np.rint(x * scale).astype(np.int64)
    bad = ints / float(scale) != x
    if bad.any():
        i = int(np.flatnonzero(bad)[0])
        raise PieceError(
            f"column {name!r}: {int(bad.sum())} value(s) do not round-trip at scale {scale} "
            f"(first: {x[i]!r} at row {i})")
    return ints


def bars_from_floats(t, o, h, l, c, v, n) -> Dict[str, np.ndarray]:
    """Bars as exact integers at ``WORK_SCALE`` (1e6) from float columns.

    ``t`` is epoch seconds. Raises ``PieceError`` if any price or volume is not
    EXACTLY a multiple of 1e-6 (i.e. ``int / 1e6`` would not reproduce the float
    bit for bit), so nothing is ever silently rounded.
    """
    return {
        "t": _as_int_column("t", t),
        "o": _exact_scaled("o", o, WORK_SCALE), "h": _exact_scaled("h", h, WORK_SCALE),
        "l": _exact_scaled("l", l, WORK_SCALE), "c": _exact_scaled("c", c, WORK_SCALE),
        "v": _exact_scaled("v", v, WORK_SCALE),
        "n": _as_int_column("n", n),
    }


def bars_to_floats(decoded: Dict) -> Dict[str, np.ndarray]:
    """Float prices/volume from a decoded piece: ``int / scale`` (the nearest
    double to the decimal the vendor printed)."""
    hdr = decoded["header"]
    ps, vs = float(hdr["pscale"]), float(hdr["vscale"])
    return {
        "t": decoded["t"].copy(),
        "o": decoded["o"] / ps, "h": decoded["h"] / ps,
        "l": decoded["l"] / ps, "c": decoded["c"] / ps,
        "v": decoded["v"] / vs,
        "n": decoded["n"].copy(),
    }


def _is_power_of_ten(x) -> bool:
    return isinstance(x, int) and not isinstance(x, bool) and x in tuple(10 ** k for k in range(_MAX_SCALE_DIGITS + 1))


def _minimal_scale(arrays, scale: int):
    """Divide out every factor of ten shared by all values: (arrays, scale)."""
    while scale > 1:
        if any((a % 10).any() for a in arrays):
            break
        arrays = [a // 10 for a in arrays]
        scale //= 10
    return arrays, scale


def _normalise(bars: Dict, price_scale: int, vol_scale: int) -> Dict[str, np.ndarray]:
    missing = [k for k in COLUMNS if k not in bars]
    if missing:
        raise PieceError(f"bars are missing columns: {missing}")
    if not _is_power_of_ten(price_scale) or not _is_power_of_ten(vol_scale):
        raise PieceError("price_scale and vol_scale must be powers of ten up to 1e9")
    cols = {k: _as_int_column(k, bars[k]) for k in COLUMNS}
    n = cols["t"].size
    if any(cols[k].size != n for k in COLUMNS):
        raise PieceError("columns have different lengths")
    return cols


# --------------------------------------------------------------------------
# encode / decode / merge
# --------------------------------------------------------------------------

def encode_piece(symbol: str, series: str, period: str, bars: Dict, *,
                 price_scale: int = WORK_SCALE, vol_scale: int = WORK_SCALE,
                 quality: int = DEFAULT_QUALITY) -> bytes:
    """Encode one piece.

    ``bars`` maps ``t o h l c v n`` to equal-length integer arrays: ``t`` epoch
    seconds (strictly increasing, bucket starts of ``series``), ``o h l c``
    integers at ``price_scale``, ``v`` an integer at ``vol_scale``, ``n`` the
    transaction count. Use ``bars_from_floats`` to get there from floats.
    Raises ``PieceError`` on empty input or anything the format cannot hold.
    """
    if series not in T_UNIT:
        raise PieceError(f"unknown series {series!r}")
    _check_period_form(series, period)
    encode_symbol(symbol)  # validates
    cols = _normalise(bars, price_scale, vol_scale)
    t = cols["t"]
    n_bars = int(t.size)
    if n_bars == 0:
        raise PieceError("a piece needs at least one bar")
    tunit = T_UNIT[series]
    if (t % tunit).any():
        raise PieceError(f"bar times must be multiples of {tunit}s for series {series!r}")
    if n_bars > 1 and (np.diff(t) <= 0).any():
        raise PieceError("bar times must be strictly increasing (sort and de-duplicate first)")
    for name in COLUMNS:
        if int(cols[name].min()) < 0:
            raise PieceError(f"column {name!r} has a negative value")
    for day_t in (int(t[0]), int(t[-1])):
        got = period_of(series, bucketing.et_date_of(day_t))
        if got != period:
            raise PieceError(f"bar at {day_t} belongs to period {got}, not {period}")

    (o, h, l, c), pscale = _minimal_scale([cols[k] for k in "ohlc"], price_scale)
    (v,), vscale = _minimal_scale([cols["v"]], vol_scale)
    nn = cols["n"]
    if max(int(x.max()) for x in (o, h, l, c)) > MAX_PRICE:
        raise PieceError("a price is too large for the format (>= 2**52 at the piece's scale)")
    if max(int(t[-1]), int(v.max()), int(nn.max())) > MAX_VALUE:
        raise PieceError("a time, volume or transaction count is above 2**53 - 1")

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
    header = {
        "v": FORMAT_VERSION, "basis": "raw", "symbol": symbol, "series": series,
        "period": period, "bars": n_bars, "first": int(t[0]), "last": int(t[-1]),
        "tunit": tunit, "pscale": pscale, "vscale": vscale, "body": len(body),
        "crc": _columns_crc({"t": t, "o": o, "h": h, "l": l, "c": c, "v": v, "n": nn}),
    }
    hjson = json.dumps(header, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")
    if len(hjson) > 0xFFFF:
        raise PieceError("header too large")
    prefix = MAGIC + bytes([FORMAT_VERSION]) + len(hjson).to_bytes(2, "little") + hjson
    prefix += (zlib.crc32(prefix) & 0xFFFFFFFF).to_bytes(4, "little")
    return prefix + brotli.compress(body, quality=int(quality))


def _parse_prefix(data: bytes):
    """Validate magic/version/header; return (header dict, offset of the body)."""
    if not isinstance(data, (bytes, bytearray, memoryview)):
        raise PieceError("piece must be bytes")
    data = bytes(data)
    if len(data) < 10:
        raise PieceError(f"truncated piece: {len(data)} bytes")
    if data[:3] != MAGIC:
        raise PieceError("bad magic: not a history-lake piece")
    if data[3] != FORMAT_VERSION:
        raise PieceError(f"unsupported format version {data[3]} (this reader knows {FORMAT_VERSION})")
    hlen = int.from_bytes(data[4:6], "little")
    end = 6 + hlen
    if len(data) < end + 4:
        raise PieceError("truncated piece: header incomplete")
    if zlib.crc32(data[:end]) & 0xFFFFFFFF != int.from_bytes(data[end:end + 4], "little"):
        raise PieceError("header CRC mismatch")
    try:
        header = json.loads(data[6:end].decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise PieceError(f"header is not valid JSON: {exc}") from exc
    if not isinstance(header, dict) or any(k not in header for k in _HEADER_KEYS):
        raise PieceError("header is missing required keys")
    if header["v"] != FORMAT_VERSION:
        raise PieceError("header version does not match the version byte")
    if header["basis"] != "raw":
        raise PieceError(f"unsupported basis {header['basis']!r}")
    series = header["series"]
    if series not in T_UNIT or header["tunit"] != T_UNIT[series]:
        raise PieceError("header series/tunit are inconsistent")
    for key in ("bars", "first", "last", "body", "crc"):
        val = header[key]
        if not isinstance(val, int) or isinstance(val, bool) or val < 0:
            raise PieceError(f"header field {key!r} is not a non-negative integer")
    if header["bars"] < 1:
        raise PieceError("header says the piece has no bars")
    if not _is_power_of_ten(header["pscale"]) or not _is_power_of_ten(header["vscale"]):
        raise PieceError("header scales are not powers of ten")
    if not isinstance(header["symbol"], str) or not header["symbol"]:
        raise PieceError("header symbol is empty")
    _check_period_form(series, header["period"])
    return header, end + 4


def read_header(data: bytes) -> Dict:
    """The validated header only (no decompression)."""
    return _parse_prefix(data)[0]


def _decompress_body(data: bytes, offset: int, header: Dict) -> bytes:
    try:
        body = brotli.decompress(bytes(data[offset:]))
    except brotli.error as exc:
        raise PieceError(f"body is corrupt or truncated: {exc}") from exc
    if len(body) != header["body"]:
        raise PieceError(f"body is {len(body)} bytes, header says {header['body']}")
    return body


def _finish(header: Dict, cols: Dict[str, np.ndarray]) -> Dict:
    n = header["bars"]
    t = cols["t"]
    for name in COLUMNS:
        col = cols[name]
        if int(col.min()) < 0 or int(col.max()) > MAX_VALUE:
            raise PieceError(f"decoded column {name!r} is out of range")
    if n > 1 and (np.diff(t) <= 0).any():
        raise PieceError("decoded bar times are not strictly increasing")
    if int(t[0]) != header["first"] or int(t[-1]) != header["last"]:
        raise PieceError("first/last bar time does not match the header")
    if _columns_crc(cols) != header["crc"]:
        raise PieceError("column CRC mismatch")
    out = {"header": header}
    out.update(cols)
    return out


def decode_piece(data: bytes) -> Dict:
    """Decode a piece: ``{"header": {...}, "t","o","h","l","c","v","n": int64 arrays}``.

    ``t`` is epoch seconds; ``o h l c`` are integers at ``header["pscale"]``;
    ``v`` at ``header["vscale"]`` (``bars_to_floats`` divides them out).
    Verifies magic, version, header CRC, body length, bar count, ordering,
    first/last and the column CRC; raises ``PieceError`` on any mismatch.
    """
    header, offset = _parse_prefix(data)
    body = _decompress_body(data, offset, header)
    n = header["bars"]
    stream = _varint_decode(body, 8 * n)
    T, O, H, L, C, V, VF, N = (stream[i * n:(i + 1) * n] for i in range(8))
    t_units = np.cumsum(T)                       # uint64; each step < 2**53, so the max sees any overflow
    if int(t_units.max()) > MAX_VALUE // header["tunit"]:
        raise PieceError("decoded bar time is out of range")
    t = t_units.astype(np.int64) * header["tunit"]
    d_open, d_close = _unzigzag(O), _unzigzag(C)
    c = np.cumsum(d_open + d_close)
    o = c - d_close
    h = np.maximum(o, c) + _unzigzag(H)
    low = np.minimum(o, c) - _unzigzag(L)
    vscale = header["vscale"]
    if int(VF.max()) >= vscale:
        raise PieceError("fractional volume is not below vscale")
    if int(V.max()) > MAX_VALUE // vscale:
        raise PieceError("decoded volume is out of range")
    v = V.astype(np.int64) * vscale + VF.astype(np.int64)
    return _finish(header, {"t": t, "o": o, "h": h, "l": low, "c": c, "v": v, "n": N.astype(np.int64)})


def decode_piece_reference(data: bytes) -> Dict:
    """The decoder written the slow, obvious way -- no numpy in the algorithm.

    This is the step-by-step procedure of FORMAT.md and the shape a JavaScript
    port takes. It must agree with ``decode_piece`` on every piece (tested).
    """
    header, offset = _parse_prefix(data)
    body = _decompress_body(data, offset, header)
    n, tunit, vscale = header["bars"], header["tunit"], header["vscale"]

    pos = 0
    columns = []
    for _ in range(8):
        col = []
        for _ in range(n):
            value, mult, nbytes = 0, 1, 0
            while True:
                if pos >= len(body):
                    raise PieceError("body ends inside a varint")
                byte = body[pos]
                pos += 1
                nbytes += 1
                if nbytes > 8:
                    raise PieceError("varint longer than 8 bytes")
                value += (byte & 0x7F) * mult        # multiply, not shift: safe as a JS Number
                mult *= 128
                if byte < 0x80:
                    if byte == 0 and nbytes > 1:
                        raise PieceError("non-canonical varint")
                    break
            if value > MAX_VALUE:
                raise PieceError("value above 2**53 - 1")
            col.append(value)
        columns.append(col)
    if pos != len(body):
        raise PieceError("body has bytes left over after the last column")
    T, O, H, L, C, V, VF, N = columns

    def unzz(u):
        return u // 2 if u % 2 == 0 else -(u + 1) // 2

    t, o, h, low, c, v = [], [], [], [], [], []
    prev_t, prev_c = 0, 0
    for i in range(n):
        prev_t += T[i] * tunit
        oi = prev_c + unzz(O[i])
        ci = oi + unzz(C[i])
        hi = max(oi, ci) + unzz(H[i])
        li = min(oi, ci) - unzz(L[i])
        if VF[i] >= vscale:
            raise PieceError("fractional volume is not below vscale")
        t.append(prev_t); o.append(oi); h.append(hi); low.append(li); c.append(ci)
        v.append(V[i] * vscale + VF[i])
        prev_c = ci
    for name, col in (("t", t), ("o", o), ("h", h), ("l", low), ("c", c), ("v", v), ("n", N)):
        if min(col) < 0 or max(col) > MAX_VALUE:
            raise PieceError(f"decoded column {name!r} is out of range")
    cols = {k: np.array(col, dtype=np.int64)
            for k, col in (("t", t), ("o", o), ("h", h), ("l", low), ("c", c), ("v", v), ("n", N))}
    return _finish(header, cols)


def _rescale(cols: Dict[str, np.ndarray], pscale: int, vscale: int,
             to_pscale: int, to_vscale: int) -> Dict[str, np.ndarray]:
    out = dict(cols)
    pf, vf = to_pscale // pscale, to_vscale // vscale
    if pf != 1:
        for k in "ohlc":
            if int(out[k].max()) > MAX_VALUE // pf:
                raise PieceError("price overflow while rescaling for merge")
            out[k] = out[k] * pf
    if vf != 1:
        if int(out["v"].max()) > MAX_VALUE // vf:
            raise PieceError("volume overflow while rescaling for merge")
        out["v"] = out["v"] * vf
    return out


def merge_bars(old: Optional[Dict[str, np.ndarray]], new: Dict[str, np.ndarray]) -> Dict[str, np.ndarray]:
    """Union of two bar sets (same scales) keyed by ``t``: a bar in ``new``
    REPLACES the bar with the same ``t`` in ``old`` (the vendor revises bars);
    within one set the LAST occurrence of a ``t`` wins. Output is sorted by
    ``t`` and has no duplicate times."""
    if old is None:
        cat = {k: np.asarray(new[k], dtype=np.int64) for k in COLUMNS}
    else:
        cat = {k: np.concatenate([np.asarray(old[k], dtype=np.int64),
                                  np.asarray(new[k], dtype=np.int64)]) for k in COLUMNS}
    t = cat["t"]
    if t.size == 0:
        return cat
    order = np.argsort(t, kind="stable")          # equal times keep input order: old, then new
    ts = t[order]
    keep = np.ones(ts.size, dtype=bool)
    keep[:-1] = ts[1:] != ts[:-1]                 # keep the LAST of each run of equal times
    idx = order[keep]
    return {k: cat[k][idx] for k in COLUMNS}


def merge_piece(existing: Optional[bytes], new_bars: Dict, *, symbol: Optional[str] = None,
                series: Optional[str] = None, period: Optional[str] = None,
                price_scale: int = WORK_SCALE, vol_scale: int = WORK_SCALE,
                quality: int = DEFAULT_QUALITY) -> bytes:
    """Fold ``new_bars`` into an existing piece (or make a new one when
    ``existing`` is None) and return the new piece bytes.

    Bars are keyed by ``t``; a new bar replaces the old bar with the same time;
    the result is sorted and de-duplicated. ``new_bars`` need not be sorted or
    unique (its last occurrence of a time wins). ``symbol/series/period`` are
    required when ``existing`` is None and, when both are given, must match the
    existing header. Merging bars a piece already holds reproduces it byte for
    byte (at the same Brotli quality).
    """
    new = _normalise(new_bars, price_scale, vol_scale)
    if existing is None:
        if symbol is None or series is None or period is None:
            raise PieceError("symbol, series and period are required to start a new piece")
        merged = merge_bars(None, new)
        return encode_piece(symbol, series, period, merged, price_scale=price_scale,
                            vol_scale=vol_scale, quality=quality)
    old = decode_piece(existing)
    hdr = old["header"]
    for name, want in (("symbol", symbol), ("series", series), ("period", period)):
        if want is not None and hdr[name] != want:
            raise PieceError(f"existing piece is {name}={hdr[name]!r}, not {want!r}")
    pscale = max(hdr["pscale"], price_scale)
    vscale = max(hdr["vscale"], vol_scale)
    old_cols = _rescale({k: old[k] for k in COLUMNS}, hdr["pscale"], hdr["vscale"], pscale, vscale)
    new_cols = _rescale(new, price_scale, vol_scale, pscale, vscale)
    merged = merge_bars(old_cols, new_cols)
    return encode_piece(hdr["symbol"], hdr["series"], hdr["period"], merged,
                        price_scale=pscale, vol_scale=vscale, quality=quality)
