"""Studio R4 (Indicators backlog 43): the AUTHOR's status headline on a shared indicator.

The share preview (`GET /shared/{token}`), the row an install returns (`POST
/shared/{token}/install`) and each library entry (`GET /library`) carry three fields, read from the
version the link PINS and never recomputed for the viewer:

  * ``headline``: the sentence the author's status panel showed for that version, as the owner's
    browser recorded it (`POST /{def_id}/status-headline`), WITHOUT a trailing full stop; None
    when nothing was recorded;
  * ``engine_version``: the engine that recorded it, as a string; None with a None headline;
  * ``headline_current``: beside a headline only, False exactly when that engine differs from the
    one the server serves today (`svc.SCRIPT_ENGINE_VERSION`, read from `scriptEngineVersion.js`),
    and absent when the server cannot read its own.

Each rail below has a control that must read the other way, so a green is the field's, not a
blind check's.
"""
from __future__ import annotations

import contextlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import user_definitions as router_mod
from api.services import indicator_alert_service as ias
from api.services import user_definitions as svc

OWNER, FRIEND, OTHER = "u-headline-owner", "u-headline-friend", "u-headline-other"
BASE = "/api/user-definitions"
FAULT = "Our engine could not finish this script. That is on us, not your script."


def _definition(def_id: str, name: str = "Shared Screen") -> dict:
    close = {"type": "series", "name": "close"}
    tree = {"type": "op", "name": ">", "args": [close, {"type": "num", "value": 10}]}
    return {
        "schemaVersion": 1, "id": def_id, "version": 1,
        "meta": {"name": name, "shortName": "SHR", "repaint": "non-repainting"},
        "compute": {"kind": "ast", "ast": tree, "fn": svc.ast_hash(tree)},
        "placement": {"target": "price"},
        "plots": [{"key": "value", "style": "line", "role": "primary"}],
        "inputs": [],
    }


@pytest.fixture(autouse=True)
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()
    # a known serving engine, so "current" is a fact of the test and not of the checkout
    monkeypatch.setattr(svc, "SCRIPT_ENGINE_VERSION", 71)


def _as(user_id: str) -> TestClient:
    app = FastAPI()
    app.include_router(router_mod.router)
    app.dependency_overrides[get_current_user_with_plan] = \
        lambda: {"id": user_id, "role": "member", "plan": "premium"}
    return TestClient(app)


def _shared() -> tuple[str, str]:
    """``(def_id, token)``: one live definition of OWNER's, shared."""
    def_id = svc.new_def_id()
    svc.save(OWNER, def_id, _definition(def_id))
    return def_id, svc.share(OWNER, def_id)["token"]


def _record(def_id: str, headline: str, *, engine: int = 71, version: int = 1, who: str = OWNER):
    return _as(who).post(f"{BASE}/{def_id}/status-headline",
                         json={"version": version, "engine": engine, "headline": headline})


def _library_entry(token: str) -> dict:
    got = _as(FRIEND).get(f"{BASE}/library")
    assert got.status_code == 200, got.text
    entries = [e for e in got.json()["entries"] if e["token"] == token]
    assert len(entries) == 1, got.json()
    return entries[0]


# -- 1. every route carries the fields ---------------------------------------------------------------

def test_the_PREVIEW_carries_the_authors_headline_and_engine():
    def_id, token = _shared()
    assert _record(def_id, "Runs fully").status_code == 200
    body = _as(FRIEND).get(f"{BASE}/shared/{token}").json()
    assert body["headline"] == "Runs fully"
    assert body["engine_version"] == "71"
    assert body["headline_current"] is True
    assert "author_id" not in body and OWNER not in str(body)          # nothing private rides with it


def test_the_INSTALL_answer_carries_the_same_fields():
    def_id, token = _shared()
    _record(def_id, "Runs on the chart, 2 values withheld (not guessed)")
    got = _as(FRIEND).post(f"{BASE}/shared/{token}/install")
    assert got.status_code == 200, got.text
    row = got.json()
    assert row["headline"] == "Runs on the chart, 2 values withheld (not guessed)"
    assert row["engine_version"] == "71" and row["headline_current"] is True
    assert row["def_id"] != def_id                                      # CONTROL: it is the installer's row
    assert OWNER not in str(row)


def test_each_LIBRARY_entry_carries_the_fields():
    def_id, token = _shared()
    _record(def_id, "Runs fully")
    assert svc.publish(OWNER, def_id)["listed"] is True
    entry = _library_entry(token)
    assert (entry["headline"], entry["engine_version"], entry["headline_current"]) == ("Runs fully", "71", True)
    assert OWNER not in str(entry)


# -- 2. null when there is no sentence ----------------------------------------------------------------

def test_NO_recorded_sentence_is_null_on_every_route_and_carries_no_current_flag():
    def_id, token = _shared()
    svc.publish(OWNER, def_id)
    preview = _as(FRIEND).get(f"{BASE}/shared/{token}").json()
    entry = _library_entry(token)
    install = _as(FRIEND).post(f"{BASE}/shared/{token}/install").json()
    for answer in (preview, entry, install):
        assert answer["headline"] is None and answer["engine_version"] is None
        assert "headline_current" not in answer
    # CONTROL: the same link answers a headline the moment its author records one
    _record(def_id, "Runs fully")
    assert _as(FRIEND).get(f"{BASE}/shared/{token}").json()["headline"] == "Runs fully"


