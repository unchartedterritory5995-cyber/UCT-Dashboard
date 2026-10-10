"""FT-034 shadow mode: the rating-change dark log (`rating_change_compare`).

Each outcome is driven from the real rule (`rating_change._new_actions`) against a
fake feed read twice, and the sweep is proved to fire nothing and deliver nothing.
"""
from __future__ import annotations

import pytest

from api.services.alert_taxonomy import db as at_db
from api.services.alert_taxonomy import dark_report
from api.services.alert_taxonomy import rating_change as rc
from api.services.alert_taxonomy import rating_change_compare as rcc


@pytest.fixture
def db(tmp_path, monkeypatch):
    path = str(tmp_path / "alert_taxonomy.db")
    monkeypatch.setattr(at_db, "DB_PATH", path)
    return path


def act(date, action="upgrade", company="Goldman Sachs", fg="Neutral", tg="Buy"):
    return {"date": date, "company": company, "action": action, "from_grade": fg, "to_grade": tg}


BASE = [act("2026-10-01", "maintain")]


def test_the_first_read_is_a_baseline_and_scores_nothing(db):
    t = rcc.observe("NVDA", [act("2026-10-01"), act("2026-09-30", "downgrade")], "2026-10-01", db_path=db)
    assert t == {"agreed": 0, "new_only": 0, "legacy_only": 0}
    rep = rcc.report(rcc.predicate_id_for("NVDA"), db_path=db)
    assert rep["status"] == "QUIET" and rep["sessions_covered"] == ["2026-10-01"]


def test_a_new_upgrade_that_stays_in_the_feed_is_AGREED(db):
    rcc.observe("NVDA", BASE, "2026-10-01", db_path=db)
    up = act("2026-10-02")
    assert rcc.observe("NVDA", [up] + BASE, "2026-10-02", db_path=db)["agreed"] == 0   # fired, pending
    t = rcc.observe("NVDA", [up] + BASE, "2026-10-05", db_path=db)
    assert t == {"agreed": 1, "new_only": 0, "legacy_only": 0}


def test_a_fired_action_that_VANISHES_from_the_feed_is_NEW_ONLY(db):
    rcc.observe("NVDA", BASE, "2026-10-01", db_path=db)
    rcc.observe("NVDA", [act("2026-10-02")] + BASE, "2026-10-02", db_path=db)
    t = rcc.observe("NVDA", BASE, "2026-10-05", db_path=db)               # the row was retracted
    assert t["new_only"] == 1 and t["agreed"] == 0


def test_a_backdated_upgrade_below_the_watermark_is_LEGACY_ONLY_once(db):
    rcc.observe("NVDA", [act("2026-10-02", "maintain")], "2026-10-02", db_path=db)
    late = act("2026-10-02", company="Morgan Stanley")                     # inserted later, same date
    feed = [act("2026-10-02", "maintain"), late]
    t1 = rcc.observe("NVDA", feed, "2026-10-05", db_path=db)
    t2 = rcc.observe("NVDA", feed, "2026-10-06", db_path=db)
    assert (t1["legacy_only"], t2["legacy_only"]) == (1, 0)


def test_CONTROL_a_maintain_is_not_a_rating_change_and_scores_nothing(db):
    rcc.observe("NVDA", BASE, "2026-10-01", db_path=db)
    t = rcc.observe("NVDA", [act("2026-10-02", "maintain")] + BASE, "2026-10-02", db_path=db)
    t2 = rcc.observe("NVDA", [act("2026-10-02", "maintain")] + BASE, "2026-10-05", db_path=db)
    assert t == t2 == {"agreed": 0, "new_only": 0, "legacy_only": 0}


def test_changing_the_actions_discards_into_not_comparable(db):
    rcc.observe("NVDA", BASE, "2026-10-01", db_path=db)
    up = act("2026-10-02")
    rcc.observe("NVDA", [up] + BASE, "2026-10-02", db_path=db)
    rcc.observe("NVDA", [up] + BASE, "2026-10-05", db_path=db)            # agreed 1
    rcc.observe("NVDA", [up] + BASE, "2026-10-06", actions=["upgrade"], db_path=db)
    rep = rcc.report(rcc.predicate_id_for("NVDA"), db_path=db)
    assert rep["agreed"] == 0 and rep["not_comparable"] == 1


def test_the_sweep_is_DARK_by_default_and_writes_nothing(db, monkeypatch):
    monkeypatch.delenv(rcc.FLAG, raising=False)
    out = rcc.run_dark_sweep(tickers=["NVDA"], fetch=lambda t: {"items": BASE}, db_path=db)
    assert out == {"enabled": False, "evaluated": 0, "could_not_evaluate": 0}
    assert rcc.heartbeat(db_path=db) is None


def test_the_armed_sweep_fires_nothing_and_delivers_nothing(db, monkeypatch):
    monkeypatch.setenv(rcc.FLAG, "1")
    from api.services.alert_taxonomy import delivery, receipts
    monkeypatch.setattr(receipts, "record_fire", lambda **k: pytest.fail("the shadow recorded a fire"))
    monkeypatch.setattr(delivery, "deliver", lambda *a, **k: pytest.fail("the shadow delivered"))
    feeds = {"NVDA": {"items": BASE}, "AAPL": {"error": "provider outage"}}
    out = rcc.run_dark_sweep(tickers=["NVDA", "AAPL"], fetch=lambda t: feeds[t], db_path=db,
                             now=1_759_500_000)
    assert out["enabled"] and out["evaluated"] == 1 and out["could_not_evaluate"] == 1
    assert rcc.heartbeat(db_path=db)["ticks"] == 1


def test_a_quiet_sweep_still_beats(db, monkeypatch):
    monkeypatch.setenv(rcc.FLAG, "1")
    rcc.run_dark_sweep(tickers=[], fetch=lambda t: {"items": []}, db_path=db)
    assert rcc.heartbeat(db_path=db)["ticks"] == 1


def test_the_rule_is_the_SHIPPED_one(db, monkeypatch):
    """The shadow calls rating_change._new_actions itself: break it and the shadow follows."""
    calls = []
    real = rc._new_actions
    monkeypatch.setattr(rc, "_new_actions", lambda *a, **k: calls.append(a) or real(*a, **k))
    rcc.observe("NVDA", BASE, "2026-10-01", db_path=db)
    rcc.observe("NVDA", [act("2026-10-02")] + BASE, "2026-10-02", db_path=db)
    assert calls, "the shadow did not consult the shipped rule"


def test_the_shadow_log_is_readable_through_dark_report(db):
    rcc.observe("NVDA", BASE, "2026-10-01", db_path=db)
    out = dark_report.dark_report("rating-change", db_path=db)
    assert out["table"] == "rating_change_comparison_spans"
    assert [p["predicate_id"] for p in out["predicates"]] == ["shadow:NVDA"]
