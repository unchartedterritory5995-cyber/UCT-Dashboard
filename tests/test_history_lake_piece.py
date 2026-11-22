"""tools/history_lake/piece.py: exact round trip, clear errors, merge semantics.

Run: python -m pytest tests/test_history_lake_piece.py -q -p no:cacheprovider
"""
from datetime import datetime
import json
import os
import zlib

import brotli
import numpy as np
import pytest

from tools.history_lake import bucketing as B
from tools.history_lake import piece as P

PROBE = "D:/uct-history/raw/_probe-2026-11-13.csv.gz"
PROBE_DAY = "2026-11-13"
ET = B.ET


def _ts(y, m, d, hh, mm):
    return int(datetime(y, m, d, hh, mm, tzinfo=ET).timestamp())


def _synthetic(n=400, seed=7, start=None, step=60):
    """Deterministic minute bars with 2, 4 and 6 decimal prices, fractional and
    whole volumes, gaps in time, and one bar whose high is BELOW its close."""
    rng = np.random.default_rng(seed)
    start = start if start is not None else _ts(2026, 11, 13, 4, 0)
    t = start + np.cumsum(rng.integers(1, 4, size=n)) * step - step
    close = 100_000_000 + np.cumsum(rng.integers(-40_000, 40_001, size=n))      # 1e6 scale
    close[::7] += rng.integers(0, 100, size=len(close[::7]))                     # 5-6 decimals
    open_ = np.concatenate([[close[0] - 10_000], close[:-1] + rng.integers(-20_000, 20_001, size=n - 1)])
    high = np.maximum(open_, close) + rng.integers(0, 30_000, size=n)
    low = np.minimum(open_, close) - rng.integers(0, 30_000, size=n)
    high[5] = close[5] - 1_000                                                   # vendor oddity, kept verbatim
    vol = rng.integers(1, 5_000_000, size=n) * 1_000_000
    vol[::3] += rng.integers(1, 1_000_000, size=len(vol[::3]))                   # fractional shares
    cnt = rng.integers(1, 9000, size=n)
    return {"t": t.astype(np.int64), "o": open_.astype(np.int64), "h": high.astype(np.int64),
            "l": low.astype(np.int64), "c": close.astype(np.int64), "v": vol.astype(np.int64),
            "n": cnt.astype(np.int64)}


def _assert_same_bars(decoded, bars, price_scale=P.WORK_SCALE, vol_scale=P.WORK_SCALE):
    hdr = decoded["header"]
    pf, vf = price_scale // hdr["pscale"], vol_scale // hdr["vscale"]
    assert price_scale % hdr["pscale"] == 0 and vol_scale % hdr["vscale"] == 0
    assert np.array_equal(decoded["t"], bars["t"])
    for k in "ohlc":
        assert np.array_equal(decoded[k] * pf, bars[k]), k
    assert np.array_equal(decoded["v"] * vf, bars["v"])
    assert np.array_equal(decoded["n"], bars["n"])
    assert hdr["bars"] == len(bars["t"])
    assert hdr["first"] == int(bars["t"][0]) and hdr["last"] == int(bars["t"][-1])


# ---------------------------------------------------------------- round trip

def test_synthetic_round_trip_is_exact_and_both_decoders_agree():
    bars = _synthetic()
    blob = P.encode_piece("TEST", "1", "2026-11", bars)
    assert blob[:3] == b"UBH" and blob[3] == 1
    dec = P.decode_piece(blob)
    _assert_same_bars(dec, bars)
    assert dec["header"]["pscale"] == 1_000_000 and dec["header"]["vscale"] == 1_000_000
    assert dec["header"]["basis"] == "raw" and dec["header"]["symbol"] == "TEST"
    assert (dec["h"] < np.maximum(dec["o"], dec["c"])).sum() == 1       # the oddity survived
    ref = P.decode_piece_reference(blob)
    assert ref["header"] == dec["header"]
    for k in P.COLUMNS:
        assert np.array_equal(ref[k], dec[k]), k
    assert P.read_header(blob) == dec["header"]
    # deterministic
    assert P.encode_piece("TEST", "1", "2026-11", bars) == blob


