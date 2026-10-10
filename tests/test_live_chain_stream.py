"""FT-015 / BRK-01: the streamed chain reads the OPRA consumer's own tables (api/live_chain_stream.py).

The consumer's tables are stood in by plain dicts; the real `massive_ws_worker` is never started and
no socket is opened.
"""
from __future__ import annotations

import ast
import pathlib
from collections import deque

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api import live_chain_stream as lcs

C100 = "O:TST261016C00100000"
P100 = "O:TST261016P00100000"
OTHER_EXP = "O:TST261023C00100000"
OTHER_ROOT = "O:TSTX261016C00100000"


@pytest.fixture
def tables(monkeypatch):
    prints = {C100: deque([(1_000_000_000, 2.4), (2_000_000_000, 2.5)], maxlen=50),
              OTHER_EXP: deque([(1_000_000_000, 9.0)]), OTHER_ROOT: deque([(1_000_000_000, 7.0)])}
    quotes = {C100: (2.45, 2.55, 3000), P100: (1.1, 1.2, 3100), OTHER_ROOT: (1.0, 2.0, 1)}
    monkeypatch.setattr(lcs, "_tables", lambda: (prints, quotes))
    monkeypatch.setattr(lcs, "_INDEX", lcs._Index())
    monkeypatch.setattr(lcs, "_CACHE", {})
    return prints, quotes


def test_prefix_and_key_agree_with_massive_contract_spelling():
    assert lcs.prefix_of("tst", "2026-10-16") == "O:TST261016"
    assert lcs._key_of(C100) == "O:TST261016"
    assert lcs._key_of(OTHER_ROOT) == "O:TSTX261016"
    assert lcs._key_of("AAPL") is None and lcs.prefix_of("TST", "10/16/2026") is None


def test_snapshot_carries_last_for_printed_contracts_and_quotes_for_the_pool_only(tables):
    rows = lcs.snapshot("O:TST261016", now=0.0)
    assert set(rows) == {C100, P100}                      # other expiry / other root excluded
    assert rows[C100] == {"last": 2.5, "last_ts": 2000, "bid": 2.45, "ask": 2.55, "quote_ts": 3000}
    assert rows[P100] == {"bid": 1.1, "ask": 1.2, "quote_ts": 3100}   # quoted, never printed


def test_the_index_grows_incrementally_and_rebuilds_when_the_session_clears(tables):
    prints, _ = tables
    lcs.snapshot("O:TST261016", now=0.0)
    new = "O:TST261016C00105000"
    prints[new] = deque([(5_000_000_000, 1.0)])
    assert new in lcs.snapshot("O:TST261016", now=10.0)
    prints.clear()                                         # the consumer's session-start clear
    prints[new] = deque([(6_000_000_000, 1.1)])
    rows = lcs.snapshot("O:TST261016", now=20.0)
    assert C100 not in rows or "last" not in rows[C100]
    assert rows[new]["last"] == 1.1


def test_diff_sends_only_what_moved():
    assert lcs.diff({"a": {"last": 1}}, {"a": {"last": 1}, "b": {"last": 2}}) == {"b": {"last": 2}}


def test_it_never_writes_the_consumers_tables(tables):
    prints, quotes = tables
    before = (dict(prints), dict(quotes))
    lcs.snapshot("O:TST261016", now=0.0)
    assert (dict(prints), dict(quotes)) == before


def test_the_partner_file_is_read_not_imported_for_writing():
    """This module may only read the consumer's two tables; it must never assign into them or
    subscribe. A static check over its own source."""
    src = (pathlib.Path(lcs.__file__)).read_text(encoding="utf-8")
    tree = ast.parse(src)
    for n in ast.walk(tree):
        if isinstance(n, (ast.Assign, ast.AugAssign)):
            for t in getattr(n, "targets", [getattr(n, "target", None)]):
                if isinstance(t, (ast.Subscript, ast.Attribute)):
                    base = t.value
                    while isinstance(base, (ast.Subscript, ast.Attribute)):
                        base = base.value
                    assert not (isinstance(base, ast.Name) and base.id == "mw"), ast.dump(t)
    assert '"action"' not in src and "websocket" not in src.lower()   # sends no subscribe message


@pytest.fixture
def client(tables, monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", "s3cret")
    app = FastAPI()
    app.include_router(lcs.router)
    return TestClient(app)


AUTH = {"Authorization": "Bearer s3cret"}


def test_routes_are_404_while_switched_off(client, monkeypatch):
    monkeypatch.delenv("OPTIONS_CHAIN_STREAM_ENABLED", raising=False)
    assert client.get("/api/live/massive/chain-quotes/TST?expiration=2026-10-16").status_code == 404
    assert client.get("/api/live/massive/chain-stream/TST?expiration=2026-10-16").status_code == 404


def test_chain_quotes_serves_the_rows_with_its_coverage_words(client, monkeypatch):
    monkeypatch.setenv("OPTIONS_CHAIN_STREAM_ENABLED", "1")
    r = client.get("/api/live/massive/chain-quotes/TST?expiration=2026-10-16", headers=AUTH)
    assert r.status_code == 200
    body = r.json()
    assert set(body["quotes"]) == {C100, P100}
    assert "60-second" in body["coverage"]
    assert client.get("/api/live/massive/chain-quotes/TST?expiration=bad", headers=AUTH).status_code == 422


def test_the_stream_route_is_at_capacity_in_words(client, monkeypatch):
    monkeypatch.setenv("OPTIONS_CHAIN_STREAM_ENABLED", "1")
    monkeypatch.setitem(lcs._SUBS, "n", lcs.MAX_SUBSCRIBERS)
    r = client.get("/api/live/massive/chain-stream/TST?expiration=2026-10-16", headers=AUTH)
    assert r.status_code == 503 and "keeps polling" in r.json()["detail"]


def test_the_default_source_names_tables_the_consumer_really_has():
    """Read by AST so the consumer is not imported (it would arm its own machinery)."""
    src = (pathlib.Path(lcs.__file__).resolve().parent / "massive_ws_worker.py").read_text(encoding="utf-8")
    names = {t.id for n in ast.parse(src).body if isinstance(n, (ast.Assign, ast.AnnAssign))
             for t in (n.targets if isinstance(n, ast.Assign) else [n.target]) if isinstance(t, ast.Name)}
    assert {"_RAW_T_HISTORY", "_nbbo_table"} <= names
    assert "MAX_Q_SUBSCRIPTIONS" in names            # control: the probe sees a sibling
