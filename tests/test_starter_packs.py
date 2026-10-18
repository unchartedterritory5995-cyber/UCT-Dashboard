"""P5 Task 4 -- installing a starter pack, and the seen state.

`api/services/journal_two/starter_packs.py` installs one pack: its three firm style rows (seeded by Task 3,
`seed_firm_styles`), read in seed order and adopted through P3a's shared adopt body
(`template_gallery._adopt_listed_row`, rulings P5-R-C1 / P5-R-C2), one savepoint per row, one commit.
`POST /api/j2/journal-styles/starter-packs/{pack}` serves it. What each section proves:

  * INSTALL: three styles owned by the member, each carrying `source_gallery_id`; a second install adds
    nothing (`alreadyHad`); a second pack adds its own three; the library switch has no effect (P5-R-C1).
  * SKIPPED, NOT FATAL: a firm row whose kind no longer exists is skipped and the rest install
    (P5-R-C13); a row that fails AFTER its copy was written leaves no copy behind (the savepoint, C2).
  * THE ROUTE: the one 404 for every caller while the switch is off, 402 for an unpaid member, 404 for
    an unknown pack, the rate (10/hour, 5/day) with the day's charge given back on a refusal, and the
    route declared before the `{style_id}` routes (P5-R-C15).
  * THE SEEN STATE: `notebook_starter_pack` takes exactly the two shapes R-P5-5 writes, at most 512 bytes.
  * ONE FACT IN TWO FILES: the server's `PACKS` equals the client's (`J/lib/starterPacks.js`, Task 5).
"""
from __future__ import annotations

import importlib
import json
import os
import re
import tempfile
from pathlib import Path

import pytest
from fastapi import HTTPException

from api.services.journal_two import template_gallery as gallery

ROOT = Path(__file__).resolve().parents[1]
STARTER_JS = ROOT / "app" / "src" / "pages" / "journal-2-0" / "lib" / "starterPacks.js"

MEMBER = "user-p5-installer"
OTHER = "user-p5-other"
LIBRARY = "NOTEBOOK_STYLE_LIBRARY_ENABLED"
STARTER = "NOTEBOOK_STARTER_PACKS_ENABLED"
STYLES = "NOTEBOOK_JOURNAL_STYLES_ENABLED"
URL = "/api/j2/journal-styles/starter-packs"


def _sp():
    from api.services.journal_two import starter_packs
    return starter_packs


# ── fixtures ────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def conn(monkeypatch):
    """A throwaway auth.db exactly as a boot leaves it (the fifteen firm styles seeded), both switches
    the install needs on, and the library switch OFF unless a test turns it on."""
    for name in (LIBRARY, STARTER, STYLES):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv(STARTER, "1")
    monkeypatch.setenv(STYLES, "1")
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    c = auth_db.get_connection()
    for uid in (MEMBER, OTHER):
        c.execute("INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?,?,?,?,?)",
                  (uid, f"{uid}@test.uct", "x", uid, "member"))
    c.commit()
    yield c
    c.close()
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(tmp.name + suffix)
        except OSError:
            pass


@pytest.fixture
def api(conn):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.limiter import limiter
    from api.middleware import auth_middleware as authmw
    from api.routers import notebook_journal_styles
    limiter.reset()
    app = FastAPI()
    app.include_router(notebook_journal_styles.router)
    user = {"id": MEMBER, "role": "member", "plan": "pro"}
    app.dependency_overrides[authmw.get_current_user] = lambda: dict(user)
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)
    client = TestClient(app)
    yield client
    app.dependency_overrides.clear()
    limiter.reset()


def _styles(conn, uid=MEMBER):
    return conn.execute("SELECT id, name, source_gallery_id, source_version, deleted_at FROM j2_journal_styles"
                        " WHERE user_id = ? ORDER BY rowid", (uid,)).fetchall()


def _seed_titles(pack):
    return [s["title"] for s in gallery.load_style_seed() if s["pack"] == pack]


def _firm_id(pack, index):
    s = [s for s in gallery.load_style_seed() if s["pack"] == pack][index]
    return gallery.firm_style_id(s["seedKey"])


# ── PACKS: one authority per side ─────────────────────────────────────────────────────────

def test_packs_are_the_seed_files_packs_in_order():
    seeded = []
    for s in gallery.load_style_seed():
        if s["pack"] not in seeded:
            seeded.append(s["pack"])
    assert list(_sp().PACKS) == seeded == ["swing", "day", "prop", "options", "earnings"]
    assert set(_sp().PACKS) <= set(gallery.TRADING_STYLES)


