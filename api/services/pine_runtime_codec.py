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

WHAT IS ACCEPTED (the JS half accepts and refuses exactly the same inputs, and every case below
is in the shared fixture, so a drift turns one half red):

  container  ``engine``, ``columns`` and each refusal are plain ``dict`` objects. Any other
             mapping (``UserDict``, ``MappingProxyType``) is refused, as a JS ``Map`` is.
  column     a ``list``, a ``tuple``, an ``array.array('d')`` or a one-dimensional
             ``memoryview`` of float64. A ``str``, ``set``, ``range``, ``bytes``,
             ``array('f')`` or dict view is refused. Elements are numbers or ``None``.
  rows       ``None`` means "not given"; otherwise a non-negative ``int`` (never a ``bool``).
  identity   ``bundle_sha256`` must be a ``str`` of 64 lowercase hex digits (an ``int`` is
             refused). The other fields may be a non-negative safe ``int`` or a ``str``.
  numbers    an ``int`` past 2**53 that is exactly a double (``2**53``, ``10**20``) is that
             double, as JS reads the same JSON. An ``int`` that is NOT exactly a double is
             refused here. The JS half cannot see such a value (``JSON.parse`` rounds it
             first), so this one refusal is Python-only, a known gap, pinned in
             ``tests/test_pine_runtime_codec.py`` and not in the shared fixture.

The engine identity is NEVER retyped here: callers read it from the modules that declare it
(``user_definitions.read_script_engine_version`` and the service's own ``engine`` block) and
pass it in; this module only checks its shape.
"""
from __future__ import annotations

import array
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

def _is_column(col: Any) -> bool:
    """list, tuple, array('d') or a 1-D float64 memoryview: the Python spellings of a JS Array
    or Float64Array. Everything else (str, set, range, bytes, array('f')...) is refused."""
    if isinstance(col, (list, tuple)):
        return True
    if isinstance(col, array.array):
        return col.typecode == "d"
    if isinstance(col, memoryview):
        return col.format == "d" and col.ndim == 1
    return False


def _rows_arg(rows: Any) -> Optional[int]:
    """``None`` means "not given"; otherwise a non-negative int (a bool is not one)."""
    if rows is None:
        return None
    if isinstance(rows, bool) or not isinstance(rows, int) or rows < 0:
        raise CodecError("rows must be null or a non-negative integer")
    return rows


def encode_column(col: Sequence[Any], what: str = "column") -> bytes:
    """Canonical bytes of one column: 8 bytes per row, NaN/None canonicalised."""
    if not _is_column(col):
        raise CodecError(f"{what} must be a list, tuple or float64 array of numbers")
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
            try:
                f = float(x)
            except OverflowError:
                raise CodecError(f"{what}[{i}] is an integer too large for a double") from None
            if f != x:
                raise CodecError(f"{what}[{i}] is an integer that is not exactly a double")
            vals.append(f)
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
    want = _rows_arg(rows)
    if want is not None and want != n:
        raise CodecError(f"column has {n} rows, expected {want}")
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
    if field == "bundle_sha256" and not isinstance(v, str):
        raise CodecError("engine.bundle_sha256 must be a string")
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
    if not isinstance(engine, dict):
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
        if not isinstance(r, dict):
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
    if not isinstance(columns, dict):
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
    n = _rows_arg(rows)
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


# ─── W9-T14: the run's `strategy` record on the wire ────────────────────────────
#
# W9 design 3.2 / 3.4. Under profile ``backtest`` a job may ask for the run's ``strategy`` record
# with ``want: ["#strategy"]``. The service (``services/pine_runtime/job.mjs``) writes the run's
# OWN record (``strategyRecord.js::strategyRecordOf``) as JSON TEXT; its seal
# (``protocol.mjs::sealRunResults``) checks it with the bundle's ONE shape check
# (``strategyRecordShapeErrors``) and adds ``strategy_sha256`` = sha256 of the text's UTF-8 bytes.
# This side verifies the hash over the bytes it RECEIVED and parses them; it holds no second copy
# of the record's schema. The T3 column digest above is unchanged: it has no field for the record.
#
# The four strings below are the JS modules' own declarations, mirrored because this module does
# no I/O; ``tests/test_pine_strategy_backtest.py`` reads each JS source and fails on any drift.

#: ``protocol.mjs::STRATEGY_WANT``: the ``want`` entry that asks for the record (never a plot key).
STRATEGY_WANT = "#strategy"
#: ``strategyRecord.js::STRATEGY_RECORD_SCHEMA``: the record's own version tag.
STRATEGY_RECORD_SCHEMA = "uct.strategy-record/v1"
#: ``strategyRecord.js::STRATEGY_WINDOW_HISTORY``: ``meta.runtimeHistory`` of a stored document
#: whose program holds a strategy broker (the member door stamps it, W9-T11).
STRATEGY_WINDOW_HISTORY = "strategy-window"
#: ``broker.js::BROKER_START_GUARD``: a strategy run over a window that is not its history window.
STRATEGY_START_GUARD = "runtime:strategy-start"


def strategy_record_sha256(text: Any) -> str:
    """sha256 (lowercase hex) of the record text's UTF-8 bytes, exactly as the seal computes it."""
    return hashlib.sha256(_utf8(text, "strategy")).hexdigest()


def _no_constant(name: str) -> Any:
    raise CodecError(f"the strategy record holds {name}, which is not a JSON number")


def decode_strategy_record(text: Any, sha256: Any) -> Dict[str, Any]:
    """The record a result carries, or ``CodecError``. The hash is checked over the RECEIVED text
    before it is parsed; NaN / Infinity are refused (JSON has no such number, and the service
    withholds a record holding one); the record must be an object tagged with this schema."""
    if not isinstance(sha256, str) or len(sha256) != 64 or not set(sha256) <= _HEX64:
        raise CodecError("strategy_sha256 must be 64 lowercase hex digits")
    if strategy_record_sha256(text) != sha256:
        raise CodecError("the strategy record does not match its strategy_sha256")
    import json
    try:
        rec = json.loads(text, parse_constant=_no_constant)
    except ValueError as e:
        raise CodecError(f"the strategy record is not JSON ({e})") from None
    if not isinstance(rec, dict):
        raise CodecError("the strategy record is not an object")
    if rec.get("schema") != STRATEGY_RECORD_SCHEMA:
        raise CodecError(f"the strategy record is not {STRATEGY_RECORD_SCHEMA}")
    return rec
