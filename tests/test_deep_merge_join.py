"""The deep daily merge puts yfinance's older bars on Massive's basis when the two overlap on one (2026-11-18).

Production EMBJ (Embraer ADR, 4:1 on 2026-11-16): Massive's series starts 2025-11-03 and is adjusted,
yfinance's was not yet, so every deep fetch wrote a x0.25 cliff at 2025-11-03 and undid a repaired store
within minutes. `bars_fetch._yf_join_factor` has the reasoning."""
import datetime as dt

from api.services import bars_fetch as F
from api.services import bars_sqlite as S


def _days(start, n):
    out, d = [], dt.date.fromisoformat(start)
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += dt.timedelta(days=1)
    return out


def _bars(days, closes, v=1000):
    return [{"t": t, "o": c, "h": c * 1.01, "l": c * 0.99, "c": c, "v": v} for t, c in zip(days, closes)]


OLD = _days("2025-06-02", 60)            # yfinance only
SHARED = _days("2025-11-03", 40)         # both vendors
PRICES = [16.0 + 0.1 * i for i in range(40)]


def test_one_security_on_two_bases_is_joined_at_the_vendors_ratio():
    """EMBJ: yfinance 4x Massive across the overlap -> yfinance's older bars divided by 4 (volume x4)."""
    yf = _bars(OLD, [60.0 + 0.1 * i for i in range(60)], v=1000) + _bars(SHARED, [p * 4 for p in PRICES])
    massive = _bars(SHARED, PRICES)
    out = F._merge_daily_bars(yf, massive)
    assert [b["t"] for b in out] == OLD + SHARED
    assert out[0]["c"] == 15.0 and out[0]["v"] == 4000
    assert out[59]["c"] == round((60.0 + 5.9) / 4, 4)
    assert out[60] == massive[0]                       # Massive's own bars untouched
    assert abs(out[60]["c"] / out[59]["c"] - 1) < 0.05  # no cliff at the seam


def test_two_different_securities_are_never_rescaled():
    """GEN: Massive's per-ticker GenOn against yfinance's Symantec -- the ratio wanders, nothing moves."""
    yf = _bars(OLD, [17.0] * 60) + _bars(SHARED, [17.0 + (i % 5) for i in range(40)])
    massive = _bars(SHARED, [3.7 + 0.3 * ((i * 7) % 4) for i in range(40)])
    out = F._merge_daily_bars(yf, massive)
    assert [b["c"] for b in out[:60]] == [17.0] * 60


def test_the_same_basis_is_left_as_it_is():
    yf = _bars(OLD, [16.0] * 60) + _bars(SHARED, [p * 1.004 for p in PRICES])
    out = F._merge_daily_bars(yf, _bars(SHARED, PRICES))
    assert [b["c"] for b in out[:60]] == [16.0] * 60


def test_too_short_an_overlap_proves_nothing():
    yf = _bars(OLD, [60.0] * 60) + _bars(SHARED[:5], [p * 4 for p in PRICES[:5]])
    out = F._merge_daily_bars(yf, _bars(SHARED, PRICES))
    assert out[0]["c"] == 60.0


def test_an_empty_side_merges_as_before():
    m = _bars(SHARED, PRICES)
    assert F._merge_daily_bars([], m) is m
    y = _bars(OLD, [1.0] * 60)
    out = F._merge_daily_bars(y, [])
    assert out == y and all(isinstance(b, S.AddOnlyBar) for b in out), "an empty Massive answer is unjoined: add-only"


# ── 2026-11-21: an UNJOINED graft is add-only (web's CX: a pre-join-factor graft put Yahoo's basis under the vendor's) ──
# When `_yf_join_factor` cannot prove one basis (None), the older yfinance bars are AddOnlyBar: put_bars may ADD them
# where the store has no row, never REPLACE a row it holds. A proven join (EMBJ) stays an ordinary, replacing write.

import json                                     # noqa: E402

import pytest                                   # noqa: E402

from api.services import bars_sqlite as S       # noqa: E402


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(S, "_DB_PATH", str(tmp_path / "bars.db"))
    S.bump_db_epoch()
    S.init_db()
    yield tmp_path
    S.bump_db_epoch()


def _wandering():
    yf = _bars(OLD, [17.0] * 60) + _bars(SHARED, [17.0 + (i % 5) for i in range(40)])
    return yf, _bars(SHARED, [3.7 + 0.3 * ((i * 7) % 4) for i in range(40)])


def test_an_unproven_join_leaves_the_older_span_add_only_and_a_proven_one_does_not():
    out = F._merge_daily_bars(*_wandering())
    assert all(isinstance(b, S.AddOnlyBar) for b in out[:60]) and not any(isinstance(b, S.AddOnlyBar) for b in out[60:])
    short = F._merge_daily_bars(_bars(OLD, [60.0] * 60) + _bars(SHARED[:5], [p * 4 for p in PRICES[:5]]),
                                _bars(SHARED, PRICES))
    assert all(isinstance(b, S.AddOnlyBar) for b in short[:60])
    joined = F._merge_daily_bars(_bars(OLD, [60.0] * 60) + _bars(SHARED, [p * 4 for p in PRICES]), _bars(SHARED, PRICES))
    assert not any(isinstance(b, S.AddOnlyBar) for b in joined)
    assert json.dumps(out[0]) == json.dumps(dict(out[0])), "an AddOnlyBar serializes as the plain bar it is"


