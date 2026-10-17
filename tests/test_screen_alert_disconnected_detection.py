"""A0 — a saved-scan alert subscription disconnected from its formula is DETECTED.

`screen_alert_subs` is keyed by the result identity the member subscribed to. Editing
the formula moves the identity its results are filed under; definition semantics 2
suffixes it (`~s2`). Neither moves the subscription, so it silently reads a key
nothing is written to (Phase A, PA1 N7; A2 plan N11). Re-keying is A2's job — these
tests hold the DETECTOR, against the real definition store, and prove it writes
nothing.
"""
from __future__ import annotations

import pytest

from api.services import indicator_alert_service as ias
from api.services import user_definitions as ud
from api.services.screener import screen_alert_integrity as sai
from api.services.screener import screen_alerts as sa
from api.services.screener import snapshot_db as db

USER = "scan-user"


@pytest.fixture
def stores(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    db.init_db()
    sa._done.clear()
    monkeypatch.setattr(ud, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    ud._init_db()
    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()
    return tmp_path


def _scan_doc(period: int) -> dict:
    tree = {"type": "op", "name": ">", "args": [
        {"type": "series", "name": "close"},
        {"type": "call", "name": "sma",
         "args": [{"type": "series", "name": "close"}, {"type": "num", "value": period}]}]}
    return {"version": 1, "plots": [{"key": "value", "style": "line"}],
            "compute": {"kind": "ast", "ast": tree, "fn": ud.ast_hash(tree)}}


def _save(period: int, def_id=None) -> str:
    def_id = def_id or ud.new_def_id()
    ud.save(USER, def_id, dict(_scan_doc(period), id=def_id))
    return def_id


def _identity(def_id: str) -> str:
    return ud.result_identity(ud.get(USER, def_id)["definition"])


def _sub_rows() -> list:
    with db.connect() as conn:
        return conn.execute("SELECT * FROM screen_alert_subs ORDER BY def_hash").fetchall()


def test_a_subscription_on_the_live_identity_is_connected(stores):
    def_id = _save(50)
    sa.subscribe(USER, _identity(def_id), def_id, "Above the 50")
    assert sai.disconnected_subscriptions() == []
    assert sai.summary()["disconnected"] == 0


def test_an_EDITED_formula_disconnects_its_subscription(stores):
    def_id = _save(50)
    subscribed = _identity(def_id)
    sa.subscribe(USER, subscribed, def_id, "Above the 50")

    _save(200, def_id=def_id)                          # the member edits the maths
    found = sai.disconnected_subscriptions()
    assert [f["reason"] for f in found] == [sai.EDITED]
    assert found[0]["subscribed"] == subscribed
    assert found[0]["current"] == _identity(def_id) != subscribed


def test_a_bare_hash_on_a_semantics_two_definition_is_disconnected(stores):
    def_id = _save(50)
    live = _identity(def_id)
    bare = live.split(ud.SEMANTICS_IDENTITY_SUFFIX, 1)[0]
    if bare == live:
        pytest.skip("this store stamped semantics 1; the classify() rule is held below")
    sa.subscribe(USER, bare, def_id, "Above the 50")
    assert [f["reason"] for f in sai.disconnected_subscriptions()] == [sai.SEMANTICS]


def test_a_DELETED_definition_is_reported_not_dropped(stores):
    def_id = _save(50)
    sa.subscribe(USER, _identity(def_id), def_id, "Above the 50")
    ud.soft_delete(USER, def_id)
    assert [f["reason"] for f in sai.disconnected_subscriptions()] == [sai.DELETED]


def test_a_malformed_def_id_is_reported_as_deleted(stores):
    sa.subscribe(USER, "sha256:" + "0" * 64, "not-a-def-id", "Broken")
    assert [f["reason"] for f in sai.disconnected_subscriptions()] == [sai.DELETED]


def test_the_detector_WRITES_NOTHING(stores):
    def_id = _save(50)
    sa.subscribe(USER, _identity(def_id), def_id, "Above the 50")
    _save(200, def_id=def_id)
    before = _sub_rows()
    sai.disconnected_subscriptions()
    sai.summary()
    assert _sub_rows() == before


@pytest.mark.parametrize("subscribed,current,want", [
    ("sha256:a", "sha256:a", None),
    ("sha256:a", "sha256:a~s2", sai.SEMANTICS),
    ("sha256:a~s2", "sha256:a", sai.SEMANTICS),
    ("sha256:a", "sha256:b~s2", sai.EDITED),
    ("sha256:a", None, sai.DELETED),
])
def test_classify(subscribed, current, want):
    assert sai.classify(subscribed, current) == want
