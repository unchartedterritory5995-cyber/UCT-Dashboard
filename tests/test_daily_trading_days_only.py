"""A daily bar exists only on an NYSE trading day; W/M keys follow their period rule.

🔴 PRODUCTION, 2026-11-11: ``GET /api/bars/META?tf=D`` served a bar dated SATURDAY
2026-11-07 out of bars.db (6 of 193 liquid tickers probed: META NFLX MSTR MU MRVL LYFT;
no other non-trading-day key in ~10 years of history). It drew as an extra candle and
was summed into the week: META's W bar for 2026-11-06 closed at the Saturday close.

The contract (``api/services/date_bar_keys``), enforced at every layer that owns a part
of it: the provider normalization (``_massive_raw_to_iso``), the W/M resamplers, the
store's write door (``bars_sqlite._writable_bars``), the serve chokepoint
(``_fmt_sqlite_bars``) and the bounded cleanup (``purge_off_calendar_daily``).
"""
from __future__ import annotations

import random
import sqlite3
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from api.services import bars_sqlite
from api.services import date_bar_keys as dk
from api.services import session_calendar as sc

ET = ZoneInfo("America/New_York")


@pytest.fixture
def fresh_db(tmp_path, monkeypatch):
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", str(tmp_path / "bars.db"))
    bars_sqlite.bump_db_epoch()
    bars_sqlite.init_db()
    yield
    bars_sqlite.bump_db_epoch()


def _days(y0: int, y1: int):
    d = date(y0, 1, 1)
    while d <= date(y1, 12, 31):
        yield d
        d += timedelta(days=1)


def _ymd(d: date) -> int:
    return int(d.strftime("%Y%m%d"))


def _bar(t, px=10.0, v=1000):
    return {"t": t, "o": px, "h": px + 1, "l": px - 1, "c": px + 0.5, "v": v}


def _raw_insert(rows):
    """Seed rows the way an old writer / an R2 snapshot did: bypassing the write gate."""
    c = bars_sqlite._conn()
    c.executemany("INSERT OR REPLACE INTO ohlcv(ticker,tf,ts,o,h,l,c,v) VALUES(?,?,?,?,?,?,?,?)", rows)
    c.commit()


def _stored(tkr, tf):
    return [r[0] for r in bars_sqlite._conn().execute(
        "SELECT ts FROM ohlcv WHERE ticker=? AND tf=? ORDER BY ts", (tkr, tf)).fetchall()]


# ── the rule ────────────────────────────────────────────────────────────────

class TestTheKeyRule:
    def test_a_full_calendar_year_is_exactly_the_nyse_sessions(self):
        """Every day of 2026: a D key is valid iff the market is open — weekends and the
        ten 2026 holidays refused; half-days and ordinary weekday 'holidays' accepted."""
        sessions = [d for d in _days(2026, 2026) if dk.key_ok("D", _ymd(d))]
        closed_weekdays = sorted(d for d in _days(2026, 2026)
                                 if d.weekday() < 5 and not dk.key_ok("D", _ymd(d)))
        assert len(sessions) == 251
        assert all(d.weekday() < 5 for d in sessions)
        assert closed_weekdays == [
            date(2026, 1, 1), date(2026, 1, 19), date(2026, 2, 16), date(2026, 4, 3),
            date(2026, 5, 25), date(2026, 6, 19), date(2026, 7, 3), date(2026, 9, 7),
            date(2026, 11, 26), date(2026, 12, 25)]

    @pytest.mark.parametrize("d,ok", [
        (date(2026, 11, 7), False),    # THE production row: a Saturday
        (date(2026, 11, 8), False),    # Sunday
        (date(2026, 11, 11), True),    # Veterans Day: NYSE is OPEN
        (date(2026, 10, 12), True),    # Columbus Day: NYSE is OPEN
        (date(2026, 11, 26), False),   # Thanksgiving
        (date(2026, 11, 27), True),    # day after Thanksgiving: half-day, a session
        (date(2026, 12, 24), True),    # Christmas Eve: half-day, a session
        (date(2026, 7, 3), False),     # Independence Day observed (Jul 4 is a Saturday)
        (date(2026, 4, 3), False),     # Good Friday
        (date(2025, 1, 9), False),     # national day of mourning (Carter)
        (date(2018, 12, 5), False),    # national day of mourning (G.H.W. Bush)
        (date(2012, 10, 29), False),   # Hurricane Sandy
        (date(2012, 10, 30), False),
        (date(2001, 9, 11), False),    # 9/11 closure
        (date(2001, 9, 17), True),     # reopened
    ])
    def test_named_days(self, d, ok):
        assert dk.key_ok("D", _ymd(d)) is ok
        assert dk.key_ok("D", d.isoformat()) is ok   # both stored and served spellings

    def test_matches_the_session_calendar_over_its_whole_coverage(self):
        cal = sc.calendar()
        for d in _days(cal.coverage_start.year, cal.horizon.year):
            assert dk.key_ok("D", _ymd(d)) == sc.is_trading_day(d), d

    def test_weekly_and_monthly_keys(self):
        for d in _days(2024, 2027):
            assert dk.key_ok("W", _ymd(d)) == (d.weekday() == 4), d
            assert dk.key_ok("M", d.isoformat()) == (d.day == 1), d
        assert dk.key_ok("W", 20260403)            # Good Friday still keys its week

    @pytest.mark.parametrize("bad", [20261332, 2026117, "2026-11-7", None, "", True, "abcdefgh"])
    def test_malformed_keys_are_never_valid(self, bad):
        for tf in ("D", "W", "M"):
            assert dk.key_ok(tf, bad) is False

    def test_intraday_timeframes_are_not_judged(self):
        assert dk.key_ok("5", 1762542000)