def test_put_bars_adds_an_add_only_bar_but_never_lets_it_replace_a_stored_row(store):
    S.put_bars("SEAM", "D", _bars(OLD[:30], [5.0] * 30) + _bars(SHARED, [1.0] * 40), date_tf=True)
    held = {r[0] for r in S.get_bars("SEAM", "D", 10 ** 6)}       # (the store refuses non-session dates)
    S.put_bars("SEAM", "D", [S.AddOnlyBar(b) for b in _bars(OLD, [9.0] * 60)] + _bars(SHARED, PRICES), date_tf=True)
    got = {r[0]: r[4] for r in S.get_bars("SEAM", "D", 10 ** 6)}
    key = lambda d: int(d.replace("-", ""))                       # noqa: E731
    old_held = [key(d) for d in OLD[:30] if key(d) in held]
    added = [key(d) for d in OLD[30:] if key(d) in got]
    assert old_held and all(got[k] == 5.0 for k in old_held), "a stored row is never replaced by an unjoined graft"
    assert added and all(got[k] == 9.0 for k in added), "a date the store lacked is filled"
    assert all(got[key(d)] == p for d, p in zip(SHARED, PRICES) if key(d) in got), "a plain bar still replaces"


def test_a_deep_weekly_or_monthly_series_keeps_its_unjoined_periods_add_only(monkeypatch):
    monkeypatch.setattr(F, "_fetch_daily", lambda t, n, deep=False: F._merge_daily_bars(*_wandering()))
    for fetch, tf in ((F._fetch_weekly, "W"), (F._fetch_monthly, "M")):
        out = fetch("SEAM", 10 ** 4, deep=True)
        before = [b for b in out if b["t"] < SHARED[0][:8] + "01" or (tf == "W" and b["t"] < SHARED[0])]
        assert before and all(isinstance(b, S.AddOnlyBar) for b in before), tf
        assert not isinstance(out[-1], S.AddOnlyBar), tf


# ── 2026-11-21 ruling: a vendor outage never rewrites history. An EMPTY Massive answer is an unjoined source too. ──

def _massive_empty_yf(monkeypatch, yf):
    import api.services.massive as M
    monkeypatch.setattr(M, "get_agg_bars", lambda *a, **k: [])
    monkeypatch.setattr(F, "_fetch_daily_yf", lambda *a, **k: [dict(b) for b in yf])


def test_an_empty_massive_answer_never_rewrites_stored_history_and_only_fills_dates(store, monkeypatch):
    S.put_bars("OUT", "D", _bars(SHARED, PRICES), date_tf=True)            # the vendor's basis
    before = {r[0]: r for r in S.get_bars("OUT", "D", 10 ** 6)}
    _massive_empty_yf(monkeypatch, _bars(OLD, [9.0] * 60) + _bars(SHARED, [p * 4 for p in PRICES]))
    assert F.warm_ticker_deep("OUT", "D") > 0
    after = {r[0]: r for r in S.get_bars("OUT", "D", 10 ** 6)}
    assert all(after[k] == v for k, v in before.items()), "an outage rewrote stored history onto another basis"
    filled = sorted(set(after) - set(before))
    assert filled and all(after[k][4] == 9.0 for k in filled), "dates the store lacked are filled"
    log = S.unjoined_writes("OUT", "D")
    assert log and log[-1]["rows"] == len(filled) and log[-1]["ts_min"] == filled[0] and log[-1]["ts_max"] == filled[-1]


def test_a_new_ticker_gets_its_unjoined_rows_with_their_provenance(store, monkeypatch):
    _massive_empty_yf(monkeypatch, _bars(OLD, [9.0] * 60))
    assert F.warm_ticker_deep("NEWT", "D") > 0
    rows = S.get_bars("NEWT", "D", 10 ** 6)
    assert rows and S.unjoined_writes("NEWT", "D")[-1]["rows"] == len(rows)
    # ... and a later PROVEN join rebases them: a plain (joined) write replaces what the unjoined one put
    S.put_bars("NEWT", "D", [dict(b, c=2.0, o=2.0, h=2.0, l=2.0) for b in _bars(OLD, [9.0] * 60)], date_tf=True)
    assert {r[4] for r in S.get_bars("NEWT", "D", 10 ** 6)} == {2.0}


def test_the_fast_path_tail_fill_keeps_history_add_only_when_massive_is_empty(monkeypatch):
    yf = _bars(OLD, [9.0] * 60)
    monkeypatch.setattr(F, "_fetch_daily_yf", lambda *a, **k: [dict(b) for b in yf])
    out = F._fill_daily_tail_with_yf("OUT", [])
    assert [b["t"] for b in out] == OLD
    assert all(isinstance(b, S.AddOnlyBar) for b in out[:-1]) and not isinstance(out[-1], S.AddOnlyBar), \
        "held history is add-only; only the newest (mutable tail) session may update"


def test_a_proven_same_basis_is_a_join_of_one_and_replaces():
    """Ruling 2026-11-21 (#2315's third commit): 20 shared sessions, all within 1% of a median within 1% of 1.0, PROVE one
    basis. That is a join of 1.0, an ordinary replacing write (a re-graft can then repair a store whose pre-floor rows
    sit on some third basis: web's ADSK / BSX / KIM x2). Only an UNPROVEN join (short overlap, wandering ratio) is None."""
    yf = _bars(OLD, [16.0] * 60) + _bars(SHARED, [p * 1.004 for p in PRICES])
    assert F._yf_join_factor(yf, _bars(SHARED, PRICES)) == 1.0
    out = F._merge_daily_bars(yf, _bars(SHARED, PRICES))
    assert [b["c"] for b in out[:60]] == [16.0] * 60
    assert not any(isinstance(b, S.AddOnlyBar) for b in out), "a proven same basis is a replacing write"
    assert F._yf_join_factor(*_wandering()) is None
    assert F._yf_join_factor(_bars(OLD, [60.0] * 60) + _bars(SHARED[:5], PRICES[:5]), _bars(SHARED, PRICES)) is None
