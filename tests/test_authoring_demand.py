"""L6, demand mining (Studio plan, section 7): what members asked Create Indicator for that it
could not build, RANKED BY DISTINCT MEMBERS, in the owner report and the daily digest.

Seeded through `indicator_telemetry.log_event`, the same door every recorded turn goes
through, so the allowlists apply to the seed exactly as they do in production.
"""
from __future__ import annotations

import json

import pytest

from api.services import auth_db
from api.services import indicator_support_loop as loop
from api.services import indicator_telemetry as tel


@pytest.fixture(autouse=True)
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth_test.db"))
    auth_db.init_db()
    mp = tmp_path / "doorNameCoverage.json"
    mp.write_text(json.dumps({"version": 1, "counts": {}, "names": {}}), encoding="utf-8")
    monkeypatch.setattr(loop, "DOOR_MANIFEST_PATH", mp)
    return tmp_path


def turn(uid, category=None, *, access="cohort", failure="concept_refused"):
    assert tel.log_event(uid, "converse_turn", access=access, disposition="unsupported",
                         failure_class=failure, unsupported_category=category) is True


def test_ranked_by_distinct_members_not_by_how_often_one_member_asked():
    for _ in range(9):
        turn("u-keen", "table")                       # one member, nine times
    for u in ("u-a", "u-b", "u-c"):
        turn(u, "other_symbol")                        # three members, once each
    turn("u-a", "fundamentals")
    d = tel.authoring_demand(7)
    # three members once each outrank one member nine times; between two one-member rows the
    # one asked more often comes first
    assert [(r["category"], r["members"], r["turns"]) for r in d["ranked"]] == [
        ("other_symbol", 3, 3), ("table", 1, 9), ("fundamentals", 1, 1)]
    assert [r["rank"] for r in d["ranked"]] == [1, 2, 3]


def test_a_tie_on_members_is_broken_by_turns_then_by_name():
    turn("u-a", "table"); turn("u-a", "table")
    turn("u-b", "fundamentals")
    turn("u-c", "drawing")
    d = tel.authoring_demand(7)
    assert [r["category"] for r in d["ranked"]] == ["table", "drawing", "fundamentals"]


def test_admins_count_but_are_also_shown_apart():
    turn("u-admin", "options", access="admin")
    turn("u-member", "options")
    (row,) = tel.authoring_demand(7)["ranked"]
    assert row["members"] == 2 and row["members_excluding_admins"] == 1


def test_the_unclassified_share_and_the_defect_signal_are_kept_apart():
    turn("u-a", "other"); turn("u-b", "other"); turn("u-c", "table"); turn("u-d", "table")
    turn("u-e", None, failure="model_invalid")        # tried and failed: not demand
    d = tel.authoring_demand(7)
    assert d["unclassified_share"] == 0.5
    assert d["could_not_produce"] == {"members": 1, "turns": 1}
    assert sum(r["turns"] for r in d["ranked"]) == 4   # the failed turn is not in the ranking


def test_nothing_recorded_is_an_empty_ranking_with_no_share():
    d = tel.authoring_demand(7)
    assert d["ranked"] == [] and d["unclassified_share"] is None and d["categories"] == 0


def test_a_category_outside_the_closed_set_never_reaches_the_ranking():
    # the allowlist refuses the value at write time, so the turn is stored without it
    tel.log_event("u-x", "converse_turn", access="cohort", failure_class="concept_refused",
                  unsupported_category="my secret strategy words")
    assert tel.authoring_demand(7)["ranked"] == []


def test_the_owner_report_carries_it():
    turn("u-a", "table")
    assert tel.rollout_report(7)["demand"]["ranked"][0]["category"] == "table"


def test_the_daily_digest_carries_it_and_its_post_names_it():
    for u in ("u-a", "u-b"):
        turn(u, "other_timeframe")
    d = loop.build_digest()
    assert d["authoring_demand"]["ranked"][0] == {
        "category": "other_timeframe", "members": 2, "members_excluding_admins": 2,
        "turns": 2, "last_day": d["authoring_demand"]["ranked"][0]["last_day"], "rank": 1}
    text = loop.discord_embed(d)["description"]
    assert "Create Indicator could not build, by members: other_timeframe (2)" in text


def test_the_digest_survives_when_demand_cannot_be_read(monkeypatch):
    def boom(*_a, **_k):
        raise RuntimeError("no telemetry today")
    monkeypatch.setattr(tel, "authoring_demand", boom)
    d = loop.build_digest()
    assert d["authoring_demand"] is None
    assert "Create Indicator" not in loop.discord_embed(d)["description"]
