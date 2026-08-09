"""A split must leave the NON-CHART lanes correct, not only the chart.

🔴 THE DEFECT THESE TESTS PIN. `bars_sanitize` heals the SERVED bars and says so
in its own docstring — *"never touches the SQLite store"*. `bars_sqlite.get_bars`
is a bare `SELECT`, and it is what the indicator alert evaluator, the nightly
screener build and the universe scan read. Measured on the live store
2026-08-09, against Yahoo on the SAME dates:

    DD    median ours/vendor close on the 365 sessions BEFORE 2026-06-18: 0.33333
    ABTC  median ours/vendor close on the 375 sessions BEFORE 2026-07-06: 0.06667

so DD's alert-lane `SMA200` read **50.1915** where the vendor's read
**133.8873**, and its `ATR14` read **5.6186** against **4.4766** — 25.5% high on
the number that sizes a position.

⭐ EVERY EXPECTATION HERE IS DERIVED, NEVER RETYPED. The corrected series is
computed in the test from the stored one by exact rational arithmetic
(`fractions.Fraction`), and the indicator expectations are computed from THAT.
A test that retyped `149.7` would pass just as happily against a repair that
scaled by the wrong factor in the right direction.

⛔ AND `pytest.approx` IS NOT USED ANYWHERE. Measured this week on this branch,
an `ema` difference of `9.919e-07` — two genuinely different indicators — sits
INSIDE approx's default `rel=1e-6`.
"""
from __future__ import annotations

import datetime
from fractions import Fraction

import pytest

from api.services import bars_sanitize as san
from api.services import bars_split_repair as rep
from api.services import bars_sqlite
from api.services import indicator_alert_evaluator as ev
from api.services import indicator_compute as ic


# ── the fixture store ───────────────────────────────────────────────────────
@pytest.fixture
def fresh_db(tmp_path, monkeypatch):
    """A private bars.db. Same idiom as `test_weekly_key_integrity.fresh_db` —
    `_DB_PATH` is captured at module import, so a fixture must rebind the
    attribute and bump the connection epoch, not set an env var."""
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", str(tmp_path / "bars.db"))
    bars_sqlite.bump_db_epoch()
    bars_sqlite.init_db()
    yield
    bars_sqlite.bump_db_epoch()


def _sessions(start: datetime.date, n: int) -> list[datetime.date]:
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d += datetime.timedelta(days=1)
    return out


#: DD's real shape, and the part that matters is the DATE DISAGREEMENT: the
#: provider declares the 1-for-3 on 2026-06-24 while the tape stepped on
#: 2026-06-18, four sessions earlier. Every number below is a stand-in; the
#: STRUCTURE is the measurement.
_PRE_STORED = 48.0       # what the store holds before the step (⅓ of the truth)
_POST = 150.0            # the post-split scale, correct in the store
_RATIO = 1.0 / 3.0
_N_PRE, _N_POST = 300, 190
_STEP_OFFSET = 4         # sessions between the observed step and the declared date


def _plant_unadjusted_split(ticker="DD", tf="D"):
    """Write a series whose pre-step bars are still on the OLD scale.

    Returns ``(bars_written, declared_split_date, boundary_date)``.
    """
    days = _sessions(datetime.date(2024, 1, 2), _N_PRE + _N_POST)
    boundary = days[_N_PRE]                                  # first post-split bar
    declared = days[_N_PRE + _STEP_OFFSET]                   # what the provider says
    bars = []
    for i, d in enumerate(days):
        p = _PRE_STORED if i < _N_PRE else _POST
        bars.append({"t": int(d.strftime("%Y%m%d")), "o": p, "h": round(p * 1.02, 4),
                     "l": round(p * 0.98, 4), "c": p, "v": 1_000_000})
    bars_sqlite.put_bars(ticker, tf, bars, date_tf=False)
    return bars, declared.isoformat(), boundary


def _declared(date_iso):
    return [(date_iso, _RATIO)]


def _lane_bars(ticker="DD", tf="D", n=5000):
    """Exactly what the alert lane sees — its own fetch, not a re-read."""
    return ev._fetch_bars_for_alert(ticker, tf, n)


