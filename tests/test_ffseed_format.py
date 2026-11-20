"""First-frame seed pack format (api/services/ffseed_format.py, docs/charts/first-frame-seed-format.md).

The contract under test: a pack hands back EXACTLY the served bars that went in (bit-identical
doubles, same `t`), the per-symbol body is the history lake's piece body (so the lake's column
decoder reads it), anything that cannot be held exactly is refused, and a damaged pack is refused.
"""
import gzip
import json
import random
import struct

import numpy as np
import pytest

from api.services import ffseed_format as fmt


def _bits(x) -> bytes:
    return struct.pack("<d", float(x))


def _intraday_series(start, step, n, seed, *, base=50.0, frac_vol=False, dp=4):
    rng = random.Random(seed)
    out, px = [], base
    for i in range(n):
        o = round(px, dp)
        c = round(max(0.0001, px * (1 + rng.uniform(-0.01, 0.01))), dp)
        h = round(max(o, c) + rng.choice([0, 0.0001, 0.01, 0.37]), dp)
        lo = round(max(0.0001, min(o, c) - rng.choice([0, 0.0001, 0.02])), dp)
        v = rng.randint(0, 2_000_000)
        if frac_vol and i % 3 == 0:
            v = v + 0.25
        out.append({"t": start + i * step + (rng.randint(0, 3) * step if i else 0) * 0, "o": o, "h": h,
                    "l": lo, "c": c, "v": v})
        px = c
    # gaps (overnight / thin names): every 7th bar jumps ahead
    t = start
    for i, b in enumerate(out):
        b["t"] = t
        t += step * (5 if i % 7 == 6 else 1)
    return out


def _daily_series(n, seed):
    rng = random.Random(seed)
    from datetime import date, timedelta
    d, out, px = date(2025, 3, 3), [], 312.5
    while len(out) < n:
        if d.weekday() < 5:
            o = round(px, 4)
            c = round(px * (1 + rng.uniform(-0.03, 0.03)), 4)
            out.append({"t": d.isoformat(), "o": o, "h": round(max(o, c) * 1.01, 4),
                        "l": round(min(o, c) * 0.99, 4), "c": c, "v": rng.randint(10_000, 90_000_000)})
            px = c
        d += timedelta(days=1)
    return out


