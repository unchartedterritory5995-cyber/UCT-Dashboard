"""Dividend back-adjustment factors.

The convention is validated against yfinance itself in the session log (14
tickers, mean deviation <=0.019%, controls exactly 1.0000). These tests pin the
arithmetic and — more importantly — the failure directions: every degraded path
must return the UNADJUSTED frame, because a half-swept dividend store that
silently rescales a year of prices is far worse than one that does nothing.
"""
import numpy as np
import pytest

from api.services import breadth_dividends as bd


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path, monkeypatch):
    monkeypatch.setattr(bd, "DB_PATH", str(tmp_path / "div.db"))
    yield


def _seed(rows):
    from contextlib import closing
    with closing(bd._conn()) as c:
        c.executemany("INSERT OR REPLACE INTO dividends(ticker,ex_date,cash) VALUES (?,?,?)",
                      rows)
        c.commit()


DATES = [20260601, 20260602, 20260603, 20260604, 20260605]


def test_no_dividend_data_is_a_no_op():
    closes = np.full((2, 5), 100.0)
    f = bd.factors(["AAA", "BBB"], DATES, closes)
    assert np.all(f == 1.0)
    assert np.array_equal(bd.adjust(["AAA", "BBB"], DATES, closes), closes)


def test_non_payer_stays_exactly_one():
    _seed([("AAA", 20260603, 1.0)])
    closes = np.full((2, 5), 100.0)
    f = bd.factors(["AAA", "ZZZ"], DATES, closes)
    assert np.all(f[1] == 1.0), "a ticker with no events must not be touched"


def test_factor_applies_only_to_dates_before_the_ex_date():
    # $1 on a $100 prior close => ratio 0.99 for everything strictly older.
    _seed([("AAA", 20260603, 1.0)])
    closes = np.full((1, 5), 100.0)
    f = bd.factors(["AAA"], DATES, closes)
    assert f[0, 0] == pytest.approx(0.99)
    assert f[0, 1] == pytest.approx(0.99)   # 06-02 is before the 06-03 ex-date
    assert f[0, 2] == pytest.approx(1.0)    # the ex-date itself is already ex
    assert f[0, 4] == pytest.approx(1.0)


def test_multiple_events_compound():
    _seed([("AAA", 20260602, 1.0), ("AAA", 20260604, 1.0)])
    closes = np.full((1, 5), 100.0)
    f = bd.factors(["AAA"], DATES, closes)
    assert f[0, 0] == pytest.approx(0.99 * 0.99)
    assert f[0, 2] == pytest.approx(0.99)
    assert f[0, 4] == pytest.approx(1.0)


def test_ex_date_past_the_frame_is_ignored_even_with_as_of():
    """The frame's last bar stays RAW, which keeps one-day metrics untouched.

    An earlier build scaled the whole frame for a dividend going ex on the
    measured session, reasoning that the collector anchors there. Ten reconciled
    sessions rejected it: rescaling the last bar moves `prev_close`, the
    denominator of every one-day metric, and `adv_decline` degraded from 7.2 to
    12.0 with the sign 9+/0- as borderline decliners flipped to advancers.
    `as_of` is now accepted and ignored; this test is what keeps it that way.
    """
    _seed([("AAA", 20260608, 1.0)])
    closes = np.full((1, 5), 100.0)
    assert np.all(bd.factors(["AAA"], DATES, closes) == 1.0)
    assert np.all(bd.factors(["AAA"], DATES, closes, as_of=20260608) == 1.0)


def test_last_bar_is_never_adjusted():
    _seed([("AAA", 20260603, 1.0)])
    closes = np.full((1, 5), 100.0)
    f = bd.factors(["AAA"], DATES, closes)
    assert f[0, -1] == 1.0, "prev_close must stay raw or one-day metrics move"


def test_outsized_event_is_skipped_not_applied():
    # 40% of the prior close: a special/liquidating payment or bad vendor row.
    # Rescaling a year of history off it is worse than ignoring it.
    _seed([("AAA", 20260603, 40.0)])
    closes = np.full((1, 5), 100.0)
    f = bd.factors(["AAA"], DATES, closes)
    assert np.all(f == 1.0)
    assert bd._health["skipped_outsized"] >= 1


def test_missing_prev_close_walks_back_rather_than_dropping():
    _seed([("AAA", 20260604, 1.0)])
    closes = np.full((1, 5), 100.0)
    closes[0, 2] = np.nan          # the bar right before the ex-date
    f = bd.factors(["AAA"], DATES, closes)
    assert f[0, 0] == pytest.approx(0.99), "should use the last good close, not skip"


