"""The library's load budget (Studio lane R6; `api/services/load_budget.py`).

When a member lists an indicator, the server measures how much work it does over the engine's
reference series (a count from the engine's headless export, never a clock), files it in a class a
card can show, and refuses a listing over the budget.

  1. the classes and the budget are fractions of the lane's ceiling, and only a NUMBER refuses;
  2. the driver's answer is read strictly: a count, an engine refusal by name, or unavailable;
  3. only a formula is measured on this process; a pasted script is never handed to the driver,
     and a script's run half never leaves the process;
  4. the subprocess is bounded (a timeout, a slot count) and sees none of this process's secrets;
  5. the store: a listing carries `load`; an over-budget one is refused by name and writes
     nothing; a version that was never measured carries no `load` key at all.
"""
from __future__ import annotations

import json
import shutil
import subprocess

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import user_definitions as router_mod
from api.services import indicator_alert_service as ias
from api.services import load_budget as lb
from api.services import user_definitions as svc

OWNER = "u-owner"
CEILING = 16384                       # a ceiling for these tests; the real one is the engine's


def defn(def_id: str, name: str = "My Average", period: int = 20) -> dict:
    return {
        "schemaVersion": 1, "id": def_id, "version": 1,
        "meta": {"name": name, "shortName": "MA", "repaint": "non-repainting"},
        "compute": {"kind": "ast", "ast": {"type": "call", "name": "sma", "args": [
            {"type": "series", "name": "close"}, {"type": "num", "value": period}]}},
        "placement": {"target": "price"},
        "plots": [{"key": "value", "style": "line", "role": "primary"}],
        "inputs": [],
    }


def did(n: int) -> str:
    return "u_%012d" % n


def measured(work: int, ceiling: int = CEILING, state: str = lb.MEASURED) -> dict:
    return {"state": state, "lane": "ast", "work": work, "ceiling": ceiling, "code": None,
            "reference": "sha"}


def not_measured(state: str, code: str = "x") -> dict:
    return {"state": state, "lane": "ast", "work": None, "ceiling": None, "code": code,
            "reference": None}


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "defs.db"))
    svc._init_db()
    # an edit that changes the maths re-keys the owner's alerts, which live in their own store
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    monkeypatch.setattr(ias, "_DB_PATH", str(tmp_path / "auth.db"))
    ias.init_schema()
    return svc


@pytest.fixture()
def on(monkeypatch):
    monkeypatch.setenv(lb.FLAG_ENV, "1")


# ─── 1. the classes and the budget ───────────────────────────────────────────────

def test_the_classes_are_fractions_of_the_ceiling_and_the_last_bound_is_the_budget():
    assert lb.budget_of(CEILING) == 8192
    assert [name for name, _ in lb.CLASS_FRACTIONS] == ["light", "moderate", "heavy"]
    assert lb.CLASS_FRACTIONS[-1][1] == lb.PUBLISH_BUDGET_FRACTION
    fractions = [f for _, f in lb.CLASS_FRACTIONS]
    assert fractions == sorted(fractions) and len(set(fractions)) == 3
    # each bound belongs to the lighter class; one more is the next
    assert lb.class_of(0, CEILING) == "light"
    assert lb.class_of(1638, CEILING) == "light" and lb.class_of(1639, CEILING) == "moderate"
    assert lb.class_of(4096, CEILING) == "moderate" and lb.class_of(4097, CEILING) == "heavy"
    assert lb.class_of(8192, CEILING) == "heavy"
    assert lb.class_of(8193, CEILING) is None                     # over the budget: no class
    # the same fractions on another lane's ceiling
    assert lb.class_of(20_000_000, 200_000_000) == "light"
    assert lb.class_of(20_000_001, 200_000_000) == "moderate"


