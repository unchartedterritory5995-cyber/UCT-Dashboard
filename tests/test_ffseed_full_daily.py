"""The full-depth daily seed pack (zero-network switch PR 3.1, api/services/ffseed.py `daily_full_window`).

What is pinned here:
  * the device's D copy IS what a daily chart holds once its history joined: the sealed history
    (`/api/bars-history`, the real `serve_bars_history`) older than the tail's first bar, then the tail (the real
    `/api/bars` warm path at the first-paint count), bit for bit, with the serve path's split adjustment applied;
  * the seam rule is the client's (a > 2% close mismatch at the tail's first bar refuses the join: the history alone);
  * WHOLE: a symbol whose store read held fewer rows than the depth is named whole by the trailer; one that filled
    it is `partial` (its device copy still joins its history); the default depth is the history route's ceiling;
  * the daily delta carries the new build's whole/partial, and its proof refuses one that does not.
"""
import json
import struct
from datetime import date, timedelta

import pytest

from api.routers import bars as bars_router     # imported BEFORE any patch (it binds bars_fetch names at import)
from api.services import ffseed, ffseed_delta, ffseed_format as fmt


@pytest.fixture(autouse=True)
def _offline(monkeypatch):
    monkeypatch.setattr(ffseed, "_massive_split_rows", lambda s: (_ for _ in ()).throw(RuntimeError("offline")))
    monkeypatch.setattr(ffseed, "_fmp_cached_splits", lambda sym: [])
    from api.services import data_sync
    monkeypatch.setattr(data_sync, "get_bytes", lambda key: None)
    monkeypatch.delenv("FFSEED_DEPTH_D", raising=False)


def _trading_days(start: date, n: int):
    out, d = [], start
    while len(out) < n:
        if ffseed.is_trading_day(d):
            out.append(d)
        d += timedelta(days=1)
    return out


@pytest.fixture
def stored(monkeypatch):
    """A stand-in bars.db behind the real /api/bars warm path and the real /api/bars-history read."""
    from api.services import bars_fetch, bars_sanitize, bars_sqlite, bars_live_store
    rows = {}

    def get_bars(ticker, tf, n):
        return list(rows.get((ticker.upper(), tf), [])[-n:])

    monkeypatch.setattr(bars_sqlite, "get_bars", get_bars)
    monkeypatch.setattr(bars_sqlite, "get_last_ts", lambda t, tf: (rows.get((t.upper(), tf)) or [[None]])[-1][0])
    monkeypatch.setattr(bars_fetch, "_needs_fresh", lambda *a, **k: False)
    monkeypatch.setattr(bars_fetch, "_maybe_kick_deepfill", lambda *a, **k: None)
    monkeypatch.setattr(bars_fetch, "_live_derive_on_read", lambda *a, **k: None)
    monkeypatch.setattr(bars_fetch, "_live_derived_proof", lambda *a, **k: None)
    monkeypatch.setattr(bars_fetch, "_history_complete", lambda *a, **k: True)
    monkeypatch.setattr(bars_live_store, "covered", lambda *a, **k: False)
    monkeypatch.setattr(bars_sanitize, "_schedule_store_repair", lambda *a, **k: None)
    monkeypatch.setattr(bars_sanitize, "_meta_cached", lambda t: None)
    return rows


def _api_bars(sym, count):
    from api.services import bars_fetch
    resp = bars_fetch._get_bars_inner(sym, "D", count)
    assert bars_fetch.get_serve_layer() == "sqlite"
    return json.loads(resp.body)["bars"]


def _history(sym):
    """What the browser's deep join reads: `/api/bars-history/{sym}?tf=D&bars=60000` (the real serve function)."""
    resp = bars_router.serve_bars_history(sym, "D", 60000)
    body = json.loads(resp.body)
    assert body["sealed"] is True
    return body["bars"]


def _chart_after_join(sym):
    """utils/historyPrepend.prependOlder over the first-paint tail (no seam mismatch in these fixtures)."""
    tail = _api_bars(sym, ffseed.FIRST_PAINT_READ["D"])
    hist = _history(sym)
    return [b for b in hist if b["t"] < tail[0]["t"]] + tail


def _bits(x):
    return struct.pack("<d", float(x))


def _assert_same(seed, chart):
    assert len(seed) == len(chart)
    for a, b in zip(seed, chart):
        assert a["t"] == b["t"]
        for k in "ohlcv":
            assert _bits(a[k]) == _bits(b[k]), (a, b, k)


def _series(days, split_day=None, start=40.0):
    out = []
    for i, d in enumerate(days):
        px = start + i * 0.05
        if split_day is not None and d < split_day:
            px *= 3                                     # the store holds the pre-split basis (the serve path heals it)
        out.append((int(d.strftime("%Y%m%d")), round(px, 4), round(px * 1.01, 4), round(px * 0.99, 4),
                    round(px * 1.002, 4), 2_000_000 + i))
    return out


def test_default_daily_depth_is_the_history_routes_ceiling():
    assert ffseed.depth_for("D") == 60000 and ffseed.daily_is_full(ffseed.depth_for("D"))
    assert not ffseed.daily_is_full(350)                 # FFSEED_DEPTH_D=350 restores the shallow window


