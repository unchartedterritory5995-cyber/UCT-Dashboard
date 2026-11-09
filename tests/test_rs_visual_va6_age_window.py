"""RS Phase 2a visual round, unit VA6: review finding #18 — the screener's RS ages
read their TRUE age past the old 400-bar ceiling.

Before: `build_row` handed `rs_columns.collect_one` the same 400-bar window as
every other bar consumer. An RS new high can only exist from window bar 252
(LOOKBACK) and a Mansfield cross from bar 200 (MANSFIELD_LENGTH), so
`rs_nh_bars_ago` could never exceed 147 and `mansfield_cross_bars_ago` 199: a
filter of "RS NH age >= 148" never matched, and the column went blank the day
after it read 147 while the chart still drew the dot.

After: the RS step reads its own `RS_WINDOW_BARS` (252 + 400 = 652) tail, sliced
raw and then sanitized like the 400, for the same newest bar. Every other
consumer still reads 400.

Synthetic bars only: no network, no bars.db, no data root.
"""
from __future__ import annotations

from datetime import date, timedelta

import pytest

import api.services.screener.snapshot_builder as b
from api.services.screener import rs_columns, technicals
from api.services.signature import registry_defs

N = 700
END = date(2026, 11, 5)


def _weekdays_ending(end: date, n: int) -> list:
    out, d = [], end
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d -= timedelta(days=1)
    return sorted(out)


DAYS = _weekdays_ending(END, N)


def _bars(closes) -> list:
    return [{"t": int(d.strftime("%Y%m%d")), "o": c, "h": c * 1.01, "l": c * 0.99,
             "c": c, "v": 100_000.0} for d, c in zip(DAYS, closes)]


#: SPY and RSP flat at 100: the RS line is the ticker's close / 100, so the
#: shape of each ticker below IS the shape of its RS line.
SPY = _bars([100.0] * N)
RSP = _bars([100.0] * N)

NH_PEAK = 400            # the last RS new high: rises to bar 400, falls after
MANS_CROSS = 350         # Mansfield crosses up here and stays above zero


def _nh_ticker():
    """RS rises every bar to NH_PEAK (each bar from 252 on is a 252-bar high),
    then falls every bar to the end: the last RS new high is NH_PEAK, so its
    true age on the newest bar is N - 1 - NH_PEAK = 299."""
    out, c = [], 50.0
    for i in range(N):
        c *= 1.002 if i <= NH_PEAK else 0.999
        out.append(c)
    return _bars(out)


def _mansfield_ticker():
    """RS drifts down to MANS_CROSS (below its own 200-bar average, Mansfield
    negative), steps up there and drifts up to the end (above its average,
    Mansfield positive): one zero cross, at MANS_CROSS, true age 349."""
    out, c = [], 60.0
    for i in range(N):
        if i < MANS_CROSS:
            c *= 0.999
        elif i == MANS_CROSS:
            c *= 1.25
        else:
            c *= 1.0005
        out.append(c)
    return _bars(out)


@pytest.fixture
def rs_on(monkeypatch):
    monkeypatch.setattr(registry_defs, "RS_V2_ENABLED", True)


def _row(bars):
    return b.build_row("AAA", bars, None, None, failures={},
                       spy_bars=SPY, rsp_bars=RSP)


# ───────────────────────────── the window ─────────────────────────────────

def test_the_rs_window_is_lookback_plus_the_published_400():
    assert b.RS_WINDOW_BARS == rs_columns.LOOKBACK + 400 == 652
    # Deep enough for both ages to publish 400 sessions back.
    assert b.RS_WINDOW_BARS - rs_columns.MIN_BARS["rs_nh_bars_ago"] + 1 >= 400
    assert b.RS_WINDOW_BARS - rs_columns.MIN_BARS["mansfield_cross_bars_ago"] + 1 >= 400


def test_the_collector_gets_652_bars_ending_on_the_same_bar(rs_on, monkeypatch):
    seen = []
    real = rs_columns.collect_one

    def _spy(bars, spy_bars, rsp_bars=None, **kw):
        seen.append((list(bars), kw.get("session")))
        return real(bars, spy_bars, rsp_bars, **kw)
    monkeypatch.setattr(rs_columns, "collect_one", _spy)
    bars = _nh_ticker()
    row = _row(bars)
    assert len(seen) == 1
    window, session = seen[0]
    assert len(window) == 652
    assert window == bars[-652:]
    assert window[-1]["t"] == bars[-1]["t"]
    assert str(session) == row["bars_asof"] == str(bars[-1]["t"])


