"""The two Compass flow tools: `get_options_flow` and `get_dark_pool`.

What this file holds:

  1. THE DEPENDENCIES ARE REAL. Each tool's reader is called with NOTHING
     patched at the import site, so a name that does not exist in the module it
     is imported from fails here, by name. (The readers' own network and
     database calls are replaced one level further down.)
  2. THREE ANSWERS, NEVER MIXED UP. No ticker named; the read failed
     (`unavailable: True`, logged by type); a quiet tape. A failure is never
     worded as "nothing there".
  3. THE DECLARED SHAPE AND A BOUNDED SIZE. `{flow, count}` and
     `{prints, count}`, capped text, at most five prints.
  4. ONE IMPLEMENTATION. The options tool answers with the line AI Search
     grounds on; the dark pool tool reads the store behind the Dark Pool page's
     ticker drill-down.
"""
from __future__ import annotations

import logging
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.services import voice_tool_impls as impls  # noqa: E402
from api.services import voice_tools  # noqa: E402


def _dispatch(name, args):
    return voice_tools.dispatch(name, args, user={"id": "u-flow-tools"})


# -- 1. the dependencies are real ------------------------------------------------

def test_the_options_reader_resolves_its_import_for_real(monkeypatch):
    """Only the HTTP read is replaced; `from api.routers.ai_search import ...`
    runs for real, so a missing name raises ImportError here."""
    from api.routers import ai_search
    ai_search._flow_ctx_memo.clear()
    monkeypatch.setattr(ai_search, "_read_flow_rows", lambda sym, source: [])
    assert impls._options_flow("ZZZZ") == ("", True)
    ai_search._flow_ctx_memo.clear()


def test_the_dark_pool_reader_resolves_its_import_for_real(monkeypatch):
    """Only the query is replaced; `from api.darkpool_db import ...` runs for real."""
    from api import darkpool_db
    seen = {}

    def fake(ticker, days=30, limit=30, order="date"):
        seen.update(ticker=ticker, days=days, limit=limit, order=order)
        return []

    monkeypatch.setattr(darkpool_db, "get_ticker_prints", fake)
    assert impls._dark_pool("NVDA", 3) == []
    assert seen == {"ticker": "NVDA", "days": impls.DARK_POOL_SESSIONS, "limit": 3, "order": "date"}


def test_neither_reader_swallows_a_missing_import():
    """A reader that caught ImportError would turn a broken wire back into a
    quiet 'nothing there'. Read off the code, not off a comment."""
    import ast
    import inspect
    import textwrap
    for fn in (impls._options_flow, impls._dark_pool):
        tree = ast.parse(textwrap.dedent(inspect.getsource(fn)))
        assert not [n for n in ast.walk(tree) if isinstance(n, ast.Try)], fn.__name__


# -- 2 + 3. options flow -----------------------------------------------------------

LINE = ("NVDA options flow today (UCT tape): 12 notable prints, $8.4M premium — call-heavy "
        "($7.0M calls / $1.4M puts, 61% at ask); largest: CALL $150 exp 12/19/2026 $2.10M")


def test_options_flow_answers_with_the_one_line_and_the_declared_shape(monkeypatch):
    asked = []
    monkeypatch.setattr(impls, "_options_flow", lambda sym: (asked.append(sym) or (LINE, True)))
    out = _dispatch("get_options_flow", {"symbol": " $nvda "})
    assert asked == ["NVDA"]
    assert out == {"flow": LINE, "count": 1}


def test_options_flow_text_is_bounded(monkeypatch):
    monkeypatch.setattr(impls, "_options_flow", lambda sym: ("x" * 5000, True))
    out = _dispatch("get_options_flow", {"symbol": "NVDA"})
    assert len(out["flow"]) == impls.FLOW_TOOL_TEXT_CAP


def test_options_flow_with_no_ticker_asks_for_one_and_reads_nothing(monkeypatch):
    def never(sym):
        raise AssertionError("no ticker was named; nothing may be read")
    monkeypatch.setattr(impls, "_options_flow", never)
    for args in ({}, {"symbol": ""}, {"symbol": "NVDA; DROP"}, {"symbol": "TOOLONGTICKER"}):
        assert _dispatch("get_options_flow", args) == {"flow": impls.FLOW_NEEDS_TICKER, "count": 0}


def test_a_quiet_tape_is_said_as_quiet(monkeypatch):
    monkeypatch.setattr(impls, "_options_flow", lambda sym: ("", True))
    out = _dispatch("get_options_flow", {"symbol": "ZZZZ"})
    assert out == {"flow": impls.FLOW_QUIET.format(sym="ZZZZ"), "count": 0}
    assert "unavailable" not in out


