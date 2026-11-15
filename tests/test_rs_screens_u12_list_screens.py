"""RS screens unit U12, item W3.1: which of the five screens are LISTS.

``row.list`` is true on the four screens a stock qualifies for by passing rules (Top RS
Rating, RS New Highs, RS New High Before Price, UCT RS Leaders) and absent on RS exit
warnings. The client shows two things only on a list screen: the first-visit line ("The
strongest liquid stocks, ranked...", which is not what a list of warnings is) and, since
item W3.3, "Why isn't a stock here?".

Why the rail exists: the client never reads a screen's id, so what makes a screen a list
has to be data the server sends, and it has to stay off the one screen it is not true of.
"""
from __future__ import annotations

import pytest

from api.services.screener import query, rs_screens, saved_screens, snapshot_db

LIST_SCREENS = ("starter_rs_top_rating", "starter_rs_new_high", "starter_rs_nh_before_price",
                "starter_rs_leaders")
EXIT_WARNINGS = "starter_rs_exit_warning_5"


@pytest.fixture(autouse=True)
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    monkeypatch.setenv("RS_SCREENS_ENABLED", "1")
    snapshot_db.init_db()
    query._STALE_GATE_MEMO = None
    yield
    query._STALE_GATE_MEMO = None


def _starters(monkeypatch):
    from api.services.signature import registry_defs
    monkeypatch.setattr(registry_defs, "RS_V2_ENABLED", True)
    return {s["id"]: s for s in saved_screens.starters()}


# ───────────────────────── 1. which screens are lists ─────────────────────────

def test_the_four_list_screens_say_so_and_rs_exit_warnings_does_not(monkeypatch):
    by = _starters(monkeypatch)
    for sid in LIST_SCREENS:
        assert by[sid]["row"]["list"] is True, sid
    assert "list" not in by[EXIT_WARNINGS]["row"], "RS exit warnings is not a list a stock qualifies for"
    assert rs_screens.LIST_SCREENS == LIST_SCREENS
    # nothing else in the payload carries the key
    assert [s["id"] for s in by.values() if (s.get("row") or {}).get("list")] == list(LIST_SCREENS)
    # every list screen leaves the buyout names out, and only a list screen does
    assert rs_screens.LIST_SCREENS == rs_screens.NO_BUYOUT_SCREENS


def test_the_key_is_added_fresh_each_time(monkeypatch):
    a = rs_screens.screens()
    a[0]["row"]["list"] = "changed"
    assert rs_screens.screens()[0]["row"]["list"] is True


def test_nothing_carries_the_key_while_the_screens_are_off(monkeypatch):
    from api.services.signature import registry_defs
    monkeypatch.setattr(registry_defs, "RS_V2_ENABLED", True)
    monkeypatch.delenv("RS_SCREENS_ENABLED", raising=False)
    assert not [s["id"] for s in saved_screens.starters() if "row" in s]