def _truth(bars, boundary):
    """The corrected close series, derived by EXACT rational arithmetic from the
    stored one: a bar before the boundary is worth `stored / ratio` = `stored × 3`."""
    out = []
    for b in bars:
        d = datetime.date.fromisoformat(f"{str(b['t'])[:4]}-{str(b['t'])[4:6]}-{str(b['t'])[6:8]}")
        c = Fraction(str(b["c"]))
        out.append(c * 3 if d < boundary else c)
    return out


def _sma(values, period):
    window = values[-period:]
    return sum(window, Fraction(0)) / period


def _rel(actual: float, expected: Fraction) -> float:
    return abs(Fraction(actual) - expected) / abs(expected)


# ── the headline ────────────────────────────────────────────────────────────
class TestTheLaneGetsTheRightNumber:
    def test_the_alert_lanes_sma200_is_wrong_before_the_repair(self, fresh_db):
        """RED FIRST, on the artifact: the lane computes across two price scales."""
        bars, _declared_iso, boundary = _plant_unadjusted_split()
        closes = [b["c"] for b in _lane_bars()]
        got = ic.compute_sma(closes, 200)[-1]
        expected = _sma(_truth(bars, boundary), 200)
        # 10 of the last 200 sessions are still ⅓ of their true value.
        assert _rel(got, expected) > 0.03, (
            f"the un-repaired lane read {got!r} where the truth is "
            f"{float(expected)!r} — if this passes, the fixture no longer "
            "reproduces the defect and every assertion below is vacuous")

    def test_repair_moves_the_alert_lanes_sma200_onto_the_true_series(self, fresh_db):
        bars, declared_iso, boundary = _plant_unadjusted_split()
        rep.repair_ticker("DD", "D", splits=_declared(declared_iso), apply=True)
        closes = [b["c"] for b in _lane_bars()]
        got = ic.compute_sma(closes, 200)[-1]
        expected = _sma(_truth(bars, boundary), 200)
        assert _rel(got, expected) <= Fraction(1, 10**9), (
            f"lane SMA200 {got!r} vs exact {float(expected)!r}")

    def test_repair_moves_the_atr_that_feeds_position_sizing(self, fresh_db):
        """ATR14 is the one the audit called worst: a wrong number that becomes a
        wrong trade size. It must move, and it must land on the true series."""
        bars, declared_iso, boundary = _plant_unadjusted_split()
        before = ic.compute_atr_raw(_lane_bars(), 14)[-1]
        rep.repair_ticker("DD", "D", splits=_declared(declared_iso), apply=True)
        after = ic.compute_atr_raw(_lane_bars(), 14)[-1]
        # An ATR whose window sits entirely after the boundary is unaffected by
        # the scale change, which is why the fixture's step is inside it.
        assert before != after
        true_bars = [dict(b) for b in bars]
        for b in true_bars:
            d = datetime.date.fromisoformat(
                f"{str(b['t'])[:4]}-{str(b['t'])[4:6]}-{str(b['t'])[6:8]}")
            if d < boundary:
                for k in ("o", "h", "l", "c"):
                    b[k] = round(b[k] * 3, 4)
        assert abs(after - ic.compute_atr_raw(true_bars, 14)[-1]) <= 1e-9

    def test_the_chart_and_the_lane_now_read_the_same_closes(self, fresh_db):
        """The split-brain itself: `/api/bars` and `bars_sqlite.get_bars` must
        agree AFTER the repair, with the serve-time sanitiser finding nothing
        left to do."""
        from api.services.bars_fetch import _fmt_sqlite_bars
        _bars, declared_iso, _b = _plant_unadjusted_split()
        rep.repair_ticker("DD", "D", splits=_declared(declared_iso), apply=True)
        rows = bars_sqlite.get_bars("DD", "D", 5000)
        served = _fmt_sqlite_bars(rows, "D")           # no ticker ⇒ no sanitize
        assert [b["c"] for b in served] == [b["c"] for b in _lane_bars()]