def test_unusable_prev_close_skips_the_event():
    _seed([("AAA", 20260604, 1.0)])
    closes = np.full((1, 5), np.nan)
    f = bd.factors(["AAA"], DATES, closes)
    assert np.all(f == 1.0)
    assert bd._health["skipped_no_prev_close"] >= 1


def test_ex_date_on_a_non_session_day_lands_on_the_next_session():
    _seed([("AAA", 20260602, 1.0)])          # present in DATES
    _seed([("BBB", 20260602, 1.0)])
    closes = np.full((2, 5), 100.0)
    f = bd.factors(["AAA", "BBB"], [20260601, 20260603, 20260604, 20260605, 20260608],
                   closes)
    # 06-02 is not a session in that grid; it must apply at 06-03, so only the
    # 06-01 bar is older than it.
    assert f[0, 0] == pytest.approx(0.99)
    assert f[0, 1] == pytest.approx(1.0)


def test_adjust_is_closes_times_factors():
    _seed([("AAA", 20260603, 2.0)])
    closes = np.full((1, 5), 50.0)
    f = bd.factors(["AAA"], DATES, closes)
    assert np.allclose(bd.adjust(["AAA"], DATES, closes), closes * f)


def test_health_reports_the_store():
    _seed([("AAA", 20260603, 1.0), ("BBB", 20260603, 2.0)])
    h = bd.health()
    assert h["present"] is True
    assert h["stored_rows"] == 2
    assert h["stored_tickers"] == 2


def test_empty_inputs_do_not_raise():
    assert bd.factors([], [], np.zeros((0, 0))).shape == (0, 0)


class _Boom:
    def adjust(self, *a, **k):
        raise RuntimeError("store exploded")


def test_live_fails_open_when_the_store_raises(monkeypatch):
    """A broken dividend store must degrade to TODAY'S shipped numbers."""
    from api.services import breadth_live as live
    import sys

    monkeypatch.setenv("BREADTH_DIVIDEND_BASIS", "1")
    monkeypatch.setitem(sys.modules, "api.services.breadth_dividends", _Boom())
    closes = np.full((1, 3), 100.0)
    out = live._apply_dividend_basis(["AAA"], [20260601, 20260602, 20260603],
                                     closes, 20260604)
    assert np.array_equal(out, closes)


def test_basis_ships_dark_and_the_override_wins(monkeypatch):
    from api.services import breadth_live as live

    monkeypatch.delenv("BREADTH_DIVIDEND_BASIS", raising=False)
    assert live.dividend_basis_enabled() is False, "must be a no-op on deploy"
    monkeypatch.setenv("BREADTH_DIVIDEND_BASIS", "1")
    assert live.dividend_basis_enabled() is True

    # The A/B override has to beat the flag in BOTH directions or the two arms
    # cannot be measured from one process.
    _seed([("AAA", 20260603, 1.0)])
    monkeypatch.setattr(live, "dividend_basis_enabled", lambda: False)
    closes = np.full((1, 5), 100.0)
    forced = live._apply_dividend_basis(["AAA"], DATES, closes, 20260605, True)
    assert forced[0, 0] == pytest.approx(99.0)
    monkeypatch.setattr(live, "dividend_basis_enabled", lambda: True)
    off = live._apply_dividend_basis(["AAA"], DATES, closes, 20260605, False)
    assert np.array_equal(off, closes)


def test_anchor_switches_off_once_the_basis_is_corrected(monkeypatch):
    """The anchor and the basis correction do the SAME job — running both
    double-counts it.

    Measured over 10 reconciled sessions, mean failing fields per session:
        basis off:  raw 8.1  anchored 1.9   (anchor is load-bearing)
        basis on:   raw 1.3  anchored 6.8   (anchor now injects error)
    e.g. stage2_count raw 8.9 vs anchored 50.9.
    """
    from api.services import breadth_live as live

    monkeypatch.setenv("BREADTH_DIVIDEND_BASIS", "0")
    assert live._anchorable("pct_above_200sma") is True
    assert live._anchorable("stage2_count") is True

    monkeypatch.setenv("BREADTH_DIVIDEND_BASIS", "1")
    assert live._anchorable("pct_above_200sma") is False
    assert live._anchorable("stage2_count") is False
    # Things that were never anchorable stay that way for their own reasons.
    assert live._anchorable("spy_close") is False
    assert live._anchorable("universe_count") is False
