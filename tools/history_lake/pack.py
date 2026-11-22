"""Pack files: every symbol's piece of one series and one period, in one file.

    <root>/packs/<series>/<period>.pack

Why: a piece per file meant 3-4 random disk operations per piece (read attempt, temp write, rename,
plus the symbol's index), and a month of 1-minute history is ~11,000 pieces. On this PC's spinning
disk that was ~1,000 s per month and over a day for the whole lake, before merging or uploading.
A pack is written front to back once. At the edge a piece is one ranged read of its pack.

Layout (all integers little-endian):

    piece blob 0 | piece blob 1 | ... | trailer JSON | u64 trailer length | b"UBHPACK1"

The trailer is compact JSON with sorted keys:

    {"v": 1, "series": "1", "period": "2026-11",
     "pieces": {"AAPL": [offset, length, bars, first, last, crc], ...}}

Each blob is a complete piece (FORMAT.md section 3), byte for byte what a piece file would hold.
The trailer is inside the file, so a pack is written as ``.tmp`` and renamed once: a pack on disk
is always whole, and a crash leaves at most a ``.tmp`` that the next writer replaces.
"""
from __future__ import annotations

import json
import os
import struct
import sys
from pathlib import Path
from typing import Dict, Iterator, List, Optional, Tuple

if __package__ in (None, ""):  # script mode
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import piece  # type: ignore[no-redef]
else:
    from . import piece

PACK_VERSION = 1
MAGIC = b"UBHPACK1"
_TAIL = struct.Struct("<Q")


class PackError(ValueError):
    """A pack file is not whole, or not what its name says."""


def pack_relpath(series: str, period: str) -> str:
    if series not in piece.SERIES_IDS:
        raise PackError(f"unknown series {series!r}")
    piece._check_period_form(series, period)
    return f"packs/{series}/{period}.pack"


def pack_path(root: Path, series: str, period: str) -> Path:
    return Path(root) / pack_relpath(series, period)


def _json(obj) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")


class PackWriter:
    """Append pieces, then ``close()`` (one rename) or ``abort()``."""

    def __init__(self, root: Path, series: str, period: str):
        self.series, self.period = series, period
        self.path = pack_path(root, series, period)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.tmp = self.path.with_name(self.path.name + ".tmp")
        self.f = open(self.tmp, "wb")
        self.pos = 0
        self.pieces: Dict[str, list] = {}

    def add(self, symbol: str, blob: bytes, hdr: dict) -> None:
        if symbol in self.pieces:
            raise PackError(f"{symbol} twice in pack {self.series}/{self.period}")
        if hdr.get("symbol", symbol) != symbol or hdr.get("series", self.series) != self.series \
                or hdr.get("period", self.period) != self.period:
            raise PackError(f"piece {hdr.get('symbol')} {hdr.get('series')}/{hdr.get('period')} "
                            f"does not belong in pack {self.series}/{self.period} as {symbol}")
        self.f.write(blob)
        self.pieces[symbol] = [self.pos, len(blob), int(hdr["bars"]), int(hdr["first"]), int(hdr["last"]), int(hdr["crc"])]
        self.pos += len(blob)

    def close(self) -> dict:
        trailer = _json({"v": PACK_VERSION, "series": self.series, "period": self.period, "pieces": self.pieces})
        self.f.write(trailer)
        self.f.write(_TAIL.pack(len(trailer)))
        self.f.write(MAGIC)
        self.f.close()
        os.replace(self.tmp, self.path)
        return {"series": self.series, "period": self.period, "pieces": self.pieces, "bytes": self.path.stat().st_size}

    def abort(self) -> None:
        try:
            self.f.close()
        finally:
            try:
                os.remove(self.tmp)
            except OSError:
                pass


def read_trailer(path: Path) -> dict:
    """The trailer of a whole pack (raises PackError when the file is not one)."""
    path = Path(path)
    try:
        size = path.stat().st_size
        with open(path, "rb") as f:
            if size < len(MAGIC) + _TAIL.size:
                raise PackError(f"{path}: too short to be a pack")
            f.seek(size - len(MAGIC) - _TAIL.size)
            tail = f.read(_TAIL.size + len(MAGIC))
            if tail[_TAIL.size:] != MAGIC:
                raise PackError(f"{path}: not a pack (no end marker)")
            (n,) = _TAIL.unpack(tail[:_TAIL.size])
            body_end = size - len(MAGIC) - _TAIL.size - n
            if n <= 0 or body_end < 0:
                raise PackError(f"{path}: trailer length {n} does not fit the file")
            f.seek(body_end)
            doc = json.loads(f.read(n).decode("ascii"))
    except FileNotFoundError:
        raise
    except (ValueError, UnicodeDecodeError) as exc:
        if isinstance(exc, PackError):
            raise
        raise PackError(f"{path}: unreadable trailer: {exc}") from exc
    if not isinstance(doc, dict) or doc.get("v") != PACK_VERSION or not isinstance(doc.get("pieces"), dict):
        raise PackError(f"{path}: not a version {PACK_VERSION} pack trailer")
    end = 0
    for sym, e in doc["pieces"].items():
        if not (isinstance(e, list) and len(e) == 6 and all(isinstance(x, int) and x >= 0 for x in e)):
            raise PackError(f"{path}: bad entry for {sym!r}")
        end = max(end, e[0] + e[1])
    if end > body_end:
        raise PackError(f"{path}: an entry reaches past the pieces")
    doc["body_bytes"] = body_end
    return doc


class PackReader:
    """Random access to the pieces of one whole pack."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self.trailer = read_trailer(self.path)
        self.f = open(self.path, "rb")

    @classmethod
    def open(cls, root: Path, series: str, period: str) -> Optional["PackReader"]:
        p = pack_path(root, series, period)
        if not p.exists():
            return None
        r = cls(p)
        if r.trailer.get("series") != series or r.trailer.get("period") != period:
            r.close()
            raise PackError(f"{p} holds {r.trailer.get('series')}/{r.trailer.get('period')}, not {series}/{period}")
        return r

    def symbols(self) -> List[str]:
        return list(self.trailer["pieces"])

    def entry(self, symbol: str) -> Optional[list]:
        return self.trailer["pieces"].get(symbol)

    def get(self, symbol: str) -> Optional[bytes]:
        e = self.entry(symbol)
        if e is None:
            return None
        self.f.seek(e[0])
        blob = self.f.read(e[1])
        if len(blob) != e[1]:
            raise PackError(f"{self.path}: {symbol} is cut short")
        return blob

    def close(self) -> None:
        self.f.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


def iter_packs(root: Path) -> Iterator[Tuple[str, str, Path]]:
    """(series, period, path) of every pack under ``root``, in a stable order."""
    base = Path(root) / "packs"
    for series in piece.SERIES_IDS:
        sdir = base / series
        if not sdir.is_dir():
            continue
        for p in sorted(sdir.iterdir()):
            if p.name.endswith(".pack") and p.is_file():
                yield series, p.name[:-5], p
