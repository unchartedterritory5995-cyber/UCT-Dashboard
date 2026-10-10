"""NAAIM read on the server from public discussion (`api/services/breadth_naaim.py`).

The rules are the PC collector's `naaim_chatter.py`, ported; these cases pin the guards
that make it return None rather than a wrong number. No network.
"""
from __future__ import annotations

import pytest

from api.services import breadth_naaim as nm


def _tw(user, text):
    return {"author": {"userName": user}, "text": text, "id": f"{user}:{text}"}


def test_extract_needs_an_anchor_and_decimals():
    assert nm.extract("NAAIM exposure index at 79.70 this week") == {79.7}
    assert nm.extract("NAAIM at 80 this week") == set()                    # no decimals
    assert nm.extract("SPY closed at 612.45") == set()                      # no anchor
    assert nm.extract("NAAIM fell to 79.70 from 84.02") == {79.7}           # "from X" dropped
    assert nm.extract("NAAIM 84.02", prior=84.02) == set()                  # last week


def test_consensus_needs_two_accounts_or_a_trusted_one():
    two = [_tw("a", "NAAIM 79.70"), _tw("b", "naaim exposure index 79.7")]
    assert nm.consensus(two)[0] == 79.7
    one = [_tw("a", "NAAIM 79.70")]
    assert nm.consensus(one)[0] is None
    assert nm.consensus([_tw("isabelnet_sa", "NAAIM 79.70")])[0] == 79.7
    assert nm.consensus(one, web=79.7)[0] == 79.7                           # + web confirm
    assert nm.consensus(two, web=81.2)[0] is None                           # web contradicts


def test_a_tie_returns_nothing():
    tie = [_tw("a", "NAAIM 79.70"), _tw("b", "NAAIM 79.70"),
           _tw("c", "NAAIM 85.10"), _tw("d", "NAAIM 85.10")]
    value, _, note = nm.consensus(tie)
    assert value is None and "tie" in note


def test_latest_reading_walks_back_a_week_when_this_one_is_silent():
    weeks = []

    def fetch(wk):
        weeks.append(wk)
        return [] if wk == "2026-10-07" else [_tw("a", "NAAIM 86.76"), _tw("b", "NAAIM 86.76")]

    got = nm.latest_reading(week="2026-10-07", fetch=fetch, web=lambda wk: None)
    assert got == (86.76, "2026-09-30") and weeks == ["2026-10-07", "2026-09-30"]


def test_fill_records_the_series_and_the_rows_after_publication(monkeypatch):
    from api.services import breadth_monitor as bm
    from api.services.market_indicators import naaim_store
    monkeypatch.setattr(nm, "prior_reading", lambda: (76.99, "2026-09-30"))
    ingested = []
    monkeypatch.setattr(naaim_store, "ingest",
                        lambda v, observed_on=None, source=None: ingested.append((v, observed_on))
                        or {"accepted": True})
    rows = [{"date": "2026-10-07", "naaim": 76.99, "naaim_date": "2026-09-30"},  # before publish
            {"date": "2026-10-08", "naaim": 76.99, "naaim_date": "2026-09-30"},  # stale
            {"date": "2026-10-09", "naaim": 86.76, "naaim_date": "2026-10-07"}]  # current
    patched = {}
    monkeypatch.setattr(bm, "get_history", lambda n: rows)
    monkeypatch.setattr(bm, "patch_fields", lambda d, f: patched.setdefault(d, f) is not None)
    out = nm.fill(reading=(86.76, "2026-10-07"))
    assert ingested == [(86.76, "2026-10-07")]
    assert out["fixed"] == ["2026-10-08"]
    assert patched["2026-10-08"] == {"naaim": 86.76, "naaim_date": "2026-10-07"}


def test_fill_without_keys_writes_nothing(monkeypatch):
    from api.services import breadth_monitor as bm
    monkeypatch.delenv("TWITTERAPI_IO_API_KEY", raising=False)
    monkeypatch.delenv("PERPLEXITY_API_KEY", raising=False)
    monkeypatch.setattr(nm, "prior_reading", lambda: None)
    nm._DONE.clear()
    monkeypatch.setattr(bm, "patch_fields", lambda *a: pytest.fail("must not write"))
    assert nm.fill()["ok"] is False
