"""GET /api/user-definitions reads the runtime lane's committed lists ONCE per request, not once per row per lane.

Measured: production smoke@ (27 definitions, 26 of them runtime documents), the list's server time was 205-220 ms
(`server-timing app;dur`, sequential, no burst), against 5-9 ms for /me and /runtime-kill. Replayed locally from the
captured list: 219 ms per list, ~89% of it in `server_lanes_stamp`. Each runtime row asks three server lanes, and
every one of those questions re-read and re-parsed the committed kill list (56 KB) and the allowlist (112 KB) and
re-ran the capability registry's policy pass: ~180 kill-list reads and ~256 allowlist reads per list.

What this pins:
  * one list request opens each committed file at most once;
  * the answer is exactly the one computed with every read made per call;
  * the lists are still read PER REQUEST: an edited kill list (file or variable) reaches the very next list.
"""

from __future__ import annotations

import builtins
import contextlib
import hashlib
import json
import pathlib
import sqlite3

import pytest

from api.routers import user_definitions as router_mod
from api.services import runtime_definitions as rt
from api.services import user_definitions as svc

USER = "u-reads-once"
MEMBER = {"id": USER, "role": "member", "plan": "pro"}


def _source(i: int) -> str:
    return f'//@version=5\nindicator("t{i}")\nvar float s = 0.0\ns := s + close * {i}\nplot(s, title="S")\n'


def _runtime_doc(def_id: str, source: str) -> dict:
    return {
        "schemaVersion": 1, "id": def_id, "version": 1,
        "meta": {"name": "t", "shortName": "t", "repaint": "non-repainting", "lane": "runtime",
                 "runtimeHistory": "listing"},
        "compute": {"kind": "runtime", "fn": f"runtime:{def_id}", "rev": 1, "source": source,
                    "outputs": {"value": 0}},
        "placement": {"target": "pane", "pane": {"height": 0.25}},
        "plots": [{"key": "value", "style": "line", "role": "primary", "label": "S"}],
        "inputs": [],
    }


@pytest.fixture
def rows(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    monkeypatch.setenv(rt.STAGE_ENV, rt.STAGE_ALL)
    monkeypatch.setenv(rt.CAPABILITY_ADMISSION_ENV, rt.CAPABILITY_ADMISSION_ON)
    monkeypatch.delenv(rt.KILL_ENV, raising=False)
    monkeypatch.delenv(rt.ALLOW_ENV, raising=False)
    getattr(router_mod, "_reset_list_caches", lambda: None)()
    # stored by direct INSERT, as rows already on disk are: this file is about the READ path
    c = sqlite3.connect(svc._DB_PATH)
    ids = []
    for i in range(6):
        def_id = f"u_00000000{i:04x}"
        ids.append(def_id)
        c.execute("INSERT INTO user_definitions (user_id, def_id, version, rev, ast_hash, definition, repaint,"
                  " requirements, deleted_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                  (USER, def_id, 1, 1, "h", json.dumps(_runtime_doc(def_id, _source(i))), "{}", "[]", None,
                   1700000000 + i))
    c.commit()
    c.close()
    yield ids
    getattr(router_mod, "_reset_list_caches", lambda: None)()


def _list():
    return router_mod.list_definitions(user=dict(MEMBER), graph=True, engine=None)


def test_one_list_opens_each_committed_list_at_most_once(rows, monkeypatch):
    watched = {str(pathlib.Path(rt.ALLOWLIST_PATH).resolve()): 0, str(pathlib.Path(rt.KILLLIST_PATH).resolve()): 0}
    real_open, real_read_text = builtins.open, pathlib.Path.read_text

    def note(p):
        try:
            k = str(pathlib.Path(p).resolve())
        except (TypeError, OSError):
            return
        if k in watched:
            watched[k] += 1

    def counting_open(file, *a, **k):
        note(file)
        return real_open(file, *a, **k)

    def counting_read_text(self, *a, **k):
        note(self)
        return real_read_text(self, *a, **k)

    _list()                                            # warm anything a first call loads
    for k in watched:
        watched[k] = 0
    monkeypatch.setattr(builtins, "open", counting_open)
    monkeypatch.setattr(pathlib.Path, "read_text", counting_read_text)
    out = _list()
    assert len(out["definitions"]) == len(rows)
    assert all(n <= 1 for n in watched.values()), f"committed lists read per row per lane: {watched}"


def test_the_answer_is_the_one_every_per_call_read_gives(rows, monkeypatch):
    once = json.dumps(_list(), sort_keys=True)
    if hasattr(rt, "read_once"):
        monkeypatch.setattr(rt, "read_once", contextlib.nullcontext)
    per_call = json.dumps(_list(), sort_keys=True)
    assert once == per_call
    # every row carries the server lanes' answer these lists decide
    rows_out = json.loads(once)["definitions"]
    assert len(rows_out) == len(rows) and all(set(r["server_lanes"]) for r in rows_out)


def test_an_edited_kill_list_reaches_the_very_next_list(rows, tmp_path, monkeypatch):
    first = _list()["definitions"]
    assert not any("runtimeKilled" in r["definition"]["meta"] for r in first)
    # the operator variable, by id
    monkeypatch.setenv(rt.KILL_ENV, rows[0])
    killed = [r for r in _list()["definitions"] if "runtimeKilled" in r["definition"]["meta"]]
    assert [r["def_id"] for r in killed] == [rows[0]]
    monkeypatch.delenv(rt.KILL_ENV)
    # the committed file, by script hash, edited IN PLACE between two lists (the same path both times)
    f = tmp_path / "killlist.json"
    f.write_text(json.dumps({"scripts": []}), encoding="utf-8")
    monkeypatch.setattr(rt, "KILLLIST_PATH", str(f))
    assert not any("runtimeKilled" in r["definition"]["meta"] for r in _list()["definitions"])
    sha = hashlib.sha256(_source(3).encode("utf-8")).hexdigest()
    f.write_text(json.dumps({"scripts": [{"sha256": sha, "reason": "test kill"}]}), encoding="utf-8")
    killed = [r for r in _list()["definitions"] if "runtimeKilled" in r["definition"]["meta"]]
    assert [r["def_id"] for r in killed] == [rows[3]]
