"""W2-B2 (builder-b) — historical analysis on the MD-1 gateway, with SYNTHETIC bars (no network, no real store, no model).

(1) `bars.daily` gains `from`: a window from a date to the cutoff (or `to`), honest notes, pure validation.
(2) `history.eventStudy`: a thin kind over Market Intelligence's existing event_study (technical series only —
    a breadth-conditioned study is refused before any read, ADR-005); `gap_pct` = the opening gap vs the previous
    close, computed by the study's own technical adapter over the stored opens / closes; the envelope's `data.study`
    is the member's table and text, `data.summary` the value-free part; freshness historical with as_of = the last
    stored price session's close; "descriptive, not predictive"; default OFF.
(3) LOCAL-ONLY on the server: `history.afterEvent` is in turn.LOCAL_ONLY_ACTIONS and its stored request replays as
    the study's value-free note (symbol, condition, windows) — never a return.
"""
from __future__ import annotations

import json
import re

import pytest

from api.services import bars_sqlite
from api.services.market_intel import event_study as es
from api.services.market_intel import price_reads as pr
from api.services.market_intel import series_adapters as sa
from api.services.uct_agent import turn
from api.services.uct_agent.marketdata import bars_daily as bd
from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import gateway as gw
from api.services.uct_agent.marketdata import history_event_study as hes
from api.services.uct_agent.marketdata import sessions
from tests import market_intel_event_fixtures as fx
from tests.market_intel_event_fixtures import S


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.KINDS_ENV, ",".join(gw.registry().names()))  # every kind on
    gw._reset_for_test(None)
    yield
    gw._reset_for_test(None)


# ── (1) bars.daily `from` ──────────────────────────────────────────────────────────────────────────────

SESSIONS = [20251121, 20251124, 20251125, 20251126, 20251128, 20251201, 20251202]


class _Store:
    def __init__(self, ymds):
        self.rows = [(d, 99.0 + i, 101.0 + i, 98.0 + i, 100.0 + i, 1_000_000) for i, d in enumerate(ymds)]
        self.calls = []

    def get_bars_before(self, ticker, tf, max_bars, to_key):
        self.calls.append((ticker, tf, max_bars, to_key))
        return [r for r in self.rows if r[0] <= to_key][-max_bars:]


def _bars_world(monkeypatch, ymds=SESSIONS, latest=20251202):
    store = _Store(ymds)
    monkeypatch.setattr(bars_sqlite, "get_bars_before", store.get_bars_before)
    from api.services import bars_fetch

    def last_closed(now=None):
        if now is None:
            return latest
        ymd = int(now.strftime("%Y%m%d"))
        return max(d for d in SESSIONS + [latest] if d <= ymd)
    monkeypatch.setattr(bars_fetch, "_last_closed_session_yyyymmdd", last_closed)
    monkeypatch.setattr(sessions, "last_completed_session", last_closed)
    return store


def test_from_reads_the_window_from_that_day_to_the_cutoff(monkeypatch):
    store = _bars_world(monkeypatch)
    out = gw.read("bars.daily", {"symbol": "AAPL", "from": "2025-11-25"}, user_id=1, turn_id="t1")
    assert env.validate_envelope(out) == [] and out["status"] == "ok"
    assert [b["date"] for b in out["data"]["bars"]] == ["2025-11-25", "2025-11-26", "2025-11-28", "2025-12-01", "2025-12-02"]
    assert store.calls == [("AAPL", "D", bd.MAX_BARS, 20251202)]         # one read, the whole depth, filtered here
    assert out["data"]["window_from"] == "2025-11-25"
    assert bd.NOTE_FROM.format(d="2025-11-25") in out["notes"]


def test_from_with_to_is_a_closed_window_and_a_from_after_to_is_refused(monkeypatch):
    _bars_world(monkeypatch)
    out = gw.read("bars.daily", {"symbol": "AAPL", "from": "2025-11-24", "to": "2025-11-28"}, user_id=1, turn_id="t2")
    assert [b["date"] for b in out["data"]["bars"]] == ["2025-11-24", "2025-11-25", "2025-11-26", "2025-11-28"]
    assert any("point-in-time" in n for n in out["notes"])
    bad = gw.read("bars.daily", {"symbol": "AAPL", "from": "2025-11-28", "to": "2025-11-24"}, user_id=1, turn_id="t3")
    assert bad["status"] == "refused" and "`from` must be on or before `to`" in bad["notes"][0]
    assert gw.read("bars.daily", {"symbol": "AAPL", "from": "nov 24"}, user_id=1, turn_id="t4")["status"] == "refused"


