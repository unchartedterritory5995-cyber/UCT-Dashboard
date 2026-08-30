"""`sweep_history` must never write a `new_ath` series into stored history.

WHY THIS RAIL EXISTS
--------------------
`new_ath` is an ALL-TIME-high count. The sweep only ever holds `window`
sessions (320 by default), so a `new_ath` it computed would be a ~15-month
high FILED AS an all-time high. `write_bulk` writes stored history, so every
row it touched would carry the wrong definition permanently — mixed in beside
rows that carry the real one, with nothing on the row saying which is which.

Today `compute_metrics` publishes `new_ath: None` and the sweep's `fv is None`
skip already drops it. That is INCIDENTAL, and this file exists because an
incidental protection is one refactor from gone: give the key a number again
and the sweep would start writing it silently, with no test going red.

Each test carries a CONTROL — a sibling metric with a number, asserted
PRESENT — so a version of this file that captured nothing (a broken
monkeypatch, a sweep that returned early) cannot pass for the wrong reason.
"""
from api.services import breadth_history_recon as recon
from api.services import breadth_daily_ohlc, breadth_monitor

_DATES = ["2026-01-02", "2026-01-05", "2026-01-06"]


def _drive(monkeypatch, metrics: dict) -> list:
    """Run `sweep_history` over a stub frame; return the rows it tried to write."""
    written: list = []
    monkeypatch.setattr(recon, "load_deep_frame",
                        lambda *a, **k: {"dates": list(_DATES)})
    monkeypatch.setattr(recon, "recompute_from_frame",
                        lambda frame, tickers, ds, window: {
                            "ok": True, "metrics": dict(metrics)})
    # Passthrough: the derived-metric step is not what this rail is about.
    monkeypatch.setattr(breadth_monitor, "derive_live_row",
                        lambda base, recent: dict(base))
    monkeypatch.setattr(breadth_daily_ohlc, "write_bulk",
                        lambda rows, source=None: written.extend(rows) or len(rows))
    out = recon.sweep_history("2026-01-05", "2026-01-06", tickers=["AAA", "BBB"])
    assert out["ok"], out
    return written


def _metrics_of(rows) -> set:
    return {r[1] for r in rows}


def test_a_numeric_new_ath_is_refused_while_its_neighbour_is_written(monkeypatch):
    """The defect this rail exists for: `new_ath` carrying a real number.

    `new_52w_highs` is the control — same shape, same session, written.
    """
    rows = _drive(monkeypatch, {"new_ath": 41, "new_52w_highs": 41})
    seen = _metrics_of(rows)
    assert "new_52w_highs" in seen, (
        "control missing — the sweep wrote nothing, so this file proves nothing")
    assert "new_ath" not in seen, (
        "sweep_history wrote a new_ath series: a 320-session high stored under "
        "an all-time-high name")


def test_new_ath_stays_refused_when_it_is_the_only_metric_offered(monkeypatch):
    """No neighbour to hide behind — the refusal is about the key, not the row."""
    rows = _drive(monkeypatch, {"new_ath": 41, "pct_above_50sma": 62.5})
    seen = _metrics_of(rows)
    assert "pct_above_50sma" in seen
    assert "new_ath" not in seen


def test_the_none_that_compute_metrics_publishes_today_is_also_dropped(monkeypatch):
    """The current live shape. Belt and braces: it must not reach storage as a row."""
    rows = _drive(monkeypatch, {"new_ath": None, "new_52w_highs": 41})
    seen = _metrics_of(rows)
    assert "new_52w_highs" in seen
    assert "new_ath" not in seen


def test_the_refusal_set_names_new_ath():
    """The guard is a named set, not a buried condition — so it can be read."""
    assert "new_ath" in recon._NEVER_SWEEP_STORE
