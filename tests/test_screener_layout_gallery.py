"""Community scan-board layouts (`api/services/screener_layout_gallery.py`,
`api/routers/screener_layout_gallery.py`), dark behind `SCREENER_LAYOUT_GALLERY_ENABLED`.

What each section makes impossible:
  * THE FLAG: off answers the 404 of a route that does not exist on every route to everyone,
    paid or not, signed in or not; `admin` reaches admins only; then 401, then this router's 402.
  * ONE FACT IN TWO FILES: the grid, the widget minimums, the row styles and the name length are
    PARSED out of the client's `boardModel.js` and compared with the server's, so neither side
    can move alone.
  * THE SERVER REFUSES, NEVER REPAIRS: every rule, one refusal each, and a layout that passes is
    stored in its canonical shape with nothing the caller added.
  * REVIEW FIRST; USE COUNTS ONCE AND NEVER THE AUTHOR; ONE REPORT, NEVER YOUR OWN; HIDE IS NEVER
    A DELETE; UNPUBLISH DELETES; NO ID OR EMAIL LEAVES; THE ACCOUNT TAKES ITS ROWS WITH IT; A
    REFUSED PUBLISH COSTS NOTHING.
"""
from __future__ import annotations

import importlib
import json
import os
import re
import sqlite3
import tempfile
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw

ROOT = Path(__file__).resolve().parents[1]
BOARD_MODEL = ROOT / "app" / "src" / "pages" / "screener" / "focus" / "board" / "boardModel.js"
FLAG = "SCREENER_LAYOUT_GALLERY_ENABLED"
BASE = "/api/screener/layout-gallery"

A, B, C, ADMIN = "user-lay-author-a", "user-lay-member-b", "user-lay-member-c", "user-lay-admin"
EMAILS = {A: "alice.author@example.com", B: "bob.member@example.com", C: "carol.member@example.com",
          ADMIN: "the.admin@example.com"}
PAID = {"plan": "pro"}
FREE = {"plan": "free"}

BOARD = {"widgets": [
    {"id": "chart", "type": "chart", "x": 0, "y": 0, "w": 17, "h": 20},
    {"id": "results", "type": "results", "x": 17, "y": 0, "w": 7, "h": 12, "opts": {"rows": "cards"}},
    {"id": "details", "type": "details", "x": 17, "y": 12, "w": 7, "h": 8},
]}


# ── fixtures ────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    from api.services import screener_layout_gallery as svc
    svc._ready_for = None
    conn = auth_db.get_connection()
    for uid, name in ((A, "Alice Trader"), (B, "bob@example.com"), (C, ""), (ADMIN, "Admin")):
        conn.execute("INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?,?,?,?,?)",
                     (uid, EMAILS[uid], "x", name, "admin" if uid == ADMIN else "member"))
    conn.commit()
    conn.close()
    yield tmp.name
    svc._ready_for = None
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(tmp.name + suffix)
        except OSError:
            pass


@pytest.fixture(autouse=True)
def _fresh_limiter():
    from api.limiter import limiter
    limiter.reset()
    yield
    limiter.reset()


@pytest.fixture
def svc(db_path):
    from api.services import screener_layout_gallery
    return screener_layout_gallery


@pytest.fixture
def app(db_path, monkeypatch):
    monkeypatch.setenv(FLAG, "1")
    from api.routers import screener_layout_gallery
    fa = FastAPI()
    fa.include_router(screener_layout_gallery.router)
    yield fa
    fa.dependency_overrides.clear()


@pytest.fixture
def client(app):
    return TestClient(app)


def as_user(app, user_id: str, plan: dict = PAID) -> None:
    user = {"id": user_id, "role": "admin" if user_id == ADMIN else "member", **plan}
    app.dependency_overrides[authmw.get_current_user] = lambda: dict(user)
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)
    app.dependency_overrides[authmw.get_current_user_optional] = lambda: dict(user)


def signed_out(app) -> None:
    for dep in (authmw.get_current_user, authmw.get_current_user_with_plan, authmw.get_current_user_optional):
        app.dependency_overrides.pop(dep, None)


def _conn() -> sqlite3.Connection:
    from api.services import screener_layout_gallery
    from api.services.auth_db import get_connection
    conn = get_connection()
    screener_layout_gallery.ensure_schema(conn)      # a refused request never opened the store
    return conn


def _count(table: str, where: str = "1=1", *params) -> int:
    conn = _conn()
    try:
        return conn.execute(f"SELECT COUNT(*) FROM {table} WHERE {where}", params).fetchone()[0]
    finally:
        conn.close()


