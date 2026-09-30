"""TERM-038 — the published address space (api/services/address_space.py)."""
from __future__ import annotations

import textwrap

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import address_space as a

MEMBER = "u-member"
OTHER = "u-other"


@pytest.fixture
def stores(monkeypatch):
    data = {
        "layout": {MEMBER: [{"id": "12", "name": "Swing Board"}, {"id": "3", "name": "UCT Default"}],
                   OTHER: [{"id": "99", "name": "Somebody Else's Board"}]},
        "watchlist": {MEMBER: [{"id": "w-abc", "name": "Semis Watch"}]},
        "note": {MEMBER: [{"id": "n1", "name": "Swing trading plan"}, {"id": "n2", "name": "Untitled"}]},
        "screen": {MEMBER: [{"id": "7", "name": "Swing leaders scan"}]},
    }
    for kind, k in list(a.KINDS.items()):
        monkeypatch.setitem(a.KINDS, kind, a.Kind(k.prefix, k.label, k.table,
                                                  lambda uid, _k=kind: data[_k].get(uid, []), k.door))
    monkeypatch.setattr(a, "_BY_PREFIX", {k.prefix: (n, k) for n, k in a.KINDS.items()})
    return data


# ── The rail: the address set is derived from the schema, never listed ──────────

def test_every_owned_named_table_is_an_address_kind_or_exempt_with_a_reason():
    derived = a.saved_object_tables()
    assert len(derived) >= 20, f"census found only {len(derived)} tables -- a broken scan passes everything"
    kinds = {k.table for k in a.KINDS.values()}
    unclassified = sorted(set(derived) - kinds - set(a.EXEMPT))
    assert not unclassified, (
        f"owned + named tables with no address and no exemption: {unclassified} "
        "-- give each an address kind in KINDS, or an EXEMPT line with its reason")


def test_no_exemption_or_kind_names_a_table_that_is_gone():
    derived = set(a.saved_object_tables())
    assert not sorted(set(a.EXEMPT) - derived), "stale EXEMPT entries"
    assert not sorted({k.table for k in a.KINDS.values()} - derived), "a kind's table is gone"
    assert not (set(a.EXEMPT) & {k.table for k in a.KINDS.values()}), "a table is both a kind and exempt"


def test_every_exemption_carries_a_kind_and_a_reason():
    for table, why in a.EXEMPT.items():
        kind, _, reason = why.partition(":")
        assert kind in {"no-door", "not-a-saved-object", "deferred"} and len(reason.strip()) > 15, table


def test_the_census_sees_a_planted_table_and_ignores_prose(tmp_path):
    """Control: the scan must SEE an owned, named table (else it passes vacuously), must
    see through an SQL comment on a column line, and must not count a table that has
    no name column."""
    pkg = tmp_path / "api"
    pkg.mkdir()
    (pkg / "store.py").write_text(textwrap.dedent('''
        SCHEMA = """
        CREATE TABLE IF NOT EXISTS planted_boards (
          id INTEGER PRIMARY KEY,
          scope TEXT NOT NULL,        -- 'user' | 'global', with a comma, here
          user_id TEXT NOT NULL,
          name TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS planted_log (id INTEGER, user_id TEXT, payload TEXT);
        """
        # CREATE TABLE prose_only (user_id TEXT, name TEXT)  <- a comment, not a string
    '''), encoding="utf-8")
    found = a.saved_object_tables(pkg)
    assert "planted_boards" in found
    assert "planted_log" not in found and "prose_only" not in found


# ── Search and resolve ────────────────────────────────────────────────────────────

def test_a_name_finds_the_object_and_its_door(stores):
    out = a.search(MEMBER, "swing")
    names = [(r["kind"], r["name"], r["address"], r["to"]) for r in out["results"]]
    assert ("layout", "Swing Board", "L:12", "/charts?openLayout=12") in names
    assert ("note", "Swing trading plan", "N:n1", "/journal/notebook?note=n1") in names
    assert ("screen", "Swing leaders scan", "S:7", "/screener?savedScreen=7") in names
    assert out["unavailable"] == []


def test_prefix_matches_rank_above_substring_matches(stores):
    rows = a.search(MEMBER, "semi")["results"]
    assert rows[0]["address"] == "W:w-abc"
    assert rows[0]["to"] == "/charts?openWatchlist=user:w-abc"


def test_the_address_itself_is_typeable(stores):
    assert a.search(MEMBER, "L:12")["results"][0]["name"] == "Swing Board"


