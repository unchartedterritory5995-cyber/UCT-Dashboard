"""W5 T3 -- the canonical column codec, Python half, held to the shared fixture.

THE FIXTURE IS THE ONE AUTHORITY: ``tests/fixtures/pine_runtime/codec_parity.json``.
``app/src/components/chart/engine/runtime/__tests__/columnDigest.test.js`` reads the SAME file
and holds the JS half (``columnDigest.js``) to the same bytes and digests, so a rule changed in
one language only fails the other. The JS side writes the ``expect`` blocks (it is the side the
browser runs); this file never rewrites the fixture, it holds ``api/services/pine_runtime_codec``
to it.

What it proves (each normalisation rule is mutation-proved, see the commit message):

* every case: the preimage bytes, each column's bytes and the digest equal the fixture;
* na is ONE value (None and every NaN payload and sign) and -0.0 is not +0.0;
* the fixture DISTINGUISHES: the cases fall into exactly the declared equal groups, and a
  fixture whose cases all digest alike is rejected by the same check;
* round trip: decode(encode(x)) is x, encode(decode(b)) is b, strict on non-canonical bytes;
* the layout, hand-assembled from the module's header for one small run;
* base64 strictness, and the engine identity read from the module that declares it.
"""
from __future__ import annotations

import array
import hashlib
import io
import json
import math
import pathlib
import re
import struct

import pytest

from api.services import pine_runtime_codec as codec
from api.services.pine_runtime_codec import CodecError

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "pine_runtime" / "codec_parity.json"
HEX16 = re.compile(r"^[0-9a-f]{16}$")
NAN_HEX = "000000000000f87f"


def _doc() -> dict:
    with io.open(FIXTURE, encoding="utf-8") as fh:
        return json.load(fh)


DOC = _doc()


def _f64(h: str) -> float:
    return struct.unpack("<d", bytes.fromhex(h))[0]


def _element(e):
    """null / "undef" -> None; 16 hex digits -> the Float64 stored little-endian in them;
    anything else passes through untouched (the refusal cases rely on that)."""
    if e == "undef":
        return None
    if isinstance(e, str) and HEX16.match(e):
        return _f64(e)
    return e


def _typed(col):
    """The same column as an ``array('d')`` built straight from the bytes, so a NaN payload is
    in the buffer before any float object exists. na becomes the canonical NaN."""
    a = array.array("d")
    a.frombytes(b"".join(bytes.fromhex(e if isinstance(e, str) and HEX16.match(e) else NAN_HEX) for e in col))
    return a


def _input(case: dict, mode: str) -> dict:
    cols = case["columns"]
    if isinstance(cols, dict):
        cols = {}
        for k, col in case["columns"].items():
            if not isinstance(col, list):
                cols[k] = col
            elif mode == "typed":
                cols[k] = _typed(col)
            else:
                cols[k] = [_element(e) for e in col]
    return {"engine": case["engine"], "columns": cols, "refusals": case["refusals"], "rows": case.get("rows")}


def _preimage(run: dict) -> bytes:
    return codec.canonical_preimage(run["engine"], run["columns"], run["refusals"], run["rows"])


def _digest(run: dict) -> str:
    return codec.column_digest(run["engine"], run["columns"], run["refusals"], run["rows"])


def distinguishing_problems(digest_by_name: dict, groups: list) -> list:
    """What a rail on "the fixture can tell cases apart" asks: the digests partition the cases
    into EXACTLY the declared equal groups. Returns the problems found (empty = fine)."""
    problems = []
    group_of = {}
    for i, g in enumerate(groups):
        for n in g["cases"]:
            group_of[n] = i
    by_digest: dict = {}
    for name, d in digest_by_name.items():
        by_digest.setdefault(d, []).append(name)
    for names in by_digest.values():
        if len(names) < 2:
            continue
        gi = group_of.get(names[0])
        same = gi is not None and len(names) == len(groups[gi]["cases"]) and all(group_of.get(n) == gi for n in names)
        if not same:
            problems.append("collision: " + ", ".join(names))
    for g in groups:
        if len({digest_by_name[n] for n in g["cases"]}) != 1:
            problems.append("group split: " + ", ".join(g["cases"]))
    if len(by_digest) < 2:
        problems.append("every case produced one digest")
    return problems


CASES = DOC["cases"]


def test_fixture_is_shaped_as_the_js_half_reads_it():
    assert sorted(DOC) == ["cases", "decode_refuse", "engine", "equal", "refuse"]
    assert len(CASES) >= 40
    assert len({c["name"] for c in CASES}) == len(CASES)
    assert all(c.get("expect", {}).get("digest") and c["expect"].get("preimage_hex") for c in CASES)
    assert list(DOC["engine"]) == list(codec.ENGINE_FIELDS)