def publish(app, client, who: str, name: str = "My board", layout: dict | None = None):
    as_user(app, who)
    return client.post(BASE, json={"name": name, "layout": BOARD if layout is None else layout})


def approve(app, client, gallery_id: str, action: str = "approve"):
    as_user(app, ADMIN)
    return client.patch(f"{BASE}/admin/{gallery_id}", json={"action": action})


def listed(app, client, who: str) -> dict:
    as_user(app, who)
    r = client.get(BASE)
    assert r.status_code == 200, r.text
    return r.json()


def shared(app, client, who: str = A, name: str = "My board") -> str:
    """One approved layout by `who`; its id."""
    r = publish(app, client, who, name)
    assert r.status_code == 200, r.text
    gid = r.json()["item"]["id"]
    assert approve(app, client, gid).status_code == 200
    return gid


EVERY_ROUTE = [("GET", BASE), ("POST", BASE), ("DELETE", f"{BASE}/{'0' * 32}"), ("POST", f"{BASE}/{'0' * 32}/use"),
               ("POST", f"{BASE}/{'0' * 32}/report"), ("PATCH", f"{BASE}/admin/{'0' * 32}")]


# ── the flag, then 401, then 402 ────────────────────────────────────────────────────────

def test_the_route_list_in_this_file_is_the_routers_own(app):
    """Non-vacuity for the sweeps below: every route the router mounts is in EVERY_ROUTE."""
    from api.routers import screener_layout_gallery as mod
    mounted = {(m, re.sub(r"\{\w+\}", "0" * 32, r.path)) for r in mod.router.routes
               for m in (r.methods or set()) - {"HEAD", "OPTIONS"}}
    assert mounted == set(EVERY_ROUTE)


@pytest.mark.parametrize("raw", [None, "0", "false", "flase"])
def test_flag_off_is_the_404_of_no_route_for_everyone(app, client, monkeypatch, raw):
    if raw is None:
        monkeypatch.delenv(FLAG, raising=False)
    else:
        monkeypatch.setenv(FLAG, raw)
    for sign_in in (lambda: signed_out(app), lambda: as_user(app, B, FREE), lambda: as_user(app, B),
                    lambda: as_user(app, ADMIN)):
        sign_in()
        for method, path in EVERY_ROUTE:
            r = client.request(method, path, json={})
            assert (r.status_code, r.json()) == (404, {"detail": "Not Found"}), (method, path, r.text)


def test_a_fully_dark_route_reads_no_session(app, client, monkeypatch):
    """Off for everyone, the 404 comes before any session is looked up: a dark route costs an
    anonymous flood nothing but the flag read."""
    monkeypatch.delenv(FLAG, raising=False)
    reads = []
    app.dependency_overrides[authmw.get_current_user_optional] = lambda: reads.append(1)
    for method, path in EVERY_ROUTE:
        assert client.request(method, path, json={}).status_code == 404
    assert reads == []
    monkeypatch.setenv(FLAG, "admin")                                   # the preview does have to look
    assert client.get(BASE).status_code == 404
    assert reads == [1]


def test_admin_scope_reaches_admins_only(app, client, monkeypatch):
    monkeypatch.setenv(FLAG, "admin")
    for sign_in in (lambda: signed_out(app), lambda: as_user(app, B, FREE), lambda: as_user(app, B)):
        sign_in()
        for method, path in EVERY_ROUTE:
            assert client.request(method, path, json={}).status_code == 404, (method, path)
    as_user(app, ADMIN)
    assert client.get(BASE).status_code == 200
    assert "queue" in client.get(BASE).json()


def test_flag_on_then_signed_out_is_401_and_unpaid_is_this_routers_402(app, client):
    signed_out(app)
    for method, path in EVERY_ROUTE:
        assert client.request(method, path, json={}).status_code == 401, (method, path)
    as_user(app, B, FREE)
    for method, path in EVERY_ROUTE:
        r = client.request(method, path, json={})
        assert r.status_code == 402, (method, path, r.text)
        assert r.json()["detail"] == "Community scan layouts require a paid plan"


def test_the_admin_route_refuses_a_member(app, client):
    gid = publish(app, client, A).json()["item"]["id"]
    as_user(app, B)
    assert client.patch(f"{BASE}/admin/{gid}", json={"action": "approve"}).status_code == 403
    as_user(app, A)                                                # nor may an author approve their own
    assert client.patch(f"{BASE}/admin/{gid}", json={"action": "approve"}).status_code == 403
    assert listed(app, client, B)["items"] == []


# ── one fact in two files ───────────────────────────────────────────────────────────────

