"""The first-frame seed's DAILY DELTA: what a device holding build N needs to reach build N+1.

A device keeps one seed pack per timeframe (`ffseed_format`, "UFFSEED1"). Every night the full set is
~72 MB; most of it is the same bars as the night before. A delta pack ("UFFSDLT1") carries, per
timeframe, only what changed between the base build and the new one, so a device holding the base
downloads the delta, applies it, and holds byte-for-byte the new build's bars. Anyone else (no base,
another base, a failed check) takes the full pack, which is always published. Spec:
docs/charts/first-frame-seed-format.md section 10.

Per symbol, one operation (`op`):

    0 keep     the new window IS the base window (no blob)
    1 merge    the blob holds the rows to upsert by time; the new window is the base rows with
               first <= t <= last, with the blob's rows replacing / adding by `t`
    2 replace  the blob is the whole new window (a new symbol; one whose basis changed, i.e. named in
               the base manifest's next-session `splits`; or one a merge cannot reproduce)
    3 remove   the symbol is in the base but not in the new build (no blob)

Every entry carries the NEW window's `bars`, `first`, `last`, `crc` (the column CRC of the full pack)
and the new window's `pscale`/`vscale`: a device rescales the base rows it keeps to those scales,
applies the blob (encoded at the same scales), and checks the column CRC exactly as for a full pack.

FAIL-SAFE. The builder applies every delta it writes back onto the base with an INDEPENDENT reference
applier (`apply_delta`) and compares every symbol of the result with the new pack, column for column;
the symbol sets must match too. Any difference, any undecodable base or new entry, and the delta is not
published (`DeltaError`). It is a pure function of (base pack, new pack, splits names).
"""
from __future__ import annotations

import json
import struct
from typing import Dict, Iterable, Optional, Tuple

import numpy as np

from api.services import ffseed_format as fmt

MAGIC = b"UFFSDLT1"
FORMAT_VERSION = 1
KIND = "ffseed-delta"
OPS = {"keep": 0, "merge": 1, "replace": 2, "remove": 3}
OP_NAMES = {v: k for k, v in OPS.items()}
ENTRY_FIELDS = ("op", "off", "len", "rows", "bars", "first", "last", "asof", "crc", "body", "pscale", "vscale")
_TAIL = struct.Struct("<Q")
_COLS = fmt.COLUMNS


class DeltaError(ValueError):
    """A delta that cannot be built, read or proven complete."""


def _rescale(cols: dict, pscale: int, vscale: int) -> Optional[dict]:
    """`cols` (ints at cols' own scales) at (pscale, vscale) exactly, or None when not exact."""
    out = {"t": cols["t"], "n": cols["n"]}
    for keys, frm, to in (("ohlc", cols["pscale"], pscale), ("v", cols["vscale"], vscale)):
        for k in keys:
            a = np.asarray(cols[k], dtype=np.int64)
            if to >= frm:
                f = to // frm
                if a.size and int(a.max()) > fmt.MAX_VALUE // f:
                    return None
                out[k] = a * f
            else:
                f = frm // to
                if (a % f).any():
                    return None
                out[k] = a // f
    out["pscale"], out["vscale"] = pscale, vscale
    return out


def _subset(cols: dict, mask: np.ndarray) -> dict:
    out = {k: np.asarray(cols[k])[mask] for k in _COLS}
    out["pscale"], out["vscale"] = cols["pscale"], cols["vscale"]
    return out


def _equal(a: dict, b: dict) -> bool:
    return all(np.array_equal(np.asarray(a[k], dtype=np.int64), np.asarray(b[k], dtype=np.int64)) for k in _COLS)


def merge_window(base: dict, rows: Optional[dict], first: int, last: int, pscale: int, vscale: int) -> Optional[dict]:
    """THE APPLY RULE: the base rows with first <= t <= last (rescaled to the new scales), with `rows`
    replacing / adding by `t`. None when the base rows cannot be held exactly at the new scales."""
    keep = (np.asarray(base["t"]) >= first) & (np.asarray(base["t"]) <= last)
    b = _rescale(_subset(base, keep), pscale, vscale)      # only the rows kept need the new scales
    if b is None:
        return None
    if rows is None or len(rows["t"]) == 0:
        return b
    t = np.concatenate([b["t"], rows["t"]])
    order = np.argsort(t, kind="stable")                  # base first, then the blob: the blob wins a tie
    ts = t[order]
    last_of_run = np.ones(ts.size, dtype=bool)
    last_of_run[:-1] = ts[1:] != ts[:-1]
    idx = order[last_of_run]
    out = {k: np.concatenate([np.asarray(b[k], dtype=np.int64), np.asarray(rows[k], dtype=np.int64)])[idx]
           for k in _COLS}
    out["pscale"], out["vscale"] = pscale, vscale
    return out


def _decode(data: bytes, tr: dict, sym: str) -> dict:
    try:
        return fmt.decode_symbol_fast(data, tr, sym)
    except fmt.SeedError as exc:
        raise DeltaError(f"{sym}: {exc}") from exc