def test_only_a_number_over_the_budget_refuses():
    assert lb.over_budget(measured(8193)) is True
    assert lb.over_budget(measured(8192)) is False
    assert lb.over_budget(measured(9000, state=lb.RUN_PARTS_STATE)) is True     # the formula half alone
    for m in (None, {}, not_measured(lb.UNAVAILABLE), not_measured(lb.RUNTIME_LANE),
              not_measured(lb.ENGINE_REFUSED), measured(True), measured(-1), measured(9000, ceiling=0)):
        assert lb.over_budget(m) is False, m
    for bad in (None, "9", 9.5, True, -1):
        assert lb.class_of(bad, CEILING) is None and lb.class_of(9, bad) is None


def test_what_a_card_is_sent():
    assert lb.served(measured(37)) == {"class": "light", "work": 37}
    assert lb.served(measured(5000)) == {"class": "heavy", "work": 5000}
    unmeasured = {"class": None, "measured": False}
    assert lb.served(not_measured(lb.UNAVAILABLE)) == unmeasured
    assert lb.served(not_measured(lb.RUNTIME_LANE)) == unmeasured
    assert lb.served(not_measured(lb.ENGINE_REFUSED)) == unmeasured
    # a formula with a script's run half: its formula half was counted, the whole was not
    assert lb.served(measured(191, state=lb.RUN_PARTS_STATE)) == unmeasured
    # nothing at all for no measurement, or a state this module does not know
    assert lb.served(None) is None and lb.served({"state": "made-up", "work": 1, "ceiling": 9}) is None


def test_the_refusal_says_both_numbers_and_what_still_works():
    text = lb.refusal_message(measured(9200))
    assert "9,200" in text and "8,192" in text
    assert "still works on your own charts" in text and "list it again" in text


# ─── 2. the driver's answer ──────────────────────────────────────────────────────

def _driver(result: dict, ceiling: int = CEILING) -> str:
    return json.dumps({"ok": True, "result": result, "reference": {"bars": 5000, "sha256": "abc"},
                       "ceiling": {"name": "MAX_EVALUATION_UNITS", "module": "m", "value": ceiling}})


def test_a_clean_count_is_a_measurement():
    got = lb._read_answer(0, _driver({"lane": "ast", "outputs": [], "work": 37}))
    assert got == {"state": "measured", "lane": "ast", "work": 37, "ceiling": CEILING, "code": None,
                   "reference": "abc"}


def test_an_engine_refusal_is_named_and_is_not_a_number():
    got = lb._read_answer(0, _driver({"lane": "ast", "outputs": None, "work": None,
                                      "refusal": {"code": "other-symbol:not-supplied", "message": "m"}}))
    assert got["state"] == lb.ENGINE_REFUSED and got["code"] == "other-symbol:not-supplied"
    assert got["work"] is None and lb.over_budget(got) is False


@pytest.mark.parametrize("code,stdout,why", [
    (0, "not json", "bad-answer"),
    (2, json.dumps({"ok": False, "error": "the request carries no `definition` object"}), "driver-error"),
    (3, json.dumps({"ok": False, "error": "no counter", "lane": "native"}), "driver-error"),
    (0, json.dumps({"ok": True}), "bad-answer"),
    (0, _driver({"lane": "runtime", "outputs": [], "work": 5}), "lane"),          # another lane's unit
    (0, _driver({"lane": "ast", "outputs": [], "work": 5.5}), "bad-answer"),
    (0, _driver({"lane": "ast", "outputs": [], "work": None}), "bad-answer"),
    (0, _driver({"lane": "ast", "outputs": [], "work": 5}, ceiling=0), "bad-answer"),
    (1, _driver({"lane": "ast", "outputs": [], "work": 5}), "driver-error"),      # a count with a failed exit
])
def test_anything_else_is_unavailable_by_name(code, stdout, why):
    got = lb._read_answer(code, stdout)
    assert got["state"] == lb.UNAVAILABLE and got["code"] == why and got["work"] is None


# ─── 3. what is handed to the driver ─────────────────────────────────────────────