# ── the boundary the provider did not declare ───────────────────────────────
class TestTheDeclaredDateIsNotTheBoundary:
    def test_the_step_is_found_four_sessions_before_the_declared_date(self, fresh_db):
        _bars, declared_iso, boundary = _plant_unadjusted_split()
        plan = rep.plan_repair("DD", "D", splits=_declared(declared_iso))
        assert plan["boundaries"] == [(boundary.isoformat(), _RATIO)]

    def test_the_sessions_between_step_and_declared_date_are_left_alone(self, fresh_db):
        """⛔ THE FAILURE THIS PREVENTS IS THE LOUD ONE. Applying DD's factor at
        the DECLARED date would have multiplied the sessions already trading at
        the post-split scale by three — $150 into $450."""
        _bars, declared_iso, boundary = _plant_unadjusted_split()
        rep.repair_ticker("DD", "D", splits=_declared(declared_iso), apply=True)
        after = {b["t"]: b["c"] for b in _lane_bars()}
        for d in _sessions(boundary, _STEP_OFFSET + 1):
            assert after[int(d.strftime("%Y%m%d"))] == _POST

    def test_a_zero_window_detector_would_miss_it(self, fresh_db):
        """The control on the window itself. With `window=0` the detector is the
        date-exact one that shipped, and it finds NOTHING here — which is exactly
        why DD was healed nowhere, chart included."""
        bars, declared_iso, _b = _plant_unadjusted_split()
        series = [dict(b) for b in bars]
        assert san.unadjusted_splits(series, _declared(declared_iso), window=0) == []
        assert san.unadjusted_splits(series, _declared(declared_iso)) != []


# ── safety ──────────────────────────────────────────────────────────────────
class TestItCannotCorruptCorrectRows:
    def test_running_it_twice_writes_nothing_the_second_time(self, fresh_db):
        _bars, declared_iso, _b = _plant_unadjusted_split()
        first = rep.repair_ticker("DD", "D", splits=_declared(declared_iso), apply=True)
        snapshot = bars_sqlite.get_bars("DD", "D", 5000)
        second = rep.repair_ticker("DD", "D", splits=_declared(declared_iso), apply=True)
        assert first["written"] == _N_PRE and first["boundaries"]
        assert second["written"] == 0 and second["boundaries"] == []
        assert bars_sqlite.get_bars("DD", "D", 5000) == snapshot

    def test_bars_after_the_boundary_are_byte_identical(self, fresh_db):
        _bars, declared_iso, boundary = _plant_unadjusted_split()
        key = int(boundary.strftime("%Y%m%d"))
        before = [r for r in bars_sqlite.get_bars("DD", "D", 5000) if r[0] >= key]
        rep.repair_ticker("DD", "D", splits=_declared(declared_iso), apply=True)
        after = [r for r in bars_sqlite.get_bars("DD", "D", 5000) if r[0] >= key]
        assert before == after

    def test_a_declared_split_the_series_does_not_show_is_not_applied(self, fresh_db):
        """An ALREADY-adjusted series carries a split in its metadata forever.
        Nothing may be rescaled on the strength of the declaration alone."""
        days = _sessions(datetime.date(2024, 1, 2), 300)
        bars_sqlite.put_bars("OK", "D", [
            {"t": int(d.strftime("%Y%m%d")), "o": 10.0, "h": 10.2, "l": 9.8,
             "c": 10.0, "v": 1000} for d in days], date_tf=False)
        before = bars_sqlite.get_bars("OK", "D", 5000)
        out = rep.repair_ticker(
            "OK", "D", splits=[(days[200].isoformat(), 2.0)], apply=True)
        assert out["boundaries"] == [] and out["written"] == 0
        assert bars_sqlite.get_bars("OK", "D", 5000) == before

    def test_no_declared_split_is_a_no_op(self, fresh_db):
        _plant_unadjusted_split("NOSPLIT")
        before = bars_sqlite.get_bars("NOSPLIT", "D", 5000)
        out = rep.repair_ticker("NOSPLIT", "D", splits=[], apply=True)
        assert out["changed"] == 0 and out["written"] == 0
        assert bars_sqlite.get_bars("NOSPLIT", "D", 5000) == before

    def test_dry_run_writes_nothing(self, fresh_db):
        _bars, declared_iso, _b = _plant_unadjusted_split()
        before = bars_sqlite.get_bars("DD", "D", 5000)
        out = rep.repair_ticker("DD", "D", splits=_declared(declared_iso), apply=False)
        assert out["changed"] == _N_PRE and out["written"] == 0
        assert out["applied"] is False
        assert bars_sqlite.get_bars("DD", "D", 5000) == before

    def test_kill_switch_refuses_and_says_so(self, fresh_db, monkeypatch):
        monkeypatch.setenv("BARS_SPLIT_REPAIR_ENABLED", "0")
        _bars, declared_iso, _b = _plant_unadjusted_split()
        before = bars_sqlite.get_bars("DD", "D", 5000)
        out = rep.repair_ticker("DD", "D", splits=_declared(declared_iso), apply=True)
        assert out["skipped"] == "disabled" and out["written"] == 0
        assert bars_sqlite.get_bars("DD", "D", 5000) == before

    def test_intraday_is_refused_rather_than_silently_skipped(self, fresh_db):
        out = rep.repair_ticker("DD", "5", apply=True)
        assert out["skipped"] == "tf-not-repairable"