# ── the write door ──────────────────────────────────────────────────────────

class TestTheStoreRefusesOffCalendarKeys:
    def test_put_bars_stores_a_daily_row_iff_it_is_a_session(self, fresh_db):
        days = list(_days(2026, 2026))
        n = bars_sqlite.put_bars("AAA", "D", [_bar(d.isoformat()) for d in days], date_tf=True)
        want = [_ymd(d) for d in days if sc.is_trading_day(d)]
        assert n == len(want)
        assert _stored("AAA", "D") == want

    def test_put_bars_many_the_universe_feed_door_too(self, fresh_db):
        days = list(_days(2026, 2026))
        bars_sqlite.put_bars_many("D", {"BBB": [_bar(_ymd(d)) for d in days]})
        assert _stored("BBB", "D") == [_ymd(d) for d in days if sc.is_trading_day(d)]

    def test_weekly_and_monthly_keys_at_the_door(self, fresh_db):
        days = list(_days(2026, 2026))
        bars_sqlite.put_bars("WWW", "W", [_bar(d.isoformat()) for d in days], date_tf=True)
        bars_sqlite.put_bars("MMM", "M", [_bar(d.isoformat()) for d in days], date_tf=True)
        assert _stored("WWW", "W") == [_ymd(d) for d in days if d.weekday() == 4]
        assert _stored("MMM", "M") == [_ymd(d) for d in days if d.day == 1]

    def test_the_production_saturday_row_is_refused(self, fresh_db):
        bars_sqlite.put_bars("META", "D", [_bar("2026-11-06"), _bar("2026-11-07"),
                                           _bar("2026-11-09")], date_tf=True)
        assert _stored("META", "D") == [20261106, 20261109]

    def test_crypto_keeps_its_weekend_sessions(self, fresh_db):
        bars_sqlite.put_bars("BTC-USD", "D", [_bar("2026-11-07")], date_tf=True)
        assert _stored("BTC-USD", "D") == [20261107]


# ── the producer ────────────────────────────────────────────────────────────

def _massive_day(d: date, px=10.0, v=1000):
    """A raw Massive daily aggregate: t = the ET midnight that opens the day, in ms."""
    ms = int(datetime(d.year, d.month, d.day, tzinfo=ET).timestamp() * 1000)
    return {"t": ms, "o": px, "h": px + 1, "l": px - 1, "c": px + 0.5, "v": v}