def test_a_pasted_script_is_never_handed_to_the_driver(on, monkeypatch):
    def boom(_doc):
        raise AssertionError("the driver was called for a runtime-lane document")
    monkeypatch.setattr(lb, "_run_driver", boom)
    doc = {**defn(did(1)), "compute": {"kind": "runtime", "source": "//@version=6\nplot(close)"}}
    assert lb.measure(doc) == {"state": lb.RUNTIME_LANE, "lane": "runtime", "work": None,
                               "ceiling": None, "code": None, "reference": None}
    for other in ({"compute": {"kind": "native"}}, {"compute": {}}, {}, None, "x"):
        assert lb.measure(other)["state"] == lb.UNAVAILABLE and lb.measure(other)["code"] == "lane"
    # CONTROL: a formula does reach it
    monkeypatch.setattr(lb, "_run_driver", lambda _doc: measured(12))
    assert lb.measure(defn(did(1)))["state"] == lb.MEASURED


def test_switched_off_nothing_runs(monkeypatch):
    monkeypatch.delenv(lb.FLAG_ENV, raising=False)
    monkeypatch.setattr(lb, "_run_driver", lambda _doc: pytest.fail("measured while switched off"))
    assert lb.measure(defn(did(1))) is None
    assert lb.measure({"compute": {"kind": "runtime"}}) is None     # not even a state while off
    for raw, want in (("1", True), ("true", True), ("0", False), ("", False), ("off", False)):
        monkeypatch.setenv(lb.FLAG_ENV, raw)
        assert lb.enabled() is want, raw


def test_a_scripts_run_half_never_leaves_the_process_and_the_whole_is_not_called_measured(on, monkeypatch):
    seen = {}

    def fake(doc):
        seen["doc"] = doc
        return measured(191)
    monkeypatch.setattr(lb, "_run_driver", fake)
    script = "//@version=6\n// the author's whole script\nplot(close)"
    doc = defn(did(1))
    doc["compute"] = {**doc["compute"], "runtimeObjects": {"source": script}, "runtimeColours": {"source": script}}
    got = lb.measure(doc)
    assert got["state"] == lb.RUN_PARTS_STATE and got["work"] == 191
    assert "runtimeObjects" not in seen["doc"]["compute"] and "runtimeColours" not in seen["doc"]["compute"]
    assert script not in json.dumps(seen["doc"])
    assert "runtimeObjects" in doc["compute"]                      # the caller's document is untouched
    # CONTROL: a plain formula is sent as it is and is measured
    plain = defn(did(2))
    assert lb.measure(plain)["state"] == lb.MEASURED and seen["doc"] is plain


# ─── 4. the subprocess is bounded ────────────────────────────────────────────────

def test_no_node_and_a_timeout_are_unavailable_never_an_exception(on, monkeypatch):
    monkeypatch.setattr(lb.shutil, "which", lambda _name: None)
    assert lb.measure(defn(did(1)))["code"] == "no-node"

    monkeypatch.setattr(lb.shutil, "which", lambda _name: "node")
    monkeypatch.setattr(lb, "DRIVER", lb.ROOT / "tools" / "no_such_driver.mjs")
    assert lb.measure(defn(did(1)))["code"] == "no-driver"

    monkeypatch.setattr(lb, "DRIVER", lb.ROOT / "tools" / "remote_tests.py")      # any real file

    def slow(*_a, **kw):
        raise subprocess.TimeoutExpired(cmd="node", timeout=kw.get("timeout"))
    monkeypatch.setattr(lb.subprocess, "run", slow)
    assert lb.measure(defn(did(1)))["code"] == "timeout"