def _client_facts() -> dict:
    """The board's facts as `boardModel.js` declares them, read from its source."""
    src = BOARD_MODEL.read_text(encoding="utf-8")

    def const(name: str) -> int:
        m = re.search(rf"export const {name} = (\d+)", src)
        assert m, f"boardModel.js no longer declares {name}"
        return int(m.group(1))

    block = re.search(r"export const WIDGETS = \{(.*?)\n\}", src, re.S)
    assert block, "boardModel.js no longer declares WIDGETS"
    widgets = {m.group(1): (int(m.group(2)), int(m.group(3)))
               for m in re.finditer(r"^\s*(\w+): \{[^\n]*?minW: (\d+), minH: (\d+)", block.group(1), re.M)}
    rows = re.search(r"export const ROW_STYLES = \[(.*?)\]\n", src, re.S)
    assert rows, "boardModel.js no longer declares ROW_STYLES"
    return {"COLS": const("COLS"), "ROWS": const("ROWS"), "MAX_NAME": const("MAX_NAME"), "WIDGETS": widgets,
            "ROW_STYLES": tuple(re.findall(r"\['(\w+)',", rows.group(1)))}


def test_the_servers_board_facts_are_the_clients(svc):
    facts = _client_facts()
    assert len(facts["WIDGETS"]) >= 5 and len(facts["ROW_STYLES"]) >= 5      # the parse saw the real blocks
    assert facts == {"COLS": svc.COLS, "ROWS": svc.ROWS, "MAX_NAME": svc.MAX_NAME, "WIDGETS": svc.WIDGETS,
                     "ROW_STYLES": svc.ROW_STYLES}


def test_every_client_preset_is_a_layout_the_server_accepts(svc):
    """The presets are the layouts members start from; a server that refused one would refuse the
    most common thing a member could share."""
    src = BOARD_MODEL.read_text(encoding="utf-8")
    presets = re.search(r"export const PRESETS = \[(.*?)\n\]", src, re.S)
    assert presets
    lines = [ln for ln in presets.group(1).splitlines() if "widgets:" in ln]
    assert len(lines) >= 2
    for ln in lines:
        widgets = [{"type": t, "x": int(x), "y": int(y), "w": int(w), "h": int(h)}
                   for t, x, y, w, h in re.findall(r"W\('(\w+)', (\d+), (\d+), (\d+), (\d+)", ln)]
        assert widgets, ln
        out = svc.validate_layout({"widgets": widgets})
        assert [w["type"] for w in out["widgets"]] == [w["type"] for w in widgets]


# ── the server refuses, never repairs ───────────────────────────────────────────────────

def _w(kind: str, x: int, y: int, w: int, h: int, **extra) -> dict:
    return {"type": kind, "x": x, "y": y, "w": w, "h": h, **extra}


BAD_LAYOUTS = [
    ("not an object", "nope", "S_LAYOUT_UNREADABLE"),
    ("no widget list", {"widgets": "chart"}, "S_LAYOUT_UNREADABLE"),
    ("no widgets", {"widgets": []}, "S_LAYOUT_COUNT"),
    ("six widgets", {"widgets": [_w("chart", 0, 0, 8, 8)] * 6}, "S_LAYOUT_COUNT"),
    ("a widget that is not an object", {"widgets": ["chart"]}, "S_LAYOUT_TYPE"),
    ("the table, which is not a widget", {"widgets": [_w("table", 0, 0, 24, 20)]}, "S_LAYOUT_TYPE"),
    ("the heat map, which is not a widget", {"widgets": [_w("map", 0, 0, 24, 20)]}, "S_LAYOUT_TYPE"),
    ("a type that is not text", {"widgets": [_w(7, 0, 0, 24, 20)]}, "S_LAYOUT_TYPE"),
    ("one widget twice", {"widgets": [_w("chart", 0, 0, 12, 20), _w("chart", 12, 0, 12, 20)]}, "S_LAYOUT_TWICE"),
    ("a fraction", {"widgets": [_w("chart", 0, 0, 12.5, 20)]}, "S_LAYOUT_NUMBERS"),
    ("a true for a number", {"widgets": [_w("chart", True, 0, 12, 20)]}, "S_LAYOUT_NUMBERS"),
    ("text for a number", {"widgets": [_w("chart", "0", 0, 12, 20)]}, "S_LAYOUT_NUMBERS"),
    ("a missing number", {"widgets": [{"type": "chart", "x": 0, "y": 0, "w": 12}]}, "S_LAYOUT_NUMBERS"),
    ("narrower than its minimum", {"widgets": [_w("chart", 0, 0, 7, 20)]}, "S_LAYOUT_SMALL"),
    ("shorter than its minimum", {"widgets": [_w("screens", 0, 0, 4, 5)]}, "S_LAYOUT_SMALL"),
    ("left of the board", {"widgets": [_w("chart", -1, 0, 12, 20)]}, "S_LAYOUT_OUTSIDE"),
    ("past the right edge", {"widgets": [_w("chart", 13, 0, 12, 20)]}, "S_LAYOUT_OUTSIDE"),
    ("past the bottom edge", {"widgets": [_w("chart", 0, 1, 12, 20)]}, "S_LAYOUT_OUTSIDE"),
    ("two widgets overlapping by one cell", {"widgets": [_w("chart", 0, 0, 12, 20), _w("news", 11, 0, 13, 20)]},
     "S_LAYOUT_OVERLAP"),
    ("a row style the board does not have", {"widgets": [_w("results", 0, 0, 24, 20, opts={"rows": "wide"})]},
     "S_LAYOUT_ROWS"),
    ("options that are not an object", {"widgets": [_w("results", 0, 0, 24, 20, opts="cards")]}, "S_LAYOUT_ROWS"),
]