def test_the_headline_is_the_PINNED_versions_not_the_newest():
    """A sentence describes ONE stored version. The link serves the version it pins; an edit the
    author saved since (and has not re-shared) has its own sentence, or none."""
    def_id, token = _shared()
    _record(def_id, "Runs fully", version=1)
    svc.save(OWNER, def_id, _definition(def_id, name="Edited"))                 # version 2, link still pins 1
    assert svc.get(OWNER, def_id)["version"] == 2
    _record(def_id, "Not yet: Imported libraries", version=2)
    assert _as(FRIEND).get(f"{BASE}/shared/{token}").json()["headline"] == "Runs fully"
    # CONTROL: re-sharing moves the pin to version 2, and the answer moves with it
    svc.share(OWNER, def_id)
    assert _as(FRIEND).get(f"{BASE}/shared/{token}").json()["headline"] == "Not yet: Imported libraries"


def test_a_new_version_has_NO_headline_until_one_is_recorded_for_it():
    def_id, _ = _shared()
    _record(def_id, "Runs fully", version=1)
    svc.save(OWNER, def_id, _definition(def_id, name="Edited"))
    token = svc.share(OWNER, def_id)["token"]                                   # pins version 2
    assert _as(FRIEND).get(f"{BASE}/shared/{token}").json()["headline"] is None


# -- 3. headline_current: false ONLY on a real stamp difference -----------------------------------------

def test_headline_current_is_FALSE_only_when_the_recording_engine_differs():
    def_id, token = _shared()
    _record(def_id, "Runs fully", engine=70)
    body = _as(FRIEND).get(f"{BASE}/shared/{token}").json()
    assert body["engine_version"] == "70" and body["headline_current"] is False
    # CONTROL: the same sentence recorded under today's engine is current
    _record(def_id, "Runs fully", engine=71)
    body = _as(FRIEND).get(f"{BASE}/shared/{token}").json()
    assert body["engine_version"] == "71" and body["headline_current"] is True


def test_headline_current_follows_the_SERVED_engine_not_a_literal(monkeypatch):
    def_id, token = _shared()
    _record(def_id, "Runs fully", engine=71)
    monkeypatch.setattr(svc, "SCRIPT_ENGINE_VERSION", 72)                      # the server moved on
    assert _as(FRIEND).get(f"{BASE}/shared/{token}").json()["headline_current"] is False


def test_an_UNREADABLE_serving_engine_omits_headline_current_and_invents_nothing(monkeypatch):
    def_id, token = _shared()
    _record(def_id, "Runs fully", engine=71)
    monkeypatch.setattr(svc, "SCRIPT_ENGINE_VERSION", None)
    body = _as(FRIEND).get(f"{BASE}/shared/{token}").json()
    assert body["headline"] == "Runs fully" and body["engine_version"] == "71"
    assert "headline_current" not in body


def test_the_server_reads_its_engine_from_the_browsers_declaration():
    """`headline_current` compares against the ONE authority every server lane reads."""
    assert isinstance(svc.read_script_engine_version(), int)


# -- 4. the trailing full stop ----------------------------------------------------------------------

def test_the_TRAILING_full_stop_is_stripped_and_an_inner_one_is_kept():
    def_id, token = _shared()
    _record(def_id, FAULT)
    body = _as(FRIEND).get(f"{BASE}/shared/{token}").json()
    assert body["headline"] == "Our engine could not finish this script. That is on us, not your script"
    # CONTROL: a sentence with no full stop is served as written
    _record(def_id, "Runs; not in screens or scans")
    assert _as(FRIEND).get(f"{BASE}/shared/{token}").json()["headline"] == "Runs; not in screens or scans"


@pytest.mark.parametrize("text,served", [
    ("Runs fully.", "Runs fully"), ("Runs fully. ", "Runs fully"), ("Runs fully...", "Runs fully"),
    ("  Runs fully  ", "Runs fully"), ("Runs fully", "Runs fully"), (".", None), ("   ", None), (None, None),
])
def test_served_headline(text, served):
    assert svc.served_headline(text) == served


# -- 5. the record door -----------------------------------------------------------------------------

def test_only_the_OWNER_records_and_only_about_the_LIVE_version():
    def_id, token = _shared()
    assert _record(def_id, "Runs fully", who=OTHER).status_code == 404          # not theirs
    assert _record(def_id, "Runs fully", version=2).status_code == 409          # not the live version
    assert _record(def_id, "   ").status_code == 400                            # blank
    assert _record(def_id, ".").status_code == 400                              # blank once served
    assert _record(def_id, "x" * (svc.MAX_STATUS_HEADLINE_CHARS + 1)).status_code == 422
    assert _as(FRIEND).get(f"{BASE}/shared/{token}").json()["headline"] is None
    # CONTROL: the owner, the live version, a sentence
    got = _record(def_id, "Runs fully")
    assert got.status_code == 200, got.text
    assert got.json() == {"def_id": def_id, "version": 1, "engine": 71, "headline": "Runs fully"}


def test_a_DELETED_definition_takes_no_headline():
    def_id, _ = _shared()
    svc.soft_delete(OWNER, def_id)
    assert _record(def_id, "Runs fully", version=2).status_code == 404


def test_the_record_is_APPEND_ONLY_and_the_newest_row_wins():
    def_id, token = _shared()
    _record(def_id, "Runs fully")
    _record(def_id, "Runs on the chart")
    assert _as(FRIEND).get(f"{BASE}/shared/{token}").json()["headline"] == "Runs on the chart"
    with contextlib.closing(svc._connect()) as c:
        n = c.execute("SELECT COUNT(*) FROM definition_status_headlines").fetchone()[0]
    assert n == 2


def test_an_account_deletion_takes_the_members_headlines_with_it():
    from api.services import user_definitions_erasure as ude
    def_id, _ = _shared()
    _record(def_id, "Runs fully")
    assert "definition_status_headlines" in ude.MEMBER_TABLES
    report = svc.purge_user(OWNER)
    assert report["rows_deleted"]["definition_status_headlines"] == 1