def test_the_child_gets_a_timeout_a_heap_cap_and_none_of_this_processs_secrets(on, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "not-a-real-key")
    monkeypatch.setenv("SESSION_SECRET", "not-a-real-secret")
    monkeypatch.setattr(lb.shutil, "which", lambda _name: "node")
    monkeypatch.setattr(lb, "DRIVER", lb.ROOT / "tools" / "remote_tests.py")
    seen = {}

    def fake(argv, **kw):
        seen.update(argv=argv, **kw)
        return subprocess.CompletedProcess(argv, 0, _driver({"lane": "ast", "outputs": [], "work": 9}), "")
    monkeypatch.setattr(lb.subprocess, "run", fake)
    assert lb.measure(defn(did(1)))["work"] == 9
    assert seen["timeout"] == lb.MEASURE_TIMEOUT_S == 10
    assert f"--max-old-space-size={lb.NODE_HEAP_MB}" in seen["argv"]
    assert "ANTHROPIC_API_KEY" not in seen["env"] and "SESSION_SECRET" not in seen["env"]
    assert set(seen["env"]) <= {"PATH", "SYSTEMROOT", "SystemRoot", "TEMP", "TMP", "HOME"}
    request = json.loads(seen["input"])
    assert request["reference"] is True and request["values"] is False
    assert request["definition"]["compute"]["kind"] == "ast"


def test_no_free_slot_is_unavailable_and_the_slot_comes_back(on, monkeypatch):
    monkeypatch.setattr(lb.shutil, "which", lambda _name: "node")
    monkeypatch.setattr(lb, "DRIVER", lb.ROOT / "tools" / "remote_tests.py")
    monkeypatch.setattr(lb, "SLOT_WAIT_S", 0.01)
    monkeypatch.setattr(lb.subprocess, "run", lambda argv, **kw: subprocess.CompletedProcess(
        argv, 0, _driver({"lane": "ast", "outputs": [], "work": 9}), ""))
    held = [lb._SLOTS.acquire(timeout=1) for _ in range(lb.MEASURE_CONCURRENCY)]
    try:
        assert all(held)
        assert lb.measure(defn(did(1)))["code"] == "busy"
    finally:
        for _ in held:
            lb._SLOTS.release()
    # every run gives its slot back, a timed-out one included
    for _ in range(lb.MEASURE_CONCURRENCY + 2):
        assert lb.measure(defn(did(1)))["state"] == lb.MEASURED

    def slow(*_a, **kw):
        raise subprocess.TimeoutExpired(cmd="node", timeout=1)
    monkeypatch.setattr(lb.subprocess, "run", slow)
    for _ in range(lb.MEASURE_CONCURRENCY + 2):
        assert lb.measure(defn(did(1)))["code"] == "timeout"


# ─── 5. the store ────────────────────────────────────────────────────────────────

def _entry(store, token):
    return next(e for e in store.public_library(limit=60)["entries"] if e["token"] == token)


def test_a_listing_carries_its_load_on_the_card_the_preview_and_the_answer(store, monkeypatch):
    monkeypatch.setattr(lb, "measure_row", lambda _row: measured(37))
    store.save(OWNER, did(1), defn(did(1)))
    out = store.publish(OWNER, did(1))
    want = {"class": "light", "work": 37}
    assert out["load"] == want
    assert _entry(store, out["token"])["load"] == want
    assert store.resolve_share(out["token"])["load"] == want
    assert store.share_load(OWNER, did(1), out["version"]) == want
    # the newest measurement of the version wins (listing again measures again)
    monkeypatch.setattr(lb, "measure_row", lambda _row: measured(5000))
    assert store.publish(OWNER, did(1))["load"] == {"class": "heavy", "work": 5000}
    assert _entry(store, out["token"])["load"] == {"class": "heavy", "work": 5000}


def test_over_the_budget_is_refused_by_name_and_nothing_is_written(store, monkeypatch):
    monkeypatch.setattr(lb, "measure_row", lambda _row: measured(9200))
    store.save(OWNER, did(1), defn(did(1)))
    for role in (None, "admin"):                                    # the bar is the same for an admin
        with pytest.raises(store.ShareRefused) as exc:
            store.publish(OWNER, did(1), role=role)
        assert exc.value.reason == "load-budget"
        assert "9,200" in exc.value.detail and "8,192" in exc.value.detail
    assert store.public_library(limit=60)["entries"] == []
    assert store.share_status(OWNER, did(1)) is None               # no link was minted on the way
    assert store.listing_status(OWNER, did(1))["requested"] is False
    assert store.share_load(OWNER, did(1), 1) is None
    # CONTROL: the same definition lists once it is within the budget
    monkeypatch.setattr(lb, "measure_row", lambda _row: measured(8192))
    assert store.publish(OWNER, did(1))["load"] == {"class": "heavy", "work": 8192}