@pytest.mark.parametrize("why,layout,sentence", BAD_LAYOUTS, ids=[b[0] for b in BAD_LAYOUTS])
def test_a_layout_that_is_not_a_real_board_is_refused(app, client, svc, why, layout, sentence):
    r = publish(app, client, A, layout=layout)
    assert (r.status_code, r.json()["detail"]) == (400, getattr(svc, sentence)), why
    assert _count("screener_layout_gallery") == 0


BAD_NAMES = [
    ("missing", None, "S_NAME_MISSING"),
    ("not text", 7, "S_NAME_MISSING"),
    ("blank", "   ", "S_NAME_MISSING"),
    ("41 characters", "x" * 41, "S_NAME_LONG"),
    ("a line break", "My\nboard", "S_NAME_CHARACTER"),
    ("a NUL", "My\x00board", "S_NAME_CHARACTER"),
    ("a direction override", "My ‮board", "S_NAME_CHARACTER"),
    ("a zero-width space", "My​board", "S_NAME_CHARACTER"),
    ("a web address", "see https://example.com", "S_NAME_URL"),
    ("a bare domain", "join mysite.com now", "S_NAME_URL"),
    ("a www address", "www.mysite today", "S_NAME_URL"),
    ("an email address", "mail me@example.com", "S_NAME_EMAIL"),
    ("an @ name", "follow @trader", "S_NAME_HANDLE"),
]


@pytest.mark.parametrize("why,name,sentence", BAD_NAMES, ids=[b[0] for b in BAD_NAMES])
def test_a_name_that_cannot_be_shown_is_refused(app, client, svc, why, name, sentence):
    r = publish(app, client, A, name=name)
    assert (r.status_code, r.json()["detail"]) == (400, getattr(svc, sentence)), why
    assert _count("screener_layout_gallery") == 0


def test_a_lone_surrogate_in_a_name_is_refused_not_a_500(svc):
    with pytest.raises(svc.LayoutError) as e:
        svc.validate_name("My \ud800 board")
    assert str(e.value) == svc.S_NAME_CHARACTER


def test_a_good_name_is_trimmed_and_its_spaces_collapsed(svc):
    assert svc.validate_name("  Big   chart  left ") == "Big chart left"
    assert svc.validate_name("x" * 40) == "x" * 40
    assert svc.validate_name("U.S. leaders 50/50 (v2)") == "U.S. leaders 50/50 (v2)"


def test_what_is_stored_is_the_canonical_layout_and_nothing_the_caller_added(app, client):
    sent = {"widgets": [
        {"type": "chart", "x": 0.0, "y": 0, "w": 17, "h": 20, "id": "anything", "opts": {"rows": "cards"},
         "screen": "my secret screen", "filters": [{"key": "rs_rank"}]},
        {"type": "results", "x": 17, "y": 0, "w": 7, "h": 20, "opts": {"rows": "chips", "tickers": ["NVDA"]}},
    ], "screens": "tabs", "mine": [{"id": "m-1"}], "filters": {"rs_rank": 90}}
    r = publish(app, client, A, layout=sent)
    assert r.status_code == 200, r.text
    want = {"widgets": [{"id": "chart", "type": "chart", "x": 0, "y": 0, "w": 17, "h": 20},
                        {"id": "results", "type": "results", "x": 17, "y": 0, "w": 7, "h": 20,
                         "opts": {"rows": "chips"}}]}
    assert r.json()["item"]["layout"] == want
    conn = _conn()
    stored = conn.execute("SELECT layout_json FROM screener_layout_gallery").fetchone()[0]
    conn.close()
    assert json.loads(stored) == want
    assert "secret" not in stored and "NVDA" not in stored and "rs_rank" not in stored