def test_from_before_the_stores_depth_says_where_the_held_bars_start(monkeypatch):
    _bars_world(monkeypatch)
    out = gw.read("bars.daily", {"symbol": "AAPL", "from": "2025-01-02"}, user_id=1, turn_id="t5")
    assert out["status"] == "partial" and out["data"]["bars"][0]["date"] == "2025-11-21"
    assert bd.NOTE_FROM_SHORT.format(d="2025-01-02", first="2025-11-21") in out["notes"]


def test_from_may_be_combined_with_bars_as_a_cap(monkeypatch):
    _bars_world(monkeypatch)
    out = gw.read("bars.daily", {"symbol": "AAPL", "from": "2025-11-21", "bars": 3}, user_id=1, turn_id="t6")
    assert [b["date"] for b in out["data"]["bars"]] == ["2025-11-28", "2025-12-01", "2025-12-02"]


# ── (2) the gap_pct series and the history.eventStudy kind ────────────────────────────────────────────

GAP_UP = {30, 120, 200}          # sessions that open 6 % above the previous close
GAP_DOWN = {80}                  # one 7 % gap down


def _gap_bars():
    bars = []
    for i, d in enumerate(S):
        c = 100.0 + i * 0.1
        prev = 100.0 + (i - 1) * 0.1 if i else c
        o = prev * 1.06 if i in GAP_UP else prev * 0.93 if i in GAP_DOWN else prev * 1.001
        bars.append({"t": d, "o": round(o, 4), "h": max(o, c) + 1, "l": min(o, c) - 1, "c": c, "v": 1000})
    return bars


@pytest.fixture
def world(monkeypatch):
    state = fx.install(monkeypatch, bars=_gap_bars())
    monkeypatch.setattr(sessions, "last_completed_session", lambda now=None: 20241231)
    return state


def _read(params, turn_id="t1"):
    return gw.read(hes.KIND, params, user_id=1, turn_id=turn_id)


def test_gap_pct_is_the_opening_gap_vs_the_previous_close_from_the_stored_opens(world):
    spec, err = sa.describe({"kind": "technical", "symbol": "QQQ", "indicator": "gap_pct"})
    assert err is None and spec["label"] == "QQQ opening gap vs the previous close (%)" and spec["unit"] == "percent_change"
    loaded = sa.load(spec)
    assert loaded["status"] == "ok" and loaded["rows"][0][0] == S[1]          # the first session has no previous close
    by = dict(loaded["rows"])
    assert by[S[30]] == pytest.approx(6.0) and by[S[80]] == pytest.approx(-7.0) and abs(by[S[31]]) < 0.2
    _spec, err = sa.describe({"kind": "technical", "symbol": "QQQ", "indicator": "gap_pct", "period": 5})
    assert err["reason"] == "bad_period"


def test_price_reads_daily_open_close_uses_the_same_read_only_loader(monkeypatch):
    from api.services import bars_fetch, bars_sanitize
    seen = {}
    monkeypatch.setattr(bars_sqlite, "get_bars_table_order", lambda t, tf, n, stop_at=None: seen.setdefault("get", (t, tf, n)) and [(20240102, 9.0, 11, 8, 10.0, 5), (20240103, 10.5, 12, 9, 11.0, 5)])
    real = bars_fetch._fmt_sqlite_bars

    def spy(rows, tf, ticker=None):
        seen["suppressed"] = bars_sanitize._suppress_warm.get()
        return real(rows, tf, None)
    monkeypatch.setattr(bars_fetch, "_fmt_sqlite_bars", spy)
    out = pr.daily_open_close("qqq")
    assert seen["get"] == ("QQQ", "D", pr.MAX_BARS) and seen["suppressed"] is True
    assert out["status"] == "ok" and out["rows"] == [("2024-01-02", 9.0, 10.0), ("2024-01-03", 10.5, 11.0)]


def test_the_kind_registers_historical_default_off_and_validates_before_admission(monkeypatch, world):
    d = {x["kind"]: x for x in gw.describe()}[hes.KIND]
    assert d["freshness"] == "historical" and d["max_symbols"] == 1
    monkeypatch.setenv(gw.KINDS_ENV, "quote")
    assert _read({"symbol": "QQQ", "indicator": "gap_pct", "op": "above", "threshold": 5})["status"] == "refused"
    assert world["price_calls"] == 0


