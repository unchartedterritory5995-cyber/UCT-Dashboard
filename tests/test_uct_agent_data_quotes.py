"""MD-1 kinds `quote` / `quotes` (agent-md, Sprint 1 PR 1).

No network: massive's client and session helpers are stubbed. Pins the contract (valid envelopes, honest
as_of, live vs historical, provider_calls) and the one safety rule that matters most here: an Agent price
read never runs the alert check that /api/live-prices runs on a cache miss.
"""
from __future__ import annotations

import ast
import pathlib
import time
from types import SimpleNamespace

import pytest

from api.services import massive
from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import gateway as gw
from api.services.uct_agent.marketdata import quotes as q

_ROOT = pathlib.Path(__file__).resolve().parents[1]
NOW = time.time()


def _tick(sym, price=100.0, observed=NOW - 5, **extra):
    t = {"ticker": sym, "todaysChange": 1.5, "todaysChangePerc": 1.52,
         "day": {"o": 99.0, "h": 101.0, "l": 98.5, "c": price, "v": 123456},
         "prevDay": {"c": 98.5}, "lastTrade": {"p": price}, "_observed_at": observed}
    t.update(extra)
    return t


class _Client:
    def __init__(self, value=None, degraded=None, raises=None):
        self.value, self.degraded, self.raises, self.calls = value, degraded, raises, []

    def get_batch_quotes(self, tickers, *, entity_ids=None):  # noqa: ARG002
        self.calls.append(list(tickers))
        if self.raises:
            raise self.raises
        return SimpleNamespace(value=None if self.degraded else self.value, degraded=self.degraded)


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    # Freeze the clock the ADAPTER reads at the same instant every stamp is built from. `NOW` is taken at
    # import, and a full-suite run can reach these tests minutes later; without this the 60 s live budget
    # trips on wall-clock elapsed time, not on anything the adapter did (agent-lead, #579).
    monkeypatch.setattr(q, "time", SimpleNamespace(time=lambda: NOW))
    gw._reset_for_test(None)
    yield
    gw._reset_for_test(None)


def _market(monkeypatch, *, session="regular", client=None):
    monkeypatch.setattr(q, "_session", lambda now=None: session)
    monkeypatch.setattr(massive, "_get_client", lambda: client)
    return client


def _read(kind, params, turn="t1"):
    return gw.read(kind, params, user_id=1, turn_id=turn)


def test_both_kinds_register_with_declared_live_freshness():
    names = {d["kind"]: d for d in gw.describe()}
    assert names["quote"]["freshness"] == "live" and names["quote"]["owner"] == "agent-md"
    assert names["quote"]["max_symbols"] == 1
    assert names["quotes"]["freshness"] == "live" and names["quotes"]["max_symbols"] == gw.MAX_SYMBOLS_PER_READ


def test_quote_in_session_is_live_with_the_vendors_own_time(monkeypatch):
    c = _market(monkeypatch, client=_Client({"AAPL": _tick("AAPL", 187.25)}))
    out = _read("quote", {"symbol": "aapl"})
    assert env.validate_envelope(out) == []
    assert out["status"] == "ok" and out["freshness"] == "live" and out["source"] == "massive"
    assert out["stale"] is False and out["provider_calls"] == 1 and c.calls == [["AAPL"]]
    qd = out["data"]["quote"]
    assert qd["symbol"] == "AAPL" and qd["last"] == 187.25 and qd["prev_close"] == 98.5
    assert out["as_of"] == qd["as_of"] == env.utc_iso(__import__("datetime").datetime.fromtimestamp(
        NOW - 5, __import__("datetime").timezone.utc))
    assert "_observed_at" not in qd and "lastTrade" not in qd   # no raw provider payload


def test_an_old_quote_in_session_is_marked_stale(monkeypatch):
    _market(monkeypatch, client=_Client({"XYZ": _tick("XYZ", observed=NOW - 3600)}))
    out = _read("quote", {"symbol": "XYZ"})
    assert out["freshness"] == "live" and out["stale"] is True


@pytest.mark.parametrize("session,age", [("closed", 5), ("closed", 86_400), ("extended", 30 * 60)])
def test_outside_the_regular_session_it_is_historical_with_one_note(monkeypatch, session, age):
    _market(monkeypatch, session=session, client=_Client({"SPY": _tick("SPY", observed=NOW - age)}))
    out = _read("quote", {"symbol": "SPY"})
    assert env.validate_envelope(out) == []
    assert out["freshness"] == "historical" and out["stale"] is False and out["as_of"] is not None
    assert q.NOTE_CLOSED in out["notes"] and q.NOTE_EXTENDED not in out["notes"]   # never both


def test_extended_hours_with_a_recent_vendor_stamp_is_live_with_the_extended_note(monkeypatch):
    _market(monkeypatch, session="extended", client=_Client({"NVDA": _tick("NVDA", observed=NOW - 5 * 60)}))
    out = _read("quote", {"symbol": "NVDA"})
    assert env.validate_envelope(out) == []
    assert out["freshness"] == "live" and out["status"] == "ok" and out["stale"] is False
    assert q.NOTE_EXTENDED in out["notes"] and q.NOTE_CLOSED not in out["notes"]
    assert out["data"]["session"] == "extended"