@pytest.mark.parametrize("state", [lb.UNAVAILABLE, lb.RUNTIME_LANE, lb.ENGINE_REFUSED])
def test_what_could_not_be_measured_lists_and_says_so(store, monkeypatch, state):
    monkeypatch.setattr(lb, "measure_row", lambda _row: not_measured(state, "no-node"))
    store.save(OWNER, did(1), defn(did(1)))
    out = store.publish(OWNER, did(1))
    assert out["listed"] is True and out["load"] == {"class": None, "measured": False}
    assert _entry(store, out["token"])["load"] == {"class": None, "measured": False}


def _v2(store, n=1, period=50):
    """The owner edits: version 2 of definition `n`."""
    store.save(OWNER, did(n), {**defn(did(n), period=period), "version": 2})


def test_re_sharing_a_LISTED_indicator_over_budget_is_refused_and_the_listing_keeps_its_version(store, monkeypatch):
    """The way around a budget checked only at listing: list a light version, save a heavy one,
    re-share. The library shows whatever the link pins, so the gate is on the door that moves the pin."""
    monkeypatch.setattr(lb, "measure_row", lambda _row: measured(37))
    store.save(OWNER, did(1), defn(did(1)))
    out = store.publish(OWNER, did(1))
    assert out["version"] == 1 and out["load"] == {"class": "light", "work": 37}

    _v2(store)
    monkeypatch.setattr(lb, "measure_row", lambda row: measured(9200 if row["version"] == 2 else 37))
    with pytest.raises(store.ShareRefused) as exc:
        store.share(OWNER, did(1))
    assert exc.value.reason == "load-budget" and "9,200" in exc.value.detail
    # nothing moved: the link, the entry and the preview are still the light version
    assert store.share_status(OWNER, did(1))["version"] == 1
    assert store.resolve_share(out["token"])["origin_version"] == 1
    assert _entry(store, out["token"])["load"] == {"class": "light", "work": 37}
    assert store.share_load(OWNER, did(1), 2) is None               # no row for the refused version
    assert store.listing_status(OWNER, did(1))["listed"] is True    # and it is still listed
    # listing it again is the same door and the same answer
    with pytest.raises(store.ShareRefused) as again:
        store.publish(OWNER, did(1))
    assert again.value.reason == "load-budget"
    assert store.share_status(OWNER, did(1))["version"] == 1


def test_re_sharing_a_LISTED_indicator_within_budget_records_the_new_versions_own_measurement(store, monkeypatch):
    monkeypatch.setattr(lb, "measure_row", lambda _row: measured(37))
    store.save(OWNER, did(1), defn(did(1)))
    out = store.publish(OWNER, did(1))
    _v2(store)
    monkeypatch.setattr(lb, "measure_row", lambda row: measured(5000 if row["version"] == 2 else 37))
    again = store.share(OWNER, did(1))
    assert again["token"] == out["token"] and again["version"] == 2
    assert again["load"] == {"class": "heavy", "work": 5000}
    assert _entry(store, out["token"])["load"] == {"class": "heavy", "work": 5000}
    assert store.resolve_share(out["token"])["load"] == {"class": "heavy", "work": 5000}
    # a measurement is about ONE version: version 1 keeps its own
    assert store.share_load(OWNER, did(1), 1) == {"class": "light", "work": 37}
    assert store.share_load(OWNER, did(1), 2) == {"class": "heavy", "work": 5000}


