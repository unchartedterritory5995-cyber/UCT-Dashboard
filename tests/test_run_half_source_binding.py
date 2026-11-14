"""ENGINE 53 -- a run half runs its document's OWN script, and the door counts the store's bytes.

1. The save door (`user_definitions.save` -> `runtime_definitions.run_half_source_refusal`) refuses a
   document whose `compute.runtimeObjects.source`, its `meta.pineSourceSha256` stamp and the script
   saved beside it (`pine_source`) are not one script -- the forged-document repro: script A's
   document carrying another script's run half. A save with no script cannot bind one either.
   A share copy (which never carries the author's script) is saved without its run half; a fork
   (which carries it) keeps it.
2. `stored_bytes_for_new` counts what `save` counts against `MAX_DEFINITION_BYTES`, and equals the
   browser's count of the same sent document (`storedBytes.js`), by ONE fixture both suites read:
   `tests/fixtures/run_half_stored_bytes.json` (vitest twin: `storedBytes.parity.test.js`).
"""
from __future__ import annotations

import contextlib
import hashlib
import json
import pathlib

import pytest

from api.services import indicator_alert_service as ias
from api.services import runtime_definitions as rt
from api.services import user_definitions as svc

ROOT = pathlib.Path(__file__).resolve().parents[1]
FIX = json.loads((ROOT / "tests/fixtures/run_half_stored_bytes.json").read_text(encoding="utf-8"))
OWNER, FRIEND = "u-owner", "u-friend"
OTHER = '//@version=5\nindicator("another script")\nplot(close)\n'


@pytest.fixture(autouse=True)
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()


def sent(**over):
    d = json.loads(json.dumps(FIX["sent"]))
    d["id"] = svc.new_def_id()
    for k, v in over.items():
        if k == "source":
            d["compute"]["runtimeObjects"]["source"] = v
        elif k == "stamp":
            if v is None:
                d["meta"].pop(rt.RUN_HALF_SOURCE_STAMP, None)
            else:
                d["meta"][rt.RUN_HALF_SOURCE_STAMP] = v
    return d


def stored_blob_bytes(def_id):
    with contextlib.closing(svc._connect()) as c:
        row = c.execute("SELECT definition FROM user_definitions WHERE def_id = ? ORDER BY version DESC",
                        (def_id,)).fetchone()
    return len(row[0].encode("utf-8"))


# -- 1. the source binding ---------------------------------------------------------------------

def test_control_the_honest_run_half_saves_with_its_script():
    d = sent()
    svc.save(OWNER, d["id"], d, pine_source=FIX["source"])
    got = svc.get(OWNER, d["id"])["definition"]
    assert got["compute"]["runtimeObjects"]["source"] == FIX["source"]


def test_FORGED_another_scripts_run_half_on_this_document_is_refused():
    """The repro: script A's plots and objects, `runtimeObjects = {source: <another script>,
    outputs: {}}`. Saved beside A, it would draw the other script's (empty) drawings in place of
    A's host picture."""
    d = sent(source=OTHER)
    d["compute"]["runtimeObjects"]["outputs"] = {}
    with pytest.raises(svc.SaveRefused) as e:
        svc.save(OWNER, d["id"], d, pine_source=FIX["source"])
    assert e.value.guard == "run-half:source" and "different script" in str(e.value)


def test_FORGED_with_the_stamp_forged_too_is_still_refused_by_the_rows_own_script():
    d = sent(source=OTHER, stamp=hashlib.sha256(OTHER.encode("utf-8")).hexdigest())
    with pytest.raises(svc.SaveRefused) as e:
        svc.save(OWNER, d["id"], d, pine_source=FIX["source"])
    assert e.value.guard == "run-half:source"


def test_a_run_half_saved_without_its_script_is_refused():
    d = sent()
    with pytest.raises(svc.SaveRefused) as e:
        svc.save(OWNER, d["id"], d)
    assert e.value.guard == "run-half:source" and "carries no script" in str(e.value)


@pytest.mark.parametrize("stamp", [None, "0" * 64])
def test_a_missing_or_wrong_stamp_is_refused(stamp):
    d = sent(stamp=stamp)
    with pytest.raises(svc.SaveRefused) as e:
        svc.save(OWNER, d["id"], d, pine_source=FIX["source"])
    assert e.value.guard == "run-half:source"


def test_a_document_without_a_run_half_is_not_asked():
    assert rt.run_half_source_refusal({"compute": {"kind": "ast"}}, None) is None
    assert rt.run_half_source_refusal(rt.without_run_reads(sent()), None) is None


def test_a_share_copy_drops_the_run_half_and_a_fork_keeps_it():
    d = sent()
    svc.save(OWNER, d["id"], d, pine_source=FIX["source"])
    token = svc.share(OWNER, d["id"])["token"]
    copy = svc.install_share(FRIEND, token)
    got = svc.get(FRIEND, copy["def_id"])["definition"]
    assert "runtimeObjects" not in got["compute"] and rt.RUN_HALF_SOURCE_STAMP not in got.get("meta", {})
    assert FIX["source"] not in json.dumps(got), "the author's script never travels with a share"
    fork = svc.fork(OWNER, d["id"])
    assert svc.get(OWNER, fork["def_id"])["definition"]["compute"]["runtimeObjects"]["source"] == FIX["source"]


# -- 2. the bytes the store counts ---------------------------------------------------------------

@pytest.mark.parametrize("which", ["sent", "edge"])
def test_the_server_counts_the_bytes_the_browser_counted(which):
    assert svc.stored_bytes_for_new(json.loads(json.dumps(FIX[which]))) == FIX[f"{which}Bytes"]


@pytest.mark.parametrize("which", ["sent", "edge"])
def test_the_count_is_the_saves_own(which):
    d = json.loads(json.dumps(FIX[which]))
    d["id"] = svc.new_def_id()
    svc.save(OWNER, d["id"], d, pine_source=FIX["source"])
    # the save door's 64 KiB check counts `stored`; the blob written is that text exactly
    assert stored_blob_bytes(d["id"]) == svc.stored_bytes_for_new(json.loads(json.dumps(FIX[which])))