def test_extended_hours_age_is_judged_on_the_oldest_live_stamp(monkeypatch):
    _market(monkeypatch, session="extended", client=_Client({
        "A": _tick("A", observed=NOW - 60), "B": _tick("B", observed=NOW - 20 * 60)}))
    out = _read("quotes", {"symbols": ["A", "B"]})
    assert out["freshness"] == "historical" and q.NOTE_CLOSED in out["notes"]


@pytest.mark.parametrize("tick,src", [
    ({}, "trade"),
    ({"lastTrade": {}}, "minute"),
    ({"lastTrade": {}, "min": {}}, "day_close"),
    ({"lastTrade": {}, "min": {}, "day": {"c": 0}}, "prev_close"),
])
def test_each_row_says_where_its_last_came_from(monkeypatch, tick, src):
    base = _tick("X")
    base["min"] = {"c": 100.0}
    base.update(tick)
    _market(monkeypatch, session="closed", client=_Client({"X": base}))
    row = _read("quote", {"symbol": "X"})["data"]["quote"]
    assert row["last_source"] == src and row["last"] is not None


def test_a_live_read_with_a_close_priced_row_is_partial_and_excludes_its_stamp(monkeypatch):
    stale_row = _tick("OLD", observed=NOW - 7200)
    stale_row["lastTrade"], stale_row["min"] = {}, {}
    _market(monkeypatch, client=_Client({"AAPL": _tick("AAPL", observed=NOW - 3), "OLD": stale_row}))
    out = _read("quotes", {"symbols": ["AAPL", "OLD"]})
    assert env.validate_envelope(out) == []
    assert out["freshness"] == "live" and out["status"] == "partial" and out["stale"] is False
    assert "no current trade for OLD — showing day_close" in out["notes"]
    assert out["as_of"] == out["data"]["quotes"][0]["as_of"]      # AAPL's stamp, not OLD's
    assert q.NOTE_SET_AS_OF_LIVE in out["notes"]


def test_regular_session_with_no_current_trade_at_all_is_historical(monkeypatch):
    t = _tick("HALT")
    t["lastTrade"], t["min"] = {}, {}
    _market(monkeypatch, client=_Client({"HALT": t}))
    out = _read("quote", {"symbol": "HALT"})
    assert out["freshness"] == "historical" and q.NOTE_NO_TRADES in out["notes"]
    assert q.NOTE_CLOSED not in out["notes"]


@pytest.mark.parametrize("ymd,hm,trading,want", [
    ("2025-12-02", (10, 0), True, "regular"), ("2025-12-02", (9, 29), True, "extended"),
    ("2025-12-02", (4, 0), True, "extended"), ("2025-12-02", (3, 59), True, "closed"),
    ("2025-12-02", (16, 0), True, "extended"), ("2025-12-02", (19, 59), True, "extended"),
    ("2025-12-02", (20, 0), True, "closed"), ("2025-11-28", (13, 30), True, "extended"),   # early close
    ("2025-11-28", (12, 59), True, "regular"), ("2025-11-29", (11, 0), False, "closed"),
])
def test_session_is_classified_from_the_et_clock_and_calendar(monkeypatch, ymd, hm, trading, want):
    from zoneinfo import ZoneInfo
    monkeypatch.setattr(massive, "_today_et_is_a_trading_day", lambda: trading)
    y, m, d = map(int, ymd.split("-"))
    now = __import__("datetime").datetime(y, m, d, *hm, tzinfo=ZoneInfo("America/New_York"))
    assert q._session(now) == want


def test_quotes_set_as_of_is_the_oldest_and_partial_names_the_missing(monkeypatch):
    c = _market(monkeypatch, client=_Client({"AAPL": _tick("AAPL", observed=NOW - 2),
                                             "MSFT": _tick("MSFT", observed=NOW - 40)}))
    out = _read("quotes", {"symbols": ["AAPL", "msft", "NOPE", "AAPL", "bad sym!"]})
    assert env.validate_envelope(out) == []
    assert c.calls == [["AAPL", "MSFT", "NOPE"]]                 # de-duplicated, invalid never sent
    assert out["status"] == "partial" and out["provider_calls"] == 1
    assert [r["symbol"] for r in out["data"]["quotes"]] == ["AAPL", "MSFT"]
    assert out["as_of"] == out["data"]["quotes"][1]["as_of"]     # MSFT, the older one
    notes = " | ".join(out["notes"])
    assert "no quote for: NOPE" in notes and "not a ticker symbol" in notes and q.NOTE_SET_AS_OF_LIVE in notes
    assert out["coverage"] == {"evaluated": 4, "answered": 2, "dropped": 2, "not_computable": 0}


