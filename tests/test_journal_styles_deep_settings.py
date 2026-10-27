"""W11-R54 (F-ALIAS-1 part S, review F-ALIAS-1R I-1 -- LIVE ON MASTER): a deep settings value on a block kept VERBATIM.

`_clean_blocks` keeps three kinds of block's settings verbatim (an id stored before the grammar, a family slot stored
before it, a newer version's block -- `kind is None`) with only a byte cap. A 289-byte body whose unknown block
`zzfuture` held a list 96 deep was STORED, and then every door that serves the style answered 500 (the route's answer
passed pydantic-core's serialisation depth): the whole styles list, GET, every PUT, /default and DELETE.

Now: (1) all three branches go through ONE check, `_check_kept_verbatim`, refusing past `MAX_KEPT_SETTINGS_DEPTH`
with a 400 sentence; (2) a row ALREADY stored with deep settings (before the cap) is served with that block's settings
empty (`_servable_blocks`, in `_row`), so no door can 500 on it. Proved with a deep row written straight into a temp DB.
"""
from __future__ import annotations

import importlib
import json
import os
import tempfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw
from api.services.journal_two import journal_styles as js

URL = "/api/j2/journal-styles"
CAP = js.MAX_KEPT_SETTINGS_DEPTH
UID = "u-deep-1"
OTHER = "u-deep-2"


def nested_list(depth: int) -> list:
    """A list nested `depth` deep (the outermost counts 1): [[[...]]]."""
    v: list = []
    for _ in range(depth - 1):
        v = [v]
    return v


def nested_dict(depth: int) -> dict:
    v: dict = {}
    for _ in range(depth - 1):
        v = {"x": v}
    return v


def settings_of_depth(depth: int, shape: str) -> dict:
    """A settings OBJECT exactly `depth` deep (the settings object counts 1), its inner value of `shape`."""
    return {"x": nested_list(depth - 1) if shape == "list" else nested_dict(depth - 1)}


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(tmp.name + suffix)
        except OSError:
            pass


@pytest.fixture
def client(db_path, monkeypatch):
    monkeypatch.setenv(js.FLAG, "1")
    from api.routers import notebook_journal_styles as r
    app = FastAPI()
    app.include_router(r.router)
    user = {"id": UID, "role": "member", "plan": "pro"}
    app.dependency_overrides[authmw.get_current_user] = lambda: dict(user)
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)
    yield TestClient(app)
    app.dependency_overrides.clear()


def _style_body(settings, block="zzfuture") -> dict:
    return {"name": "T", "kindId": "weekend_prep", "blocks": [{"block": block, "settings": settings}]}


def _count() -> int:
    from api.services.auth_db import get_connection
    c = get_connection()
    try:
        return c.execute("SELECT COUNT(*) FROM j2_journal_styles").fetchone()[0]
    finally:
        c.close()


# ── the reviewer's failing input, exactly ─────────────────────────────────────────────────────────

def test_the_reviewers_289_byte_body_is_a_400_and_nothing_is_stored(client):
    raw = json.dumps({"name": "T96", "kindId": "weekend_prep",
                      "blocks": [{"block": "zzfuture", "settings": {"x": nested_list(96)}}]}).encode()
    assert len(raw) == 289                                                    # the review's input, byte for byte
    r = client.post(URL, content=raw, headers={"Content-Type": "application/json"})
    assert r.status_code == 400 and r.json()["detail"] == js.S_SETTINGS_TOO_DEEP, r.text
    assert _count() == 0
    assert client.get(URL).status_code == 200                                  # the list still serves


# ── the boundary, both shapes, on create and update ───────────────────────────────────────────────

@pytest.mark.parametrize("shape", ["list", "dict"])
def test_at_the_cap_is_kept_verbatim_and_one_past_it_is_refused(client, shape):
    at, past = settings_of_depth(CAP, shape), settings_of_depth(CAP + 1, shape)
    made = client.post(URL, json=_style_body(at))
    assert made.status_code == 200, made.text
    sid = made.json()["style"]["id"]
    assert made.json()["style"]["blocks"][0]["settings"] == at                 # kept verbatim, byte for byte
    assert client.get(f"{URL}/{sid}").json()["style"]["blocks"][0]["settings"] == at
    r = client.post(URL, json=_style_body(past))
    assert r.status_code == 400 and r.json()["detail"] == js.S_SETTINGS_TOO_DEEP, r.text
    r = client.put(f"{URL}/{sid}", json={"blocks": [{"block": "zzfuture", "settings": past}]})
    assert r.status_code == 400 and r.json()["detail"] == js.S_SETTINGS_TOO_DEEP, r.text
    assert client.get(f"{URL}/{sid}").json()["style"]["blocks"][0]["settings"] == at   # the refused PUT changed nothing
    assert client.get(URL).status_code == 200