def test_header_layout_is_what_the_doc_says():
    bars = _synthetic(50)
    blob = P.encode_piece("BRK.B", "1", "2026-11", bars)
    hlen = int.from_bytes(blob[4:6], "little")
    header = json.loads(blob[6:6 + hlen])
    assert list(header) == sorted(header)
    assert set(header) == {"v", "basis", "symbol", "series", "period", "bars", "first", "last",
                           "tunit", "pscale", "vscale", "body", "crc"}
    assert int.from_bytes(blob[6 + hlen:10 + hlen], "little") == zlib.crc32(blob[:6 + hlen])
    body = brotli.decompress(blob[10 + hlen:])
    assert len(body) == header["body"]
    # crc = CRC-32 of the seven decoded columns as 8-byte little-endian unsigned
    dec = P.decode_piece(blob)
    raw = b"".join(np.asarray(dec[k], dtype="<u8").tobytes() for k in "tohlcvn")
    assert zlib.crc32(raw) == header["crc"]
    assert header["tunit"] == 60 and header["series"] == "1" and header["period"] == "2026-11"


def test_minimal_scale_is_chosen_and_is_a_function_of_the_bars_only():
    bars = _synthetic(60)
    cents = {k: (bars[k] // 10_000) * 10_000 for k in "ohlc"}
    whole = dict(bars, **cents)
    whole["v"] = (bars["v"] // 1_000_000) * 1_000_000
    blob = P.encode_piece("TEST", "1", "2026-11", whole)
    hdr = P.read_header(blob)
    assert hdr["pscale"] == 100 and hdr["vscale"] == 1
    _assert_same_bars(P.decode_piece(blob), whole)
    # the same bars handed over at their small scale give the same bytes
    small = {"t": whole["t"], "n": whole["n"], "v": whole["v"] // 1_000_000,
             **{k: whole[k] // 10_000 for k in "ohlc"}}
    assert P.encode_piece("TEST", "1", "2026-11", small, price_scale=100, vol_scale=1) == blob
    # one six-decimal price forces the fine scale for the whole piece
    fine = dict(whole)
    fine["c"] = whole["c"].copy()
    fine["c"][3] += 1
    fine["h"] = np.maximum(whole["h"], fine["c"])
    assert P.read_header(P.encode_piece("TEST", "1", "2026-11", fine))["pscale"] == 1_000_000


def test_prices_with_four_and_six_decimals_round_trip_exactly_from_floats():
    t = _ts(2026, 11, 13, 9, 30) + 60 * np.arange(6)
    o = np.array([0.0002, 0.446422, 171.993656, 892000.0, 13.386924, 0.3579])
    c = np.array([0.0003, 0.397586, 171.99, 891999.99, 13.366026, 0.35785])
    h = np.maximum(o, c)
    low = np.minimum(o, c)
    v = np.array([1.0, 406.010010, 11841.701015, 23948455.0, 0.000001, 4017.123906])
    n = np.array([1, 11, 3, 169049, 1, 7])
    bars = P.bars_from_floats(t, o, h, low, c, v, n)
    back = P.bars_to_floats(P.decode_piece(P.encode_piece("X", "1", "2026-11", bars)))
    for name, want in (("o", o), ("h", h), ("l", low), ("c", c), ("v", v)):
        assert back[name].tobytes() == want.tobytes(), name      # bit for bit
    assert np.array_equal(back["t"], t) and np.array_equal(back["n"], n)


def test_bars_from_floats_refuses_to_round():
    t = _ts(2026, 11, 13, 9, 30) + 60 * np.arange(2)
    ok = np.array([1.5, 2.25])
    seven = np.array([1.5, 0.1234567])            # 7 decimals: not representable at 1e-6
    n = np.array([1, 1])
    with pytest.raises(P.PieceError, match="round-trip"):
        P.bars_from_floats(t, seven, ok, ok, ok, ok, n)
    with pytest.raises(P.PieceError, match="round-trip"):
        P.bars_from_floats(t, ok, ok, ok, ok, seven, n)
    with pytest.raises(P.PieceError, match="non-finite"):
        P.bars_from_floats(t, np.array([1.0, np.nan]), ok, ok, ok, ok, n)
    with pytest.raises(P.PieceError, match="integer"):
        P.bars_from_floats(t.astype(float), ok, ok, ok, ok, ok, n)


def test_huge_volumes_and_prices():
    t = _ts(2026, 11, 13, 4, 0) + 3600 * np.arange(3)
    big_v = np.array([P.MAX_VALUE, 5_000_000_000_000, 0], dtype=np.int64)
    bars = {"t": t, "o": np.array([1, 2, 3]), "h": np.array([5, 5, 5]), "l": np.array([1, 1, 1]),
            "c": np.array([2, 3, 4]), "v": big_v, "n": np.array([P.MAX_VALUE, 1, 0])}
    blob = P.encode_piece("BIG", "60e", "2026", bars, price_scale=10_000, vol_scale=1)
    dec = P.decode_piece(blob)
    assert np.array_equal(dec["v"], big_v) and dec["header"]["vscale"] == 1
    assert np.array_equal(P.decode_piece_reference(blob)["v"], big_v)
    assert int(dec["n"][0]) == P.MAX_VALUE
    # a fractional volume as large as the format allows: 9,007,199,254.740991 shares
    frac = dict(bars, v=np.array([P.MAX_VALUE, 1, 1_000_000], dtype=np.int64))
    dec = P.decode_piece(P.encode_piece("BIG", "60e", "2026", frac, price_scale=10_000, vol_scale=1_000_000))
    assert dec["header"]["vscale"] == 1_000_000 and int(dec["v"][0]) == P.MAX_VALUE
    # the price ceiling
    top = dict(bars, o=np.array([P.MAX_PRICE, 2, 3]), h=np.array([P.MAX_PRICE, 5, 5]),
               c=np.array([1, 3, 4]))
    dec = P.decode_piece(P.encode_piece("BIG", "60e", "2026", top, price_scale=1, vol_scale=1))
    assert int(dec["o"][0]) == P.MAX_PRICE and int(dec["h"][0]) == P.MAX_PRICE
    # beyond the limits: refused, never wrapped
    with pytest.raises(P.PieceError, match="2\\*\\*53"):
        P.encode_piece("BIG", "60e", "2026", dict(bars, v=np.array([2 ** 53, 1, 1])), vol_scale=1)
    with pytest.raises(P.PieceError, match="too large"):
        P.encode_piece("BIG", "60e", "2026", dict(top, o=np.array([P.MAX_PRICE + 2, 2, 3]),
                                                  h=np.array([P.MAX_PRICE + 2, 5, 5])),
                       price_scale=1, vol_scale=1)
    with pytest.raises(P.PieceError, match="2\\*\\*53"):
        P.encode_piece("BIG", "60e", "2026", dict(bars, v=np.array([2 ** 63 + 5, 1, 1], dtype=np.uint64)),
                       vol_scale=1)


def test_one_bar_piece():
    bars = {k: v[:1] for k, v in _synthetic(10).items()}
    blob = P.encode_piece("ONE", "1", "2026-11", bars)
    dec = P.decode_piece(blob)
    _assert_same_bars(dec, bars)
    assert dec["header"]["bars"] == 1 and dec["header"]["first"] == dec["header"]["last"]
    assert np.array_equal(P.decode_piece_reference(blob)["c"], dec["c"])


def test_every_series_round_trips_with_its_time_unit():
    day = "2026-11-13"
    minutes = np.arange(_ts(2026, 11, 13, 4, 0), _ts(2026, 11, 13, 20, 0), 60, dtype=np.int64)
    for series in P.SERIES_IDS:
        t = np.unique(B.series_bucket_starts(minutes, series, day))
        n = len(t)
        bars = {"t": t, "o": np.full(n, 1_000_000) + np.arange(n), "h": np.full(n, 2_000_000),
                "l": np.full(n, 500_000), "c": np.full(n, 1_500_000) - np.arange(n),
                "v": np.arange(n) * 1_000_000 + 250_000, "n": np.arange(n)}
        blob = P.encode_piece("SPY", series, P.period_of(series, day), bars)
        dec = P.decode_piece(blob)
        _assert_same_bars(dec, bars)
        assert dec["header"]["tunit"] == P.T_UNIT[series]
    assert P.period_of("1", day) == "2026-11" and P.period_of("5", day) == "2026Q4"
    assert [P.period_of(s, day) for s in ("15", "30", "60", "60e")] == ["2026"] * 4
    assert P.period_of("5", "2026-03-31") == "2026Q1" and P.period_of("5", "2026-04-01") == "2026Q2"
    assert P.period_of("1", 20270101) == "2027-01"


# ------------------------------------------------------------- rejections

def test_empty_input_is_rejected():
    empty = {k: np.array([], dtype=np.int64) for k in P.COLUMNS}
    with pytest.raises(P.PieceError, match="at least one bar"):
        P.encode_piece("TEST", "1", "2026-11", empty)
    with pytest.raises(P.PieceError, match="at least one bar"):
        P.merge_piece(None, empty, symbol="TEST", series="1", period="2026-11")


def test_encoder_rejects_what_the_format_cannot_hold():
    bars = _synthetic(20)
    enc = lambda b, **kw: P.encode_piece("TEST", kw.pop("series", "1"), kw.pop("period", "2026-11"), b, **kw)
    with pytest.raises(P.PieceError, match="strictly increasing"):
        enc(dict(bars, t=bars["t"][::-1].copy()))
    dup = dict(bars, t=bars["t"].copy())
    dup["t"][3] = dup["t"][2]
    with pytest.raises(P.PieceError, match="strictly increasing"):
        enc(dup)
    with pytest.raises(P.PieceError, match="multiples of 60"):
        enc(dict(bars, t=bars["t"] + 1))
    with pytest.raises(P.PieceError, match="multiples of 300"):
        enc(dict(bars, t=bars["t"] // 300 * 300 + 60), series="5", period="2026Q4")
    with pytest.raises(P.PieceError, match="negative"):
        enc(dict(bars, l=-bars["l"]))
    with pytest.raises(P.PieceError, match="different lengths"):
        enc(dict(bars, n=bars["n"][:-1]))
    with pytest.raises(P.PieceError, match="missing columns"):
        enc({k: v for k, v in bars.items() if k != "n"})
    with pytest.raises(P.PieceError, match="integer array"):
        enc(dict(bars, o=bars["o"].astype(float)))
    with pytest.raises(P.PieceError, match="belongs to period 2026-11"):
        enc(bars, period="2026-10")
    with pytest.raises(P.PieceError, match="not a valid period"):
        enc(bars, period="2026Q4")
    with pytest.raises(P.PieceError, match="unknown series"):
        enc(bars, series="2")
    with pytest.raises(P.PieceError, match="powers of ten"):
        enc(bars, price_scale=500)
    # a piece cannot straddle its period: the last bar is in December
    late = dict(bars, t=bars["t"].copy())
    late["t"][-1] = _ts(2026, 12, 1, 4, 0)
    with pytest.raises(P.PieceError, match="belongs to period 2026-12"):
        enc(late)
    # ET, not UTC: 19:59 ET on Nov 30 is Dec 1 in UTC and is still November's
    edge = {k: v[:1].copy() for k, v in bars.items()}
    edge["t"][0] = _ts(2026, 11, 30, 19, 59)
    assert P.read_header(enc(edge))["period"] == "2026-11"


# ---------------------------------------------------- corruption / truncation

def _small_blob():
    return P.encode_piece("TEST", "1", "2026-11", _synthetic(120))


def test_every_corrupted_byte_is_an_error_never_different_data():
    blob = _small_blob()
    good = P.decode_piece(blob)
    raised = same = 0
    for i in range(len(blob)):
        for flip in (0xFF, 0x01, 0x80):
            bad = bytearray(blob)
            bad[i] ^= flip
            try:
                dec = P.decode_piece(bytes(bad))
            except P.PieceError as exc:
                assert str(exc)
                raised += 1
                continue
            # a flipped bit Brotli does not read (padding) may decode -- but only to the SAME data
            assert dec["header"] == good["header"], i
            for k in P.COLUMNS:
                assert np.array_equal(dec[k], good[k]), (i, k)
            same += 1
    assert raised >= 3 * len(blob) - 8, (raised, same)

    hlen = int.from_bytes(blob[4:6], "little")
    for pos, what in ((0, "magic"), (3, "version"), (4, "truncated|CRC"), (10, "CRC"),
                      (6 + hlen, "CRC"), (10 + hlen + 20, "corrupt|CRC|values|varint|range|body")):
        bad = bytearray(blob)
        bad[pos] ^= 0xFF
        with pytest.raises(P.PieceError, match=what):
            P.decode_piece(bytes(bad))
        with pytest.raises(P.PieceError):
            P.decode_piece_reference(bytes(bad))


def test_truncated_file_is_a_clear_error_at_every_length():
    blob = _small_blob()
    for cut in range(len(blob)):
        with pytest.raises(P.PieceError):
            P.decode_piece(blob[:cut])
    for cut in (0, 5, 9, 60, len(blob) - 1):
        with pytest.raises(P.PieceError):
            P.decode_piece_reference(blob[:cut])
        with pytest.raises(P.PieceError):
            P.read_header(blob[:cut]) if cut < 100 else P.decode_piece(blob[:cut])
    for extra in (b"\x00", b"\xff", b"more"):                 # bytes after the Brotli stream
        with pytest.raises(P.PieceError, match="corrupt or truncated"):
            P.decode_piece(blob + extra)
    with pytest.raises(P.PieceError, match="truncated"):
        P.decode_piece(b"")
    with pytest.raises(P.PieceError, match="magic"):
        P.decode_piece(b"not a piece at all, just some bytes")


def _reassemble(blob, header_edit=None, body_edit=None):
    """Rebuild a piece with a tampered header and/or body and VALID outer CRCs,
    so the inner checks (count, CRC of columns, ordering) are what must fire."""
    hlen = int.from_bytes(blob[4:6], "little")
    header = json.loads(blob[6:6 + hlen])
    body = brotli.decompress(blob[10 + hlen:])
    if body_edit:
        body = body_edit(body)
        header["body"] = len(body)      # keep the length check quiet so the deeper check must fire
    if header_edit:
        header_edit(header)
    hjson = json.dumps(header, sort_keys=True, separators=(",", ":")).encode()
    prefix = b"UBH" + bytes([blob[3]]) + len(hjson).to_bytes(2, "little") + hjson
    return prefix + zlib.crc32(prefix).to_bytes(4, "little") + brotli.compress(body, quality=5)


def _swap_last_varint(body, replacement):
    start = len(body) - 1
    while start > 0 and body[start - 1] & 0x80:
        start -= 1
    return body[:start] + replacement


def test_inner_checks_fire_when_the_outer_crcs_are_valid():
    blob = _small_blob()
    assert P.decode_piece(_reassemble(blob))["header"]["bars"] == 120       # control: untampered is fine
    cases = [
        (lambda h: h.update(bars=h["bars"] - 1), None, "values, expected"),            # bar count
        (lambda h: h.update(bars=h["bars"] + 1), None, "values, expected"),
        (lambda h: h.update(crc=h["crc"] ^ 1), None, "column CRC"),                    # column CRC
        (lambda h: h.update(first=h["first"] + 60), None, "first/last"),
        (lambda h: h.update(last=h["last"] + 60), None, "first/last"),
        (lambda h: h.update(body=h["body"] + 1), None, "header says"),
        (lambda h: h.update(pscale=h["pscale"] + 1), None, "powers of ten"),
        (lambda h: h.update(basis="adjusted"), None, "basis"),
        (lambda h: h.update(v=2), None, "version"),
        (lambda h: h.update(series="60"), None, "inconsistent"),
        (lambda h: h.pop("crc"), None, "missing required keys"),
        (lambda h: h.update(bars=0), None, "no bars"),
        (lambda h: h.update(bars="120"), None, "not a non-negative integer"),
        (lambda h: h.update(first=-1), None, "not a non-negative integer"),
        (lambda h: h.update(symbol=""), None, "symbol is empty"),
        (lambda h: h.update(period="2026"), None, "not a valid period"),
        (lambda h: h.update(vscale=0), None, "powers of ten"),
        # the last value of the body (a small transaction count) re-written in illegal shapes
        (None, lambda b: _swap_last_varint(b, b"\x85\x00"), "non-canonical varint"),
        (None, lambda b: _swap_last_varint(b, b"\x81" * 8 + b"\x01"), "longer than 8 bytes"),
        (None, lambda b: _swap_last_varint(b, b"\xff" * 7 + b"\x7f"), r"above 2\*\*53"),
        (None, lambda b: _swap_last_varint(b, b"\xff" * 7 + b"\x0f"), "column CRC"),   # 2**53 - 1: legal, just wrong
        (None, lambda b: b[:-1] + bytes([b[-1] ^ 2]), "column CRC"),                   # one value changed
        (None, lambda b: b + b"\x00", "values, expected"),
        (None, lambda b: b[:-1], "values, expected|inside a varint"),
        (None, lambda b: b[:-1] + b"\x80", "inside a varint"),
    ]
    for header_edit, body_edit, what in cases:
        bad = _reassemble(blob, header_edit, body_edit)
        with pytest.raises(P.PieceError, match=what):
            P.decode_piece(bad)
        with pytest.raises(P.PieceError):
            P.decode_piece_reference(bad)
    # a bad version BYTE is its own clear message
    bad = bytearray(blob)
    bad[3] = 2
    with pytest.raises(P.PieceError, match="unsupported format version 2"):
        P.decode_piece(bytes(bad))


def test_time_must_strictly_increase_on_decode():
    blob = _small_blob()

    def zero_second_delta(body):
        # T column is the first 120 varints; the second one is the first delta (1 byte, small)
        b = bytearray(body)
        i = 0
        while b[i] & 0x80:
            i += 1
        assert b[i + 1] < 0x80
        b[i + 1] = 0
        return bytes(b)

    bad = _reassemble(blob, None, zero_second_delta)
    with pytest.raises(P.PieceError, match="strictly increasing"):
        P.decode_piece(bad)
    with pytest.raises(P.PieceError, match="strictly increasing"):
        P.decode_piece_reference(bad)


def _raw_columns(blob):
    """(header, [T, O, H, L, C, V, VF, N]) -- the eight varint columns as stored."""
    hlen = int.from_bytes(blob[4:6], "little")
    header = json.loads(blob[6:6 + hlen])
    n = header["bars"]
    stream = P._varint_decode(brotli.decompress(blob[10 + hlen:]), 8 * n)
    return header, [stream[i * n:(i + 1) * n].copy() for i in range(8)]


def _pack(header, columns):
    """A structurally valid piece (good header CRC, good Brotli, right body length)
    from hand-made columns: only the check under test can refuse it."""
    body = P._varint_encode(np.concatenate([np.asarray(c, dtype=np.uint64) for c in columns]))
    header = dict(header, body=len(body))
    hjson = json.dumps(header, sort_keys=True, separators=(",", ":")).encode()
    prefix = b"UBH\x01" + len(hjson).to_bytes(2, "little") + hjson
    return prefix + zlib.crc32(prefix).to_bytes(4, "little") + brotli.compress(body, quality=5)


def _three_bars(series="60e", vol=(0, 0, 0), vol_scale=1):
    t = _ts(2026, 11, 13, 4, 0) + 3600 * np.arange(3)
    bars = {"t": t, "o": np.array([10, 11, 12]), "h": np.array([15, 15, 15]), "l": np.array([5, 5, 5]),
            "c": np.array([11, 12, 13]), "v": np.array(vol), "n": np.array([1, 2, 3])}
    return bars, P.encode_piece("X", series, "2026", bars, price_scale=1, vol_scale=vol_scale)


def test_crafted_pieces_that_only_one_guard_can_refuse():
    bars, blob = _three_bars(vol=(2_500_000, 1_000_001, 7), vol_scale=1_000_000)
    header, cols = _raw_columns(blob)
    assert header["vscale"] == 1_000_000 and cols[5].tolist() == [2, 1, 0] and cols[6].tolist() == [500_000, 1, 7]
    assert np.array_equal(P.decode_piece(_pack(header, cols))["v"], bars["v"])           # control

    # (a) the same volume written non-canonically (whole - 1, fraction + vscale): the column CRC
    #     still matches, so only the "fraction < vscale" rule can refuse it
    bad = [c.copy() for c in cols]
    bad[5][0] -= 1
    bad[6][0] += 1_000_000
    for decode in (P.decode_piece, P.decode_piece_reference):
        with pytest.raises(P.PieceError, match="fractional volume is not below vscale"):
            decode(_pack(header, bad))

    # (b) a negative price whose CRC is made to match: only the range check can refuse it
    bad = [c.copy() for c in cols]
    bad[1][0] = 2 * 6 - 1                                    # zz(-6): open = -6
    bad[4][0] = 2 * 17                                       # close back to 11
    neg = {k: np.asarray(bars[k], dtype=np.int64).copy() for k in P.COLUMNS}
    neg["o"][0] = -6
    crafted = _pack(dict(header, crc=P._columns_crc(neg)), bad)
    for decode in (P.decode_piece, P.decode_piece_reference):
        with pytest.raises(P.PieceError, match="out of range"):
            decode(crafted)

    # (c) whole shares * vscale overflowing 64 bits back into range, CRC made to match the wrapped value
    bars0, blob0 = _three_bars()
    header0, cols0 = _raw_columns(blob0)
    assert header0["vscale"] == 1
    big = 18_446_744_074                                     # * 1e9 = 2**64 + 290,448,384
    assert big * 10 ** 9 - 2 ** 64 == 290_448_384
    bad = [c.copy() for c in cols0]
    bad[5][0] = big
    wrapped = {k: np.asarray(bars0[k], dtype=np.int64).copy() for k in P.COLUMNS}
    wrapped["v"][0] = 290_448_384
    crafted = _pack(dict(header0, vscale=10 ** 9, crc=P._columns_crc(wrapped)), bad)
    with pytest.raises(P.PieceError, match="volume is out of range"):
        P.decode_piece(crafted)
    with pytest.raises(P.PieceError, match="out of range"):
        P.decode_piece_reference(crafted)

    # (d) first time * tunit overflowing 64 bits back into range, CRC and first/last made to match
    t0 = 5_124_095_576_030_432                               # * 3600 = 2**64 + 3584
    assert t0 * 3600 - 2 ** 64 == 3584 and t0 < 2 ** 53
    bad = [c.copy() for c in cols0]
    bad[0][0] = t0
    wrapped = {k: np.asarray(bars0[k], dtype=np.int64).copy() for k in P.COLUMNS}
    wrapped["t"] = np.array([3584, 3584 + 3600, 3584 + 7200])
    crafted = _pack(dict(header0, first=3584, last=3584 + 7200, crc=P._columns_crc(wrapped)), bad)
    with pytest.raises(P.PieceError, match="time is out of range"):
        P.decode_piece(crafted)
    with pytest.raises(P.PieceError, match="out of range"):
        P.decode_piece_reference(crafted)


# ------------------------------------------------------------------- merge

def test_merge_new_replaces_old_sorted_and_deduplicated():
    bars = _synthetic(200)
    old = {k: v[:150] for k, v in bars.items()}
    blob = P.encode_piece("TEST", "1", "2026-11", old)

    # the vendor revises bars 100..149 and adds 150..199, handed over out of order
    new = {k: v[100:].copy() for k, v in bars.items()}
    new["c"] = new["c"] + 7
    new["h"] = np.maximum(new["h"], new["c"])
    new["v"] = new["v"] + 3
    perm = np.random.default_rng(1).permutation(100)
    shuffled = {k: v[perm] for k, v in new.items()}
    merged = P.decode_piece(P.merge_piece(blob, shuffled))

    assert merged["header"]["bars"] == 200
    assert np.array_equal(merged["t"], bars["t"])
    assert (np.diff(merged["t"]) > 0).all()
    assert np.array_equal(merged["c"][:100], bars["c"][:100])           # untouched old bars kept
    assert np.array_equal(merged["c"][100:], bars["c"][100:] + 7)       # NEW won for 100..149
    assert np.array_equal(merged["v"][100:], bars["v"][100:] + 3)
    assert not np.array_equal(merged["c"][100:150], bars["c"][100:150])

    # merge == encode of the union, byte for byte, whatever the hand-over order
    want = {k: np.concatenate([old[k][:100], new[k]]) for k in P.COLUMNS}
    assert P.merge_piece(blob, shuffled) == P.encode_piece("TEST", "1", "2026-11", want)
    assert P.merge_piece(blob, new) == P.merge_piece(blob, shuffled)


def test_merge_is_idempotent_and_order_independent():
    bars = _synthetic(300)
    a = {k: v[:180] for k, v in bars.items()}
    b = {k: v[120:] for k, v in bars.items()}
    whole = P.encode_piece("TEST", "1", "2026-11", bars)
    ab = P.merge_piece(P.merge_piece(None, a, symbol="TEST", series="1", period="2026-11"), b)
    assert ab == whole
    assert P.merge_piece(ab, b) == whole and P.merge_piece(ab, a) == whole     # folding again changes nothing
    ba = P.merge_piece(P.merge_piece(None, b, symbol="TEST", series="1", period="2026-11"), a)
    assert ba == whole


def test_merge_within_new_bars_last_occurrence_wins():
    bars = _synthetic(10)
    twice = {k: np.concatenate([v, v[4:6]]) for k, v in bars.items()}
    twice["c"] = twice["c"].copy()
    twice["c"][-2:] += 5                                    # the later copies differ
    twice["h"] = np.maximum(twice["h"], twice["c"])
    dec = P.decode_piece(P.merge_piece(None, twice, symbol="TEST", series="1", period="2026-11"))
    assert dec["header"]["bars"] == 10
    assert np.array_equal(dec["c"][4:6], bars["c"][4:6] + 5)


def test_merge_across_scales_and_identity_checks():
    bars = _synthetic(40)
    coarse = {"t": bars["t"][:20], "n": bars["n"][:20], "v": bars["v"][:20] // 1_000_000,
              **{k: bars[k][:20] // 10_000 for k in "ohlc"}}
    blob = P.encode_piece("TEST", "1", "2026-11", coarse, price_scale=100, vol_scale=1)
    assert P.read_header(blob)["pscale"] == 100
    fine = {k: v[20:] for k, v in bars.items()}
    merged = P.decode_piece(P.merge_piece(blob, fine))
    assert merged["header"]["pscale"] == 1_000_000 and merged["header"]["vscale"] == 1_000_000
    assert np.array_equal(merged["o"][:20], coarse["o"] * 10_000)
    assert np.array_equal(merged["v"][:20], coarse["v"] * 1_000_000)
    assert np.array_equal(merged["o"][20:], fine["o"])
    with pytest.raises(P.PieceError, match="symbol='TEST'"):
        P.merge_piece(blob, fine, symbol="OTHER")
    with pytest.raises(P.PieceError, match="series='1'"):
        P.merge_piece(blob, fine, series="5")
    with pytest.raises(P.PieceError, match="required"):
        P.merge_piece(None, fine)
    with pytest.raises(P.PieceError):
        P.merge_piece(blob[:-3], fine)


# ------------------------------------------------------------------- paths

def test_symbol_path_encoding_is_reversible_case_safe_and_device_safe():
    samples = ["NVDA", "BRK.B", "BACpB", "AIIAr", "AAC.WS", "CON", "PRN", "AUX", "NUL", "COM1",
               "BCPC", "BCpC", "TPC", "TpC", "A", "X_Y", "s-ODD", "ÅB", "a b/c\\d:e*f?"]
    encoded = [P.encode_symbol(s) for s in samples]
    assert [P.decode_symbol(e) for e in encoded] == samples
    assert len({e.upper() for e in encoded}) == len(samples)                 # no case-insensitive collision
    reserved = {"CON", "PRN", "AUX", "NUL"} | {f"{p}{i}" for p in ("COM", "LPT") for i in range(10)}
    for e in encoded:
        assert e == e.upper().replace("S-", "s-", 1)
        assert all(ch in "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-s" for ch in e)
        assert e.upper() not in reserved and not e.endswith((".", " "))
    assert P.encode_symbol("NVDA") == "s-NVDA"
    assert P.encode_symbol("BRK.B") == "s-BRK_2EB"
    assert P.encode_symbol("BACpB") == "s-BAC_70B"
    assert P.piece_relpath("60e", "BRK.B", "2026") == "v1/60e/s-BRK_2EB/2026.ubh"
    assert P.index_relpath("CON") == "v1/index/s-CON.json"
    for bad in ("NVDA", "s-nvda", "s-BRK_2", "s-BRK_2eB", "s-", "s-A_41"):   # _41 is 'A': non-canonical
        with pytest.raises(P.PieceError):
            P.decode_symbol(bad)
    with pytest.raises(P.PieceError):
        P.encode_symbol("")
    with pytest.raises(P.PieceError):
        P.piece_relpath("1", "NVDA", "2026")


# ------------------------------------------------------------- real data

def _load_probe():
    import pyarrow as pa
    import pyarrow.csv as pc
    pa.set_cpu_count(1)
    tb = pc.read_csv(PROBE, read_options=pc.ReadOptions(use_threads=False))
    enc = tb["ticker"].combine_chunks().dictionary_encode()
    codes = enc.indices.to_numpy()
    names = enc.dictionary.to_pylist()
    cols = {c: tb[c].to_numpy() for c in ("open", "high", "low", "close", "volume", "transactions", "window_start")}
    return codes, names, cols


@pytest.mark.skipif(not os.path.exists(PROBE), reason=f"real-data round trip needs {PROBE}")
def test_real_day_round_trips_exactly_for_every_ticker():
    """Every row of a real vendor day: float -> piece -> float is bit-identical,
    for all ~11,900 tickers (the numpy decoder), and the reference decoder agrees
    on a sample."""
    codes, names, cols = _load_probe()
    assert (cols["window_start"] % 60_000_000_000 == 0).all()
    t_all = cols["window_start"] // 1_000_000_000
    # exactness of the 1e6 scale over the WHOLE file, including sub-dollar 6-decimal prints
    whole = P.bars_from_floats(t_all, cols["open"], cols["high"], cols["low"], cols["close"],
                               cols["volume"], cols["transactions"])
    assert len(whole["t"]) > 1_000_000
    six_dec = int(((whole["o"] % 100) != 0).sum())
    frac_vol = int(((whole["v"] % 1_000_000) != 0).sum())
    assert six_dec > 0 and frac_vol > 0, "the probe file no longer exercises 6-decimal prices / fractional volume"

    bounds = np.flatnonzero(np.diff(codes)) + 1
    starts = np.concatenate([[0], bounds])
    ends = np.concatenate([bounds, [len(codes)]])
    assert len(starts) == len(names) > 10_000
    rows = total_bytes = 0
    scales = set()
    for k, (s, e) in enumerate(zip(starts, ends)):
        sym = names[codes[s]]
        bars = {c: whole[c][s:e] for c in P.COLUMNS}
        blob = P.encode_piece(sym, "1", "2026-11", bars, quality=5)
        dec = P.decode_piece(blob)
        assert dec["header"]["symbol"] == sym and dec["header"]["bars"] == e - s
        back = P.bars_to_floats(dec)
        for name, src in (("o", "open"), ("h", "high"), ("l", "low"), ("c", "close"), ("v", "volume")):
            assert back[name].tobytes() == cols[src][s:e].tobytes(), (sym, name)
        assert np.array_equal(back["t"], t_all[s:e])
        assert np.array_equal(back["n"], cols["transactions"][s:e])
        scales.add(dec["header"]["pscale"])
        if k % 150 == 0 or sym in ("SPY", "NVDA", "BRK.A"):
            ref = P.decode_piece_reference(blob)
            for c in P.COLUMNS:
                assert np.array_equal(ref[c], dec[c]), (sym, c)
        rows += e - s
        total_bytes += len(blob)
    assert rows == len(codes)
    assert {100, 10_000, 1_000_000} <= scales          # the per-piece scale really varies
    print(f"\nreal day: {rows} bars, {len(starts)} pieces, {total_bytes / rows:.2f} bytes/bar at q5, "
          f"{six_dec} six-decimal opens, {frac_vol} fractional volumes")