def test_a_link_that_is_not_listed_is_never_measured_and_never_refused(store, monkeypatch):
    calls = []
    monkeypatch.setattr(lb, "measure_row", lambda row: calls.append(row["version"]) or measured(9200))
    store.save(OWNER, did(1), defn(did(1)))
    first = store.share(OWNER, did(1))                              # a private link: no budget applies
    assert calls == [] and "load" not in first
    _v2(store)
    assert store.share(OWNER, did(1))["version"] == 2 and calls == []
    # listed, then taken out of the library by its owner: the link is private again
    monkeypatch.setattr(lb, "measure_row", lambda row: calls.append(row["version"]) or measured(37))
    store.publish(OWNER, did(1))
    assert calls == [2]
    assert store.unpublish(OWNER, did(1)) is True
    store.save(OWNER, did(1), {**defn(did(1), period=80), "version": 3})
    assert store.share(OWNER, did(1))["version"] == 3 and calls == [2]
    assert "load" not in store.resolve_share(first["token"])        # version 3 was never measured


def test_a_version_pinned_while_the_switch_is_off_carries_no_load_key(store, monkeypatch):
    monkeypatch.setattr(lb, "measure_row", lambda _row: measured(37))
    store.save(OWNER, did(1), defn(did(1)))
    out = store.publish(OWNER, did(1))
    assert "load" in _entry(store, out["token"])
    _v2(store)
    monkeypatch.setattr(lb, "measure_row", lambda _row: None)       # the switch went off
    assert store.share(OWNER, did(1))["version"] == 2
    assert "load" not in _entry(store, out["token"])
    assert "load" not in store.resolve_share(out["token"])
    assert store.share_load(OWNER, did(1), 1) == {"class": "light", "work": 37}    # version 1 keeps its own


@pytest.mark.parametrize("code", ["busy", "timeout"])
def test_a_measurement_that_could_not_be_made_in_time_refuses_the_listing_to_be_asked_again(store, monkeypatch, code):
    """Not accepted unmeasured: a crowded or slow measurement would be the way around the budget."""
    monkeypatch.setattr(lb, "measure_row", lambda _row: not_measured(lb.UNAVAILABLE, code))
    store.save(OWNER, did(1), defn(did(1)))
    with pytest.raises(store.ShareRefused) as exc:
        store.publish(OWNER, did(1))
    assert exc.value.reason == "load-busy"
    assert ("Try again" in exc.value.detail) and ("not listed" in exc.value.detail)
    assert store.share_status(OWNER, did(1)) is None and store.public_library(limit=60)["entries"] == []
    assert router_mod._SHARE_STATUS["load-busy"] == 503
    # CONTROL: the server's own trouble (no node, an unreadable answer) refuses nobody
    monkeypatch.setattr(lb, "measure_row", lambda _row: not_measured(lb.UNAVAILABLE, "no-node"))
    assert store.publish(OWNER, did(1))["load"] == {"class": None, "measured": False}


def test_which_unavailable_outcomes_ask_again():
    assert lb.RETRY_CODES == ("busy", "timeout")
    assert lb.must_retry(not_measured(lb.UNAVAILABLE, "busy")) and lb.must_retry(not_measured(lb.UNAVAILABLE, "timeout"))
    for m in (None, {}, measured(9), not_measured(lb.UNAVAILABLE, "no-node"), not_measured(lb.UNAVAILABLE, "bad-answer"),
              not_measured(lb.ENGINE_REFUSED, "timeout"), not_measured(lb.RUNTIME_LANE, "busy")):
        assert lb.must_retry(m) is False, m
    assert "time limit" in lb.retry_message(not_measured(lb.UNAVAILABLE, "timeout"))
    assert "in a moment" in lb.retry_message(not_measured(lb.UNAVAILABLE, "busy"))


def test_one_listing_holds_a_worker_for_a_bounded_time_and_the_subprocess_count_is_capped():
    """Stated in the module's header: a wait for a slot, then the run's own limit."""
    assert lb.MEASURE_CONCURRENCY == 2
    assert lb.SLOT_WAIT_S + lb.MEASURE_TIMEOUT_S == 15
    assert lb._SLOTS._initial_value == lb.MEASURE_CONCURRENCY