@pytest.mark.parametrize("params,why", [
    ({"symbol": "q!", "indicator": "gap_pct", "op": "above", "threshold": 5}, "a valid ticker symbol is required"),
    ({"symbol": "QQQ", "indicator": "volume", "op": "above", "threshold": 5}, "indicator must be one of"),
    ({"symbol": "QQQ", "indicator": "gap_pct", "op": "over", "threshold": 5}, "op must be one of"),
    ({"symbol": "QQQ", "indicator": "gap_pct", "op": "above", "threshold": "5"}, "a numeric threshold is required"),
    ({"symbol": "QQQ", "indicator": "gap_pct", "period": 5, "op": "above", "threshold": 5}, "gap_pct takes no period"),
    ({"symbol": "QQQ", "indicator": "rsi", "op": "below", "threshold": 30}, "`period` must be a positive whole number"),
    ({"symbol": "QQQ", "indicator": "rsi", "period": 14, "op": "below", "threshold": 130}, "That threshold isn't a possible value"),
    ({"symbol": "QQQ", "indicator": "gap_pct", "op": "above", "threshold": 5, "horizons": [0]}, "each horizon is a whole number"),
    ({"symbol": "QQQ", "indicator": "gap_pct", "op": "above", "threshold": 5, "horizons": [1, 2, 3, 4, 5]}, "horizons must list 1 to 4"),
    ({"symbol": "QQQ", "indicator": "gap_pct", "op": "above", "threshold": 5, "since": "2024"}, "`since` must be a date"),
])
def test_bad_requests_are_refused_and_read_nothing(world, params, why):
    out = _read(params)
    assert out["status"] == "refused" and out["notes"][0].startswith(why), out["notes"]
    assert world["price_calls"] == 0 and world["breadth_calls"] == 0


def test_a_breadth_conditioned_study_is_refused_before_any_read(world):
    req = hes.study_request({"symbol": "QQQ", "indicator": "gap_pct", "op": "above", "threshold": 5})
    req["condition"]["series"] = {"kind": "breadth", "universe": "nasdaq", "metric": "pct_above_50sma"}
    ok, err = es.validate(req, allowed_kinds=hes.ALLOWED_SERIES_KINDS)
    assert ok is None and err["reason"] == "kind_not_enabled"
    assert hes.ALLOWED_SERIES_KINDS == ("technical",)
    assert world["breadth_calls"] == 0


def test_the_study_after_gaps_up_is_the_members_table_and_a_value_free_summary(world):
    out = _read({"symbol": "qqq", "indicator": "gap_pct", "op": "above", "threshold": 5, "horizons": [1, 5, 21]})
    assert env.validate_envelope(out) == [], out["notes"]
    assert out["status"] == "ok" and out["freshness"] == "historical" and out["source"] == hes.SOURCE
    assert out["provider_calls"] == 0 and out["as_of"] == "2024-12-31T21:00:00Z" and out["stale"] is False
    for n in (hes.NOTE_DESCRIPTIVE, hes.NOTE_COMPLETED, hes.NOTE_LOCAL, hes.NOTE_GAPS):
        assert n in out["notes"]
    d = out["data"]
    assert d["symbol"] == "QQQ"
    assert d["summary"]["events_used"] == 3 and d["summary"]["series_label"] == "QQQ opening gap vs the previous close (%)"
    assert d["summary"]["price_last"] == S[-1] and d["summary"]["small_sample"] is True
    assert [h["label"] for h in d["summary"]["horizons"]] == ["1 trading session", "5 trading sessions", "21 trading sessions"]
    # the summary is VALUE-FREE: no float anywhere in it
    assert not re.search(r"\d+\.\d+", json.dumps(d["summary"]))
    # the member's part carries the study's own text and table (every horizon a row)
    st = d["study"]
    assert st["lead"].startswith("QQQ opening gap vs the previous close (%) above +5.0%: 3 events between")
    assert [r["window"] for r in st["table"]["rows"]] == ["1 trading session", "5 trading sessions", "21 trading sessions"]
    assert [c["key"] for c in st["table"]["columns"]] == ["window", "n", "up", "mean", "median", "best", "worst", "baseline"]
    assert st["table"]["rows"][0]["n"] == "3" and st["table"]["rows"][0]["up"] == "100%"      # closes rise 0.1 a session
    assert "Past results do not predict future returns." in st["text"]
    assert isinstance(st["caveats"], list) and any("Small sample" in c for c in st["caveats"])
    assert d["request"]["horizons"] == [{"sessions": 1}, {"sessions": 5}, {"sessions": 21}] and d["request"]["start"] is None


def test_gaps_down_default_horizons_and_since(world):
    out = _read({"symbol": "QQQ", "indicator": "gap_pct", "op": "below", "threshold": -5, "since": "2024-03-01"})
    assert out["status"] == "ok"
    assert out["data"]["summary"]["events_used"] == 1 and out["data"]["request"]["start"] == "2024-03-01"
    assert [h["label"] for h in out["data"]["summary"]["horizons"]] == ["1 trading session", "5 trading sessions", "21 trading sessions"]


