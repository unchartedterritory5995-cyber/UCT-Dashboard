"""The READ half of a snapshot rewrite, and who is allowed to make it.

A maintenance job holds the PUSH_SECRET bearer and no member account. It could
already rewrite any field on a snapshot (`PATCH /{date}/field`) but had no way
to READ the list it was about to rewrite: `get_history` strips the `*_list`
keys, and the per-key drill GET is gated on a member session. So the one caller
that must do read-modify-write was the one caller that could not read.

That gap is why every stored drill list carried % change at ONE decimal for
months with no way to refine it in place — the collector could compute the
missing digit but not fetch the rows to put it on.
"""
from __future__ import annotations

import json
import sqlite3

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import breadth_monitor as bm

SECRET = "worker-secret-for-tests"
DATE = "2026-09-04"


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path, monkeypatch):
    monkeypatch.setattr(bm, "_db_path", lambda: str(tmp_path / "breadth.db"))

    class _NoCache:
        def get(self, *_a, **_k):
            return None

        def set(self, *_a, **_k):
            pass

        def delete_prefix(self, *_a, **_k):
            pass

    import api.services.cache as cache_mod
    monkeypatch.setattr(cache_mod, "cache", _NoCache())
    bm.init_db()
    yield


def _seed(date_str=DATE, metrics=None):
    m = metrics if metrics is not None else {
        "universe_count": 3,
        "down_4pct_today": 2,
        "down_4pct_today_list": [
            {"t": "GWRE", "pct": -19.9, "c": 162.42, "vr": 3.9},
            {"t": "LULU", "pct": -17.4, "c": 100.61, "vr": 8.6},
        ],
        "up_4pct_today_list": [{"t": "AAA", "pct": 4.4, "c": 10.0}],
        "universe_list": [{"t": "AAA", "pct": 4.4}, {"t": "GWRE", "pct": -19.9}],
    }
    with sqlite3.connect(bm._db_path()) as c:
        c.execute("INSERT OR REPLACE INTO breadth_snapshots (date, metrics) VALUES (?, ?)",
                  (date_str, json.dumps(m)))
    return m


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", SECRET)
    from api.routers import breadth_monitor as rt
    # ⛔ TWO GATES, TWO LIFETIMES. `require_push_secret` reads the environment on
    # every REQUEST, so setenv alone is enough for it. `_check_auth` — which the
    # PATCH beside it still ships on — reads the module global `_PUSH_SECRET`
    # frozen at IMPORT. Setting only the env passed this file alone and returned
    # 500 the moment any earlier test in the process had imported the router
    # first: green alone, red in company.
    monkeypatch.setattr(rt, "_PUSH_SECRET", SECRET)
    app = FastAPI()
    app.include_router(rt.router)
    return TestClient(app)


AUTH = {"Authorization": f"Bearer {SECRET}"}


# ── the service ──────────────────────────────────────────────────────────────

def test_it_returns_every_list_key_and_nothing_else():
    _seed()
    out = bm.get_snapshot_lists(DATE)
    assert set(out) == {"down_4pct_today_list", "up_4pct_today_list", "universe_list"}
    assert out["down_4pct_today_list"][0]["t"] == "GWRE"


def test_keys_narrows_the_response():
    _seed()
    out = bm.get_snapshot_lists(DATE, ["universe_list"])
    assert set(out) == {"universe_list"}


def test_an_unknown_key_is_simply_absent_not_an_error():
    _seed()
    assert bm.get_snapshot_lists(DATE, ["not_a_real_list"]) == {}


def test_a_date_with_no_snapshot_is_None_and_a_snapshot_with_no_lists_is_empty():
    """The caller SKIPS a missing date and PATCHES an empty one — two different
    actions, so the two cases must not answer the same thing."""
    _seed("2026-09-03", metrics={"universe_count": 10})     # a row, no lists
    assert bm.get_snapshot_lists("2026-09-03") == {}
    assert bm.get_snapshot_lists("2026-01-01") is None      # no row at all