def test_a_listing_from_before_this_existed_and_a_bare_share_carry_no_load_key(store, monkeypatch):
    monkeypatch.setattr(lb, "measure_row", lambda _row: pytest.fail("a bare share measured"))
    store.save(OWNER, did(1), defn(did(1)))
    shared = store.share(OWNER, did(1))                             # a link, never listed
    assert "load" not in store.resolve_share(shared["token"])
    with svc.contextlib.closing(svc._connect()) as c, c:            # a listing row with no measurement
        c.execute("INSERT INTO definition_listings (user_id, def_id, listed, created_at) VALUES (?,?,1,1)",
                  (OWNER, did(1)))
    assert "load" not in _entry(store, shared["token"])


def test_switched_off_the_listing_door_is_what_it_was(store, monkeypatch):
    monkeypatch.delenv(lb.FLAG_ENV, raising=False)
    monkeypatch.setattr(lb.subprocess, "run", lambda *a, **k: pytest.fail("a subprocess ran while switched off"))
    store.save(OWNER, did(1), defn(did(1)))
    out = store.publish(OWNER, did(1))
    assert out["listed"] is True and "load" not in out
    assert "load" not in _entry(store, out["token"]) and "load" not in store.resolve_share(out["token"])
    with svc.contextlib.closing(svc._connect()) as c:
        assert c.execute("SELECT COUNT(*) FROM definition_load_measurements").fetchone()[0] == 0
    # CONTROL: switched on, the same press records one row
    monkeypatch.setenv(lb.FLAG_ENV, "1")
    monkeypatch.setattr(lb, "_run_driver", lambda _doc: measured(12))
    assert store.publish(OWNER, did(1))["load"] == {"class": "light", "work": 12}
    with svc.contextlib.closing(svc._connect()) as c:
        assert c.execute("SELECT COUNT(*) FROM definition_load_measurements").fetchone()[0] == 1


def test_a_deleted_account_takes_its_measurements_with_it(store, monkeypatch):
    monkeypatch.setattr(lb, "measure_row", lambda _row: measured(37))
    for n, who in ((1, OWNER), (2, "u-control")):
        store.save(who, did(n), defn(did(n)))
        store.publish(who, did(n))
    report = store.purge_user(OWNER)
    assert report["ok"] is True and report["rows_deleted"]["definition_load_measurements"] == 1
    with svc.contextlib.closing(svc._connect()) as c:
        left = [r[0] for r in c.execute("SELECT user_id FROM definition_load_measurements")]
    assert left == ["u-control"]


def test_the_route_answers_409_with_the_reason_and_the_message(store, monkeypatch):
    monkeypatch.setattr(lb, "measure_row", lambda _row: measured(9200))
    store.save(OWNER, did(1), defn(did(1)))
    app = FastAPI()
    app.include_router(router_mod.router)
    app.dependency_overrides[router_mod.require_paid] = lambda: {"id": OWNER, "role": "user", "plan": "pro"}
    r = TestClient(app, raise_server_exceptions=False).post(f"/api/user-definitions/{did(1)}/list")
    assert r.status_code == 409, r.text
    detail = r.json()["detail"]
    assert detail["reason"] == "load-budget" and "8,192" in detail["message"]
    assert router_mod._SHARE_STATUS["load-budget"] == 409


# ─── the document is measured AS SERVED ──────────────────────────────────────────

