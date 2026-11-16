"""One piece written to disk: the unit of work the builder hands to a process pool (``build.py --jobs``).

Its own module, imported by name in both package and script mode, so a spawned worker can find
``write_piece`` the same way the builder did. Encoding is deterministic, so which process writes a
piece never changes its bytes.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

if __package__ in (None, ""):  # script mode (build.py run as a file, and the pool's workers)
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import piece  # type: ignore[no-redef]
else:
    from . import piece


def write_atomic(path: Path, data: bytes) -> None:
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


def write_piece(path: str, symbol: str, series: str, period: str, bars: dict, quality: int) -> dict:
    """Encode `bars` as the piece at `path`, merging into what is already there. Returns
    ``{"bars", "first", "last", "crc", "bytes", "unchanged"}``, or ``{"error": text}`` when the bars
    cannot form a piece (the caller stops the build with it)."""
    path = Path(path)
    try:
        with open(path, "rb") as f:
            existing = f.read()
    except FileNotFoundError:
        existing = None
    try:
        if existing is None:
            blob = piece.encode_piece(symbol, series, period, bars, quality=quality)
        else:
            blob = piece.merge_piece(existing, bars, symbol=symbol, series=series, period=period, quality=quality)
    except piece.PieceError as exc:
        return {"error": str(exc)}
    unchanged = blob == existing
    if not unchanged:
        path.parent.mkdir(parents=True, exist_ok=True)
        write_atomic(path, blob)
    hdr = piece.read_header(blob)
    return {"bars": hdr["bars"], "first": hdr["first"], "last": hdr["last"], "crc": hdr["crc"],
            "bytes": len(blob), "unchanged": unchanged}


def encode_blob(existing, symbol: str, series: str, period: str, bars: dict, quality: int) -> dict:
    """Pack mode: the same piece, returned instead of written (the builder appends it to the
    period's pack). ``existing`` is the piece already in the pack, or None."""
    try:
        if existing is None:
            blob = piece.encode_piece(symbol, series, period, bars, quality=quality)
        else:
            blob = piece.merge_piece(existing, bars, symbol=symbol, series=series, period=period, quality=quality)
    except piece.PieceError as exc:
        return {"error": str(exc)}
    hdr = piece.read_header(blob)
    return {"blob": blob, "bars": hdr["bars"], "first": hdr["first"], "last": hdr["last"], "crc": hdr["crc"],
            "bytes": len(blob), "unchanged": blob == existing}
