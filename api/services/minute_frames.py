"""Universe minute frames: the binary format (pure codec, no IO).

A MINUTE FRAME carries, for one minute, the newly CLOSED 1-minute bar of every symbol that
traded in it (Massive `AM.*`), so a browser can keep its on-device copy of EVERY symbol current
to the minute without a connection per symbol. `minute_frame_publisher` builds one a minute on
stream-ingest; `app/src/lib/minuteFrames/codec.js` is the decoder twin (the two are pinned to
each other by `tests/fixtures/minute_frames/` and its rail).

Everything is little-endian. Integers marked `varint` are unsigned LEB128; `zz` is a zigzag
varint (signed). No Brotli anywhere: the stored object is gzip, which a browser inflates
natively (`Content-Encoding: gzip`, or `DecompressionStream('gzip')`).

FRAME ("UMF1")
    0   4s   magic b"UMF1"
    4   u8   version (1)
    5   u8   flags: bit0 FLAG_AV = every record carries `av` (the vendor's accumulated day volume)
                    bit1 FLAG_INCOMPLETE = the vendor socket was down for part of this minute's
                    delivery window: a symbol missing here may still have traded (a reader
                    treats the minute as a GAP, never as "no trades")
                    bit2 FLAG_DAILY = a DAILY section follows the blocks (below)
    6   u16  reserved (0)
    8   u32  day       ET trading date as YYYYMMDD
    12  u32  seq       this frame's minute, as its index from 04:00 ET of `day` (0..959)
    16  u32  prev_seq  the seq of the frame this publisher epoch published before it, NO_SEQ when
                       it is the epoch's first. A reader that last applied seq X and gets a frame
                       whose prev_seq is not X has MISSED frames (see consumer.js).
    20  u32  epoch     the publisher's epoch id (a new process or a new day starts a new one)
    24  u32  minute    unix minute (t_ms // 60000) of `seq`, so a reader needs no time-zone math
    28  ...  symbol table: varint count, then per entry `u8 shared, u8 len, len bytes` (front-coded
             against the previous entry; ASCII; entries strictly increasing)
    ..  ...  varint n_blocks, then each BLOCK:
               varint minute (unix minute of the bars in it)
               u8     kind: 0 ONTIME (the frame's own minute), 1 LATE (a minute whose frame was
                      already published; never seen before), 2 REPLACE (a minute already
                      published, with DIFFERENT values: the new values win)
               varint n_records, then records in strictly increasing symbol index:
                 varint sym_gap   index - previous index - 1 (the first: index)
                 u8     scales    low nibble: price scale k (0..8), or 15 = four float64 follow
                                  high nibble: volume scale kv (0..8), or 15 = float64 follows
                 price  k<=8: zz O, zz (C-O), zz (H-max(O,C)), zz (min(O,C)-L), all as integers
                        scaled by 10**k; k==15: f64 o, h, l, c
                 volume kv<=8: varint V (v scaled by 10**kv); kv==15: f64 v
                 av     (FLAG_AV) the same volume scale as v: varint (AV+1), 0 = absent;
                        kv==15: f64 av (NaN = absent)
    ..  ...  (FLAG_DAILY) the DAILY section: varint n_daily, then n_daily records in strictly
             increasing symbol index, each exactly a block record WITHOUT av (sym_gap, scales,
             price, volume): that symbol's DAILY bar for `day` as the server holds it (bars-api's
             whole-market snapshot `day` row, the row /api/bars?tf=D serves). Published from the
             regular close (16:00 ET, 13:00 on a half day) to 20:00: the first such frame of a
             publisher epoch carries every symbol, later ones only the symbols whose row changed.
             A reader keeps the newest row per symbol (replaying today.bin in order gives it).
    ..  u32  CRC-32 of every byte before it

    A reader that does not know FLAG_DAILY refuses the frame (trailing bytes), never misreads it;
    the publisher sets it only with MINUTE_FRAMES_WITH_DAILY=1.

EXACT, BY CONSTRUCTION. A price is stored at the smallest scale k at which `n / 10**k == p`
holds in IEEE double arithmetic (Python and JavaScript divide identically, correctly rounded),
so the reader's `n / 10**k` is the writer's float, bit for bit. A value that is not exact at
any k <= 8 (or whose scaled integer leaves +-2**50, so every zigzag stays a safe JS integer)
is stored as a raw float64 instead. Nothing is ever rounded.

TODAY ("UMT1") — the rolling "today so far": every frame of the day, as published, in order.
    0   4s   magic b"UMT1"
    4   u8   version (1)
    5   u8   reserved
    6   u16  reserved
    8   u32  day
    12  u32  epoch     the publisher epoch that wrote it
    16  ...  frames, each as (u32 byte length, FRAME bytes)
    ..  u32  n_frames  } the TRAILER: last, so the writer can keep ONE running gzip stream of
    ..  u32  seq       } the day and finish a copy of it at each roll (`TodayWriter`), instead
    ..  u32  CRC-32    } of re-compressing every frame of the day each time. seq = the newest
                         frame's seq; the CRC covers every byte before it.
Replaying its frames in order and then the minute files after `seq` gives a reader the SAME
state as a reader that was live all day (the late and replace blocks ride in the frames
exactly as they did live). A gap inside it (the publisher was down) is visible the same way:
a frame whose prev_seq is not the seq of the frame before it.
"""
from __future__ import annotations