def test_a_stale_store_is_said_and_a_symbol_without_history_is_unavailable(world, monkeypatch):
    monkeypatch.setattr(sessions, "last_completed_session", lambda now=None: 20250106)
    out = _read({"symbol": "QQQ", "indicator": "gap_pct", "op": "above", "threshold": 5})
    assert out["stale"] is True and any("newest completed session is 2025-01-06" in n for n in out["notes"])
    world["bars"] = []
    out = _read({"symbol": "NOPE", "indicator": "gap_pct", "op": "above", "threshold": 5}, turn_id="t2")
    assert out["status"] == "unavailable" and env.validate_envelope(out) == []
    assert "UCT has no stored daily history" in out["notes"][0]


def test_rsi_and_pct_from_sma_conditions_run_through_the_same_adapter(world):
    out = _read({"symbol": "QQQ", "indicator": "pct_from_sma", "period": 10, "op": "above", "threshold": 0.3, "horizons": [5]})
    assert out["status"] == "ok" and out["data"]["summary"]["series_label"] == "QQQ % from its 10-day SMA"
    out = _read({"symbol": "QQQ", "indicator": "rsi", "period": 14, "op": "above", "threshold": 50, "horizons": [5]}, turn_id="t2")
    assert out["status"] in ("ok", "unavailable")


def _spike_bars():
    """Flat closes at 100 with two one-session closing highs (sessions 60 and 150): two N-day breakouts, nothing else."""
    out = []
    for i, d in enumerate(S):
        c = 110.0 if i == 60 else 120.0 if i == 150 else 100.0
        out.append({"t": d, "o": c, "h": c + 1, "l": c - 1, "c": c, "v": 1000})
    return out


def test_pct_from_high_is_the_close_vs_the_prior_n_day_closing_high(world):
    """PKG2: "after N-day breakouts" — the close against the highest close of the N sessions BEFORE it (never itself)."""
    world["bars"] = _spike_bars()
    spec, err = sa.describe({"kind": "technical", "symbol": "QQQ", "indicator": "pct_from_high", "period": 20})
    assert err is None and spec["label"] == "QQQ close vs its prior 20-day closing high (%)" and spec["domain"] == "signed"
    loaded = sa.load(spec)
    assert loaded["status"] == "ok" and loaded["rows"][0][0] == S[20]          # the first N sessions have no prior high
    by = dict(loaded["rows"])
    assert by[S[59]] == pytest.approx(0.0) and by[S[60]] == pytest.approx(10.0)
    assert by[S[61]] == pytest.approx(100 / 110 * 100 - 100) and by[S[81]] == pytest.approx(0.0)
    for bad in (None, 4, 253):
        _s, e = sa.describe({"kind": "technical", "symbol": "QQQ", "indicator": "pct_from_high", "period": bad})
        assert e["reason"] == "bad_period"


def test_a_breakout_study_counts_each_new_n_day_closing_high_once(world):
    world["bars"] = _spike_bars()
    out = _read({"symbol": "QQQ", "indicator": "pct_from_high", "period": 20, "op": "cross_above", "threshold": 0, "horizons": [5]})
    assert out["status"] == "ok", out["notes"]
    assert out["data"]["summary"]["events_used"] == 2
    assert out["data"]["summary"]["series_label"] == "QQQ close vs its prior 20-day closing high (%)"
    assert hes.validate({"symbol": "QQQ", "indicator": "pct_from_high", "op": "cross_above", "threshold": 0}) == "`period` must be a positive whole number"


# ── (3) local-only on the server ──────────────────────────────────────────────────────────────────────

def test_history_afterEvent_is_local_only_and_replays_as_a_value_free_note():
    assert "history.afterEvent" in turn.LOCAL_ONLY_ACTIONS
    row = {"role": "outcome", "text": "QQQ after gaps: up 3 of 3 (100%), average +0.41%",
           "data": {"kind": "answered", "actions": ["history.afterEvent"], "local": True,
                    "requests": [{"symbol": "QQQ", "indicator": "gap_pct", "period": None, "op": "above", "threshold": 5, "horizons": [1, 5, 21], "since": "2024-03-01"}]}}
    assert turn.is_local_row(row) is True
    text = turn.outcome_for_model(row)
    assert text.startswith(turn.LOCAL_RESULT_NOTE)
    assert "event study: every time QQQ opening gap vs the previous close (%) above 5, QQQ over 1 trading session, 5 trading sessions, 21 trading sessions" in text
    assert "2024-03-01" in text
    for v in ("100%", "+0.41", "3 of 3"):
        assert v not in text
    # a request that does not validate says nothing (never a guess)
    bad = {**row, "data": {**row["data"], "requests": [{"symbol": "QQQ", "indicator": "volume"}]}}
    assert turn.outcome_for_model(bad) == turn.LOCAL_RESULT_NOTE