# ── 1. install ────────────────────────────────────────────────────────────────────────────

def test_installing_swing_creates_three_styles_the_member_owns_each_with_its_source(conn):
    out = _sp().install(conn, MEMBER, "swing")
    titles = _seed_titles("swing")
    assert [i["title"] for i in out["installed"]] == titles          # seed order (P5-R-T3-6)
    assert out["alreadyHad"] == [] and out["skipped"] == []
    rows = _styles(conn)
    assert len(rows) == 3
    assert [r["id"] for r in rows] == [i["styleId"] for i in out["installed"]]
    assert [r["source_gallery_id"] for r in rows] == [_firm_id("swing", i) for i in range(3)]
    assert all(r["source_version"] == 1 and r["deleted_at"] is None for r in rows)
    assert [r["name"] for r in rows] == titles
    assert _styles(conn, OTHER) == []                                 # nobody else's account moved
    # Notify is off (R-P5-2): no watch. The use is recorded, as for any adopt of another's item.
    assert conn.execute("SELECT COUNT(*) FROM j2_gallery_watches").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM j2_template_gallery_uses WHERE user_id = ?",
                        (MEMBER,)).fetchone()[0] == 3


def test_reinstall_adds_nothing(conn):
    first = _sp().install(conn, MEMBER, "swing")
    assert len(first["installed"]) == 3                               # non-vacuity: the first install did add
    again = _sp().install(conn, MEMBER, "swing")
    assert again == {"installed": [], "alreadyHad": _seed_titles("swing"), "skipped": []}
    assert len(_styles(conn)) == 3


def test_a_copy_the_member_deleted_is_not_already_had(conn):
    from api.services.journal_two import journal_styles as js
    first = _sp().install(conn, MEMBER, "swing")
    js.delete_style(MEMBER, first["installed"][0]["styleId"], conn)
    again = _sp().install(conn, MEMBER, "swing")
    assert [i["title"] for i in again["installed"]] == _seed_titles("swing")[:1]
    assert again["alreadyHad"] == _seed_titles("swing")[1:]


def test_day_after_swing_installs_days_three_as_well(conn):
    _sp().install(conn, MEMBER, "swing")
    out = _sp().install(conn, MEMBER, "day")
    assert [i["title"] for i in out["installed"]] == _seed_titles("day")
    assert out["alreadyHad"] == [] and out["skipped"] == []
    assert len(_styles(conn)) == 6


@pytest.mark.parametrize("library", ["0", "1"])
def test_the_library_switch_has_no_effect_on_install(conn, monkeypatch, library):
    monkeypatch.setenv(LIBRARY, library)
    out = _sp().install(conn, MEMBER, "prop")
    assert [i["title"] for i in out["installed"]] == _seed_titles("prop")
    assert len(_styles(conn)) == 3


def test_install_needs_both_its_switches(conn, monkeypatch):
    monkeypatch.setenv(STARTER, "0")
    assert _sp().install(conn, MEMBER, "swing") is None
    monkeypatch.setenv(STARTER, "1")
    monkeypatch.setenv(STYLES, "0")
    assert _sp().install(conn, MEMBER, "swing") is None
    assert _styles(conn) == []


def test_an_unknown_pack_installs_nothing(conn):
    assert _sp().install(conn, MEMBER, "long_term") is None           # a trading style, but not a pack
    assert _sp().install(conn, MEMBER, "nope") is None
    assert _styles(conn) == []


def test_a_hidden_firm_row_is_not_part_of_its_pack(conn):
    hidden = _firm_id("swing", 1)
    conn.execute("UPDATE j2_template_gallery SET hidden = 1 WHERE id = ?", (hidden,))
    conn.commit()
    out = _sp().install(conn, MEMBER, "swing")
    titles = _seed_titles("swing")
    assert [i["title"] for i in out["installed"]] == [titles[0], titles[2]]
    assert out["alreadyHad"] == [] and out["skipped"] == []


# ── 2. skipped, not fatal ─────────────────────────────────────────────────────────────────