@pytest.mark.parametrize("mode", ["array", "typed"])
@pytest.mark.parametrize("case", CASES, ids=lambda c: c["name"])
def test_case_bytes_and_digest_equal_the_fixture(case, mode):
    run = _input(case, mode)
    assert _preimage(run).hex() == case["expect"]["preimage_hex"]
    assert _digest(run) == case["expect"]["digest"]
    for k, col in run["columns"].items():
        assert codec.encode_column(col).hex() == case["expect"]["columns_hex"][k]


def test_every_case_digest_is_a_sha256_of_its_own_recorded_preimage():
    for c in CASES:
        assert hashlib.sha256(bytes.fromhex(c["expect"]["preimage_hex"])).hexdigest() == c["expect"]["digest"]


def test_control_the_cases_fall_into_exactly_the_declared_equal_groups():
    digests = {c["name"]: c["expect"]["digest"] for c in CASES}
    for g in DOC["equal"]:
        for n in g["cases"]:
            assert n in digests, n
    assert distinguishing_problems(digests, DOC["equal"]) == []
    live = {c["name"]: _digest(_input(c, "array")) for c in CASES}
    assert distinguishing_problems(live, DOC["equal"]) == []


def test_control_the_check_itself_rejects_a_fixture_that_cannot_distinguish():
    names = [c["name"] for c in CASES]
    assert distinguishing_problems({n: "x" for n in names}, DOC["equal"])
    live = {c["name"]: c["expect"]["digest"] for c in CASES}
    # collapsing -0 into +0 would put these two in one bucket, outside any declared group
    collapsed = dict(live, neg_zero=live["pos_zero"])
    assert re.search(r"collision: .*neg_zero", "; ".join(distinguishing_problems(collapsed, DOC["equal"])))
    # a split group is caught too
    split = dict(live, na_nan_negative=live["pos_zero"])
    assert "group split" in "; ".join(distinguishing_problems(split, DOC["equal"]))


def test_the_named_distinctions_the_design_cares_about_hold():
    d = {c["name"]: c["expect"]["digest"] for c in CASES}
    apart = [
        ("neg_zero", "pos_zero"), ("na_null", "pos_zero"), ("na_nan", "pos_infinity"), ("pos_infinity", "neg_infinity"),
        ("na_nan", "neg_infinity"), ("refusal_per_output_bar_null", "refusal_per_output_bar_zero"),
        ("refusals_single", "refusals_duplicate"), ("one_ulp_apart_a", "one_ulp_apart_b"), ("keys_ab", "keys_swapped_values"),
        ("keys_ab", "boundary_one_column"), ("engine_boundary_a", "engine_boundary_b"),
        ("engine_base", "engine_script_engine"), ("engine_base", "engine_language"), ("engine_base", "engine_frontend"),
        ("engine_base", "engine_ir"), ("engine_base", "engine_bundle"), ("refusal_run_wide", "refusal_other_guard"),
        ("refusal_per_output", "refusal_other_key"), ("keys_utf8_order_a", "keys_utf8_order_reversed_values"),
    ]
    for a, b in apart:
        assert d[a] != d[b], f"{a} vs {b}"


def test_na_is_one_value_on_the_wire_and_negative_zero_and_the_infinities_are_not_na():
    for x in (None, math.nan, -math.nan, _f64("010000000000f87f"), _f64("010000000000f07f"), _f64("000000000000f8ff")):
        assert codec.encode_column([x]).hex() == NAN_HEX
    assert codec.encode_column([-0.0]).hex() == "0000000000000080"
    assert codec.encode_column([0.0]).hex() == "0000000000000000"
    assert codec.encode_column([0]).hex() == "0000000000000000"
    assert codec.encode_column([math.inf, -math.inf]).hex() == "000000000000f07f000000000000f0ff"


@pytest.mark.parametrize("case", DOC["refuse"], ids=lambda c: c["name"])
def test_refuses_every_input_the_fixture_lists_by_codec_error(case):
    with pytest.raises(CodecError):
        _preimage(_input(case, "array"))


def test_the_refusal_list_is_not_trivially_short():
    assert len(DOC["refuse"]) >= 30


@pytest.mark.parametrize("case", DOC["decode_refuse"], ids=lambda c: c["name"])
def test_refuses_every_byte_string_the_fixture_lists_as_not_decodable(case):
    with pytest.raises(CodecError):
        codec.decode_column(bytes.fromhex(case["hex"]), case.get("rows"))