def test_CONTROL_a_shallow_unknown_block_is_kept_and_the_byte_cap_still_answers_its_own_sentence(client):
    shallow = {"a": [1, {"b": 2}]}
    made = client.post(URL, json=_style_body(shallow))
    assert made.status_code == 200 and made.json()["style"]["blocks"][0]["settings"] == shallow
    wide = {"x": "y" * (js.MAX_UNKNOWN_SETTINGS_BYTES + 1)}
    r = client.post(URL, json=_style_body(wide))
    assert r.status_code == 400 and r.json()["detail"] == js.S_SETTINGS_TOO_LARGE


def test_every_verbatim_branch_takes_the_one_depth_check():
    """The three branches of `_clean_blocks` that keep settings verbatim, called directly: a newer version's block
    (`kind is None`), an id the grammar refuses that was stored so (legacy), and a family slot stored before the
    grammar (legacy). At the cap each is kept; one past it each is refused with the depth sentence."""
    for shape in ("list", "dict"):
        at, past = settings_of_depth(CAP, shape), settings_of_depth(CAP + 1, shape)
        cases = [("zzfuture", None), ("bad id!", "legacy"), ("built_a", "legacy")]
        for bid, legacy in cases:
            def run(settings):
                keep = {js._legacy_key(bid, settings)} if legacy else None
                return js._clean_blocks([{"block": bid, "settings": settings}], legacy=keep)
            assert run(at)[0]["settings"] == at, (bid, shape)
            with pytest.raises(js.StyleValidationError, match=f"^{js.S_SETTINGS_TOO_DEEP}$"):
                run(past)


# ── the read-side guard: a row stored BEFORE the cap ──────────────────────────────────────────────

def _seed_deep_row(depth: int = 96) -> str:
    """A style row written straight into the temp DB, as one stored before the cap was: a `zzfuture` block whose
    settings nest `depth + 1` deep, beside an ordinary block."""
    made = js.create_style(UID, {"name": "Old", "kindId": "weekend_prep",
                                 "blocks": [{"block": "chart", "settings": {}}]})
    from api.services.auth_db import get_connection
    c = get_connection()
    try:
        stored = json.loads(c.execute("SELECT blocks_json FROM j2_journal_styles WHERE id = ?",
                                      (made["id"],)).fetchone()[0])
        stored.append({"block": "zzfuture", "enabled": True, "settings": {"x": nested_list(depth)}})
        c.execute("UPDATE j2_journal_styles SET blocks_json = ? WHERE id = ?", (json.dumps(stored), made["id"]))
        c.commit()
    finally:
        c.close()
    return made["id"]


def test_a_stored_deep_row_cannot_500_any_door(client):
    sid = _seed_deep_row()
    listed = client.get(URL)
    assert listed.status_code == 200, listed.text[:300]
    got = client.get(f"{URL}/{sid}")
    assert got.status_code == 200, got.text[:300]
    blocks = got.json()["style"]["blocks"]
    assert [b["block"] for b in blocks] == ["chart", "zzfuture"]                  # the block stays visible
    assert blocks[1]["settings"] == {}                                            # its unservable value does not
    renamed = client.put(f"{URL}/{sid}", json={"name": "fine"})
    assert renamed.status_code == 200 and renamed.json()["style"]["name"] == "fine", renamed.text[:300]
    default = client.post(f"{URL}/{sid}/default")
    assert default.status_code == 200, default.text[:300]
    saved = client.put(f"{URL}/{sid}", json={"blocks": blocks})                   # saving what was served works
    assert saved.status_code == 200, saved.text[:300]
    gone = client.delete(f"{URL}/{sid}")
    assert gone.status_code == 200, gone.text[:300]
    assert client.get(URL).status_code == 200


def test_CONTROL_the_seeded_row_is_the_failure_it_stands_for():
    """Without the guard, the seeded value is what 500ed: FastAPI's own serialisation refuses it."""
    from fastapi.encoders import jsonable_encoder  # noqa: F401 -- the import the route answer path uses
    from pydantic_core import to_jsonable_python
    deep = {"style": {"blocks": [{"settings": {"x": nested_list(96)}}]}}
    with pytest.raises(ValueError):
        to_jsonable_python(deep)
    shallow = {"style": {"blocks": [{"settings": settings_of_depth(CAP, "list")}]}}
    assert to_jsonable_python(shallow) == shallow