def test_a_failed_flow_read_is_unavailable_never_quiet(monkeypatch, caplog):
    monkeypatch.setattr(impls, "_options_flow", lambda sym: ("", False))
    caplog.set_level(logging.WARNING, logger=impls.__name__)
    out = _dispatch("get_options_flow", {"symbol": "NVDA"})
    assert out == {"flow": impls.FLOW_UNAVAILABLE, "count": 0, "unavailable": True}
    assert any("get_options_flow" in r.getMessage() for r in caplog.records)


def test_a_broken_flow_wire_is_logged_by_type_and_answered_unavailable(monkeypatch, caplog):
    def broken(sym):
        raise ImportError("cannot import name 'flow_ticker_line'")
    monkeypatch.setattr(impls, "_options_flow", broken)
    caplog.set_level(logging.WARNING, logger=impls.__name__)
    out = _dispatch("get_options_flow", {"symbol": "NVDA"})
    assert out == {"flow": impls.FLOW_UNAVAILABLE, "count": 0, "unavailable": True}
    msgs = [r.getMessage() for r in caplog.records]
    assert any("ImportError" in m for m in msgs), msgs
    assert not any("flow_ticker_line" in m for m in msgs), "the log carries the type, not the message"


def test_the_options_tool_reads_the_same_line_AI_Search_grounds_on(monkeypatch):
    """End to end over the real `flow_ticker_line`, with only the HTTP read replaced."""
    from api.routers import ai_search
    ai_search._flow_ctx_memo.clear()
    today = ai_search._et_day_mdyyyy()
    rows = [
        {"CreatedDate": today, "Premium": "2100000", "CallPut": "CALL", "Side": "ASK",
         "Strike": "150", "ExpirationDate": "12/19/2026"},
        {"CreatedDate": today, "Premium": "400000", "CallPut": "PUT", "Side": "BID",
         "Strike": "120", "ExpirationDate": "12/19/2026"},
    ]
    monkeypatch.setattr(ai_search, "_read_flow_rows",
                        lambda sym, source: rows if source == "stocks" else [])
    out = _dispatch("get_options_flow", {"symbol": "NVDA"})
    assert out["count"] == 1
    assert out["flow"] == ai_search._summarize_flow_rows("NVDA", rows, today)
    assert out["flow"].startswith("NVDA options flow today")
    ai_search._flow_ctx_memo.clear()

    # the same wire, failing: the tool says unavailable, not quiet
    monkeypatch.setattr(ai_search, "_read_flow_rows", lambda sym, source: None)
    out = _dispatch("get_options_flow", {"symbol": "NVDA"})
    assert out == {"flow": impls.FLOW_UNAVAILABLE, "count": 0, "unavailable": True}
    ai_search._flow_ctx_memo.clear()


# -- 2 + 3. dark pool ----------------------------------------------------------------

PRINTS = [
    {"date": "11/14", "dateLong": "Nov 14, 2026", "dateRaw": "11/14/2026", "price": 128.5,
     "notional": 12_500_000.0, "pctAvgVol": 350.0, "volume": 97_276.0, "type": "B"},
    {"date": "11/13", "dateLong": "Nov 13, 2026", "dateRaw": "11/13/2026", "price": 127.0,
     "notional": 6_000_000.0, "pctAvgVol": None, "volume": None, "type": ""},
    {"date": "11/12", "dateLong": "Nov 12, 2026", "dateRaw": "11/12/2026", "price": None,
     "notional": 5_000_000.0, "pctAvgVol": None, "volume": 0.0, "type": ""},
]


def test_dark_pool_lists_the_prints_in_the_declared_shape(monkeypatch):
    asked = []
    monkeypatch.setattr(impls, "_dark_pool",
                        lambda sym, limit: (asked.append((sym, limit)) or PRINTS[:limit]))
    out = _dispatch("get_dark_pool", {"symbol": "uber", "count": 2})
    assert asked == [("UBER", 2)]
    assert set(out) == {"prints", "count"} and out["count"] == 2
    assert out["prints"] == ("UBER dark pool prints, newest first: "
                             "11/14 $12.5M at $128.50 (97,276 shares); 11/13 $6.0M at $127.00")