def test_resolve_is_owner_scoped(stores):
    assert a.resolve(MEMBER, "L:12")["to"] == "/charts?openLayout=12"
    assert a.resolve(MEMBER, "L:99") is None          # another member's board
    assert a.resolve(OTHER, "L:99")["name"] == "Somebody Else's Board"
    assert a.resolve(MEMBER, "Z:1") is None and a.resolve(MEMBER, "garbage") is None


def test_a_rename_keeps_the_address(stores):
    stores["layout"][MEMBER][0]["name"] = "Momentum Board"
    assert a.resolve(MEMBER, "L:12")["name"] == "Momentum Board"
    assert a.search(MEMBER, "momentum")["results"][0]["address"] == "L:12"


def test_an_unreadable_store_is_named_not_empty(stores, monkeypatch):
    def boom(_uid):
        raise RuntimeError("store unreadable")
    k = a.KINDS["note"]
    monkeypatch.setitem(a.KINDS, "note", a.Kind(k.prefix, k.label, k.table, boom, k.door))
    out = a.search(MEMBER, "swing")
    assert out["unavailable"] == ["note"]
    assert sorted(r["kind"] for r in out["results"]) == ["layout", "screen"]


# ── The routes: dark, then signed-in only ──────────────────────────────────────────

def _client(user):
    from api.routers import address_space as router_mod
    from api.middleware.auth_middleware import get_current_user
    app = FastAPI()
    app.include_router(router_mod.router)
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def test_routes_404_while_dark(monkeypatch, stores):
    monkeypatch.delenv(a.ENABLED_ENV, raising=False)
    c = _client({"id": MEMBER})
    assert c.get("/api/address/search?q=swing").status_code == 404
    assert c.get("/api/address/resolve?a=L:12").status_code == 404


def test_routes_serve_when_armed(monkeypatch, stores):
    monkeypatch.setenv(a.ENABLED_ENV, "1")
    c = _client({"id": MEMBER})
    r = c.get("/api/address/search?q=swing")
    assert r.status_code == 200 and r.json()["results"]
    assert c.get("/api/address/resolve?a=L:12").json()["to"] == "/charts?openLayout=12"
    assert c.get("/api/address/resolve?a=L:99").status_code == 404


def test_the_real_listers_run_against_real_stores():
    """The unit tests above stub the listers; this calls the REAL ones (sandboxed by the
    root conftest) so a wrong signature or return shape in a store is caught here."""
    from api.services import auth_db, charts_layout_service
    from api.services.journal_two import db as j2db
    auth_db.init_db()
    charts_layout_service._init_db()
    try:
        j2db.init_db()
    except Exception:  # noqa: BLE001 -- older layouts init the J2 schema from auth_db
        pass
    import uuid
    from api.services import watchlist_service
    from api.services.journal_two import notes as j2notes
    from api.services import auth_service
    uid = auth_service.create_user(f"addr-{uuid.uuid4().hex[:8]}@example.invalid", "Probe-Pass-2026!")["id"]
    lay = charts_layout_service.upsert("user", uid, "Probe Board", {"widgets": [], "cols": 12}, None, None)
    wl = watchlist_service.create_watchlist(uid, "Probe Watch")
    note = j2notes.create_note(uid, {"title": "Probe note", "body_md": "x"})
    from api.services.screener import saved_screens
    saved_screens.init()
    scr = saved_screens.create(uid, "Probe Scan", {"filters": []})
    want = {"layout": (str(lay["id"]), "Probe Board"), "watchlist": (str(wl["id"]), "Probe Watch"),
            "note": (str(note["id"]), "Probe note"), "screen": (str(scr["id"]), "Probe Scan")}
    for kind, k in a.KINDS.items():
        rows = k.lister(uid)
        assert isinstance(rows, list), kind
        assert all({"id", "name"} <= set(r) for r in rows), kind
        assert want[kind] in {(r["id"], r["name"]) for r in rows}, (kind, rows[:3])
        # and the address resolves to the same door a member's click would use
        assert a.resolve(uid, a.address_of(kind, want[kind][0]))["name"] == want[kind][1]


def test_the_auth_payload_carries_the_flag(monkeypatch):
    from api.routers import auth
    monkeypatch.delenv(a.ENABLED_ENV, raising=False)
    assert auth._address_space_enabled() is False
    monkeypatch.setenv(a.ENABLED_ENV, "1")
    assert auth._address_space_enabled() is True