import math
import struct
import zlib
from typing import Iterable, Optional

MAGIC = b"UMF1"
TODAY_MAGIC = b"UMT1"
VERSION = 1
FLAG_AV = 0x01
FLAG_INCOMPLETE = 0x02
FLAG_DAILY = 0x04
NO_SEQ = 0xFFFFFFFF

KIND_ONTIME = 0
KIND_LATE = 1
KIND_REPLACE = 2
KINDS = (KIND_ONTIME, KIND_LATE, KIND_REPLACE)

#: The session a frame day spans: 04:00-20:00 ET, 960 minutes; seq = minute index from 04:00.
SESSION_START_MIN = 4 * 60
SESSION_MINUTES = 16 * 60

MAX_SCALE = 8
RAW_SCALE = 15
#: Largest |scaled integer| stored as an integer: zigzag(2**50) < 2**53, a safe JS integer.
MAX_SCALED = 2 ** 50

_HDR = struct.Struct("<4sBBHIIIII")       # 28 bytes
_TODAY_HDR = struct.Struct("<4sBBHII")    # 16 bytes
_TODAY_TRAILER = struct.Struct("<II")       # n_frames, seq (then the CRC)
_POW10 = tuple(10.0 ** k for k in range(MAX_SCALE + 1))   # exact doubles for k <= 22


class FrameError(ValueError):
    """The bytes are not a whole, valid frame (bad magic, version, CRC, truncation)."""


# ── scaling ──────────────────────────────────────────────────────────────────

def _exact_at(p: float, k: int) -> Optional[int]:
    """The integer n with n / 10**k == p exactly (IEEE), or None."""
    n = round(p * _POW10[k])
    if abs(n) > MAX_SCALED:
        return None
    if n / _POW10[k] == p:
        return n
    # p * 10**k can round to a neighbour of the right integer: try the two around it.
    for m in (n - 1, n + 1):
        if abs(m) <= MAX_SCALED and m / _POW10[k] == p:
            return m
    return None


def price_scale(values: Iterable[float]) -> int:
    """The smallest k (0..8) at which every value is exact, or RAW_SCALE."""
    vals = list(values)
    for v in vals:
        if not isinstance(v, float) or not math.isfinite(v):
            return RAW_SCALE
    for k in range(MAX_SCALE + 1):
        if all(_exact_at(v, k) is not None for v in vals):
            return k
    return RAW_SCALE


def volume_scale(values: Iterable[float]) -> int:
    """Like price_scale, for non-negative volumes (a negative one is stored raw)."""
    vals = list(values)
    if any(v < 0 for v in vals if isinstance(v, float) and math.isfinite(v)):
        return RAW_SCALE
    return price_scale(vals)


# ── varints ──────────────────────────────────────────────────────────────────

def _put_varint(out: bytearray, n: int) -> None:
    if n < 0:
        raise ValueError("varint must be >= 0")
    while n >= 0x80:
        out.append((n & 0x7F) | 0x80)
        n >>= 7
    out.append(n)


def _put_zz(out: bytearray, n: int) -> None:
    _put_varint(out, (n << 1) if n >= 0 else ((-n << 1) - 1))


def _get_varint(buf, pos: int) -> tuple[int, int]:
    n = 0
    shift = 0
    while True:
        if pos >= len(buf):
            raise FrameError("truncated varint")
        b = buf[pos]
        pos += 1
        n |= (b & 0x7F) << shift
        if b < 0x80:
            return n, pos
        shift += 7
        if shift > 63:
            raise FrameError("varint too long")