def test_an_unbuildable_firm_row_is_skipped_not_fatal(conn):
    bad = _firm_id("swing", 1)
    payload = json.loads(conn.execute("SELECT payload_json FROM j2_template_gallery WHERE id = ?",
                                      (bad,)).fetchone()[0])
    payload["kindId"] = "a_kind_a_later_release_removed"
    conn.execute("UPDATE j2_template_gallery SET payload_json = ? WHERE id = ?", (json.dumps(payload), bad))
    conn.commit()
    out = _sp().install(conn, MEMBER, "swing")
    titles = _seed_titles("swing")
    assert [i["title"] for i in out["installed"]] == [titles[0], titles[2]]
    assert out["skipped"] == [titles[1]] and out["alreadyHad"] == []
    assert [r["source_gallery_id"] for r in _styles(conn)] == [_firm_id("swing", 0), _firm_id("swing", 2)]


def test_a_removed_block_installs_minus_the_block(conn):
    # P5-R-C13: a block a later release removes is dropped by the adopt rule (`_safe_listed`), never skipped.
    gid = _firm_id("swing", 0)
    payload = json.loads(conn.execute("SELECT payload_json FROM j2_template_gallery WHERE id = ?",
                                      (gid,)).fetchone()[0])
    kept = [b["block"] for b in payload["blocks"]]
    payload["blocks"] = payload["blocks"] + [{"block": "aBlockALaterReleaseRemoved", "enabled": True}]
    conn.execute("UPDATE j2_template_gallery SET payload_json = ? WHERE id = ?", (json.dumps(payload), gid))
    conn.commit()
    out = _sp().install(conn, MEMBER, "swing")
    assert out["skipped"] == [] and len(out["installed"]) == 3
    blocks = json.loads(conn.execute("SELECT blocks_json FROM j2_journal_styles WHERE source_gallery_id = ?",
                                     (gid,)).fetchone()[0])
    assert [b["block"] for b in blocks] == kept


def test_a_row_that_fails_after_its_copy_is_written_leaves_no_copy(conn, monkeypatch):
    # The savepoint (P5-R-C2): the second row's copy and its use are written, THEN its adopt fails. Only
    # that row is undone; the rows before and after it stay, under the one commit.
    real = gallery._author_label
    failing = _firm_id("swing", 1)

    def label(row):
        if row["id"] == failing:
            raise gallery.GalleryError("boom after the write")
        return real(row)

    monkeypatch.setattr(gallery, "_author_label", label)
    out = _sp().install(conn, MEMBER, "swing")
    titles = _seed_titles("swing")
    assert out["skipped"] == [titles[1]]
    assert [i["title"] for i in out["installed"]] == [titles[0], titles[2]]
    assert [r["source_gallery_id"] for r in _styles(conn)] == [_firm_id("swing", 0), _firm_id("swing", 2)]
    assert conn.execute("SELECT COUNT(*) FROM j2_template_gallery_uses WHERE gallery_id = ?",
                        (failing,)).fetchone()[0] == 0


def test_an_unexpected_error_rolls_the_whole_pack_back(conn, monkeypatch):
    real = gallery._author_label
    failing = _firm_id("swing", 2)

    def label(row):
        if row["id"] == failing:
            raise RuntimeError("not a gallery refusal")
        return real(row)

    monkeypatch.setattr(gallery, "_author_label", label)
    with pytest.raises(RuntimeError):
        _sp().install(conn, MEMBER, "swing")
    assert _styles(conn) == []


# ── 3. the route ──────────────────────────────────────────────────────────────────────────

def test_the_route_installs_a_pack(api, conn):
    r = api.post(f"{URL}/swing")
    assert r.status_code == 200, r.text
    body = r.json()
    assert [i["title"] for i in body["installed"]] == _seed_titles("swing")
    assert set(body) == {"installed", "alreadyHad", "skipped"}
    assert all(set(i) == {"styleId", "title"} for i in body["installed"])
    assert api.post(f"{URL}/swing").json()["alreadyHad"] == _seed_titles("swing")


@pytest.mark.parametrize("off", [STARTER, STYLES])
def test_while_a_switch_is_off_every_caller_gets_the_identical_404(api, conn, monkeypatch, off):
    from api.middleware import auth_middleware as authmw
    monkeypatch.setenv(off, "0")
    app = api.app
    paid = api.post(f"{URL}/swing")
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: {"id": MEMBER, "role": "member",
                                                                           "plan": "free"}
    unpaid = api.post(f"{URL}/swing")
    app.dependency_overrides.pop(authmw.get_current_user, None)
    app.dependency_overrides.pop(authmw.get_current_user_with_plan, None)
    signed_out = api.post(f"{URL}/swing", content=b"{bad")
    assert (paid.status_code, unpaid.status_code, signed_out.status_code) == (404, 404, 404)
    assert paid.json() == unpaid.json() == signed_out.json() == {"detail": "Not found"}
    assert _styles(conn) == []