def test_a_results_widget_without_a_row_style_gets_one_line(svc):
    out = svc.validate_layout({"widgets": [_w("results", 0, 0, 24, 20)]})
    assert out["widgets"][0]["opts"] == {"rows": "line"}


def test_a_body_over_16_kb_or_not_an_object_is_refused(app, client):
    as_user(app, A)
    r = client.post(BASE, content=json.dumps({"name": "x", "pad": "y" * 17_000}),
                    headers={"Content-Type": "application/json"})
    assert r.status_code == 413
    assert client.post(BASE, content="[1, 2]", headers={"Content-Type": "application/json"}).status_code == 422
    assert client.post(BASE, content="{not json", headers={"Content-Type": "application/json"}).status_code == 422
    assert _count("screener_layout_gallery") == 0


# ── review first ────────────────────────────────────────────────────────────────────────

def test_a_publish_is_pending_until_an_admin_approves_it(app, client):
    r = publish(app, client, A, "Big chart left")
    assert r.status_code == 200, r.text
    item = r.json()["item"]
    assert (item["status"], item["mine"], item["name"], item["author"], item["uses"], item["reported"]) == (
        "pending", True, "Big chart left", "Alice Trader", 0, False)
    # the author also learns whether it is hidden; the report count stays the admin's
    assert set(item) == {"id", "name", "author", "layout", "uses", "mine", "status", "reported", "createdAt", "hidden"}
    assert item["hidden"] is False
    assert item["layout"] == BOARD

    other = listed(app, client, B)
    assert other["items"] == [] and other["mine"] == [] and "queue" not in other
    assert other["limits"] == {"maxMine": 10}
    author = listed(app, client, A)
    assert [i["id"] for i in author["mine"]] == [item["id"]] and author["items"] == [] and "queue" not in author
    admin = listed(app, client, ADMIN)
    assert [i["id"] for i in admin["queue"]] == [item["id"]]
    assert (admin["queue"][0]["hidden"], admin["queue"][0]["reports"]) == (False, 0)

    done = approve(app, client, item["id"])
    assert done.status_code == 200 and done.json()["item"]["status"] == "approved"
    seen = listed(app, client, B)["items"]
    assert [(i["id"], i["mine"], i["author"]) for i in seen] == [(item["id"], False, "Alice Trader")]
    assert "hidden" not in seen[0] and "reports" not in seen[0]
    assert listed(app, client, ADMIN)["queue"] == []


def test_a_declined_layout_is_never_listed_and_its_author_can_see_the_answer(app, client):
    gid = publish(app, client, A).json()["item"]["id"]
    assert approve(app, client, gid, "decline").json()["item"]["status"] == "declined"
    assert listed(app, client, B)["items"] == []
    assert [(i["id"], i["status"]) for i in listed(app, client, A)["mine"]] == [(gid, "declined")]
    # sharing the same name again replaces the declined copy with a new pending one
    again = publish(app, client, A)
    assert again.status_code == 200 and again.json()["item"]["status"] == "pending"
    assert [i["status"] for i in listed(app, client, A)["mine"]] == ["pending"]


def test_an_unknown_admin_action_or_layout_is_refused(app, client, svc):
    gid = publish(app, client, A).json()["item"]["id"]
    r = approve(app, client, gid, "delete")
    assert (r.status_code, r.json()["detail"]) == (400, svc.S_ADMIN_ACTION)
    assert approve(app, client, "f" * 32).status_code == 404
    assert approve(app, client, "not-an-id").status_code == 404


def test_an_email_looking_or_blank_display_name_reads_a_uct_member(app, client):
    shared(app, client, B, "Bobs board")
    shared(app, client, C, "Carols board")
    assert {i["name"]: i["author"] for i in listed(app, client, A)["items"]} == {
        "Bobs board": "A UCT member", "Carols board": "A UCT member"}


def test_the_most_used_layout_is_listed_first_then_the_newest(app, client):
    first = shared(app, client, A, "First")
    second = shared(app, client, A, "Second")
    assert [i["id"] for i in listed(app, client, C)["items"]] == [second, first]       # newest first
    as_user(app, B)
    assert client.post(f"{BASE}/{first}/use").status_code == 200
    assert [i["id"] for i in listed(app, client, C)["items"]] == [first, second]       # most used first