def _get_zz(buf, pos: int) -> tuple[int, int]:
    z, pos = _get_varint(buf, pos)
    return ((z >> 1) if not (z & 1) else -((z + 1) >> 1)), pos


# ── session clock ────────────────────────────────────────────────────────────

def _et():
    from zoneinfo import ZoneInfo
    return ZoneInfo("America/New_York")


def seq_of_minute(minute: int) -> tuple[int, int]:
    """(day YYYYMMDD, seq) of a unix minute, or (day, -1) outside 04:00-20:00 ET."""
    from datetime import datetime
    dt = datetime.fromtimestamp(minute * 60, tz=_et())
    day = dt.year * 10000 + dt.month * 100 + dt.day
    mod = dt.hour * 60 + dt.minute - SESSION_START_MIN
    return day, (mod if 0 <= mod < SESSION_MINUTES else -1)


def minute_of_seq(day: int, seq: int) -> int:
    """The unix minute of `seq` on ET date `day` (DST-correct: it is wall-clock minutes)."""
    from datetime import datetime
    mod = SESSION_START_MIN + seq
    dt = datetime(day // 10000, day // 100 % 100, day % 100, mod // 60, mod % 60, tzinfo=_et())
    return int(dt.timestamp()) // 60


def hhmm_of_seq(seq: int) -> str:
    """The ET wall clock of `seq` as HHMM (the minute file's name)."""
    mod = SESSION_START_MIN + seq
    return f"{mod // 60:02d}{mod % 60:02d}"


# ── encode ───────────────────────────────────────────────────────────────────

def _symbol_table(out: bytearray, symbols: list) -> None:
    _put_varint(out, len(symbols))
    prev = b""
    for s in symbols:
        b = s.encode("ascii")
        if not b or len(b) > 255:
            raise ValueError(f"symbol {s!r} must be 1..255 ASCII bytes")
        if b <= prev:
            raise ValueError("symbols must be strictly increasing")
        shared = 0
        lim = min(len(prev), len(b), 255)
        while shared < lim and prev[shared] == b[shared]:
            shared += 1
        out.append(shared)
        out.append(len(b) - shared)
        out += b[shared:]
        prev = b


def _record(out: bytearray, row: tuple, with_av: bool) -> None:
    o, h, l, c, v = (float(x) for x in row[:5])
    av = row[5] if len(row) > 5 else None
    k = price_scale((o, h, l, c))
    vols = (v,) if (not with_av or av is None) else (v, float(av))
    kv = volume_scale(vols)
    out.append(k | (kv << 4))
    if k == RAW_SCALE:
        out += struct.pack("<dddd", o, h, l, c)
    else:
        O, H, L, C = (_exact_at(x, k) for x in (o, h, l, c))
        _put_zz(out, O)
        _put_zz(out, C - O)
        _put_zz(out, H - max(O, C))
        _put_zz(out, min(O, C) - L)
    if kv == RAW_SCALE:
        out += struct.pack("<d", v)
        if with_av:
            out += struct.pack("<d", math.nan if av is None else float(av))
    else:
        _put_varint(out, _exact_at(v, kv))
        if with_av:
            _put_varint(out, 0 if av is None else _exact_at(float(av), kv) + 1)


def encode_frame(*, day: int, seq: int, prev_seq: int, epoch: int, minute: int,
                 blocks: list, with_av: bool = False, complete: bool = True,
                 daily: Optional[dict] = None) -> bytes:
    """One frame. `blocks` = [(minute, kind, {sym: (o, h, l, c, v[, av])}), ...]; the block for
    the frame's own minute is first by convention. `daily` = {sym: (o, h, l, c, v)}, the DAILY
    section (None or empty: none). Returns the RAW (uncompressed) bytes."""
    symbols = sorted({s for _, _, rows in blocks for s in rows} | set(daily or ()))
    index = {s: i for i, s in enumerate(symbols)}
    flags = (FLAG_AV if with_av else 0) | (0 if complete else FLAG_INCOMPLETE) | (FLAG_DAILY if daily else 0)
    out = bytearray(_HDR.pack(MAGIC, VERSION, flags, 0,
                              day, seq, prev_seq & 0xFFFFFFFF, epoch & 0xFFFFFFFF, minute))
    _symbol_table(out, symbols)
    _put_varint(out, len(blocks))
    for bmin, kind, rows in blocks:
        if kind not in KINDS:
            raise ValueError(f"unknown block kind {kind}")
        _put_varint(out, bmin)
        out.append(kind)
        _put_varint(out, len(rows))
        prev = -1
        for s in sorted(rows, key=index.__getitem__):
            i = index[s]
            _put_varint(out, i - prev - 1)
            prev = i
            _record(out, rows[s], with_av)
    if daily:
        _put_varint(out, len(daily))
        prev = -1
        for s in sorted(daily, key=index.__getitem__):
            i = index[s]
            _put_varint(out, i - prev - 1)
            prev = i
            _record(out, tuple(daily[s])[:5], False)
    out += struct.pack("<I", zlib.crc32(out) & 0xFFFFFFFF)
    return bytes(out)


def today_header(*, day: int, epoch: int) -> bytes:
    return _TODAY_HDR.pack(TODAY_MAGIC, VERSION, 0, 0, day, epoch & 0xFFFFFFFF)


def today_entry(frame: bytes) -> bytes:
    return struct.pack("<I", len(frame)) + frame


def encode_today(*, day: int, seq: int, epoch: int, frames: list) -> bytes:
    """The rolling "today so far" in one piece (`TodayWriter` builds the same bytes
    incrementally). `frames` = the RAW bytes of every frame published today, in order."""
    out = bytearray(today_header(day=day, epoch=epoch))
    for f in frames:
        out += today_entry(f)
    out += _TODAY_TRAILER.pack(len(frames), seq)
    out += struct.pack("<I", zlib.crc32(out) & 0xFFFFFFFF)
    return bytes(out)


class TodayWriter:
    """The "today so far" file as ONE running gzip stream: `add(frame)` compresses only the new
    frame, and `snapshot()` finishes a COPY of the stream with the trailer, so a roll costs one
    frame of compression plus a copy of the bytes so far, never the whole day again. Its bytes
    gunzip to exactly `encode_today(...)` of the same frames (pinned by the tests)."""

    def __init__(self, *, day: int, epoch: int, level: int = 6):
        self.day = day
        self.epoch = epoch
        self.n = 0
        self.seq = NO_SEQ
        self._z = zlib.compressobj(level, zlib.DEFLATED, 31)     # 31 = gzip container
        self._crc = 0
        self._out = bytearray()
        self._feed(today_header(day=day, epoch=epoch))

    def _feed(self, raw: bytes) -> None:
        self._crc = zlib.crc32(raw, self._crc)
        self._out += self._z.compress(raw)

    def add(self, frame: bytes, seq: int) -> None:
        self._feed(today_entry(frame))
        self.n += 1
        self.seq = seq

    def snapshot(self) -> bytes:
        """The gzip bytes of the file as it stands (the writer keeps going)."""
        z = self._z.copy()
        trailer = _TODAY_TRAILER.pack(self.n, self.seq & 0xFFFFFFFF)
        crc = zlib.crc32(trailer, self._crc)
        tail = z.compress(trailer + struct.pack("<I", crc & 0xFFFFFFFF)) + z.flush()
        return bytes(self._out) + tail

    @property
    def compressed_bytes(self) -> int:
        return len(self._out)


def gzip_bytes(raw: bytes, level: int = 6) -> bytes:
    """gzip (RFC 1952) with a fixed mtime, so the same frame always gzips to the same bytes."""
    import gzip
    return gzip.compress(raw, compresslevel=level, mtime=0)


def maybe_gunzip(data: bytes) -> bytes:
    if data[:2] == b"\x1f\x8b":
        import gzip
        return gzip.decompress(data)
    return data


# ── decode ───────────────────────────────────────────────────────────────────

def _check_crc(buf: bytes) -> None:
    if len(buf) < 4:
        raise FrameError("truncated")
    (stored,) = struct.unpack_from("<I", buf, len(buf) - 4)
    if zlib.crc32(buf[:-4]) & 0xFFFFFFFF != stored:
        raise FrameError("crc mismatch")


def decode_frame(data: bytes) -> dict:
    """RAW (or gzip) frame bytes -> {header fields..., "blocks": [{"minute", "kind", "rows":
    {sym: (o, h, l, c, v[, av])}}]}. Raises FrameError on anything that is not a whole frame."""
    buf = maybe_gunzip(bytes(data))
    if len(buf) < _HDR.size + 4:
        raise FrameError("truncated")
    magic, version, flags, _r, day, seq, prev_seq, epoch, minute = _HDR.unpack_from(buf, 0)
    if magic != MAGIC:
        raise FrameError("not a minute frame")
    if version != VERSION:
        raise FrameError(f"unsupported version {version}")
    _check_crc(buf)
    end = len(buf) - 4
    pos = _HDR.size
    n_sym, pos = _get_varint(buf, pos)
    symbols = []
    prev = b""
    for _ in range(n_sym):
        if pos + 2 > end:
            raise FrameError("truncated symbol table")
        shared, ln = buf[pos], buf[pos + 1]
        pos += 2
        b = prev[:shared] + buf[pos:pos + ln]
        pos += ln
        symbols.append(b.decode("ascii"))
        prev = b
    with_av = bool(flags & FLAG_AV)
    n_blocks, pos = _get_varint(buf, pos)
    blocks = []
    for _ in range(n_blocks):
        bmin, pos = _get_varint(buf, pos)
        kind = buf[pos]
        pos += 1
        n, pos = _get_varint(buf, pos)
        rows, pos = _read_records(buf, pos, n, symbols, with_av)
        blocks.append({"minute": bmin, "kind": kind, "rows": rows})
    out = {"day": day, "seq": seq, "prev_seq": prev_seq, "epoch": epoch, "minute": minute,
           "flags": flags, "blocks": blocks}
    if flags & FLAG_DAILY:
        n, pos = _get_varint(buf, pos)
        out["daily"], pos = _read_records(buf, pos, n, symbols, False)
    if pos != end:
        raise FrameError("trailing bytes")
    return out


def _read_records(buf, pos: int, n: int, symbols: list, with_av: bool):
    """`n` records (the block record layout above) -> ({sym: row}, new pos)."""
    rows = {}
    idx = -1
    for _ in range(n):
        gap, pos = _get_varint(buf, pos)
        idx += gap + 1
        if idx >= len(symbols):
            raise FrameError("record names a symbol outside the table")
        sc = buf[pos]
        pos += 1
        k, kv = sc & 0x0F, sc >> 4
        if k == RAW_SCALE:
            o, h, l, c = struct.unpack_from("<dddd", buf, pos)
            pos += 32
        else:
            O, pos = _get_zz(buf, pos)
            dC, pos = _get_zz(buf, pos)
            dH, pos = _get_zz(buf, pos)
            dL, pos = _get_zz(buf, pos)
            C = O + dC
            H = max(O, C) + dH
            L = min(O, C) - dL
            p = _POW10[k]
            o, h, l, c = O / p, H / p, L / p, C / p
        av = None
        if kv == RAW_SCALE:
            (v,) = struct.unpack_from("<d", buf, pos)
            pos += 8
            if with_av:
                (av,) = struct.unpack_from("<d", buf, pos)
                pos += 8
                av = None if math.isnan(av) else av
        else:
            V, pos = _get_varint(buf, pos)
            v = V / _POW10[kv]
            if with_av:
                A, pos = _get_varint(buf, pos)
                av = None if A == 0 else (A - 1) / _POW10[kv]
        rows[symbols[idx]] = (o, h, l, c, v, av) if with_av else (o, h, l, c, v)
    return rows, pos


def decode_today(data: bytes) -> dict:
    """RAW (or gzip) today bytes -> {"day", "seq", "epoch", "frames": [decoded frame, ...]}."""
    buf = maybe_gunzip(bytes(data))
    if len(buf) < _TODAY_HDR.size + _TODAY_TRAILER.size + 4:
        raise FrameError("truncated")
    magic, version, _a, _b, day, epoch = _TODAY_HDR.unpack_from(buf, 0)
    if magic != TODAY_MAGIC:
        raise FrameError("not a today file")
    if version != VERSION:
        raise FrameError(f"unsupported version {version}")
    _check_crc(buf)
    end = len(buf) - 4 - _TODAY_TRAILER.size
    n, seq = _TODAY_TRAILER.unpack_from(buf, end)
    pos = _TODAY_HDR.size
    frames = []
    while pos < end:
        if pos + 4 > end:
            raise FrameError("truncated")
        (ln,) = struct.unpack_from("<I", buf, pos)
        pos += 4
        if pos + ln > end:
            raise FrameError("truncated")
        frames.append(decode_frame(buf[pos:pos + ln]))
        pos += ln
    if len(frames) != n:
        raise FrameError("frame count mismatch")
    return {"day": day, "seq": seq, "epoch": epoch, "frames": frames}