def test_round_trip_decode_of_encode_is_x_bit_for_bit_and_encode_of_decode_is_b():
    for c in CASES:
        for col in _input(c, "array")["columns"].values():
            data = codec.encode_column(col)
            back = codec.decode_column(data, len(col))
            assert len(back) == len(col)
            for x, y in zip(col, back):
                if x is None or x != x:
                    assert math.isnan(y)
                else:
                    assert struct.pack("<d", y) == struct.pack("<d", x)
            assert codec.encode_column(back) == data


def test_negative_zero_survives_the_round_trip():
    assert math.copysign(1.0, codec.decode_column(codec.encode_column([-0.0]))[0]) == -1.0
    assert math.copysign(1.0, codec.decode_column(codec.encode_column([0.0]))[0]) == 1.0


def test_decode_is_strict_whole_rows_the_asked_for_count_canonical_nan_only():
    with pytest.raises(CodecError):
        codec.decode_column(bytes(7))
    with pytest.raises(CodecError):
        codec.decode_column(bytes(16), 3)
    with pytest.raises(CodecError):
        codec.decode_column(bytes.fromhex("010000000000f87f"))
    with pytest.raises(CodecError):
        codec.decode_column(bytes.fromhex("000000000000f8ff"))
    with pytest.raises(CodecError):
        codec.decode_column([0] * 8)
    assert codec.decode_column(b"") == []
    assert codec.decode_column(memoryview(codec.encode_column([1.5, 2.5])), 2) == [1.5, 2.5]


def test_base64_round_trips_and_refuses_non_canonical_text():
    import base64
    import os

    raw = os.urandom(1000)
    assert codec.bytes_to_b64(raw) == base64.b64encode(raw).decode()
    assert codec.b64_to_bytes(base64.b64encode(raw).decode()) == raw
    for bad in ("AA", "AA=", "A===", " AAAA", "AAAA\n", "AA==AA==", "AB==", "A$AA", 7, "éAAA"):
        with pytest.raises(CodecError):
            codec.b64_to_bytes(bad)
    assert codec.b64_to_bytes("") == b""


def _le32(n: int) -> bytes:
    return struct.pack("<I", n)


def _s(s: str) -> bytes:
    b = s.encode("utf-8")
    return _le32(len(b)) + b


def test_the_layout_hand_assembled_from_the_module_header():
    e = DOC["engine"]
    want = b"".join([
        _s(codec.CODEC_TAG),
        _s(str(e["script_engine"])), _s(e["runtime_language"]), _s(str(e["runtime_frontend"])),
        _s(str(e["runtime_ir"])), _s(e["bundle_sha256"]),
        _le32(2),
        _s("a"), _le32(2), bytes.fromhex("0000000000000080" + "000000000000f03f"),
        _s("b"), _le32(2), bytes.fromhex("000000000000f03f" + "000000000000f87f"),
        _le32(2),
        _s("*"), _s("g"), b"\x00",
        _s("b"), _s("z"), b"\x01", _le32(300),
    ])
    columns = {"b": [1.0, None], "a": [-0.0, 1.0]}
    refusals = [{"key": "b", "guard": "z", "bar": 300, "sentence": "ignored"}, {"key": "*", "guard": "g", "bar": None}]
    assert codec.canonical_preimage(e, columns, refusals) == want
    assert codec.column_digest(e, columns, [{"key": "b", "guard": "z", "bar": 300}, {"key": "*", "guard": "g"}]) == hashlib.sha256(want).hexdigest()


def test_input_shapes():
    e = DOC["engine"]
    assert codec.encode_column((1.0, None, 3.0)) == codec.encode_column([1.0, math.nan, 3.0])
    assert codec.column_digest(e, {"v": array.array("d", [1.0, math.nan, -0.0])}) == codec.column_digest(e, {"v": [1, None, -0.0]})
    for bad in ("abc", b"abc", bytearray(b"ab"), 5, {1: 2}, {"0": 1}, None):
        with pytest.raises(CodecError):
            codec.encode_column(bad)
    for bad in ([True], ["1"], [{}], [[1]], [2 ** 60], [b"x"]):
        with pytest.raises(CodecError):
            codec.encode_column(bad)
    codec.canonical_preimage(e, {"v": [1, 2]}, rows=2)
    with pytest.raises(CodecError):
        codec.canonical_preimage(e, {"v": [1, 2]}, rows=3)


def test_the_engine_identity_can_be_read_from_the_module_that_declares_it():
    from api.services import user_definitions

    version = user_definitions.read_script_engine_version()
    assert isinstance(version, int) and version >= 1
    live = dict(DOC["engine"], script_engine=version)
    base = codec.column_digest(live, {"v": [1.0]})
    assert re.fullmatch(r"[0-9a-f]{64}", base)
    assert codec.column_digest(dict(live, script_engine=version + 1), {"v": [1.0]}) != base