# ── the cap and the duplicate name ──────────────────────────────────────────────────────

def test_the_eleventh_layout_and_a_repeated_name_are_409(app, client, svc, monkeypatch):
    from api.routers import screener_layout_gallery as mod
    monkeypatch.setattr(mod, "PUBLISH_RATE", "1000/hour")
    monkeypatch.setenv(mod.DAILY_PUBLISH_CAP_ENV, "1000")
    for n in range(svc.MAX_MINE):
        assert publish(app, client, A, f"Board {n}").status_code == 200
    r = publish(app, client, A, "One too many")
    assert (r.status_code, r.json()["detail"]) == (409, svc.S_CAP)
    assert _count("screener_layout_gallery", "user_id = ?", A) == svc.MAX_MINE
    # the cap is each member's own
    assert publish(app, client, B, "Board 0").status_code == 200
    dup = publish(app, client, B, "  board   0 ")
    assert (dup.status_code, dup.json()["detail"]) == (409, svc.S_DUPLICATE)


# ── use: once per member, never the author ──────────────────────────────────────────────

def test_use_counts_once_per_member_and_never_the_author(app, client):
    gid = shared(app, client)
    as_user(app, A)
    own = client.post(f"{BASE}/{gid}/use")
    assert own.status_code == 200 and own.json()["item"]["uses"] == 0
    as_user(app, B)
    assert client.post(f"{BASE}/{gid}/use").json()["item"]["uses"] == 1
    assert client.post(f"{BASE}/{gid}/use").json()["item"]["uses"] == 1
    as_user(app, C)
    out = client.post(f"{BASE}/{gid}/use").json()["item"]
    assert (out["uses"], out["mine"], out["layout"]) == (2, False, BOARD)
    assert _count("screener_layout_gallery_uses", "gallery_id = ?", gid) == 2
    assert _count("screener_layout_gallery_uses", "user_id = ?", A) == 0


def test_a_layout_that_is_not_listed_cannot_be_used_except_by_its_author(app, client):
    gid = publish(app, client, A).json()["item"]["id"]                 # pending
    as_user(app, B)
    assert client.post(f"{BASE}/{gid}/use").status_code == 404
    as_user(app, A)
    assert client.post(f"{BASE}/{gid}/use").status_code == 200
    approve(app, client, gid)
    approve(app, client, gid, "hide")
    as_user(app, B)
    assert client.post(f"{BASE}/{gid}/use").status_code == 404
    assert client.post(f"{BASE}/{'e' * 32}/use").status_code == 404
    assert _count("screener_layout_gallery_uses") == 0


# ── report: once, never your own ────────────────────────────────────────────────────────

def test_report_once_and_never_your_own(app, client, svc):
    gid = shared(app, client)
    as_user(app, B)
    assert client.post(f"{BASE}/{gid}/report", json={"reason": "name"}).json() == {"reported": True, "already": False}
    assert client.post(f"{BASE}/{gid}/report", json={"reason": "other"}).json() == {"reported": True, "already": True}
    assert _count("screener_layout_gallery_reports", "gallery_id = ?", gid) == 1
    assert [i["reported"] for i in listed(app, client, B)["items"]] == [True]
    assert [i["reported"] for i in listed(app, client, C)["items"]] == [False]

    bad = client.post(f"{BASE}/{gid}/report", json={"reason": "spite"})
    assert (bad.status_code, bad.json()["detail"]) == (400, svc.S_REPORT_REASON)
    as_user(app, A)
    own = client.post(f"{BASE}/{gid}/report", json={"reason": "name"})
    assert (own.status_code, own.json()["detail"]) == (400, svc.S_REPORT_OWN)
    assert _count("screener_layout_gallery_reports", "gallery_id = ?", gid) == 1

    queue = listed(app, client, ADMIN)["queue"]
    assert [(i["id"], i["reports"]) for i in queue] == [(gid, 1)]


def test_a_layout_nobody_can_see_cannot_be_reported(app, client):
    gid = publish(app, client, A).json()["item"]["id"]                 # pending
    as_user(app, B)
    assert client.post(f"{BASE}/{gid}/report", json={"reason": "name"}).status_code == 404
    assert client.post(f"{BASE}/{'e' * 32}/report", json={"reason": "name"}).status_code == 404
    assert _count("screener_layout_gallery_reports") == 0