def test_a_stored_row_is_stamped_as_served_before_it_is_measured(on, monkeypatch):
    seen = {}

    def fake(doc):
        seen["doc"] = doc
        return measured(12)
    monkeypatch.setattr(lb, "_run_driver", fake)
    why = "This script is on the list of scripts whose values differ from TradingView."
    row = {"def_id": did(1), "version": 1, "definition": defn(did(1)), "host_known_divergence": why}
    assert lb.measure_row(row)["work"] == 12
    assert seen["doc"]["meta"]["hostKnownDivergence"] == why       # the stamp a member's browser receives
    assert "hostKnownDivergence" not in row["definition"]["meta"]  # the stored row is not touched
    # CONTROL: a row with nothing to stamp is measured as it is
    plain = {"def_id": did(2), "version": 1, "definition": defn(did(2))}
    lb.measure_row(plain)
    assert "hostKnownDivergence" not in seen["doc"]["meta"]


def test_a_pasted_scripts_row_is_answered_before_it_is_stamped(on, monkeypatch):
    from api.services import runtime_definitions
    monkeypatch.setattr(runtime_definitions, "stamp_served", lambda *a, **k: pytest.fail("a runtime row was stamped"))
    monkeypatch.setattr(lb, "_run_driver", lambda _d: pytest.fail("a runtime row reached the driver"))
    row = {"def_id": did(1), "version": 1, "definition": {**defn(did(1)), "compute": {"kind": "runtime", "source": "plot(close)"}}}
    assert lb.measure_row(row)["state"] == lb.RUNTIME_LANE
    assert lb.measure_row(None)["state"] == lb.UNAVAILABLE
    monkeypatch.delenv(lb.FLAG_ENV)
    assert lb.measure_row(row) is None


@pytest.mark.skipif(shutil.which("node") is None or not lb.DRIVER.is_file(),
                    reason="node or tools/headless_work.mjs is not in this checkout")
def test_a_document_a_members_chart_refuses_is_engine_refused_by_that_code_never_clean(on):
    why = "This script is on the list of scripts whose values differ from TradingView."
    row = {"def_id": did(1), "version": 1, "definition": defn(did(1)), "host_known_divergence": why}
    got = lb.measure_row(row)
    assert got["state"] == lb.ENGINE_REFUSED and got["code"] == "pine:known-divergence", got
    assert got["work"] is None and lb.over_budget(got) is False
    assert lb.served(got) == {"class": None, "measured": False}
    # CONTROL: the same document without the stamp is measured
    assert lb.measure_row({"def_id": did(1), "version": 1, "definition": defn(did(1))})["state"] == lb.MEASURED


# ─── the real driver, when this checkout has it ──────────────────────────────────

@pytest.mark.skipif(shutil.which("node") is None or not lb.DRIVER.is_file(),
                    reason="node or tools/headless_work.mjs is not in this checkout")
def test_the_real_driver_measures_a_formula_the_same_twice(on):
    first = lb.measure(defn(did(1)))
    assert first["state"] == lb.MEASURED, first
    assert first["lane"] == "ast" and first["work"] > 0 and first["ceiling"] > first["work"]
    assert isinstance(first["reference"], str) and len(first["reference"]) == 64
    assert lb.measure(defn(did(1))) == first
    assert lb.served(first)["class"] == "light"


@pytest.mark.skipif(shutil.which("node") is None or not lb.DRIVER.is_file(),
                    reason="node or tools/headless_work.mjs is not in this checkout")
def test_end_to_end_a_stored_formula_is_measured_at_listing_by_the_real_driver(store, on):
    """Nothing faked: the document the store hands back is what the driver computes."""
    store.save(OWNER, did(1), defn(did(1)))
    out = store.publish(OWNER, did(1))
    assert out["load"]["class"] == "light" and out["load"]["work"] > 0, out
    assert _entry(store, out["token"])["load"] == out["load"]
    assert store.resolve_share(out["token"])["load"] == out["load"]
    with svc.contextlib.closing(svc._connect()) as c:
        row = dict(c.execute("SELECT * FROM definition_load_measurements").fetchone())
    assert row["state"] == lb.MEASURED and row["lane"] == "ast" and row["version"] == out["version"]
    assert row["work"] == out["load"]["work"] and row["ceiling"] > row["work"]
    assert len(row["reference"]) == 64