def test_with_the_switch_on_an_unpaid_member_gets_402(api, conn):
    from api.middleware import auth_middleware as authmw
    api.app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: {"id": MEMBER, "role": "member",
                                                                               "plan": "free"}
    r = api.post(f"{URL}/swing")
    assert r.status_code == 402
    assert _styles(conn) == []


def test_with_the_switch_on_signed_out_is_401(api, conn):
    from api.middleware import auth_middleware as authmw
    api.app.dependency_overrides.pop(authmw.get_current_user, None)
    api.app.dependency_overrides.pop(authmw.get_current_user_with_plan, None)
    assert api.post(f"{URL}/swing").status_code == 401


@pytest.mark.parametrize("pack", ["nope", "long_term", "SWING", "restore", "default"])
def test_an_unknown_pack_is_a_404(api, conn, pack):
    r = api.post(f"{URL}/{pack}")
    assert r.status_code == 404 and r.json() == {"detail": "Not found"}
    assert _styles(conn) == []


def test_the_starter_pack_route_is_declared_before_the_style_id_routes():
    from api.routers import notebook_journal_styles as router_mod
    paths = [(sorted(r.methods), r.path) for r in router_mod.router.routes]
    starter = paths.index((["POST"], "/api/j2/journal-styles/starter-packs/{pack}"))
    for path in ("/api/j2/journal-styles/{style_id}/restore", "/api/j2/journal-styles/{style_id}/default"):
        assert starter < paths.index((["POST"], path)), path


def _used(scope_subject=MEMBER):
    from api.services import daily_counters
    from api.services.journal_two.calendar import et_today
    from api.routers import notebook_journal_styles as router_mod
    return daily_counters.value(et_today(), router_mod.DAILY_STARTER_PACK_SCOPE, scope_subject)


def test_the_rate_is_five_a_day_and_the_sixth_is_refused_with_its_sentence(api, conn):
    from api.routers import notebook_journal_styles as router_mod
    for _ in range(5):
        assert api.post(f"{URL}/swing").status_code == 200
    assert _used() == 5
    r = api.post(f"{URL}/day")
    assert r.status_code == 429 and r.json()["detail"] == router_mod.STARTER_PACK_RATE_SENTENCE
    assert _used() == 5
    assert len(_styles(conn)) == 3                                    # the refused day pack added nothing


def test_the_hourly_rate_is_ten(api, conn, monkeypatch):
    from api.routers import notebook_journal_styles as router_mod
    monkeypatch.setenv("NOTEBOOK_STARTER_PACK_DAILY_CAP", "100")
    assert router_mod.STARTER_PACK_RATE == "10/hour"
    for _ in range(10):
        assert api.post(f"{URL}/swing").status_code == 200
    r = api.post(f"{URL}/swing")
    assert r.status_code == 429 and r.json()["detail"] == router_mod.STARTER_PACK_RATE_SENTENCE


def test_a_refusal_gives_the_days_charge_back(api, conn, monkeypatch):
    sp = _sp()
    assert api.post(f"{URL}/swing").status_code == 200
    assert _used() == 1                                               # non-vacuity: a success IS charged
    assert api.post(f"{URL}/nope").status_code == 404
    assert _used() == 1                                               # an unknown pack is never charged

    def boom(*_a, **_k):
        raise RuntimeError("install failed")

    monkeypatch.setattr(sp, "install", boom)
    with pytest.raises(RuntimeError):
        api.post(f"{URL}/day")
    assert _used() == 1                                               # the failure gave it back
    monkeypatch.setattr(sp, "install", lambda *_a, **_k: None)
    assert api.post(f"{URL}/day").status_code == 404
    assert _used() == 1                                               # so did the not-found


# ── 4. the seen state: notebook_starter_pack ──────────────────────────────────────────────

KEY = "notebook_starter_pack"
AT = "2026-10-17T14:30:00.000Z"


def _check(value):
    from api.routers import auth as auth_router
    auth_router._validate_preference(KEY, value)


def test_the_key_has_its_own_named_validator():
    from api.routers import auth as auth_router
    assert auth_router._PREFERENCE_KEYS[KEY] == KEY
    assert auth_router._PREFERENCE_KEYS[KEY] != auth_router._PREF_OPAQUE