def test_missing_observation_time_gives_null_as_of_with_a_note_and_stale(monkeypatch):
    _market(monkeypatch, client=_Client({"AAPL": _tick("AAPL", observed=None)}))
    out = _read("quote", {"symbol": "AAPL"})
    assert env.validate_envelope(out) == []
    assert out["as_of"] is None and out["stale"] is True
    assert any("no observation time" in n for n in out["notes"])


@pytest.mark.parametrize("client,calls", [(None, 0),
                                          (_Client(raises=RuntimeError("boom apiKey=SECRET")), 1),
                                          (_Client(degraded="cached_forbidden"), 0),
                                          (_Client({}), 1)])
def test_provider_failures_are_honest_unavailable(monkeypatch, client, calls):
    if client is None:
        monkeypatch.setattr(massive, "_get_client", lambda: (_ for _ in ()).throw(RuntimeError("no key")))
        monkeypatch.setattr(q, "_session", lambda now=None: "regular")
    else:
        _market(monkeypatch, client=client)
    out = _read("quote", {"symbol": "AAPL"})
    assert env.validate_envelope(out) == []
    assert out["status"] == "unavailable" and out["data"] is None and out["provider_calls"] == calls
    assert "SECRET" not in " ".join(out["notes"])


def test_bad_params_are_unavailable_without_a_provider_call(monkeypatch):
    c = _market(monkeypatch, client=_Client({}))
    for kind, params in [("quote", {"symbol": ""}), ("quotes", {"symbols": "AAPL"}), ("quotes", {"symbols": []})]:
        out = _read(kind, params)
        assert env.validate_envelope(out) == [] and out["status"] == "unavailable" and out["provider_calls"] == 0
    assert c.calls == []


def test_quote_refuses_more_than_one_symbol_and_quotes_more_than_fifty(monkeypatch):
    _market(monkeypatch, client=_Client({}))
    assert _read("quote", {"symbol": "A", "symbols": ["A", "B"]})["status"] == "refused"
    assert _read("quotes", {"symbols": [f"S{i}" for i in range(51)]})["status"] == "refused"


def test_dark_when_the_flag_is_off(monkeypatch):
    monkeypatch.delenv(gw.DATA_ENV)
    c = _market(monkeypatch, client=_Client({"AAPL": _tick("AAPL")}))
    assert _read("quote", {"symbol": "AAPL"})["status"] == "refused" and c.calls == []


# ── Price reads must never trigger alerts (MD-1 §4, §6.2) ─────────────────────────────────────────────

def test_a_price_read_never_runs_the_alert_check(monkeypatch):
    from api.services import watchlist_alert_service as was
    fired = []
    monkeypatch.setattr(was, "run_alert_check", lambda *a, **k: fired.append(a))
    _market(monkeypatch, client=_Client({"AAPL": _tick("AAPL"), "MSFT": _tick("MSFT")}))
    for i in range(3):
        assert _read("quotes", {"symbols": ["AAPL", "MSFT"]}, turn=f"t{i}")["status"] == "ok"
        assert _read("quote", {"symbol": "AAPL"}, turn=f"t{i}")["status"] == "ok"
    assert fired == []


def test_the_control_proves_the_alert_spy_can_fire(monkeypatch):
    """Non-vacuity: the same spy DOES see the call when something actually makes it."""
    from api.services import watchlist_alert_service as was
    fired = []
    monkeypatch.setattr(was, "run_alert_check", lambda *a, **k: fired.append(a))
    was.run_alert_check({"AAPL": {}})
    assert fired == [({"AAPL": {}},)]


def test_the_adapter_imports_neither_the_live_prices_route_nor_the_alert_service():
    src = (_ROOT / "api/services/uct_agent/marketdata/quotes.py").read_text(encoding="utf-8")
    mods = set()
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.ImportFrom) and node.module:
            mods.add(node.module)
            mods.update(f"{node.module}.{a.name}" for a in node.names)
        elif isinstance(node, ast.Import):
            mods.update(a.name for a in node.names)
    assert "api.services.massive" in mods                     # control: the walk sees real imports
    assert not any("live_prices" in m or "watchlist_alert" in m or "alert" in m.split(".")[-1] for m in mods)


def test_the_adapter_clock_is_frozen_so_age_is_independent_of_suite_runtime():
    """Control on the fixture: the adapter sees NOW, however long ago this module was imported."""
    assert q.time.time() == NOW


def test_the_contract_doc_states_the_same_notes_the_code_emits():
    """MD-1 v1.1 §4.1 quotes each note verbatim; QA pins fixtures to the doc, so the two must not drift."""
    doc = (_ROOT / "docs/agent/program/contracts/MD-1-market-data.md").read_text(encoding="utf-8")
    assert "(v1.1)" in doc.splitlines()[0]
    for note in (q.NOTE_EXTENDED, q.NOTE_CLOSED, q.NOTE_NO_TRADES, q.NOTE_SET_AS_OF, q.NOTE_SET_AS_OF_LIVE):
        assert note in doc, note
