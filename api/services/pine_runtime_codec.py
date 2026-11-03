"""W5 T3 -- the canonical column codec, Python half.

``docs/pine/SERVER-RUNTIME-DESIGN.md`` section 2.3. The server runtime and the chart's
worker must be provable to have produced the SAME columns, bit for bit, so both hosts
reduce a run to one byte string and one sha256. The JS half is
``app/src/components/chart/engine/runtime/columnDigest.js``; this module is its twin and
the encoding below is written, line for line, from the same header comment.

THE FIXTURE IS THE ONE AUTHORITY: ``tests/fixtures/pine_runtime/codec_parity.json``.
``columnDigest.test.js`` and ``tests/test_pine_runtime_codec.py`` both read it, so a rule
changed in one language only turns the other language's test red.

NOTHING CALLS THIS YET (T11's ``pine_runtime_client`` will). It is pure: no I/O, no clock.

THE ENCODING (every integer little-endian; "str" is u32 byte length + UTF-8):

  column    n * 8 bytes, one little-endian IEEE-754 Float64 per row. ``None`` and EVERY
            NaN (any payload, either sign) become ``7FF8000000000000``. Pine's ``na`` IS a
            NaN in a column, so na, None and NaN are ONE value on the wire. ``-0.0`` stays
            ``-0.0`` (``8000000000000000``): bit-identical means bit-identical. +/-Infinity
            are their own bit patterns and are NOT na.
  preimage  str("pine-runtime-columns/1")                       the codec's own tag
            str(script_engine) str(runtime_language) str(runtime_frontend)
            str(runtime_ir) str(bundle_sha256)                  engine identity, in that order
            u32 column count, then per column in UTF-8 BYTE order of its key:
                 str(key) u32 rows, rows*8 bytes
            u32 refusal count, then per refusal sorted by (key, guard, bar), compared on
            UTF-8 bytes with a null bar first:
                 str(key | '*') str(guard) u8 hasBar [u32 bar]
  digest    sha256(preimage), lowercase hex.

The refusal SENTENCE is not in the preimage: sentences may change wording ("map by guard,
never by sentence", PHASE3 3.6 item 6). Keys sort by UTF-8 bytes (JS's default order is
UTF-16, which differs above U+FFFF). A string with a lone surrogate has no UTF-8 form and is
refused, as in JS. Every field is length-prefixed, so no two different inputs share a
preimage by sliding a boundary.

The engine identity is NEVER retyped here: callers read it from the modules that declare it
(``user_definitions.read_script_engine_version`` and the service's own ``engine`` block) and
pass it in; this module only checks its shape.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import struct
from typing import Any, Dict, List, Mapping, Optional, Sequence

CODEC_TAG = "pine-runtime-columns/1"

#: The engine-identity fields, in preimage order (the wire shape, ``engine`` in 3.2).
ENGINE_FIELDS = ("script_engine", "runtime_language", "runtime_frontend", "runtime_ir", "bundle_sha256")

#: Every NaN, whatever its payload, is these eight bytes.
CANONICAL_NAN_BYTES = bytes([0, 0, 0, 0, 0, 0, 0xF8, 0x7F])

_U32_MAX = 0xFFFFFFFF
_MAX_SAFE_INT = 2 ** 53 - 1
_HEX64 = frozenset("0123456789abcdef")


class CodecError(ValueError):
    """The input is not encodable (or the bytes are not canonical). Never a silent coerce."""


def _utf8(s: Any, what: str) -> bytes:
    if not isinstance(s, str):
        raise CodecError(f"{what} must be a string")
    try:
        return s.encode("utf-8")
    except UnicodeEncodeError:
        raise CodecError(f"{what} holds a lone surrogate") from None


def _u32(v: int) -> bytes:
    return struct.pack("<I", v)


def _str(b: bytes) -> bytes:
    return _u32(len(b)) + b


# ─── columns ────────────────────────────────────────────────────────────────────

def encode_column(col: Sequence[Any], what: str = "column") -> bytes:
    """Canonical bytes of one column: 8 bytes per row, NaN/None canonicalised."""
    if isinstance(col, (bytes, bytearray, Mapping)) or not hasattr(col, "__len__"):
        raise CodecError(f"{what} must be a list, tuple or array of numbers")
    n = len(col)
    vals: List[float] = []
    nan_at: List[int] = []
    for i, x in enumerate(col):
        if x is None:
            vals.append(0.0)
            nan_at.append(i)
        elif isinstance(x, bool) or not isinstance(x, (int, float)):
            raise CodecError(f"{what}[{i}] must be a number or None")
        elif isinstance(x, int):
            if abs(x) > _MAX_SAFE_INT:
                raise CodecError(f"{what}[{i}] is an integer beyond 2**53, which JS cannot hold")
            vals.append(float(x))
        elif x != x:
            vals.append(0.0)
            nan_at.append(i)
        else:
            vals.append(x)
    out = bytearray(struct.pack("<%dd" % n, *vals))
    for i in nan_at:
        out[i * 8:i * 8 + 8] = CANONICAL_NAN_BYTES
    return bytes(out)


def decode_column(data: bytes, rows: Optional[int] = None) -> List[float]:
    """Decode canonical column bytes to a list of floats (NaN for na). Strict: the length
    must be a whole number of rows (and equal ``rows`` when given), and every NaN must be
    the canonical one, so decode(encode(x)) is x and encode(decode(b)) is b for every byte
    string we accept."""
    if not isinstance(data, (bytes, bytearray, memoryview)):
        raise CodecError("column bytes must be bytes")
    data = bytes(data)
    if len(data) % 8 != 0:
        raise CodecError(f"column bytes length {len(data)} is not a multiple of 8")
    n = len(data) // 8
    if rows is not None and rows != n:
        raise CodecError(f"column has {n} rows, expected {rows}")
    vals = struct.unpack("<%dd" % n, data)
    for i, v in enumerate(vals):
        if v != v and data[i * 8:i * 8 + 8] != CANONICAL_NAN_BYTES:
            raise CodecError(f"row {i} is a NaN with a non-canonical payload")
    return list(vals)


def bytes_to_b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def b64_to_bytes(text: Any) -> bytes:
    if not isinstance(text, str):
        raise CodecError("not canonical base64")
    try:
        raw = base64.b64decode(text.encode("ascii"))
    except (binascii.Error, UnicodeEncodeError):
        raise CodecError("not canonical base64") from None
    if base64.b64encode(raw).decode("ascii") != text:
        raise CodecError("not canonical base64")
    return raw


# ─── identity and refusals ──────────────────────────────────────────────────────

def _identity_field(engine: Mapping[str, Any], field: str) -> bytes:
    """The UTF-8 bytes of one identity field. An integer and its decimal string are one value."""
    v = engine.get(field)
    if isinstance(v, bool):
        raise CodecError(f"engine.{field} must be a non-negative integer or a string")
    if isinstance(v, int):
        if v < 0 or v > _MAX_SAFE_INT:
            raise CodecError(f"engine.{field} must be a non-negative integer or a string")
        return _utf8(str(v), f"engine.{field}")
    data = _utf8(v, f"engine.{field}")  # refuses anything that is not a string
    if len(data) == 0:
        raise CodecError(f"engine.{field} must not be empty")
    if field == "bundle_sha256" and (len(v) != 64 or not set(v) <= _HEX64):
        raise CodecError("engine.bundle_sha256 must be 64 lowercase hex digits")
    return data


def _identity_bytes(engine: Any) -> bytes:
    if not isinstance(engine, Mapping):
        raise CodecError("engine must be an object")
    for k in engine:
        if k not in ENGINE_FIELDS:
            raise CodecError(f"engine.{k} is not an identity field")
    return b"".join(_str(_identity_field(engine, f)) for f in ENGINE_FIELDS)


def _normalise_refusals(refusals: Any) -> List[tuple]:
    if not isinstance(refusals, (list, tuple)):
        raise CodecError("refusals must be an array")
    rows = []
    for i, r in enumerate(refusals):
        if not isinstance(r, Mapping):
            raise CodecError(f"refusals[{i}] must be an object")
        key = _utf8(r.get("key"), f"refusals[{i}].key")
        guard = _utf8(r.get("guard"), f"refusals[{i}].guard")
        if len(key) == 0:
            raise CodecError(f"refusals[{i}].key must not be empty (use '*' for the whole run)")
        if len(guard) == 0:
            raise CodecError(f"refusals[{i}].guard must not be empty")
        bar = r.get("bar")
        if bar is not None:
            if isinstance(bar, bool) or not isinstance(bar, int) or bar < 0 or bar > _U32_MAX:
                raise CodecError(f"refusals[{i}].bar must be null or an integer in [0, 2^32-1]")
        # a null bar sorts before every number: (0,) < (1, n)
        rows.append((key, guard, (0,) if bar is None else (1, bar)))
    rows.sort()
    return rows


# ─── the preimage and the digest ────────────────────────────────────────────────

def canonical_preimage(
    engine: Mapping[str, Any],
    columns: Mapping[str, Sequence[Any]],
    refusals: Sequence[Mapping[str, Any]] = (),
    rows: Optional[int] = None,
) -> bytes:
    """The exact bytes the digest hashes. ``columns`` maps plot key -> column; ``refusals``
    is ``[{key | '*', guard, bar | None, sentence?}]``; ``rows``, when given, is the bar
    count every column must have."""
    if not isinstance(columns, Mapping):
        raise CodecError("columns must be an object")
    out = [_str(_utf8(CODEC_TAG, "tag")), _identity_bytes(engine)]
    entries = []
    for name in columns:
        key = _utf8(name, f"column key {name!r}")
        if len(key) == 0:
            raise CodecError("a column key must not be empty")
        entries.append((key, name))
    entries.sort(key=lambda e: e[0])
    out.append(_u32(len(entries)))
    n = rows
    for key, name in entries:
        data = encode_column(columns[name], f"column {name!r}")
        length = len(data) // 8
        if n is None:
            n = length
        if length != n:
            raise CodecError(f"column {name!r} has {length} rows, expected {n}")
        out.append(_str(key))
        out.append(_u32(length))
        out.append(data)
    rs = _normalise_refusals(refusals)
    out.append(_u32(len(rs)))
    for key, guard, bar in rs:
        out.append(_str(key))
        out.append(_str(guard))
        out.append(b"\x00" if bar == (0,) else b"\x01" + _u32(bar[1]))
    return b"".join(out)


def column_digest(
    engine: Mapping[str, Any],
    columns: Mapping[str, Sequence[Any]],
    refusals: Sequence[Mapping[str, Any]] = (),
    rows: Optional[int] = None,
) -> str:
    return hashlib.sha256(canonical_preimage(engine, columns, refusals, rows)).hexdigest()