@pytest.mark.parametrize("value", [
    json.dumps({"v": 1, "state": "installed", "pack": "swing", "at": AT}),
    json.dumps({"v": 1, "state": "dismissed", "at": AT}),
] + [json.dumps({"v": 1, "state": "installed", "pack": p, "at": AT}) for p in ("day", "prop", "options",
                                                                               "earnings")])
def test_the_two_shapes_r_p5_5_writes_are_accepted(value):
    _check(value)


_OVER = json.dumps({"v": 1, "state": "dismissed", "at": "x" * 600})


@pytest.mark.parametrize("value", [
    "", "x", "null", "[]", "1", '"installed"',
    json.dumps({"v": 2, "state": "dismissed", "at": AT}),
    json.dumps({"v": True, "state": "dismissed", "at": AT}),
    json.dumps({"v": "1", "state": "dismissed", "at": AT}),
    json.dumps({"state": "dismissed", "at": AT}),
    json.dumps({"v": 1, "state": "done", "at": AT}),
    json.dumps({"v": 1, "at": AT}),
    json.dumps({"v": 1, "state": "dismissed"}),
    json.dumps({"v": 1, "state": "dismissed", "at": ""}),
    json.dumps({"v": 1, "state": "dismissed", "at": 1760000000}),
    json.dumps({"v": 1, "state": "installed", "at": AT}),                       # installed names its pack
    json.dumps({"v": 1, "state": "installed", "pack": "long_term", "at": AT}),
    json.dumps({"v": 1, "state": "installed", "pack": "SWING", "at": AT}),
    json.dumps({"v": 1, "state": "installed", "pack": None, "at": AT}),
    json.dumps({"v": 1, "state": "dismissed", "pack": "swing", "at": AT}),      # dismissed names none
    json.dumps({"v": 1, "state": "dismissed", "at": AT, "extra": 1}),
    '{"v": 1, "state": "dismissed", "at": NaN}',
    '{"v": 1, "state": "dismissed", "at": "\\ud800"}',
    _OVER,
])
def test_anything_else_gets_the_one_400(value):
    from api.routers import auth as auth_router
    with pytest.raises(HTTPException) as e:
        _check(value)
    assert e.value.status_code == 400
    assert e.value.detail == auth_router._STARTER_PACK_REFUSAL


def test_the_size_cap_is_512_bytes():
    # A valid blob padded with JSON whitespace isolates the byte cap from every field rule:
    # exactly 512 bytes is accepted, one more is refused.
    valid = json.dumps({"v": 1, "state": "installed", "pack": "swing", "at": AT})
    at_cap = valid + " " * (512 - len(valid.encode("utf-8")))
    assert len(at_cap.encode("utf-8")) == 512
    _check(at_cap)
    over = at_cap + " "
    with pytest.raises(HTTPException) as e:
        _check(over)
    assert e.value.status_code == 400


# ── 5. one fact in two files ──────────────────────────────────────────────────────────────

_PACKS_DECL = re.compile(r"\bexport\s+const\s+PACKS\s*=\s*(?:Object\.freeze\(\s*)?\[(.*?)\]", re.S)
_PACK_KEY = re.compile(r"\bkey\s*:\s*['\"]([^'\"]+)['\"]")


def client_packs(src: str) -> list[str]:
    """The `key`s of `J/lib/starterPacks.js` `PACKS` (an array of `{key, label}`), in order."""
    m = _PACKS_DECL.search(src)
    assert m, "PACKS is not declared as an exported array"
    keys = _PACK_KEY.findall(m.group(1))
    assert keys, "PACKS declares no {key: ...} entries"
    return keys


def test_the_parse_reads_the_planned_shape_and_sees_a_difference():
    planned = ("export const PACKS = Object.freeze([{key:'swing',label:'Swing'},{key:'day',label:'Day'},"
               "{key:'prop',label:'Prop'},{key:'options',label:'Options'},{key:'earnings',label:'Earnings'}])")
    assert client_packs(planned) == list(_sp().PACKS)
    assert client_packs(planned.replace("'prop'", "'long_term'")) != list(_sp().PACKS)     # control


def test_client_packs_equal_server_packs():
    if not STARTER_JS.exists():
        pytest.xfail("J/lib/starterPacks.js is created by P5 Task 5; once it exists this comparison runs")
    assert client_packs(STARTER_JS.read_text(encoding="utf-8")) == list(_sp().PACKS)