# ── the wire ────────────────────────────────────────────────────────────────
class TestTheWireIsNotCut:
    """⭐ THE SHAPE THE 2026-08-08 AUDIT SAID WAS MISSING. Every test above can
    pass with `bars_sanitize` never calling the repairer at all — eight features
    were once built, tested, green and connected to nothing. This goes RED when
    the HAND-OFF is cut while both components stay correct."""

    def test_serving_a_chart_repairs_the_store_behind_it(self, fresh_db, monkeypatch):
        from api.services.cache import cache
        bars, declared_iso, boundary = _plant_unadjusted_split()
        cache.set(san._META_KEY.format("DD"),
                  {"ipo": None, "splits": _declared(declared_iso)}, ttl=3600)

        ran: list = []
        real = rep.repair_ticker

        def _sync(ticker, tf="D", **kw):
            ran.append((ticker, tf))
            return real(ticker, tf, **kw)

        monkeypatch.setattr(rep, "repair_ticker", _sync)
        # Run the hand-off inline so the assertion cannot race a worker thread.
        monkeypatch.setattr(san, "_warm_pool", _Inline())

        served = [dict(b) for b in bars]
        for b in served:
            b["t"] = f"{str(b['t'])[:4]}-{str(b['t'])[4:6]}-{str(b['t'])[6:8]}"
        san.sanitize_daily_bars("DD", served, "D")

        assert ran, ("the serve path detected an unadjusted split and told the "
                     "store NOTHING — the split-brain is back")
        key = int(boundary.strftime("%Y%m%d"))
        stored = {r[0]: r[4] for r in bars_sqlite.get_bars("DD", "D", 5000)}
        assert stored[key - 100 if (key - 100) in stored else min(stored)] != _PRE_STORED

    def test_a_clean_series_hands_off_nothing(self, fresh_db, monkeypatch):
        """The control: the hand-off must be caused by the DETECTION, not by
        every serve. A hook that always fired would pass the test above for the
        wrong reason."""
        from api.services.cache import cache
        days = _sessions(datetime.date(2024, 1, 2), 300)
        cache.set(san._META_KEY.format("CLEAN"),
                  {"ipo": None, "splits": [(days[200].isoformat(), 2.0)]}, ttl=3600)
        ran: list = []
        monkeypatch.setattr(rep, "repair_ticker",
                            lambda *a, **k: ran.append(a) or {})
        monkeypatch.setattr(san, "_warm_pool", _Inline())
        san.sanitize_daily_bars("CLEAN", [
            {"t": d.isoformat(), "o": 10.0, "h": 10.2, "l": 9.8, "c": 10.0, "v": 1000}
            for d in days], "D")
        assert ran == []


class _Inline:
    """A `ThreadPoolExecutor` stand-in that runs the job on this thread."""

    def submit(self, fn, *a, **kw):
        fn(*a, **kw)
        return None