def test_full_daily_seed_is_the_chart_after_its_history_joined(stored, monkeypatch):
    from api.services import bars_sanitize
    sym = "ZZFULLD"
    days = _trading_days(date(2019, 1, 2), 1700)           # ends long before today: every bar is sealed
    split_day = days[900]                                  # deep in the history, far left of the tail
    stored[(sym, "D")] = _series(days, split_day)
    monkeypatch.setattr(bars_sanitize, "_meta_cached", lambda t: {"splits": [(split_day.isoformat(), 3.0)]})
    asof = days[-1]
    data, st = ffseed.build_tf("D", [sym], asof, "B1")
    tr = fmt.read_trailer(data)
    assert st["symbols"] == 1 and st["bars"] == 1700 and st["partial"] == 0
    assert tr["whole"] is True and tr["partial"] == [] and fmt.whole_symbols(tr) == {sym}
    seed = fmt.read_served(data, sym)
    _assert_same(seed, _chart_after_join(sym))
    # the split IS applied in the deep part: the day before the split sits on the post-split basis
    pre = next(b for b in seed if b["t"] == days[899].isoformat())
    assert abs(pre["c"] / next(b for b in seed if b["t"] == split_day.isoformat())["c"] - 1) < 0.01


def test_a_short_listing_is_whole_and_holds_every_bar(stored):
    sym = "ZZNEWLIST"
    days = _trading_days(date(2026, 6, 1), 120)            # fewer rows than the first-paint read: one read
    stored[(sym, "D")] = _series(days)
    asked = []
    real = ffseed.store_read

    def read(s, tf, n):
        asked.append(n)
        return real(s, tf, n)

    bars, whole = ffseed.daily_full_window(sym, 60000, int(days[-1].strftime("%Y%m%d")), read=read)
    assert whole is True and len(bars) == 120 and bars[0]["t"] == days[0].isoformat()
    assert asked == [ffseed.FIRST_PAINT_READ["D"]]        # the store ran out on the tail read: no second read


def test_a_series_deeper_than_the_depth_is_partial(stored):
    sym = "ZZDEEP"
    days = _trading_days(date(2020, 1, 2), 1000)
    stored[(sym, "D")] = _series(days)
    data, st = ffseed.build_tf("D", [sym], days[-1], "B1", depth=800)
    tr = fmt.read_trailer(data)
    assert st["partial"] == 1 and tr["partial"] == [sym] and fmt.whole_symbols(tr) == frozenset()
    assert dict(zip(fmt.ENTRY_FIELDS, tr["symbols"][sym]))["bars"] == 800


def test_the_seam_rule_is_the_clients():
    deep = [{"t": f"2026-01-{d:02d}", "o": 10, "h": 11, "l": 9, "c": 10.0, "v": 1} for d in range(2, 30)]
    tail_same = [dict(b) for b in deep[20:]]
    tail_same[0]["c"] = 10.19                              # 1.9%: joined, the tail wins the overlap
    joined = ffseed.join_daily(deep, tail_same)
    assert [b["t"] for b in joined] == [b["t"] for b in deep] and joined[20]["c"] == 10.19
    tail_off = [dict(b, c=b["c"] * 1.05) for b in deep[20:]]   # 5% at the seam: refused, the history alone
    assert ffseed.join_daily(deep, tail_off) == deep


def test_the_shallow_depth_has_no_whole_key(stored):
    sym = "ZZSHALLOW"
    days = _trading_days(date(2024, 1, 2), 500)
    stored[(sym, "D")] = _series(days)
    data, _st = ffseed.build_tf("D", [sym], days[-1], "B1", depth=350)
    tr = fmt.read_trailer(data)
    assert "whole" not in tr and "partial" not in tr and fmt.whole_symbols(tr) == frozenset()


def _daily(days, px=10.0):
    return [{"t": d.isoformat(), "o": px, "h": px + 1, "l": px - 1, "c": px + 0.5, "v": 1000} for d in days]


def _whole_pack(build, asof, series, partial=()):
    pb = fmt.PackBuilder("D", asof=asof.isoformat(), build=build, depth=60000, whole=True, partial=partial)
    for sym, bars in series.items():
        pb.add_served(sym, bars)
    return pb.finish()


def test_the_delta_carries_whole_and_partial_and_its_proof_checks_them():
    base_days = _trading_days(date(2025, 1, 2), 400)
    new_days = base_days + _trading_days(base_days[-1] + timedelta(days=1), 1)
    base = _whole_pack("20261120T0131Z", base_days[-1], {"AAA": _daily(base_days), "BBB": _daily(base_days, 20)},
                       partial=["BBB"])
    new = _whole_pack("20261121T0131Z", new_days[-1], {"AAA": _daily(new_days), "BBB": _daily(new_days, 20)},
                      partial=["BBB"])
    delta, st = ffseed_delta.build_delta(base, new)
    dtr = ffseed_delta.read_delta_trailer(delta)
    assert dtr["whole"] is True and dtr["partial"] == ["BBB"]
    assert st["merge"] == 2                                # one appended row a symbol, not a whole record
    # a delta that does not say what the new pack says is not proven
    shallow_new = fmt.PackBuilder("D", asof=new_days[-1].isoformat(), build="20261121T0131Z", depth=60000)
    shallow_new.add_served("AAA", _daily(new_days))
    shallow_new.add_served("BBB", _daily(new_days, 20))
    with pytest.raises(ffseed_delta.DeltaError, match="whole/partial"):
        ffseed_delta.verify_delta(base, delta, shallow_new.finish())


def test_a_malformed_whole_key_is_refused():
    pb = fmt.PackBuilder("D", asof="2026-01-05", build="B", depth=60000, whole=True)
    pb.add_served("AAA", _daily(_trading_days(date(2025, 12, 1), 20)))
    data = pb.finish()
    tr_len = int.from_bytes(data[-16:-8], "little")
    tr = json.loads(data[-16 - tr_len:-16])
    tr["partial"] = "AAA"                                  # a string, not a list
    body = json.dumps(tr, sort_keys=True, separators=(",", ":")).encode("ascii")
    bad = data[:-16 - tr_len] + body + len(body).to_bytes(8, "little") + data[-8:]
    with pytest.raises(fmt.SeedError, match="whole/partial"):
        fmt.read_trailer(bad)