# ── the route ────────────────────────────────────────────────────────────────

def test_the_worker_bearer_reads_the_lists(client):
    _seed()
    r = client.get(f"/api/breadth-monitor/{DATE}/lists", headers=AUTH)
    assert r.status_code == 200
    body = r.json()
    assert body["date"] == DATE
    assert body["lists"]["down_4pct_today_list"][1]["t"] == "LULU"


def test_keys_param_narrows_the_route_response(client):
    _seed()
    r = client.get(f"/api/breadth-monitor/{DATE}/lists",
                   params={"keys": "universe_list,up_4pct_today_list"}, headers=AUTH)
    assert set(r.json()["lists"]) == {"universe_list", "up_4pct_today_list"}


@pytest.mark.parametrize("headers", [
    {},
    {"Authorization": "Bearer wrong"},
    {"Authorization": SECRET},          # no "Bearer " prefix
])
def test_it_refuses_anyone_without_the_worker_bearer(client, headers):
    _seed()
    r = client.get(f"/api/breadth-monitor/{DATE}/lists", headers=headers)
    assert r.status_code == 401


def test_a_blank_secret_refuses_everybody_rather_than_matching_an_empty_bearer(monkeypatch):
    """⛔ THE FAILURE DIRECTION IS CLOSED. An unset PUSH_SECRET must not turn
    `Authorization: Bearer ` into a valid credential."""
    monkeypatch.setenv("PUSH_SECRET", "")
    from api.routers import breadth_monitor as rt
    app = FastAPI()
    app.include_router(rt.router)
    c = TestClient(app)
    _seed()
    assert c.get(f"/api/breadth-monitor/{DATE}/lists",
                 headers={"Authorization": "Bearer "}).status_code == 401


def test_a_date_with_no_snapshot_is_404_so_a_patch_can_skip_it(client):
    r = client.get("/api/breadth-monitor/2026-01-01/lists", headers=AUTH)
    assert r.status_code == 404


def test_a_malformed_date_is_rejected_before_any_lookup(client):
    r = client.get("/api/breadth-monitor/not-a-date/lists", headers=AUTH)
    assert r.status_code == 400


# ── the loop the collector actually runs ─────────────────────────────────────

def test_read_modify_write_round_trips_through_the_patch_route(client):
    """⭐ THE WHOLE POINT. Read a stored list, put the second decimal back on it,
    PATCH it, read it again — the exact sequence `--patch-pct-precision` runs.
    Testing the GET alone would leave the loop unproven at its seam."""
    _seed()
    got = client.get(f"/api/breadth-monitor/{DATE}/lists",
                     params={"keys": "down_4pct_today_list"}, headers=AUTH).json()
    items = got["lists"]["down_4pct_today_list"]
    assert [i["pct"] for i in items] == [-19.9, -17.4]

    for item, refined in zip(items, [-19.94, -17.43]):
        item["pct"] = refined
    patched = client.patch(f"/api/breadth-monitor/{DATE}/field", headers=AUTH,
                           json={"key": "down_4pct_today_list", "value": items})
    assert patched.status_code == 200

    back = client.get(f"/api/breadth-monitor/{DATE}/lists",
                      params={"keys": "down_4pct_today_list"}, headers=AUTH).json()
    rows = back["lists"]["down_4pct_today_list"]
    assert [i["pct"] for i in rows] == [-19.94, -17.43]
    # Everything else on the row survived the rewrite untouched.
    assert [i["t"] for i in rows] == ["GWRE", "LULU"]
    assert [i["c"] for i in rows] == [162.42, 100.61]
    assert [i["vr"] for i in rows] == [3.9, 8.6]
    # And the patch touched ONE key — the neighbouring lists are unchanged.
    assert client.get(f"/api/breadth-monitor/{DATE}/lists", headers=AUTH
                      ).json()["lists"]["universe_list"] == [
        {"t": "AAA", "pct": 4.4}, {"t": "GWRE", "pct": -19.9}]