# ── TERM-056: addresses in PUBLIC text resolve against the AUTHOR's shared objects ──────

def test_floor_text_links_only_what_the_author_shared():
    """Owner ruling 2026-09-29. A shared layout links (via its share token), a private one is
    marked private WITHOUT its name, somebody else's object and ordinary text get nothing."""
    import uuid
    from api.services import auth_db, auth_service, charts_layout_service as cls, watchlist_service
    auth_db.init_db()
    cls._init_db()
    author = auth_service.create_user(f"fl-{uuid.uuid4().hex[:8]}@example.invalid", "Probe-Pass-2026!")["id"]
    other = auth_service.create_user(f"fo-{uuid.uuid4().hex[:8]}@example.invalid", "Probe-Pass-2026!")["id"]
    private = cls.upsert("user", author, "My Secret Board", {"widgets": [], "cols": 24}, None, None)
    shared = cls.upsert("user", author, "Swing Board", {"widgets": [], "cols": 24}, None, None)
    token = cls.share(author, shared["id"])["token"]
    theirs = cls.upsert("user", other, "Not Yours", {"widgets": [], "cols": 24}, None, None)
    wl = watchlist_service.create_watchlist(author, "Semis", is_public=True)

    text = (f"see L:{shared['id']} and L:{private['id']} and L:{theirs['id']}, "
            f"W:{wl['id']} -- also W:3 in a row")
    links = {l["address"]: l for l in a.shared_links(author, text)}

    assert links[f"L:{shared['id']}"]["shared"] is True
    assert links[f"L:{shared['id']}"]["to"] == f"/charts?openShared={token}"
    assert links[f"L:{shared['id']}"]["name"] == "Swing Board"
    assert links[f"L:{private['id']}"] == {"address": f"L:{private['id']}", "kind": "layout",
                                          "kind_label": "Chart layout", "shared": False}
    assert "My Secret Board" not in str(links)                  # a private title never leaks
    assert f"L:{theirs['id']}" not in links                     # not the author's: no chip
    assert links[f"W:{wl['id']}"]["to"] == f"/charts?openWatchlist=community:{wl['id']}"
    assert "W:3" not in links                                   # ordinary text stays text
    assert a.shared_links(None, text) == []                     # the mentor has no objects


def test_the_floor_payload_carries_the_links():
    from api.routers import community as router_mod
    import uuid
    from api.services import auth_db, auth_service, charts_layout_service as cls
    auth_db.init_db()
    cls._init_db()
    author = auth_service.create_user(f"fp-{uuid.uuid4().hex[:8]}@example.invalid", "Probe-Pass-2026!")["id"]
    lay = cls.upsert("user", author, "Board", {"widgets": [], "cols": 24}, None, None)
    body = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"L:%s"}]}]}' % lay["id"]
    items = router_mod._attach_authors([{"author_id": author, "body": body}, {"author_id": author, "body": "no address"}])
    assert items[0]["address_links"][0]["shared"] is False
    assert "address_links" not in items[1]


def test_floor_text_links_a_saved_screen_only_when_the_author_made_it_public():
    """Build D (2026-09-30): a public saved screen links through its share token; a private
    one is marked private WITHOUT its name; somebody else's gets nothing."""
    import uuid
    from api.services import auth_db, auth_service
    from api.services.screener import saved_screens as ss
    auth_db.init_db()
    ss.init()
    author = auth_service.create_user(f"fs-{uuid.uuid4().hex[:8]}@example.invalid", "Probe-Pass-2026!")["id"]
    other = auth_service.create_user(f"fx-{uuid.uuid4().hex[:8]}@example.invalid", "Probe-Pass-2026!")["id"]
    pub = ss.create(author, "Leaders Scan", {"filters": []}, is_public=True)
    priv = ss.create(author, "My Secret Scan", {"filters": []})
    theirs = ss.create(other, "Not Yours", {"filters": []}, is_public=True)
    links = {l["address"]: l for l in a.shared_links(
        author, f"try S:{pub['id']} or S:{priv['id']} or S:{theirs['id']}")}
    assert links[f"S:{pub['id']}"]["to"] == f"/screener?screen={pub['share_token']}"
    assert links[f"S:{pub['id']}"]["name"] == "Leaders Scan"
    assert links[f"S:{priv['id']}"] == {"address": f"S:{priv['id']}", "kind": "screen",
                                        "kind_label": "Saved screen", "shared": False}
    assert "My Secret Scan" not in str(links)
    assert f"S:{theirs['id']}" not in links