def test_every_other_consumer_still_reads_the_400(rs_on, monkeypatch):
    """Control: only the RS step deepened. The technicals step (and the rest
    reading `bars`) still gets exactly the raw-tail-400."""
    seen = []
    real = technicals.compute_technicals

    def _spy(bars, **kw):
        seen.append(len(bars))
        return real(bars, **kw)
    monkeypatch.setattr(technicals, "compute_technicals", _spy)
    _row(_nh_ticker())
    assert seen == [400]


def test_the_rs_window_is_raw_tail_then_sanitize(rs_on, monkeypatch):
    """A bad bar inside the 652 is dropped, never back-filled from deeper
    history (the same rule the 400 follows)."""
    seen = []
    real = rs_columns.collect_one

    def _spy(bars, spy_bars, rsp_bars=None, **kw):
        seen.append(list(bars))
        return real(bars, spy_bars, rsp_bars, **kw)
    monkeypatch.setattr(rs_columns, "collect_one", _spy)
    bars = [dict(x) for x in _nh_ticker()]
    bars[-600]["c"] = None
    _row(bars)
    assert len(seen[0]) == 651
    assert seen[0][0]["t"] == bars[-652]["t"]


# ───────────────────────────── the true ages ──────────────────────────────

def test_an_rs_new_high_older_than_147_bars_reports_its_true_age(rs_on):
    bars = _nh_ticker()
    true_age = N - 1 - NH_PEAK
    assert true_age == 299 and true_age > 147
    # The old 400-bar window could not see it (the defect, pinned as a fact).
    assert rs_columns.collect_one(bars[-400:], SPY, RSP)["rs_nh_bars_ago"] is None
    row = _row(bars)
    assert row["rs_nh_bars_ago"] == true_age
    assert row["rs_new_high"] == 0


def test_a_mansfield_cross_older_than_199_bars_reports_its_true_age(rs_on):
    bars = _mansfield_ticker()
    true_age = N - 1 - MANS_CROSS
    assert true_age == 349 and true_age > 199
    assert rs_columns.collect_one(bars[-400:], SPY, RSP)["mansfield_cross_bars_ago"] is None
    row = _row(bars)
    assert row["mansfield_cross_bars_ago"] == true_age
    assert row["mansfield"] is not None and row["mansfield"] > 0


def test_the_age_matches_the_full_history_answer(rs_on):
    """The screener now agrees with the chart's deep series (all 700 bars) for
    any event inside the published 400."""
    for bars, col in ((_nh_ticker(), "rs_nh_bars_ago"),
                      (_mansfield_ticker(), "mansfield_cross_bars_ago")):
        deep = rs_columns.collect_one(bars, SPY, RSP)[col]
        assert _row(bars)[col] == deep


def test_a_young_event_reads_the_same_as_before(rs_on):
    """Control: an event well inside the old ceiling reads the same age through
    the 400 and the 652, and every flag that reads only the newest bars agrees."""
    closes, c = [], 50.0
    for i in range(N):
        c *= 1.002 if i <= N - 21 else 0.999
        closes.append(c)
    bars = _bars(closes)
    old = rs_columns.collect_one(bars[-400:], SPY, RSP)
    row = _row(bars)
    assert old["rs_nh_bars_ago"] == row["rs_nh_bars_ago"] == 20
    for col in ("rs_new_high", "rs_nh_before_price", "rs_nh_red_day",
                "green_on_red_20", "rs_line_above_ma", "rs_benchmark_agree"):
        assert row[col] == old[col], col


# ───────────────────── A7: the one label (rail + methodology) ─────────────────

def test_the_mansfield_age_label_drops_zero_and_fits_one_line():
    """Spec A7 "One label": `Mansfield zero-cross age (bars)` becomes
    `Mansfield cross age (bars)` so it fits one rail line like its neighbours;
    the description (tooltip) keeps "zero"."""
    from api.services.screener import filters, methodology
    label = filters.FILTERS["mansfield_cross_bars_ago"]["label"]
    assert label == "Mansfield Cross Age (bars)"
    assert "zero" not in label.lower()
    # No longer than the longest RS neighbour that already sits on one line.
    assert len(label) <= len(filters.FILTERS["rs_rating_chg_5"]["label"])
    m = methodology.for_column("mansfield_cross_bars_ago")
    assert m["label"] == label
    assert "zero" in m["one_line"].lower()


def test_no_other_rs_filter_label_moved():
    """Control: the neighbours keep their labels."""
    from api.services.screener import filters
    assert filters.FILTERS["rs_cross_up_bars_ago"]["label"] == "RS Line Cross-Up Age (bars)"
    assert filters.FILTERS["rs_nh_bars_ago"]["label"] == "RS New High Age (bars)"
    assert filters.FILTERS["mansfield"]["label"] == "Mansfield RS"