def test_a_missing_number_is_left_out_never_written_as_zero(monkeypatch):
    monkeypatch.setattr(impls, "_dark_pool", lambda sym, limit: PRINTS[2:3])
    out = _dispatch("get_dark_pool", {"symbol": "UBER"})
    assert out["prints"].endswith("11/12 $5.0M")
    assert " 0 " not in out["prints"] and "$0" not in out["prints"]


@pytest.mark.parametrize("asked,want", [(None, 3), (0, 3), (1, 1), (5, 5), (99, 5), (-4, 1), ("x", 3)])
def test_dark_pool_count_is_bounded(monkeypatch, asked, want):
    seen = []
    monkeypatch.setattr(impls, "_dark_pool", lambda sym, limit: (seen.append(limit) or PRINTS * 4))
    out = _dispatch("get_dark_pool", {"symbol": "UBER", "count": asked})
    assert seen == [want]
    assert out["count"] <= impls.DARK_POOL_MAX_PRINTS and out["count"] == want
    assert len(out["prints"]) <= impls.FLOW_TOOL_TEXT_CAP


def test_dark_pool_with_no_ticker_asks_for_one_and_reads_nothing(monkeypatch):
    def never(sym, limit):
        raise AssertionError("no ticker was named; nothing may be read")
    monkeypatch.setattr(impls, "_dark_pool", never)
    for args in ({}, {"symbol": ""}, {"symbol": "../x"}):
        assert _dispatch("get_dark_pool", args) == {"prints": impls.DARK_POOL_NEEDS_TICKER, "count": 0}


def test_no_print_on_record_is_said_as_none_on_record(monkeypatch):
    monkeypatch.setattr(impls, "_dark_pool", lambda sym, limit: [])
    out = _dispatch("get_dark_pool", {"symbol": "ZZZZ"})
    assert out == {"prints": impls.DARK_POOL_QUIET.format(sym="ZZZZ", days=impls.DARK_POOL_SESSIONS),
                   "count": 0}


def test_a_failed_dark_pool_read_is_logged_by_type_and_answered_unavailable(monkeypatch, caplog):
    def broken(sym, limit):
        raise ImportError("cannot import name 'get_ticker_prints'")
    monkeypatch.setattr(impls, "_dark_pool", broken)
    caplog.set_level(logging.WARNING, logger=impls.__name__)
    out = _dispatch("get_dark_pool", {"symbol": "UBER"})
    assert out == {"prints": impls.DARK_POOL_UNAVAILABLE, "count": 0, "unavailable": True}
    msgs = [r.getMessage() for r in caplog.records]
    assert any("ImportError" in m for m in msgs), msgs


def test_the_dark_pool_tool_reads_the_store_end_to_end(monkeypatch, tmp_path):
    """Over the real `darkpool_db.get_ticker_prints` and a seeded store."""
    from api import darkpool_db
    monkeypatch.setattr(darkpool_db, "DB_DIR", str(tmp_path), raising=True)
    monkeypatch.setattr(darkpool_db, "DB_PATH", str(tmp_path / "darkpool.db"), raising=True)
    darkpool_db.init_db()
    conn = darkpool_db.get_conn()
    try:
        cols = [r[1] for r in conn.execute("PRAGMA table_info(darkpool_trades)")]
        base = {c: None for c in cols if c not in ("id", "created_at")}
        for date, price, notional, volume in (("11/13/2026", 127.0, 6_000_000.0, 47_244.0),
                                              ("11/14/2026", 128.5, 12_500_000.0, 97_276.0)):
            row = dict(base, ticker="UBER", date=date, timestamp="15:59:00", price=price,
                       notional=notional, volume=volume, type="B")
            conn.execute(f"INSERT INTO darkpool_trades ({', '.join(row)}) "
                         f"VALUES ({', '.join('?' for _ in row)})", list(row.values()))
        conn.commit()
    finally:
        conn.close()
    out = _dispatch("get_dark_pool", {"symbol": "UBER", "count": 5})
    assert out["count"] == 2
    assert out["prints"] == ("UBER dark pool prints, newest first: "
                             "11/14 $12.5M at $128.50 (97,276 shares); "
                             "11/13 $6.0M at $127.00 (47,244 shares)")


# -- the registry -----------------------------------------------------------------

def test_both_tools_are_registered_with_a_ticker_parameter():
    schema = {t["name"]: t for t in voice_tools.get_schema_for_context("global")}
    for name in ("get_options_flow", "get_dark_pool"):
        assert name in schema, name
        assert "symbol" in schema[name]["parameters"]["properties"]
        assert "ticker" in schema[name]["description"].lower()
