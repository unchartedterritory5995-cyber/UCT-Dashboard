"""TERM-073 (FB-A4-01) -- the member half of the analyst revision timeline.

`GET /api/research/analyst-revisions/{ticker}` over `analyst_pass`'s retained,
append-only `analyst_timeline`. FB-A4-01's acceptance: "the day it holds two
dated snapshots it can answer what changed; the surface's first assertion is that
two snapshots with identical values render as NO revision, not as a flat line."
Driven through the REAL timeline writer into a temporary store.
"""
from __future__ import annotations

import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.middleware.auth_middleware import (  # noqa: E402
    get_current_user as _get_current_user,
    get_current_user_with_plan as _get_current_user_with_plan,
)
from api.services.research import analyst_revisions as svc  # noqa: E402
from api.services.screener import analyst_pass  # noqa: E402
from tests.authclients import FREE_MEMBER, PAID_MEMBER, signed_in_as  # noqa: E402

FLAG = "ANALYST_REVISIONS_ENABLED"
FASTAPI_404 = b'{"detail":"Not Found"}'
ROW = {"consensus": "Buy", "pt_target": 150.0, "upgrades_30d": 2,
       "downgrades_30d": 0, "eps_next_y_growth": 0.12}


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_ANALYST_DB_PATH", str(tmp_path / "screener_analyst.db"))
    analyst_pass.init_db()

    def put(ticker, pass_date, fetched_at, **over):
        analyst_pass.append_timeline(ticker, {**ROW, **over}, fetched_at=fetched_at,
                                     pass_date=pass_date)
    return put


@pytest.fixture(scope="module")
def app():
    from api.main import app as real_app
    return real_app


@pytest.fixture
def client(app):
    yield TestClient(app, raise_server_exceptions=False)
    for dep in (_get_current_user, _get_current_user_with_plan):
        app.dependency_overrides.pop(dep, None)


# ── the answer ──────────────────────────────────────────────────────────────

def test_two_IDENTICAL_snapshots_are_no_revision_not_a_flat_line(store):
    store("NVDA", "2026-09-28", 1_790_000_000)
    store("NVDA", "2026-09-29", 1_790_086_400)
    out = svc.revision_history("nvda")
    assert out["status"] == "no_revision"
    assert out["revisions"] == []
    assert out["observations"] == 2
    assert out["window"] == {"first": "2026-09-28", "last": "2026-09-29"}


def test_a_changed_field_is_named_with_from_and_to(store):
    store("NVDA", "2026-09-28", 1_790_000_000)
    store("NVDA", "2026-09-29", 1_790_086_400)
    store("NVDA", "2026-09-30", 1_790_172_800, pt_target=165.0, consensus="Strong Buy")
    out = svc.revision_history("NVDA")
    assert out["status"] == "revised"
    assert out["revisions"] == [{
        "from_date": "2026-09-29", "to_date": "2026-09-30",
        "changes": {"consensus": {"from": "Buy", "to": "Strong Buy"},
                    "pt_target": {"from": 150.0, "to": 165.0}},
    }]


def test_one_snapshot_is_no_history_and_says_so(store):
    store("AMD", "2026-09-30", 1_790_172_800)
    out = svc.revision_history("AMD")
    assert out["status"] == "no_history" and out["observations"] == 1
    assert svc.revision_history("ZZZZ")["status"] == "no_history"
    assert svc.revision_history("ZZZZ")["window"] is None


def test_the_method_ships_with_the_number(store):
    """PROD-C5: window, source and the contributor set travel with every answer;
    the contributor count is not retained, so it is None and SAYS so."""
    store("NVDA", "2026-09-28", 1_790_000_000)
    out = svc.revision_history("NVDA")
    assert out["source"] and out["window"] and "observations" in out
    assert out["contributors"] is None
    assert "does not retain" in out["contributors_note"]


def test_the_answer_reads_the_retained_fields_the_pass_writes():
    """The labelled fields ARE the timeline's fields -- one list, not a restatement."""
    assert tuple(svc.FIELD_LABELS) == analyst_pass._TIMELINE_FIELDS


# ── the door ────────────────────────────────────────────────────────────────

def test_dark_by_default_answers_404_to_a_paid_member(client, monkeypatch):
    monkeypatch.delenv(FLAG, raising=False)
    with signed_in_as(PAID_MEMBER):
        r = client.get("/api/research/analyst-revisions/NVDA")
    assert r.status_code == 404 and r.content == FASTAPI_404


def test_armed_it_is_paid_only(client, monkeypatch, store):
    monkeypatch.setenv(FLAG, "1")
    store("NVDA", "2026-09-28", 1_790_000_000)
    store("NVDA", "2026-09-29", 1_790_086_400)
    with signed_in_as(FREE_MEMBER):
        assert client.get("/api/research/analyst-revisions/NVDA").status_code == 402
    with signed_in_as(PAID_MEMBER):
        r = client.get("/api/research/analyst-revisions/NVDA")
    assert r.status_code == 200 and r.json()["status"] == "no_revision"


def test_the_flag_is_read_per_request(client, monkeypatch, store):
    store("NVDA", "2026-09-28", 1_790_000_000)
    with signed_in_as(PAID_MEMBER):
        monkeypatch.setenv(FLAG, "1")
        assert client.get("/api/research/analyst-revisions/NVDA").status_code == 200
        monkeypatch.setenv(FLAG, "0")
        assert client.get("/api/research/analyst-revisions/NVDA").status_code == 404