def test_dismiss_clears_the_reports_and_leaves_the_layout_listed(app, client):
    gid = shared(app, client)
    as_user(app, B)
    client.post(f"{BASE}/{gid}/report", json={"reason": "broken"})
    out = approve(app, client, gid, "dismiss").json()["item"]
    assert (out["reports"], out["hidden"], out["status"]) == (0, False, "approved")
    assert listed(app, client, ADMIN)["queue"] == []
    assert [i["id"] for i in listed(app, client, C)["items"]] == [gid]


# ── hide is a visibility state, never a delete ──────────────────────────────────────────

def test_hide_takes_it_off_the_list_and_the_author_still_has_it(app, client):
    gid = shared(app, client)
    as_user(app, B)
    client.post(f"{BASE}/{gid}/report", json={"reason": "name"})
    out = approve(app, client, gid, "hide").json()["item"]
    assert (out["hidden"], out["status"], out["reports"]) == (True, "approved", 0)     # status left alone
    assert listed(app, client, B)["items"] == []
    mine = listed(app, client, A)["mine"]
    # the author is told it was hidden, and is never shown how many reports it drew
    assert [(i["id"], i["status"], i["hidden"]) for i in mine] == [(gid, "approved", True)] and "reports" not in mine[0]
    assert [(i["id"], i["hidden"]) for i in listed(app, client, ADMIN)["queue"]] == [(gid, True)]
    assert _count("screener_layout_gallery", "id = ?", gid) == 1                       # not a delete

    back = approve(app, client, gid, "unhide").json()["item"]
    assert (back["hidden"], back["status"]) == (False, "approved")
    assert [i["id"] for i in listed(app, client, B)["items"]] == [gid]


def test_the_queue_is_pending_first_then_reported_then_hidden(app, client):
    hidden = shared(app, client, A, "Hidden one")
    reported = shared(app, client, A, "Reported one")
    approve(app, client, hidden, "hide")
    as_user(app, B)
    client.post(f"{BASE}/{reported}/report", json={"reason": "name"})
    older = publish(app, client, B, "Older pending").json()["item"]["id"]
    newer = publish(app, client, C, "Newer pending").json()["item"]["id"]
    assert [i["id"] for i in listed(app, client, ADMIN)["queue"]] == [older, newer, reported, hidden]


# ── unpublish deletes ───────────────────────────────────────────────────────────────────

def test_unpublish_is_the_authors_and_deletes_the_layout_with_what_was_recorded_about_it(app, client):
    gid = shared(app, client)
    as_user(app, B)
    client.post(f"{BASE}/{gid}/use")
    client.post(f"{BASE}/{gid}/report", json={"reason": "name"})
    assert client.delete(f"{BASE}/{gid}").status_code == 404           # not B's to remove
    assert _count("screener_layout_gallery", "id = ?", gid) == 1
    as_user(app, A)
    assert client.delete(f"{BASE}/{gid}").json() == {"ok": True}
    assert (_count("screener_layout_gallery"), _count("screener_layout_gallery_uses"),
            _count("screener_layout_gallery_reports")) == (0, 0, 0)
    assert client.delete(f"{BASE}/{gid}").status_code == 404
    assert listed(app, client, B)["items"] == []


def test_an_admin_can_remove_any_layout(app, client):
    gid = shared(app, client)
    as_user(app, ADMIN)
    assert client.delete(f"{BASE}/{gid}").json() == {"ok": True}
    assert _count("screener_layout_gallery") == 0


# ── nothing that names a member leaves ──────────────────────────────────────────────────

def test_no_response_carries_a_user_id_or_an_email(app, client):
    texts = []
    r = publish(app, client, A, "Alices board")
    gid = r.json()["item"]["id"]
    texts.append(r.text)
    texts.append(publish(app, client, B, "Bobs board").text)
    texts.append(approve(app, client, gid).text)
    as_user(app, C)
    texts.append(client.post(f"{BASE}/{gid}/use").text)
    texts.append(client.post(f"{BASE}/{gid}/report", json={"reason": "name"}).text)
    for who in (A, B, C, ADMIN):
        as_user(app, who)
        texts.append(client.get(BASE).text)
    texts.append(approve(app, client, gid, "hide").text)
    blob = "\n".join(texts)
    assert "Alices board" in blob and '"queue"' in blob                  # the texts are the real answers
    for uid in (A, B, C, ADMIN):
        assert uid not in blob, f"a response carries the member id {uid}"
        assert EMAILS[uid] not in blob
    assert "@" not in blob and "user_id" not in blob


# ── the account takes its rows with it ──────────────────────────────────────────────────