SERIES = {
    ("5", "AAPL"): _intraday_series(1_794_000_000 // 300 * 300, 300, 300, 1),
    ("5", "PENNY"): _intraday_series(1_794_000_000 // 300 * 300, 300, 120, 2, base=0.0412),
    ("5", "BRK-A"): _intraday_series(1_794_000_000 // 300 * 300, 300, 50, 3, base=731_000.25, dp=2),
    ("5", "FRAC"): _intraday_series(1_794_000_000 // 300 * 300, 300, 40, 4, frac_vol=True),
    ("5", "ONE"): _intraday_series(1_794_000_000 // 300 * 300, 300, 1, 5),
    ("60", "SPY"): _intraday_series(1_794_000_000 // 1800 * 1800, 1800, 1000, 6, base=590.0),
    ("1", "NVDA"): _intraday_series(1_794_000_000 // 60 * 60, 60, 600, 7, base=190.0),
    ("D", "MSFT"): _daily_series(350, 8),
    ("D", "IPO"): _daily_series(12, 9),
}


def _pack(tf, comp="gzip", order=None):
    pb = fmt.PackBuilder(tf, asof="2026-11-18", build="20261119T0131Z", depth=300, comp=comp)
    items = [(s, b) for (t, s), b in SERIES.items() if t == tf]
    if order is not None:
        items = order(items)
    for sym, bars in items:
        pb.add_served(sym, bars)
    return pb.finish()


@pytest.mark.parametrize("comp", fmt.COMPRESSIONS)
@pytest.mark.parametrize("tf", ["1", "5", "60", "D"])
def test_round_trip_is_bit_exact(tf, comp):
    data = _pack(tf, comp)
    tr = fmt.read_trailer(data)
    assert tr["tf"] == tf and tr["comp"] == comp and tr["asof"] == "2026-11-18"
    expected = {s: b for (t, s), b in SERIES.items() if t == tf}
    assert set(tr["symbols"]) == set(expected)
    for sym, bars in expected.items():
        got = fmt.read_served(data, sym, tr)
        assert len(got) == len(bars)
        for a, b in zip(got, bars):
            assert a["t"] == b["t"] and type(a["t"]) is type(b["t"])
            for k in "ohlcv":
                assert _bits(a[k]) == _bits(b[k]), (sym, k, a, b)
        e = dict(zip(fmt.ENTRY_FIELDS, tr["symbols"][sym]))
        assert e["bars"] == len(bars)
        assert e["asof"] == 20261118
        first, last = bars[0]["t"], bars[-1]["t"]
        if tf == "D":
            assert fmt.iso_of_day_seconds(e["first"]) == first and fmt.iso_of_day_seconds(e["last"]) == last
        else:
            assert (e["first"], e["last"]) == (first, last)


def test_scales_are_the_smallest_exact():
    tr = fmt.read_trailer(_pack("5"))
    e = {s: dict(zip(fmt.ENTRY_FIELDS, v)) for s, v in tr["symbols"].items()}
    assert e["AAPL"]["pscale"] == 10_000 and e["AAPL"]["vscale"] == 1
    assert e["BRK-A"]["pscale"] == 100
    assert e["FRAC"]["vscale"] == 100            # 0.25 shares
    tr_d = fmt.read_trailer(_pack("D"))
    assert dict(zip(fmt.ENTRY_FIELDS, tr_d["symbols"]["MSFT"]))["vscale"] == 1


def test_pack_bytes_do_not_depend_on_insertion_order():
    assert _pack("5") == _pack("5", order=lambda items: list(reversed(items)))
    assert _pack("5") == _pack("5", order=lambda items: sorted(items, key=lambda kv: len(kv[1])))


def test_body_is_the_history_lake_piece_body():
    """The per-symbol body is byte for byte the lake piece body, so the lake's column decoder
    (piece.js decodeBody, piece.decode_piece) reads it unchanged."""
    brotli = pytest.importorskip("brotli")
    from tools.history_lake import piece
    bars = SERIES[("5", "FRAC")]
    cols = fmt.served_to_ints(bars, "5")
    body, facts = fmt.encode_body(cols, "5")
    # the lake encoder, fed the same integers at the same scales
    lake = piece.encode_piece("FRAC", "5", piece.period_of("5", piece.bucketing.et_date_of(int(cols["t"][0]))),
                              {k: cols[k] for k in fmt.COLUMNS},
                              price_scale=cols["pscale"], vol_scale=cols["vscale"])
    hdr, off = piece._parse_prefix(lake)
    assert brotli.decompress(lake[off:]) == body
    assert hdr["crc"] == facts["crc"] and hdr["body"] == facts["body"]
    assert (hdr["pscale"], hdr["vscale"]) == (facts["pscale"], facts["vscale"])


def test_gzip_blob_is_one_plain_gzip_member():
    data = _pack("5", "gzip")
    tr = fmt.read_trailer(data)
    off, ln = tr["symbols"]["AAPL"][:2]
    blob = data[off:off + ln]
    assert blob[:2] == b"\x1f\x8b"                       # a browser's DecompressionStream('gzip') input
    assert len(gzip.decompress(blob)) == tr["symbols"]["AAPL"][7]


@pytest.mark.parametrize("bad, why", [
    ([{"t": 1794000000, "o": 0.123456789012, "h": 1, "l": 0.1, "c": 0.5, "v": 1}], "exact"),
    ([{"t": 1794000000, "o": 1, "h": 1, "l": 1, "c": 1, "v": None}], "non-number"),
    ([{"t": 1794000000, "o": 0, "h": 1, "l": 1, "c": 1, "v": 1}], "positive"),
    ([{"t": 1794000000, "o": 1, "h": 1, "l": 1, "c": 1, "v": -5}], "negative"),
    ([{"t": 1794000000, "o": float("nan"), "h": 1, "l": 1, "c": 1, "v": 1}], "finite"),
    ([{"t": 1794000030, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}], "multiples"),
    ([{"t": 1794000000, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}] * 2, "increasing"),
])
def test_refuses_what_it_cannot_hold_exactly(bad, why):
    pb = fmt.PackBuilder("5", asof="2026-11-18", build="b", depth=300)
    with pytest.raises(fmt.SeedError, match=why):
        pb.add_served("X", bad)
    assert len(pb) == 0


def test_daily_time_must_be_an_iso_date():
    with pytest.raises(fmt.SeedError):
        fmt.served_to_ints([{"t": 1794000000, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}], "D")
    with pytest.raises(fmt.SeedError):
        fmt.served_to_ints([{"t": "2026-11-18T00:00", "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}], "D")


def _flip(data: bytes, pos: int) -> bytes:
    b = bytearray(data)
    b[pos] ^= 0x01
    return bytes(b)


@pytest.mark.parametrize("comp", fmt.COMPRESSIONS)
def test_a_damaged_blob_is_refused(comp):
    data = _pack("5", comp)
    tr = fmt.read_trailer(data)
    off, ln = tr["symbols"]["AAPL"][:2]
    for pos in (off + ln // 2, off + ln - 1):
        bad = _flip(data, pos)
        with pytest.raises(fmt.SeedError):
            fmt.read_served(bad, "AAPL", fmt.read_trailer(bad))


def test_a_damaged_frame_is_refused():
    data = _pack("D")
    with pytest.raises(fmt.SeedError, match="end marker"):
        fmt.read_trailer(data[:-1])
    with pytest.raises(fmt.SeedError):
        fmt.read_trailer(_flip(data, len(data) - 12))                   # trailer length
    tlen = struct.unpack("<Q", data[-16:-8])[0]
    start = len(data) - 16 - tlen
    tr = json.loads(data[start:start + tlen])
    tr["symbols"]["MSFT"][1] = 10 ** 9                                  # reaches past the blobs
    bad_tr = json.dumps(tr, sort_keys=True, separators=(",", ":")).encode()
    bad = data[:start] + bad_tr + struct.pack("<Q", len(bad_tr)) + fmt.MAGIC
    with pytest.raises(fmt.SeedError, match="past the blobs"):
        fmt.read_trailer(bad)


def test_trailer_entry_lies_are_caught_by_the_body_checks():
    data = _pack("5")
    tr = fmt.read_trailer(data)
    tr["symbols"]["AAPL"][4] += 300                                      # wrong `last`
    with pytest.raises(fmt.SeedError, match="first/last"):
        fmt.decode_symbol(data, tr, "AAPL")
    tr = fmt.read_trailer(data)
    tr["symbols"]["AAPL"][6] ^= 1                                        # wrong crc
    with pytest.raises(fmt.SeedError, match="CRC"):
        fmt.decode_symbol(data, tr, "AAPL")


def test_reference_decoder_agrees_with_numpy_columns():
    bars = SERIES[("60", "SPY")]
    cols = fmt.served_to_ints(bars, "60")
    body, f = fmt.encode_body(cols, "60")
    got = fmt.decode_body(body, bars=f["bars"], first=f["first"], last=f["last"], crc=f["crc"],
                          body_len=f["body"], tunit=1800, pscale=f["pscale"], vscale=f["vscale"])
    for k in fmt.COLUMNS:
        assert np.array_equal(got[k], cols[k]), k


def test_missing_symbol_reads_none():
    data = _pack("5")
    assert fmt.read_served(data, "NOPE") is None