def build_delta(base_bytes: bytes, new_bytes: bytes, *, splits_symbols: Iterable[str] = ()) -> Tuple[bytes, dict]:
    """(delta pack bytes, stats). Raises DeltaError unless the delta provably reproduces the new pack."""
    btr, ntr = fmt.read_trailer(base_bytes), fmt.read_trailer(new_bytes)
    if btr["tf"] != ntr["tf"] or btr["tunit"] != ntr["tunit"]:
        raise DeltaError("base and new packs are different timeframes")
    if btr["build"] == ntr["build"]:
        raise DeltaError("base and new are the same build")
    if (btr["basis"], btr["grid"]) != (ntr["basis"], ntr["grid"]):
        raise DeltaError("base and new differ in basis or grid")
    comp = ntr["comp"]
    rebase = {str(s).upper().replace(".", "-") for s in splits_symbols}
    nview = memoryview(new_bytes)
    entries: Dict[str, list] = {}
    blobs = []
    off = 0
    stats = {k: 0 for k in OPS}
    stats["merge_rows"] = 0
    for sym in sorted(set(btr["symbols"]) | set(ntr["symbols"])):
        if sym not in ntr["symbols"]:
            entries[sym] = [OPS["remove"], 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1]
            stats["remove"] += 1
            continue
        ne = dict(zip(fmt.ENTRY_FIELDS, ntr["symbols"][sym]))
        new = _decode(new_bytes, ntr, sym)
        head = [ne["bars"], ne["first"], ne["last"], ne["asof"], ne["crc"]]
        op, blob, rows, body_len = None, b"", 0, 0
        if sym in btr["symbols"] and sym not in rebase:
            base = _decode(base_bytes, btr, sym)
            bsub = _rescale(_subset(base, (base["t"] >= ne["first"]) & (base["t"] <= ne["last"])),
                            ne["pscale"], ne["vscale"])
            if bsub is not None:
                if _equal(bsub, new):
                    op = OPS["keep"]
                else:
                    pos = np.searchsorted(bsub["t"], new["t"])
                    inb = (pos < bsub["t"].size) & (bsub["t"][np.minimum(pos, max(0, bsub["t"].size - 1))] == new["t"]) \
                        if bsub["t"].size else np.zeros(new["t"].size, dtype=bool)
                    same = np.zeros(new["t"].size, dtype=bool)
                    if inb.any():
                        j = pos[inb]
                        same[inb] = np.all([np.asarray(bsub[k])[j] == np.asarray(new[k])[inb] for k in _COLS], axis=0)
                    changed = _subset(new, ~same)
                    if changed["t"].size and _equal(merge_window(base, changed, ne["first"], ne["last"],
                                                                 ne["pscale"], ne["vscale"]) or {k: [] for k in _COLS}, new):
                        body, _f = fmt.encode_body(changed, ntr["tf"])
                        mblob = fmt.compress(body, comp)
                        if len(mblob) < ne["len"]:
                            op, blob, rows, body_len = OPS["merge"], mblob, int(changed["t"].size), len(body)
        if op is None:
            op = OPS["replace"]
            blob = bytes(nview[ne["off"]:ne["off"] + ne["len"]])
            rows, body_len = ne["bars"], ne["body"]
        if op == OPS["keep"]:
            entries[sym] = [op, 0, 0, 0] + head + [0, ne["pscale"], ne["vscale"]]
        else:
            entries[sym] = [op, off, len(blob), rows] + head + [body_len, ne["pscale"], ne["vscale"]]
            blobs.append(blob)
            off += len(blob)
        stats[OP_NAMES[op]] += 1
        if op == OPS["merge"]:
            stats["merge_rows"] += rows
    trailer = json.dumps({
        "v": FORMAT_VERSION, "kind": KIND, "tf": ntr["tf"], "tunit": ntr["tunit"], "basis": ntr["basis"],
        "grid": ntr["grid"], "comp": comp, "depth": ntr["depth"], "asof": ntr["asof"], "build": ntr["build"],
        "base": btr["build"], "base_asof": btr["asof"], "fields": list(ENTRY_FIELDS), "symbols": entries,
    }, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")
    data = b"".join(blobs) + trailer + _TAIL.pack(len(trailer)) + MAGIC
    verify_delta(base_bytes, data, new_bytes)
    stats.update({"symbols": len(entries), "bytes": len(data), "base": btr["build"], "build": ntr["build"]})
    return data, stats


def read_delta_trailer(data: bytes) -> dict:
    n = len(data)
    if n < len(MAGIC) + _TAIL.size or bytes(data[n - len(MAGIC):]) != MAGIC:
        raise DeltaError("not a seed delta (no UFFSDLT1 end marker)")
    (tlen,) = _TAIL.unpack(bytes(data[n - 16:n - 8]))
    start = n - 16 - tlen
    if tlen <= 0 or start < 0:
        raise DeltaError("trailer length does not fit the file")
    try:
        tr = json.loads(bytes(data[start:start + tlen]).decode("ascii"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise DeltaError(f"trailer is not ASCII JSON: {exc}") from exc
    if tr.get("v") != FORMAT_VERSION or tr.get("kind") != KIND or tr.get("fields") != list(ENTRY_FIELDS):
        raise DeltaError("unsupported delta version, kind or entry layout")
    for sym, e in tr["symbols"].items():
        if not (isinstance(e, list) and len(e) == len(ENTRY_FIELDS) and all(fmt._is_count(x) for x in e)):
            raise DeltaError(f"bad entry for {sym!r}")
        if e[0] not in OP_NAMES or e[1] + e[2] > start:
            raise DeltaError(f"bad op or blob range for {sym!r}")
    tr["blob_bytes"] = start
    return tr


def verify_delta(base_bytes: bytes, delta_bytes: bytes, new_bytes: bytes) -> None:
    """⛔ THE PROOF the builder runs before publishing: an independent apply of the delta onto the base
    gives back the new pack, symbol set and every column, exactly. One symbol at a time (bounded memory)."""
    ntr = fmt.read_trailer(new_bytes)
    seen = set()
    for sym, got in apply_delta_iter(base_bytes, delta_bytes):
        want = _decode(new_bytes, ntr, sym) if sym in ntr["symbols"] else None
        if want is None or not _equal(got, want) or (got["pscale"], got["vscale"]) != (want["pscale"], want["vscale"]):
            raise DeltaError(f"applying the delta does not give the new pack's {sym}")
        seen.add(sym)
    if seen != set(ntr["symbols"]):
        raise DeltaError("applying the delta does not give the new pack's symbol set")


def apply_delta(base_bytes: bytes, delta_bytes: bytes) -> Dict[str, dict]:
    """Every symbol of the new build, as exact integer columns (see `apply_delta_iter`)."""
    return dict(apply_delta_iter(base_bytes, delta_bytes))


def apply_delta_iter(base_bytes: bytes, delta_bytes: bytes):
    """The reference applier (the procedure of spec section 10; the device implements the same):
    yields (symbol, exact integer columns at the new window's scales) for every symbol of the new
    build. Raises DeltaError / SeedError on any failed check, including each result's column CRC."""
    btr = fmt.read_trailer(base_bytes)
    dtr = read_delta_trailer(delta_bytes)
    if dtr["base"] != btr["build"] or dtr["tf"] != btr["tf"]:
        raise DeltaError(f"delta applies to base {dtr['base']} {dtr['tf']}, not {btr['build']} {btr['tf']}")
    view = memoryview(delta_bytes)
    for sym, e in sorted(dtr["symbols"].items()):
        op, off, ln, rows, bars, first, last, asof, crc, body_len, pscale, vscale = e
        if op == OPS["remove"]:
            continue
        if op == OPS["replace"]:
            body = fmt.decompress(bytes(view[off:off + ln]), dtr["comp"])
            yield sym, fmt.decode_body_fast(body, bars=bars, first=first, last=last, crc=crc, body_len=body_len,
                                            tunit=dtr["tunit"], pscale=pscale, vscale=vscale)
            continue
        if sym not in btr["symbols"]:
            raise DeltaError(f"{sym}: {OP_NAMES[op]} needs the symbol in the base")
        base = fmt.decode_symbol_fast(base_bytes, btr, sym)
        blob_rows = None
        if op == OPS["merge"]:
            body = fmt.decompress(bytes(view[off:off + ln]), dtr["comp"])
            if len(body) != body_len or rows < 1:
                raise DeltaError(f"{sym}: merge body is {len(body)} bytes / {rows} rows, the entry says {body_len}")
            blob_rows = _decode_rows(body, rows, dtr["tunit"], pscale, vscale)
        got = merge_window(base, blob_rows, first, last, pscale, vscale)
        if got is None or len(got["t"]) != bars or int(got["t"][0]) != first or int(got["t"][-1]) != last:
            raise DeltaError(f"{sym}: the applied window does not have the entry's bars/first/last")
        if fmt.columns_crc(got) != crc:
            raise DeltaError(f"{sym}: column CRC mismatch after apply")
        yield sym, got


def _decode_rows(body: bytes, n: int, tunit: int, pscale: int, vscale: int) -> dict:
    """A merge blob's rows (no CRC of their own: the applied window's CRC proves them)."""
    v8 = fmt._varint_decode_np(body, 8 * n)
    T, O, H, L, C, V, VF, N = (v8[i * n:(i + 1) * n] for i in range(8))
    t = np.cumsum(T).astype(np.int64) * tunit
    d_open, d_close = fmt._unzz(O), fmt._unzz(C)
    c = np.cumsum(d_open + d_close)
    o = c - d_close
    if int(VF.max()) >= vscale:
        raise DeltaError("fractional volume is not below vscale")
    return {"t": t, "o": o, "c": c, "h": np.maximum(o, c) + fmt._unzz(H), "l": np.minimum(o, c) - fmt._unzz(L),
            "v": V.astype(np.int64) * vscale + VF.astype(np.int64), "n": N.astype(np.int64),
            "pscale": pscale, "vscale": vscale}