def test_account_deletion_removes_a_members_layouts_reports_and_uses(app, client):
    from api.services.journal_two import account_purge as ap
    theirs = shared(app, client, A, "Alices board")
    kept = shared(app, client, B, "Bobs board")
    as_user(app, A)                                                     # A's own use + report of B's layout
    client.post(f"{BASE}/{kept}/use")
    client.post(f"{BASE}/{kept}/report", json={"reason": "name"})
    as_user(app, C)                                                     # what C recorded about A's and B's
    for gid in (theirs, kept):
        client.post(f"{BASE}/{gid}/use")
        client.post(f"{BASE}/{gid}/report", json={"reason": "other"})
    assert (_count("screener_layout_gallery"), _count("screener_layout_gallery_uses"),
            _count("screener_layout_gallery_reports")) == (2, 3, 3)

    conn = _conn()
    try:
        result = ap.purge_user_data(A, conn)
        conn.commit()
    finally:
        conn.close()
    assert result["ok"] is True
    for table in ("screener_layout_gallery", "screener_layout_gallery_uses", "screener_layout_gallery_reports"):
        assert _count(table, "user_id = ?", A) == 0, table
        assert _count(table, "gallery_id = ?" if table != "screener_layout_gallery" else "id = ?", theirs) == 0, table
    # B's layout and what C recorded about it are untouched
    assert _count("screener_layout_gallery", "id = ?", kept) == 1
    assert _count("screener_layout_gallery_uses", "gallery_id = ? AND user_id = ?", kept, C) == 1
    assert _count("screener_layout_gallery_reports", "gallery_id = ? AND user_id = ?", kept, C) == 1
    assert (_count("screener_layout_gallery"), _count("screener_layout_gallery_uses"),
            _count("screener_layout_gallery_reports")) == (1, 1, 1)


# ── rate limits ─────────────────────────────────────────────────────────────────────────

def _charged(who: str) -> float:
    from api.routers import screener_layout_gallery as mod
    from api.services import daily_counters
    from api.services.journal_two.calendar import et_today
    return daily_counters.value(et_today(), mod.DAILY_PUBLISH_SCOPE, who)


def test_a_refused_publish_gives_the_days_charge_back(app, client):
    assert publish(app, client, A, "Good one").status_code == 200
    assert _charged(A) == 1
    assert publish(app, client, A, "x" * 41).status_code == 400          # a bad name
    assert publish(app, client, A, layout={"widgets": []}).status_code == 400
    assert publish(app, client, A, "good ONE").status_code == 409        # a repeated name
    assert _charged(A) == 1
    assert publish(app, client, A, "Second").status_code == 200
    assert _charged(A) == 2


def test_the_durable_daily_cap_refuses_the_next_publish(app, client, monkeypatch):
    from api.routers import screener_layout_gallery as mod
    monkeypatch.setenv(mod.DAILY_PUBLISH_CAP_ENV, "2")
    assert publish(app, client, A, "One").status_code == 200
    assert publish(app, client, A, "Two").status_code == 200
    r = publish(app, client, A, "Three")
    assert (r.status_code, r.json()["detail"]) == (429, mod.PUBLISH_RATE_SENTENCE)
    assert _count("screener_layout_gallery") == 2
    assert publish(app, client, B, "One").status_code == 200             # each member's own count


def test_the_hourly_limits_are_per_member(app, client, monkeypatch):
    from api.routers import screener_layout_gallery as mod
    gid = shared(app, client)
    monkeypatch.setattr(mod, "USE_RATE", "2/hour")
    monkeypatch.setattr(mod, "REPORT_RATE", "1/hour")
    monkeypatch.setattr(mod, "PUBLISH_RATE", "1/hour")
    as_user(app, B)
    assert [client.post(f"{BASE}/{gid}/use").status_code for _ in range(3)] == [200, 200, 429]
    assert [client.post(f"{BASE}/{gid}/report", json={"reason": "name"}).status_code for _ in range(2)] == [200, 429]
    assert [publish(app, client, B, f"B {n}").status_code for n in range(2)] == [200, 429]
    as_user(app, C)                                                      # another member's budget is their own
    assert client.post(f"{BASE}/{gid}/use").status_code == 200
    assert client.post(f"{BASE}/{gid}/report", json={"reason": "name"}).status_code == 200


def test_the_three_limiter_scopes_are_named_in_the_single_process_roster():
    """A per-process limit nobody listed is a limit nobody doubles on purpose (CLAUDE.md)."""
    from api.routers import screener_layout_gallery as mod
    text = (ROOT / "CLAUDE.md").read_text(encoding="utf-8")
    for scope in (mod.SCOPE_PUBLISH, mod.SCOPE_REPORT, mod.SCOPE_USE):
        assert f"`{scope}`" in text, scope
