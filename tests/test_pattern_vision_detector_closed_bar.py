"""Detectors see the last CLOSED bar as current, never a partial candle.

Detectors index `bars[-1]` directly as "the current bar" -- `bull_flag`,
`donchian_breakout` (its `breakout_close` is literally `bars[-1]["c"]`), and
about ten others. `candidates_for` handed them the FULL series, so on any
ticker holding today's partial intraday candle a "breakout" could be measured
on a bar that had not finished forming and could un-happen before the close,
while the recorded `asof_date` named the prior session.

Measured on production 2026-09-10: GILD's partial carried 6% of its 20-day
average volume forty minutes into the session, and GILD was judged on
`bull_flag`.

The load-bearing test is the first one: the list handed to `detect_all` must
END at the evidence bar, so detection and `asof_date` cannot disagree about
which bar is being described.
"""
import datetime

from zoneinfo import ZoneInfo

from api.services.pattern_vision import orchestrator as orch

_ET = ZoneInfo("America/New_York")


def _today():
    return datetime.datetime.now(_ET).date()


def _ymd(d):
    return int(d.strftime("%Y%m%d"))


def _bar(d, c=100.0):
    return (_ymd(d), c, c + 1, c - 1, c, 1000)


def _series(n=40, with_today=False):
    """n closed daily bars ending yesterday, optionally plus today's partial."""
    t = _today()
    out = [_bar(t - datetime.timedelta(days=n - i)) for i in range(n)]
    if with_today:
        out.append(_bar(t, c=999.0))
    return out


def _capture(monkeypatch, bars):
    """Run the real candidates_for and capture what detect_all was handed."""
    seen = {}

    import api.services.pattern_engine as pe
    from api.services.pattern_engine.primitives import context as pe_ctx

    def _detect(bars_list, ctx, pattern_ids=None):
        seen["bars"] = bars_list
        seen["ctx_len"] = ctx.get("_n") if isinstance(ctx, dict) else None
        return [{"pattern_id": "vcp", "confidence": 70.0, "levels": {"entry": 1.0}}]

    monkeypatch.setattr(pe, "detect_all", _detect)
    monkeypatch.setattr(pe_ctx, "build_context",
                        lambda bars_list, sym=None: {"_n": len(bars_list)})
    monkeypatch.setattr(orch, "_read_bars", lambda t, tf: bars)
    cands = orch.candidates_for("NVDA")
    return seen, cands


def test_the_list_handed_to_detect_all_ends_at_the_evidence_bar(monkeypatch):
    """THE LOAD-BEARING ONE. With today's partial present, the detectors must
    not see it."""
    bars = _series(with_today=True)
    seen, cands = _capture(monkeypatch, bars)

    assert seen["bars"][-1]["t"] == orch._evidence_bar(bars)[0], (
        "detect_all's last bar must BE the evidence bar"
    )
    assert seen["bars"][-1]["t"] != bars[-1][0], "the partial candle leaked into detection"
    assert len(seen["bars"]) == len(bars) - 1


def test_without_a_partial_the_series_is_passed_whole(monkeypatch):
    """Control. Nothing is withheld on a ticker whose today-bar has not arrived
    -- which on any given morning is most of them."""
    bars = _series(with_today=False)
    seen, _ = _capture(monkeypatch, bars)
    assert len(seen["bars"]) == len(bars)
    assert seen["bars"][-1]["t"] == bars[-1][0]
    assert seen["bars"][-1]["t"] == orch._evidence_bar(bars)[0]


def test_the_context_is_built_from_the_same_truncated_series(monkeypatch):
    """`build_context` derives ATRs and averages. Feeding it the partial while
    the detectors see closed bars would be a second disagreement, one layer
    down."""
    bars = _series(with_today=True)
    seen, _ = _capture(monkeypatch, bars)
    assert seen["ctx_len"] == len(seen["bars"])


def test_asof_date_matches_the_bar_detection_actually_saw(monkeypatch):
    bars = _series(with_today=True)
    seen, cands = _capture(monkeypatch, bars)
    assert cands, "fixture must produce a candidate or this asserts nothing"
    last_seen_ts = str(seen["bars"][-1]["t"])
    iso = "%s-%s-%s" % (last_seen_ts[:4], last_seen_ts[4:6], last_seen_ts[6:8])
    assert cands[0]["asof_date"] == iso


def test_a_series_that_is_too_short_once_truncated_yields_nothing(monkeypatch):
    """The 30-bar floor applies to the CLOSED history, not the raw list. A
    ticker with exactly 30 bars of which one is today's partial has 29 closed
    bars, and detecting on 29 while claiming 30 is the kind of quiet
    off-by-one this change exists to remove."""
    t = _today()
    bars = [_bar(t - datetime.timedelta(days=30 - i)) for i in range(29)] + [_bar(t)]
    assert len(bars) == 30
    seen, cands = _capture(monkeypatch, bars)
    assert cands == []
    assert "bars" not in seen, "detect_all must not be called at all"
