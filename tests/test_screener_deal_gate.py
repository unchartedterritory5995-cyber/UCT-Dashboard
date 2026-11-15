"""Every screener scan leaves out a pending acquisition (`query.deal_gate`).

Before this the buyout exclude set reached the screener ONLY through the universe file
`screener_universe.build_and_save` writes, and nothing runs that on a schedule. A deal
announced after the last rebuild stayed in the snapshot and every screen served it: on
2026-11-14 "Tight bases near highs" listed TECH, UTZ, HZO, SLN, ARX and ADT, all six in
the app's own pending set. A stock pinned at its deal price is the tightest base there is.
"""
from __future__ import annotations

import pytest

from api.services import deal_status

ROWS = [
    {"ticker": "AAA", "price": 10.0, "snapshot_date": "2026-11-13"},
    {"ticker": "TECH", "price": 55.0, "snapshot_date": "2026-11-13"},
    {"ticker": "BRK.B", "price": 480.0, "snapshot_date": "2026-11-13"},
    {"ticker": "ZZZ", "price": 20.0, "snapshot_date": "2026-11-13"},
]
ALL = {"AAA", "TECH", "BRK.B", "ZZZ"}
CONSULTED: list = []


@pytest.fixture
def snap(tmp_path, monkeypatch):
    from api.services.screener import snapshot_db as db
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    db.init_db()
    db.upsert_rows([dict(r) for r in ROWS])


@pytest.fixture
def deal(monkeypatch):
    """deal("off") | deal("on", {...}) | deal("broken")."""
    def set_(state, pend=frozenset()):
        CONSULTED.clear()
        if state == "off":
            monkeypatch.delenv("DEAL_STATUS_ENABLED", raising=False)

            def _never():
                CONSULTED.append(1)
                raise AssertionError("exclude set consulted with DEAL_STATUS_ENABLED off")
            monkeypatch.setattr(deal_status, "screener_excludes", _never)
            return
        monkeypatch.setenv("DEAL_STATUS_ENABLED", "1")
        if state == "broken":
            def _boom():
                raise RuntimeError("store unreadable")
            monkeypatch.setattr(deal_status, "screener_excludes", _boom)
        else:
            monkeypatch.setattr(deal_status, "screener_excludes", lambda: frozenset(pend))
    return set_


def _tickers(spec=None):
    from api.services.screener import query as Q
    return {r["ticker"] for r in Q.run_scan(spec or {"filters": [], "page_size": 50})["rows"]}


def test_a_pending_acquisition_is_left_out_of_every_scan(snap, deal):
    deal("on", {"TECH"})
    assert _tickers() == ALL - {"TECH"}
    # ...and out of a screen with criteria, not only the bare universe
    assert _tickers({"filters": [{"key": "price", "op": "gte", "min": 15}],
                     "page_size": 50}) == {"BRK.B", "ZZZ"}


def test_the_count_and_the_coverage_receipt_agree_with_the_rows(snap, deal):
    from api.services.screener import query as Q
    deal("on", {"TECH"})
    spec = {"filters": [], "page_size": 50}
    assert Q.preview_count(spec)["count"] == len(_tickers(spec)) == 3
    c = Q.coverage_for(spec)
    assert (c["evaluated"], c["answered"]) == (3, 3)


def test_a_class_share_matches_in_either_spelling(snap, deal):
    deal("on", {"BRK-B"})          # the set's spelling; the row is stored as BRK.B
    assert _tickers() == ALL - {"BRK.B"}


def test_with_the_flag_off_nothing_is_consulted_and_nothing_is_excluded(snap, deal):
    from api.services.screener import query as Q
    deal("off")
    assert Q.deal_gate() is None
    assert _tickers() == ALL
    assert CONSULTED == []


def test_a_fault_in_the_exclude_set_excludes_nothing(snap, deal):
    from api.services.screener import query as Q
    deal("broken")
    assert Q.deal_gate() is None
    assert _tickers() == ALL


def test_an_empty_exclude_set_adds_no_clause(snap, deal):
    from api.services.screener import query as Q
    deal("on", set())
    assert Q.deal_gate() is None
    assert _tickers() == ALL