class TestTheProducer:
    def test_a_provider_saturday_aggregate_is_not_normalized_into_the_series(self):
        """The reproduction: the provider's daily aggregates for Fri 11-06, SAT 11-07 and
        Mon 11-09. Before the fix `_massive_raw_to_iso` passed the Saturday through."""
        from api.services.bars_fetch import _massive_raw_to_iso
        raw = [_massive_day(date(2026, 11, 6)), _massive_day(date(2026, 11, 7), v=5),
               _massive_day(date(2026, 11, 9))]
        assert [b["t"] for b in _massive_raw_to_iso(raw)] == ["2026-11-06", "2026-11-09"]

    def test_a_saturday_is_not_summed_into_its_week(self):
        """META's served W bar closed at the Saturday close and carried its volume."""
        from api.services.bars_fetch import _resample_weekly_iso
        week = [dict(_bar(f"2026-11-0{i}", px=10.0 + i), v=100) for i in (2, 3, 4, 5, 6)]
        sat = {"t": "2026-11-07", "o": 99.0, "h": 99.0, "l": 99.0, "c": 99.0, "v": 7}
        (w,) = _resample_weekly_iso(week + [sat])
        assert w["t"] == "2026-11-06"
        assert w["c"] == week[-1]["c"] and w["h"] == max(b["h"] for b in week)
        assert w["v"] == 500

    def test_a_holiday_row_is_not_summed_into_its_month(self):
        from api.services.bars_fetch import _resample_monthly_iso
        (m,) = _resample_monthly_iso([_bar("2026-11-25", px=10), _bar("2026-11-26", px=50),
                                      _bar("2026-11-27", px=11)])
        assert m["t"] == "2026-11-01" and m["h"] == 12 and m["v"] == 2000

    def test_property_resampled_periods_are_exactly_their_sessions(self):
        """Fuzz: random daily series over 2000-2028 with random off-calendar rows mixed
        in. Every W/M bar equals the aggregate of the SESSION rows of its period, and
        carries a valid key."""
        from api.services.bars_fetch import _resample_monthly_iso, _resample_weekly_iso
        rng = random.Random(20261107)
        cal = sc.calendar()
        for _ in range(60):
            start = cal.coverage_start + timedelta(days=rng.randrange(0, 10000))
            daily = []
            for k in range(rng.randrange(5, 90)):
                d = start + timedelta(days=k)
                if sc.is_trading_day(d) or rng.random() < 0.5:
                    px = rng.uniform(5, 500)
                    daily.append({"t": d.isoformat(), "o": px, "h": px * 1.02, "l": px * 0.98,
                                  "c": px * 1.01, "v": rng.randrange(0, 10_000)})
            sessions = [b for b in daily if sc.is_trading_day(date.fromisoformat(b["t"]))]
            for tf, fn, period in (
                ("W", _resample_weekly_iso, lambda d: d.isocalendar()[:2]),
                ("M", _resample_monthly_iso, lambda d: (d.year, d.month)),
            ):
                built = fn(daily)
                assert all(dk.key_ok(tf, b["t"]) for b in built)
                groups: dict = {}
                for b in sessions:
                    groups.setdefault(period(date.fromisoformat(b["t"])), []).append(b)
                assert len(built) == len(groups)
                for b, (_, g) in zip(built, sorted(groups.items())):
                    assert (b["o"], b["c"]) == (g[0]["o"], g[-1]["c"])
                    assert b["h"] == max(x["h"] for x in g) and b["l"] == min(x["l"] for x in g)
                    assert b["v"] == sum(x["v"] for x in g)


# ── the serve chokepoint ────────────────────────────────────────────────────

class TestServeGuard:
    def test_a_stored_saturday_never_renders(self):
        from api.services.bars_fetch import _fmt_sqlite_bars
        rows = [(20261106, 10, 11, 9, 10.5, 100), (20261107, 10, 10, 10, 10, 1),
                (20261109, 10, 11, 9, 10.5, 100)]
        assert [b["t"] for b in _fmt_sqlite_bars(rows, "D")] == ["2026-11-06", "2026-11-09"]

    def test_property_no_served_daily_key_is_off_calendar(self):
        from api.services.bars_fetch import _fmt_sqlite_bars
        rows = [(_ymd(d), 10, 11, 9, 10.5, 100) for d in _days(2025, 2026)]
        served = _fmt_sqlite_bars(rows, "D")
        assert [b["t"] for b in served] == [d.isoformat() for d in _days(2025, 2026)
                                            if sc.is_trading_day(d)]

    def test_weekly_guard_still_friday_only(self):
        from api.services.bars_fetch import _fmt_sqlite_bars
        rows = [(20261102, 10, 11, 9, 10.5, 100), (20261106, 10, 11, 9, 10.5, 100)]
        assert [b["t"] for b in _fmt_sqlite_bars(rows, "W")] == ["2026-11-06"]


