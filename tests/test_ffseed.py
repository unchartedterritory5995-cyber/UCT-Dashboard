"""First-frame seed builder (api/services/ffseed.py).

What is pinned here:
  * the selection: newest N, regular session only (half-day aware), the 60m 'session' grid,
    nothing past the as-of session, the read window grows only when it must;
  * the seed IS the /api/bars answer: the same stored rows answered by the real `/api/bars`
    warm path (`bars_fetch._get_bars_inner` Layer 2), filtered the way the chart filters them,
    equal the decoded seed bit for bit, with the serve path's split adjustment applied;
  * the build bookkeeping (skips, floor, manifest) and the nightly trigger.
"""
import hashlib
import json
import math
import re
import struct
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from api.services import ffseed, ffseed_format as fmt

ET = ZoneInfo("America/New_York")
REPO = Path(__file__).resolve().parents[1]


def _ts(d: date, hh: int, mm: int) -> int:
    return int(datetime(d.year, d.month, d.day, hh, mm, tzinfo=ET).timestamp())


def _bar(t, px=100.0, v=1000):
    return {"t": t, "o": px, "h": round(px + 0.5, 4), "l": round(px - 0.5, 4), "c": round(px + 0.25, 4), "v": v}


def _eth_day(d: date, step_min: int):
    """Every bucket of the 04:00-20:00 ET day, as the store serves an intraday series."""
    out, m = [], 4 * 60
    while m < 20 * 60:
        out.append(_bar(_ts(d, m // 60, m % 60), 100 + m / 1000))
        m += step_min
    return out


def _sixty_session_grid_day(d: date, half: bool = False):
    """The stored tf=60 'session' grid: clock hours outside RTH, 09:30-anchored hours inside."""
    close = 13 * 60 if half else 16 * 60
    mins = [4 * 60, 5 * 60, 6 * 60, 7 * 60, 8 * 60, 9 * 60]
    m = 9 * 60 + 30
    while m < close:
        mins.append(m)
        m += 60
    m = close
    while m < (close + 4 * 60):
        mins.append(m)
        m += 60
    return [_bar(_ts(d, x // 60, x % 60), 200 + x / 1000) for x in mins]


# ---- the read count is the chart's own first-paint ask --------------------------------------

def test_first_paint_read_matches_the_chart_source():
    src = (REPO / "app/src/utils/barsBackfill.js").read_text(encoding="utf-8")
    target = {k: int(v) for k, v in re.findall(r"'(\d+)':\s*(\d+)",
                                                re.search(r"VISIBLE_TARGET = \{([^}]*)\}", src).group(1))}
    first = int(re.search(r"FIRST_PAINT_BARS = (\d+)", src).group(1))
    cap = int(re.search(r"FIRST_PAINT_MAX = (\d+)", src).group(1))
    frac = 390 / 960
    want = {tf: min(cap, max(first, math.ceil(n / frac))) for tf, n in target.items()}
    want["D"] = first
    assert ffseed.FIRST_PAINT_READ == want


# ---- selection ---------------------------------------------------------------------------------

WED, THU, FRI_HALF, MON = date(2026, 11, 25), date(2026, 11, 26), date(2026, 11, 27), date(2026, 11, 30)


def test_select_keeps_regular_session_only_half_day_aware():
    served = _eth_day(WED, 5) + _eth_day(FRI_HALF, 5) + _eth_day(MON, 5)
    asof = 20261127
    sel = ffseed.select_window(served, "5", 10_000, asof)
    days = {}
    for b in sel:
        d = datetime.fromtimestamp(b["t"], ET)
        days.setdefault(d.date(), []).append(d.hour * 60 + d.minute)
    assert set(days) == {WED, FRI_HALF}                                     # nothing after as-of
    assert days[WED][0] == 570 and days[WED][-1] == 955 and len(days[WED]) == 78
    assert days[FRI_HALF][0] == 570 and days[FRI_HALF][-1] == 775 and len(days[FRI_HALF]) == 42
    # newest N, oldest dropped
    tail = ffseed.select_window(served, "5", 50, asof)
    assert tail == sel[-50:]


def test_select_sixty_minute_session_grid():
    served = _sixty_session_grid_day(WED) + _sixty_session_grid_day(FRI_HALF, half=True)
    sel = ffseed.select_window(served, "60", 1000, 20261127)
    hm = [(datetime.fromtimestamp(b["t"], ET).date(), datetime.fromtimestamp(b["t"], ET).strftime("%H:%M"))
          for b in sel]
    assert [x for d, x in hm if d == WED] == ["09:30", "10:30", "11:30", "12:30", "13:30", "14:30", "15:30"]
    assert [x for d, x in hm if d == FRI_HALF] == ["09:30", "10:30", "11:30", "12:30"]


def test_select_daily_cuts_bars_after_as_of_and_keeps_newest_n():
    served = [{"t": (date(2026, 1, 1) + timedelta(days=i)).isoformat(), "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}
              for i in range(400)]
    sel = ffseed.select_window(served, "D", 350, 20261118)
    assert sel[-1]["t"] == "2026-11-18" and len(sel) == 322
    assert ffseed.select_window(served, "D", 5, 20261118)[0]["t"] == "2026-11-14"


def test_seed_window_reads_the_first_paint_window_then_grows_only_when_needed():
    days = []
    d = date(2026, 1, 2)
    while len(days) < 200:
        if ffseed.is_trading_day(d):
            days.append(d)
        d += timedelta(days=1)
    store = [b for x in days for b in _sixty_session_grid_day(x)]
    asked = []

    def read(sym, tf, count):
        asked.append(count)
        rows = store[-count:]
        return list(rows), len(rows)

    asof = int(days[-1].strftime("%Y%m%d"))
    sel = ffseed.seed_window("X", "60", 1000, asof, read=read)
    assert asked[0] == ffseed.FIRST_PAINT_READ["60"]
    # 17 stored rows a day hold 7 RTH hours: 1138 rows -> ~468, 2276 -> ~937, 4552 -> all 3400 rows
    assert asked == [1138, 2276, 4552]
    assert len(sel) == 1000 and sel == ffseed.select_window(store, "60", 1000, asof)

    asked.clear()
    short = store[-300:]
    sel = ffseed.seed_window("X", "60", 1000, asof, read=lambda s, t, c: (asked.append(c) or (short[-c:], len(short[-c:]))))
    assert asked == [1138]                             # the store ran out: no second read
    assert len(sel) == len(ffseed.select_window(short, "60", 1000, asof))


# ---- the seed IS the /api/bars answer ----------------------------------------------------------

def _trading_days(start: date, n: int):
    out, d = [], start
    while len(out) < n:
        if ffseed.is_trading_day(d):
            out.append(d)
        d += timedelta(days=1)
    return out


@pytest.fixture
def stored(monkeypatch):
    """A stand-in bars.db for one symbol behind the real /api/bars warm path."""
    from api.services import bars_fetch, bars_sanitize, bars_sqlite
    rows = {}

    def get_bars(ticker, tf, n):
        r = rows.get((ticker.upper(), tf), [])
        return list(r[-n:])

    monkeypatch.setattr(bars_sqlite, "get_bars", get_bars)
    monkeypatch.setattr(bars_sqlite, "get_last_ts", lambda t, tf: (rows.get((t.upper(), tf)) or [[None]])[-1][0])
    monkeypatch.setattr(bars_fetch, "_needs_fresh", lambda *a, **k: False)
    monkeypatch.setattr(bars_fetch, "_maybe_kick_deepfill", lambda *a, **k: None)
    monkeypatch.setattr(bars_fetch, "_live_derive_on_read", lambda *a, **k: None)
    monkeypatch.setattr(bars_fetch, "_live_derived_proof", lambda *a, **k: None)
    monkeypatch.setattr(bars_fetch, "_history_complete", lambda *a, **k: True)
    from api.services import bars_live_store
    monkeypatch.setattr(bars_live_store, "covered", lambda *a, **k: False)
    monkeypatch.setattr(bars_sanitize, "_schedule_store_repair", lambda *a, **k: None)
    monkeypatch.setattr(bars_sanitize, "_meta_cached", lambda t: None)
    return rows


def _api_bars(sym, tf, count):
    """What `/api/bars/{sym}?tf=..&bars=count` answers on the warm path, parsed as the browser parses it."""
    from api.services import bars_fetch
    resp = bars_fetch._get_bars_inner(sym, tf, count)
    assert bars_fetch.get_serve_layer() == "sqlite"
    return json.loads(resp.body)["bars"]


def _bits(x):
    return struct.pack("<d", float(x))


def _assert_same(seed, chart):
    assert len(seed) == len(chart)
    for a, b in zip(seed, chart):
        assert a["t"] == b["t"]
        for k in "ohlcv":
            assert _bits(a[k]) == _bits(b[k]), (a, b, k)


def _round_trip(tf, sym, bars, asof):
    pb = fmt.PackBuilder(tf, asof=asof.isoformat(), build="t", depth=len(bars))
    pb.add_served(sym, bars)
    return fmt.read_served(pb.finish(), sym)


def test_intraday_seed_equals_the_api_bars_answer_rth_view(stored):
    days = _trading_days(date(2026, 11, 2), 12)
    sym = "ZZSEEDA"
    raw = []
    for i, d in enumerate(days):
        for b in _eth_day(d, 5):
            raw.append((b["t"], round(80 + i + b["o"] / 1000, 4), round(81 + i, 4), round(79 + i, 4),
                        round(80.5 + i + b["o"] / 997, 4), 1200 + i))
    stored[(sym, "5")] = raw
    asof = days[-1]
    seed = ffseed.seed_window(sym, "5", 300, int(asof.strftime("%Y%m%d")))
    chart = _api_bars(sym, "5", ffseed.FIRST_PAINT_READ["5"])            # the chart's first answer
    chart_rth = [b for b in chart if ffseed.is_rth_bar(b["t"])][-300:]   # StockChart keepRthBars
    assert len(seed) == 300
    _assert_same(_round_trip("5", sym, seed, asof), chart_rth)


def test_daily_seed_equals_the_api_bars_answer_with_the_split_applied(stored, monkeypatch):
    from api.services import bars_sanitize
    sym = "ZZSEEDD"
    days = _trading_days(date(2025, 3, 3), 420)
    split_day = days[300]
    raw = []
    for i, d in enumerate(days):
        px = 400.0 + i * 0.25 if d < split_day else (400.0 + i * 0.25) / 4
        raw.append((int(d.strftime("%Y%m%d")), round(px, 4), round(px * 1.01, 4), round(px * 0.99, 4),
                    round(px, 4), 1_000_000))
    stored[(sym, "D")] = raw
    monkeypatch.setattr(bars_sanitize, "_meta_cached", lambda t: {"splits": [(split_day.isoformat(), 4.0)]})
    asof = days[-1]
    seed = ffseed.seed_window(sym, "D", 350, int(asof.strftime("%Y%m%d")))
    chart = _api_bars(sym, "D", ffseed.FIRST_PAINT_READ["D"])[-350:]
    _assert_same(_round_trip("D", sym, seed, asof), chart)
    # and the split IS applied: the bar before the split day sits on the post-split basis
    pre = next(b for b in seed if b["t"] == days[299].isoformat())
    raw_pre = raw[299]
    assert pre["c"] == round(raw_pre[4] / 4, 4) and pre["v"] == 4_000_000
    assert abs(pre["c"] / next(b for b in seed if b["t"] == split_day.isoformat())["c"] - 1) < 0.01


def test_a_sixty_minute_series_still_on_the_old_clock_grid_is_left_out(stored):
    """`/api/bars` rebuilds such a series (a store write) before serving it; the seed never writes, so
    it must not ship the old layout either."""
    days = _trading_days(date(2026, 11, 2), 3)
    asof = days[-1]
    new_grid = [(b["t"], 10.0, 10.5, 9.5, 10.25, 100) for d in days for b in _sixty_session_grid_day(d)]
    old_grid = [(_ts(d, h, 0), 10.0, 10.5, 9.5, 10.25, 100) for d in days for h in range(4, 20)]
    stored[("ZZNEW", "60")] = new_grid
    stored[("ZZOLD", "60")] = old_grid
    data, st = ffseed.build_tf("60", ["ZZNEW", "ZZOLD"], asof, "B", depth=1000)
    assert st["old_grid"] == 1 and st["symbols"] == 1
    assert set(fmt.read_trailer(data)["symbols"]) == {"ZZNEW"}


# ---- build bookkeeping -------------------------------------------------------------------------

def _fake_read(table):
    def read(sym, tf, count):
        rows = table.get((sym, tf), [])
        return rows[-count:], len(rows[-count:])
    return read


def test_build_tf_counts_and_skips():
    asof = date(2026, 11, 18)
    days = _trading_days(date(2026, 11, 2), 13)
    assert days[-1] == asof
    good = [b for d in days for b in _eth_day(d, 5)]
    stale = [b for d in days[:-1] for b in _eth_day(d, 5)]
    table = {
        ("AAA", "5"): good,
        ("SHORT", "5"): [b for b in _eth_day(asof, 5)],
        ("STALE", "5"): stale,
        ("BAD", "5"): [dict(b, o=0.123456789012) for b in good],
    }
    data, st = ffseed.build_tf("5", ["AAA", "BAD", "NONE", "SHORT", "STALE"], asof, "B1",
                               depth=300, read=_fake_read(table))
    assert (st["symbols"], st["no_bars"], st["stale"], st["inexact"], st["short"]) == (2, 1, 1, 1, 1)
    tr = fmt.read_trailer(data)
    assert set(tr["symbols"]) == {"AAA", "SHORT"}
    assert tr["build"] == "B1" and tr["asof"] == "2026-11-18" and tr["depth"] == 300
    assert dict(zip(fmt.ENTRY_FIELDS, tr["symbols"]["SHORT"]))["bars"] == 78


def test_build_manifest_and_floor():
    asof = date(2026, 11, 18)
    days = _trading_days(date(2026, 1, 2), 240)
    days = [d for d in days if d <= asof]
    table = {}
    for s in ("AAA", "BBB"):
        table[(s, "D")] = [{"t": d.isoformat(), "o": 10.0, "h": 11.0, "l": 9.5, "c": 10.5, "v": 7} for d in days]
        table[(s, "60")] = [b for d in days[-160:] for b in _sixty_session_grid_day(d)]
    now = datetime(2026, 11, 19, 1, 31, tzinfo=ZoneInfo("UTC"))
    built = ffseed.build(tfs=["60", "D"], symbols=["AAA", "BBB"], asof=asof, read=_fake_read(table),
                         now=now, min_symbols=2)
    m = built["manifest"]
    assert m["build"] == "20261119T0131Z" and m["asof"] == "2026-11-18" and m["kind"] == "ffseed"
    for tf in ("60", "D"):
        e, data = m["tfs"][tf], built["packs"][tf]
        assert e["bytes"] == len(data) and e["sha256"] == hashlib.sha256(data).hexdigest()
        assert e["key"] == f"ffseed/20261119T0131Z/{tf}.ffs" and e["url"] == f"/api/seed/v1/20261119T0131Z/{tf}.ffs"
        assert e["symbols"] == 2 and fmt.read_trailer(data)["build"] == m["build"]
    assert m["tfs"]["60"]["bars"] == 2000 and m["tfs"]["D"]["bars"] == 2 * len(days)
    with pytest.raises(ffseed.SeedBuildError, match="floor"):
        ffseed.build(tfs=["D"], symbols=["AAA", "BBB"], asof=asof, read=_fake_read(table), now=now, min_symbols=3)


def test_floor_is_per_timeframe(monkeypatch):
    """One timeframe's floor never refuses another's pack; its own variable overrides; 1m has its own default."""
    asof = date(2026, 11, 18)
    days = [d for d in _trading_days(date(2026, 1, 2), 240) if d <= asof]
    table = {}
    for s in ("AAA", "BBB"):
        table[(s, "D")] = [{"t": d.isoformat(), "o": 10.0, "h": 11.0, "l": 9.5, "c": 10.5, "v": 7} for d in days]
        table[(s, "60")] = [b for d in days[-160:] for b in _sixty_session_grid_day(d)]
    now = datetime(2026, 11, 19, 1, 31, tzinfo=ZoneInfo("UTC"))
    monkeypatch.setattr(ffseed, "MIN_SYMBOLS", 2)
    for tf in ("1", "60", "D"):
        monkeypatch.delenv(f"FFSEED_MIN_SYMBOLS_{tf}", raising=False)
    built = ffseed.build(tfs=["60", "D"], symbols=["AAA", "BBB"], asof=asof, read=_fake_read(table), now=now)
    assert set(built["manifest"]["tfs"]) == {"60", "D"}
    monkeypatch.setenv("FFSEED_MIN_SYMBOLS_D", "3")                 # D's own floor, above what it holds
    with pytest.raises(ffseed.SeedBuildError, match="tf D: 2 symbols, floor 3"):
        ffseed.build(tfs=["60", "D"], symbols=["AAA", "BBB"], asof=asof, read=_fake_read(table), now=now)
    assert ffseed.floor_for("60") == 2                               # untouched: the global floor
    assert ffseed.floor_for("1") == ffseed.MIN_SYMBOLS_BY_TF["1"]    # 1m: its own default
    monkeypatch.setenv("FFSEED_MIN_SYMBOLS_1", "5")
    assert ffseed.floor_for("1") == 5


def test_build_and_publish_uploads_packs_before_the_manifest(monkeypatch):
    from api.services import data_sync
    asof = date(2026, 11, 18)
    table = {("AAA", "D"): [{"t": asof.isoformat(), "o": 1.0, "h": 1.0, "l": 1.0, "c": 1.0, "v": 1}]}
    puts = []
    monkeypatch.setattr(data_sync, "credentials_ok", lambda: True)
    monkeypatch.setattr(data_sync, "put_bytes", lambda k, b, ct: puts.append((k, ct)) or True)
    monkeypatch.setattr(ffseed, "prune", lambda *a: [])
    m = ffseed.build_and_publish(tfs=["D"], symbols=["AAA"], asof=asof, read=_fake_read(table), min_symbols=1)
    assert [k for k, _ in puts] == [m["tfs"]["D"]["key"], "ffseed/latest.json"]
    assert puts[0][1] == ffseed.CONTENT_TYPE
    monkeypatch.setattr(data_sync, "put_bytes", lambda k, b, ct: False)
    with pytest.raises(ffseed.SeedBuildError, match="upload failed"):
        ffseed.build_and_publish(tfs=["D"], symbols=["AAA"], asof=asof, read=_fake_read(table), min_symbols=1)


# ---- trigger -----------------------------------------------------------------------------------

@pytest.mark.parametrize("now, published, want", [
    (datetime(2026, 11, 18, 20, 30, tzinfo=ET), 20261117, True),     # Wed after 20:15: build Wed
    (datetime(2026, 11, 18, 17, 0, tzinfo=ET), 20261117, False),     # Wed before 20:15: Tue already out
    (datetime(2026, 11, 18, 20, 30, tzinfo=ET), 20261118, False),    # already published
    (datetime(2026, 11, 21, 10, 0, tzinfo=ET), 20261119, True),      # Saturday catches up Friday
    (datetime(2026, 11, 26, 22, 0, tzinfo=ET), 20261125, False),     # Thanksgiving: no session
])
def test_should_build(now, published, want):
    assert ffseed.should_build(now, published) is want


def test_builder_is_dark_by_default(monkeypatch):
    monkeypatch.delenv("FFSEED_ENABLED", raising=False)
    assert ffseed.start_ffseed_builder() is False
