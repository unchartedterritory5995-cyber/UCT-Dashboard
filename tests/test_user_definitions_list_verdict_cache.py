"""GET /api/user-definitions answers a stored version's PURE stamps once per process, not once per request.

Measured (local, 29 definitions: the 14 house formulas twice and a Fred RS copy): the list handler spent ~74% of
its time in `scan_definition.assert_scannable` and ~12% in `line_identities_many`, both recomputed for every row of
every request. Both are functions of the STORED VERSION alone:
  * the store is append-only, so `(user_id, def_id, version)` names one immutable document (the two in-place
    writers, relint and the erasure scrub, touch `repaint` / `requirements` and `origin.author_id`, none of which
    the served document's scannability or plot keys read);
  * the only per-request difference in the served document is the served stamps on `meta` (the kill list, the
    allowlist, the held / known-divergence sentences), and they are part of the key.
What this pins: the answer is byte-identical to the uncached one, every request; the expensive checks run once per
stored version; a new version, a moved stamp or another database is a new answer.
"""

from __future__ import annotations

import json

import pytest

from api.routers import user_definitions as router_mod
from api.services import alert_rev_migration as rev
from api.services import indicator_alert_service as ias
from api.services import scan_definition
from api.services import user_definitions as svc

USER = "u-verdict-cache"


def _reset():
    # (a getattr, so the same file runs against a build without the caches: that is the red run)
    getattr(router_mod, "_reset_list_caches", lambda: None)()
MEMBER = {"id": USER, "role": "member", "plan": "pro"}


def _sma(period: int) -> dict:
    return {"type": "call", "name": "sma",
            "args": [{"type": "series", "name": "close"}, {"type": "num", "value": period}]}


def _cross(period: int) -> dict:
    return {"type": "op", "name": ">", "args": [{"type": "series", "name": "close"}, _sma(period)]}


def defn(def_id: str, tree: dict) -> dict:
    return {
        "schemaVersion": 1, "id": def_id, "version": 1,
        "meta": {"name": "Mine", "shortName": "M", "repaint": "non-repainting"},
        "compute": {"kind": "ast", "ast": tree},
        "placement": {"target": "price"},
        "plots": [{"key": "value", "style": "line", "role": "primary"}],
        "inputs": [],
    }


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()
    rev.init_schema()
    _reset()
    yield tmp_path
    _reset()


def _new(tree: dict) -> str:
    def_id = svc.new_def_id()
    svc.save(USER, def_id, defn(def_id, tree))
    return def_id


def _list(graph=True):
    return router_mod.list_definitions(user=dict(MEMBER), graph=graph, engine=None)


@pytest.fixture
def counted(monkeypatch):
    calls = {"scan": 0, "lines": 0}
    real_scan = scan_definition.assert_scannable
    real_eff = svc._effective_line_ids

    def scan(definition):
        calls["scan"] += 1
        return real_scan(definition)

    def eff(*a, **k):
        calls["lines"] += 1
        return real_eff(*a, **k)

    monkeypatch.setattr(scan_definition, "assert_scannable", scan)
    monkeypatch.setattr(svc, "_effective_line_ids", eff)
    return calls


def _uncached():
    _reset()
    out = _list()
    _reset()
    return out


def test_every_request_answers_exactly_what_the_uncached_handler_answers(store):
    _new(_cross(20))                 # scannable
    _new(_sma(10))                   # refused: yields a number
    edited = _new(_cross(30))
    svc.save(USER, edited, defn(edited, _sma(31)))   # a new version: a new answer
    want = json.dumps(_uncached(), sort_keys=True)
    first = json.dumps(_list(), sort_keys=True)
    second = json.dumps(_list(), sort_keys=True)
    assert first == want and second == want
    rows = _list()["definitions"]
    assert [r["scannable"] for r in rows] == [True, False, False]
    assert rows[1]["scan_refusal"]["gate"] == "yields"


def test_the_expensive_checks_run_once_per_stored_version(store, counted):
    for p in (5, 6, 7):
        _new(_cross(p))
    _list()
    assert counted["scan"] == 3 and counted["lines"] == 3
    _list()
    _list(graph=False)
    assert counted["scan"] == 3, "scannability was recomputed for a version already answered"
    assert counted["lines"] == 3, "line identities were recomputed for a version already answered"


def test_an_edit_is_a_new_answer_and_the_old_version_is_not_reused(store, counted):
    d = _new(_cross(8))
    assert _list()["definitions"][0]["scannable"] is True
    svc.save(USER, d, defn(d, _sma(8)))                 # now a number: refused
    rows = _list()["definitions"]
    assert rows[0]["scannable"] is False and rows[0]["scan_refusal"]["gate"] == "yields"
    assert counted["scan"] == 2


def test_a_moved_served_stamp_is_a_new_answer(store, monkeypatch):
    """The served stamps (here a held-withholds sentence) are part of the key: a stamp that appears or moves is
    asked again, so a cached verdict can never outlive the document it was computed for."""
    _new(_cross(9))
    _list()
    seen = []
    real = scan_definition.assert_scannable
    monkeypatch.setattr(scan_definition, "assert_scannable", lambda d: seen.append(dict(d.get("meta") or {})) or real(d))
    from api.services import runtime_definitions as rd
    monkeypatch.setattr(rd, "stamp_served", lambda row, **k: dict(row, definition=dict(
        row["definition"], meta=dict(row["definition"].get("meta") or {}, heldDivergence="held"))))
    _list()
    assert len(seen) == 1 and seen[0].get("heldDivergence") == "held"
    _list()
    assert len(seen) == 1


def test_another_database_is_another_answer(store, tmp_path, monkeypatch, counted):
    d = _new(_cross(12))
    _list()
    other = tmp_path / "other.db"
    monkeypatch.setattr(svc, "_DB_PATH", str(other))
    svc._init_db()
    assert _list()["definitions"] == []
    svc.save(USER, d, defn(d, _sma(12)))                 # the same id and version, another file
    assert _list()["definitions"][0]["scannable"] is False