# ── the cleanup ─────────────────────────────────────────────────────────────

class TestCleanup:
    def _seed_meta_week(self, tkr="META", with_history=True):
        days = [date(2026, 11, d) for d in (2, 3, 4, 5, 6)]
        rows = [(tkr, "D", _ymd(d), 10.0 + i, 11.0 + i, 9.0 + i, 10.5 + i, 100)
                for i, d in enumerate(days)]
        if with_history:   # the store holds November from its first session
            rows.append((tkr, "D", 20261030, 9.0, 10.0, 8.0, 9.5, 100))
        rows.append((tkr, "D", 20261107, 99.0, 99.0, 99.0, 99.0, 7))     # the bad row
        rows.append((tkr, "W", 20261106, 10.0, 99.0, 9.0, 99.0, 507))    # summed it in
        rows.append((tkr, "M", 20261101, 10.0, 99.0, 9.0, 99.0, 507))
        _raw_insert(rows)

    def test_deletes_the_row_and_rebuilds_its_week_and_month(self, fresh_db):
        self._seed_meta_week()
        assert bars_sqlite.purge_off_calendar_daily("META") == 1
        assert 20261107 not in _stored("META", "D")
        c = bars_sqlite._conn()
        w = c.execute("SELECT o,h,l,c,v FROM ohlcv WHERE ticker='META' AND tf='W' AND ts=20261106").fetchone()
        m = c.execute("SELECT o,h,l,c,v FROM ohlcv WHERE ticker='META' AND tf='M' AND ts=20261101").fetchone()
        assert w == (10.0, 15.0, 9.0, 14.5, 500)
        assert m == (10.0, 15.0, 9.0, 14.5, 500)

    def test_idempotent(self, fresh_db):
        self._seed_meta_week()
        bars_sqlite.purge_off_calendar_daily("META")
        before = bars_sqlite._conn().execute("SELECT * FROM ohlcv ORDER BY tf, ts").fetchall()
        assert bars_sqlite.purge_off_calendar_daily("META") == 0
        assert bars_sqlite._conn().execute("SELECT * FROM ohlcv ORDER BY tf, ts").fetchall() == before

    def test_a_period_the_store_does_not_hold_from_its_start_is_not_rebuilt(self, fresh_db):
        """Daily history starting mid-month must not replace the month by a partial one."""
        self._seed_meta_week("THIN", with_history=False)
        bars_sqlite.purge_off_calendar_daily("THIN")
        m = bars_sqlite._conn().execute(
            "SELECT v FROM ohlcv WHERE ticker='THIN' AND tf='M' AND ts=20261101").fetchone()
        assert m == (507,)           # untouched (history starts 11-02, after the 1st)
        w = bars_sqlite._conn().execute(
            "SELECT v FROM ohlcv WHERE ticker='THIN' AND tf='W' AND ts=20261106").fetchone()
        assert w == (500,)           # the week starts Monday 11-02 — held, rebuilt

    def test_every_off_calendar_shape_in_a_year_is_found(self, fresh_db):
        """The SQL pre-filter is a superset of the Python rule over a whole year."""
        _raw_insert([("ALL", "D", _ymd(d), 10, 11, 9, 10.5, 1) for d in _days(2026, 2026)])
        assert bars_sqlite.purge_off_calendar_daily("ALL") == sum(
            1 for d in _days(2026, 2026) if not sc.is_trading_day(d))
        assert all(dk.key_ok("D", ts) for ts in _stored("ALL", "D"))

    def test_runs_inside_the_boot_purge_pass(self, fresh_db):
        self._seed_meta_week()
        bars_sqlite.purge_mis_keyed_weekly_rows()
        assert 20261107 not in _stored("META", "D")

    def test_crypto_untouched(self, fresh_db):
        _raw_insert([("BTC-USD", "D", 20261107, 10, 11, 9, 10.5, 1)])
        assert bars_sqlite.purge_off_calendar_daily("BTC-USD") == 0
