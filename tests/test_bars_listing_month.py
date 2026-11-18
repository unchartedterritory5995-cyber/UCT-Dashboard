"""bars_sanitize step 1 on W / M: an ordinary period step is no reuse gap (2026-11-18).

Measured on production (smoke@, GETs, 2026-11-18): `/api/bars/RDDT?tf=M` started 2024-04-01 (32 months) while
TradingView's NYSE:RDDT 1M chart starts 2024-03-01 (33 months, capture rs-rating-fred6724-m-rddt-1m-2026-11-18),
and `/api/bars/SPY?tf=M` started 1993-02-01 while SPY listed 1993-01-29. The stored rows were whole: the serve-time
reuse cutoff measured a gap as the RAW step between bars, so on a monthly series the first 31-day step was "the
largest gap", and its resume bar (the month after the listing month) sat within the 12-day alignment tolerance of the
cached ipoDate. Eight other recent listings kept their first month only because their profile was not cached.
The gap is now the EXCESS over one bar's span (`_NOMINAL_STEP_DAYS`), and a monthly resume bar aligns with a listing
inside its own month."""
import datetime as dt

import pytest

from api.services import bars_fetch as BF
from api.services import bars_sanitize as S

pytestmark = pytest.mark.skipif(not S._ENABLED, reason="sanitizer disabled")


def daily(start, end, *, base=100.0, at=None):
    """Weekday bars from `start` to `end`; `at` maps an ISO day to a price from that day on."""
    out, d, i, price = [], dt.date.fromisoformat(start), 0, base
    while d <= dt.date.fromisoformat(end):
        if at and d.isoformat() in at:
            price = at[d.isoformat()]
        if d.weekday() < 5:
            c = round(price + i * 0.01, 2)
            out.append({"t": d.isoformat(), "o": c, "h": c + 1, "l": c - 1, "c": c, "v": 1000})
            i += 1
        d += dt.timedelta(days=1)
    return out


def monthly(rows, ticker):
    return BF._resample_monthly_iso(rows, ticker=ticker)


def weekly(rows, ticker):
    return BF._resample_weekly_iso(rows, ticker=ticker)


@pytest.fixture
def world(monkeypatch):
    """A store whose D / W / M rows are what the test hands it, and listing metadata per ticker."""
    st, meta = {}, {}
    S._BUILT_CACHE.clear()
    monkeypatch.setattr(S, "_warm_meta", lambda t: None)
    monkeypatch.setattr(S, "_meta_cached", lambda t: meta.get(t))
    monkeypatch.setattr(S, "_identity_source", lambda s, tf: list(st.get((s, tf), [])))
    monkeypatch.setattr(S, "_store_first", lambda s, tf: (
        dt.date.fromisoformat(st[(s, tf)][0]["t"]) if st.get((s, tf)) else None))

    def put(ticker, d_rows, ipo=None):
        st[(ticker, "D")] = d_rows
        st[(ticker, "W")] = weekly(d_rows, ticker)
        st[(ticker, "M")] = monthly(d_rows, ticker)
        meta[ticker] = {"ipo": ipo, "splits": []} if ipo else None
        return st[(ticker, "W")], st[(ticker, "M")]
    return put


def test_rddt_monthly_keeps_its_listing_month(world):
    """TradingView's NYSE:RDDT 1M: 33 months from 2024-03-01, the listing month (from 2024-03-21) included."""
    _, m = world("RDDT", daily("2024-03-21", "2026-11-17", base=40.0), ipo="2024-03-21")
    out = S.sanitize_daily_bars("RDDT", list(m), "M")
    assert out[0]["t"] == "2024-03-01"
    assert len(out) == 33 and out == m


def test_spy_monthly_keeps_its_one_session_listing_month(world):
    """SPY listed Friday 1993-01-29: January 1993 is one session, and it is a month."""
    _, m = world("SPY", daily("1993-01-29", "1995-12-29", base=43.9), ipo="1993-01-29")
    out = S.sanitize_daily_bars("SPY", list(m), "M")
    assert [b["t"] for b in out[:2]] == ["1993-01-01", "1993-02-01"]
    assert out == m


def test_the_listing_week_was_never_cut_and_still_is_not(world):
    w, _ = world("RDDT", daily("2024-03-21", "2026-11-17", base=40.0), ipo="2024-03-21")
    out = S.sanitize_daily_bars("RDDT", list(w), "W")
    assert out[0]["t"] == "2024-03-22" and out == w


def test_a_volatile_month_is_no_reuse_without_metadata(world):
    """The metadata-free branch cut on a >=4x move across a gap; a month-to-month step is no gap."""
    rows = daily("2025-01-02", "2025-12-31", base=10.0, at={"2025-02-03": 55.0})
    _, m = world("MEME", rows)                               # no metadata: the price-ratio branch decides
    assert m[1]["c"] / m[0]["c"] >= S._REUSE_PRICE_FACTOR    # the fixture really has the move
    out = S.sanitize_daily_bars("MEME", list(m), "M")
    assert out == m and out[0]["t"] == "2025-01-01"


def test_a_two_week_hole_on_weekly_is_not_three_weeks_of_missing_history(world):
    """W's nominal step: a 21-day step between two weekly bars is 14 days missing, not a reuse gap."""
    rows = [b for b in daily("2025-01-02", "2025-06-30", base=10.0, at={"2025-02-03": 55.0})
            if not ("2025-01-20" <= b["t"] <= "2025-01-31")]   # two weeks missing, a 5x move across them
    w, _ = world("HOLE", rows)
    steps = [(dt.date.fromisoformat(b["t"]) - dt.date.fromisoformat(a["t"])).days for a, b in zip(w, w[1:])]
    assert max(steps) == 21                                   # the fixture really has the 21-day step
    out = S.sanitize_daily_bars("HOLE", list(w), "W")
    assert out == w


def test_a_recycled_symbol_on_monthly_is_still_cut_at_its_new_listing(world):
    """The control: an earlier security, ~4 months with no bars, the new listing on 2026-04-20 (late in its
    month, 19 days after the bar's 1st: outside the day tolerance, inside the month). Prices close enough that
    only the listing alignment can decide."""
    old = daily("2024-01-02", "2025-11-28", base=40.0)
    new = daily("2026-04-20", "2026-11-17", base=50.0)
    _, m = world("RECY", old + new, ipo="2026-04-20")
    i = [b["t"] for b in m].index("2026-04-01")
    assert 0.25 < m[i]["c"] / m[i - 1]["c"] < S._REUSE_PRICE_FACTOR   # the ratio branch cannot be what cuts
    out = S.sanitize_daily_bars("RECY", list(m), "M")
    assert out[0]["t"] == "2026-04-01" and out == m[i:]


def test_a_recycled_symbol_with_no_metadata_and_a_huge_gap_is_still_cut_on_monthly(world):
    old = daily("2010-01-04", "2011-06-30", base=40.0)
    new = daily("2026-04-01", "2026-11-17", base=44.0)
    _, m = world("COLD", old + new)
    out = S.sanitize_daily_bars("COLD", list(m), "M")
    assert out[0]["t"] == "2026-04-01"


def test_daily_is_unchanged_a_reused_ticker_is_cut_at_its_listing(world):
    old = daily("2015-01-05", "2015-03-02", base=1.0)
    new = daily("2026-04-02", "2026-05-01", base=50.0)
    world("DRAM", old + new, ipo="2026-04-02")
    out = S.sanitize_daily_bars("DRAM", old + new, "D")
    assert out[0]["t"] == "2026-04-02" and len(out) == len(new)
