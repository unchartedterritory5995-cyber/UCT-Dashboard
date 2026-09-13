"""MOB-05 — "follow this line": object-bound alerts, beside the fixed ones.

⭐ THE POINT OF THE FEATURE IS THAT BOTH SEMANTICS SURVIVE. A bound alert tracks
its drawing; a FIXED alert is a price the user chose, which happens to have been
found by drawing a line, and it must go on meaning that forever. The seeded
price-context alerts are all of the second kind, so a resync that reached them
would quietly rewrite levels a member set deliberately — the failure would be a
wrong number in the bell, days later, with nothing to trace it to.

⛔ AND BINDING MUST NOT EDIT THE PAST. Once an alert has fired, it is a record
that price crossed a line on a particular day. Moving the line afterwards must
not rewrite that record, so every bound write is scoped to `is_active = 1`.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user
from api.services import auth_db
from api.services import watchlist_alert_service as wls
import api.routers.watchlist_alerts as router_mod


@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    db_path = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(db_path))
    monkeypatch.setattr(auth_db, "_DB_PATH", str(db_path))
    auth_db.init_db()
    conn = auth_db.get_connection()
    for uid in ("u1", "u2"):
        conn.execute("INSERT INTO users (id, email, password_hash) VALUES (?,?,?)",
                     (uid, f"{uid}@local.test", "x"))
    conn.commit()
    conn.close()
    return db_path


def _client(user_id="u1"):
    app = FastAPI()
    app.include_router(router_mod.router)
    app.dependency_overrides[get_current_user] = lambda: {"id": user_id, "role": "member"}
    return TestClient(app)


TREND = dict(alert_type="trendline", anchors=(1_700_000_000, 100.0, 1_700_086_400, 110.0))


# ── both semantics exist, and they are distinguishable ──────────────────────

def test_bound_and_fixed_alerts_coexist_and_are_told_apart(tmp_db):
    bound = wls.create_alert("u1", "NVDA", 110.0, "above", drawing_id="d1", **TREND)
    fixed = wls.create_alert("u1", "NVDA", 114.26, "above")          # the seeded shape
    assert bound["drawing_id"] == "d1"
    assert fixed["drawing_id"] is None
    rows = {r["id"]: r for r in wls.list_user_alerts("u1")}
    assert rows[bound["id"]]["drawing_id"] == "d1"
    assert rows[fixed["id"]]["drawing_id"] is None


def test_a_seeded_fixed_alert_is_never_touched_by_a_resync(tmp_db):
    """The instruction that matters most: do not replace seeded alerts."""
    fixed = wls.create_alert("u1", "NVDA", 114.26, "above")
    wls.create_alert("u1", "NVDA", 110.0, "above", drawing_id="d1", **TREND)
    moved = wls.resync_bound_alerts("u1", "d1", target_price=999.0,
                                    anchors=(1_700_000_000, 900.0, 1_700_086_400, 999.0))
    assert moved == 1
    still = {r["id"]: r for r in wls.list_user_alerts("u1")}[fixed["id"]]
    assert still["target_price"] == 114.26
    assert still["alert_type"] == "price"


# ── the resync ──────────────────────────────────────────────────────────────

def test_resync_repoints_the_bound_alert_and_the_checker_agrees(tmp_db):
    """The product assertion: after the line moves, the alert fires off the NEW line."""
    wls.create_alert("u1", "NVDA", 110.0, "above", drawing_id="d1", **TREND)
    mid = 1_700_043_200            # halfway between the two anchors
    before = wls._alert_level_now(wls.list_user_alerts("u1")[0], mid)
    assert before == pytest.approx(105.0)

    wls.resync_bound_alerts("u1", "d1", target_price=210.0,
                            anchors=(1_700_000_000, 200.0, 1_700_086_400, 210.0))
    after = wls._alert_level_now(wls.list_user_alerts("u1")[0], mid)
    assert after == pytest.approx(205.0)


def test_resync_leaves_a_triggered_alert_alone(tmp_db):
    """A fired alert is history. Moving the line on Thursday must not rewrite Tuesday."""
    a = wls.create_alert("u1", "NVDA", 110.0, "above", drawing_id="d1", **TREND)
    conn = auth_db.get_connection()
    conn.execute("UPDATE watchlist_alerts SET is_active = 0, triggered_at = 'then' WHERE id = ?", (a["id"],))
    conn.commit(); conn.close()

    assert wls.resync_bound_alerts("u1", "d1", target_price=999.0,
                                   anchors=(1, 900.0, 2, 999.0)) == 0
    row = wls.list_user_alerts("u1", active_only=False)[0]
    assert row["target_price"] == 110.0


def test_resync_is_scoped_to_the_owner(tmp_db):
    """Drawing ids are client-generated, so a collision across users must be inert."""
    mine = wls.create_alert("u1", "NVDA", 110.0, "above", drawing_id="shared-id", **TREND)
    theirs = wls.create_alert("u2", "NVDA", 110.0, "above", drawing_id="shared-id", **TREND)
    assert wls.resync_bound_alerts("u1", "shared-id", target_price=999.0,
                                   anchors=(1, 900.0, 2, 999.0)) == 1
    assert {r["id"]: r for r in wls.list_user_alerts("u2")}[theirs["id"]]["target_price"] == 110.0
    assert {r["id"]: r for r in wls.list_user_alerts("u1")}[mine["id"]]["target_price"] == 999.0


# ── the drawing goes away ───────────────────────────────────────────────────

def test_deleting_the_drawing_disarms_it_but_keeps_the_record_of_one_that_fired(tmp_db):
    armed = wls.create_alert("u1", "NVDA", 110.0, "above", drawing_id="d1", **TREND)
    fired = wls.create_alert("u1", "NVDA", 108.0, "above", drawing_id="d1", **TREND)
    conn = auth_db.get_connection()
    conn.execute("UPDATE watchlist_alerts SET is_active = 0 WHERE id = ?", (fired["id"],))
    conn.commit(); conn.close()

    assert wls.delete_bound_alerts("u1", "d1") == 1
    left = [r["id"] for r in wls.list_user_alerts("u1", active_only=False)]
    assert armed["id"] not in left
    assert fired["id"] in left


# ── the routes ──────────────────────────────────────────────────────────────

def test_the_bound_route_is_not_swallowed_by_the_alert_id_route(tmp_db):
    """⛔ FastAPI answers on FIRST MATCH and `/{alert_id}` matches "bound".

    Registered in the wrong order this returns 404 "Alert not found" while every
    component on the page looks correct — the same trap as the COT live-drill
    route. The assertion is on the RESPONSE SHAPE, because a 404 here is exactly
    what the wrong order produces.
    """
    wls.create_alert("u1", "NVDA", 110.0, "above", drawing_id="d1", **TREND)
    c = _client()
    r = c.delete("/api/watchlist-alerts/bound/d1")
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "deleted": 1}


def test_patching_a_drawing_with_no_bound_alert_is_ok_not_404(tmp_db):
    """The chart pushes on any move of a line it has seen; most lines carry no alert."""
    c = _client()
    r = c.patch("/api/watchlist-alerts/bound/never-bound",
                json={"target_price": 5.0, "alert_type": "line"})
    assert r.status_code == 200
    assert r.json() == {"ok": True, "updated": 0}


def test_create_accepts_a_drawing_id_over_http(tmp_db):
    c = _client()
    r = c.post("/api/watchlist-alerts", json={
        "sym": "nvda", "target_price": 110.0, "direction": "above",
        "alert_type": "trendline", "anchor_t1": 1_700_000_000, "anchor_p1": 100.0,
        "anchor_t2": 1_700_086_400, "anchor_p2": 110.0, "drawing_id": "d1",
    })
    assert r.status_code == 200, r.text
    assert r.json()["drawing_id"] == "d1"
    assert r.json()["sym"] == "NVDA"


def test_an_alert_created_without_a_drawing_id_stays_fixed(tmp_db):
    c = _client()
    r = c.post("/api/watchlist-alerts",
               json={"sym": "NVDA", "target_price": 114.26, "direction": "above"})
    assert r.status_code == 200
    assert r.json()["drawing_id"] is None
