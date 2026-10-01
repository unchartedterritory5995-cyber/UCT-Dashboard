"""C46 — what the REAL server does with the bodies the builder sends when a member
pastes Pine into a formula they already saved.

The other half of `app/src/components/chart/builder/BuilderSheet.pineRepaste.test.jsx`.
That file drives the shipped builder and pins the exact `compute` each paste sends
(`tests/fixtures/pine_param_ids/repaste-requests.json`); this file feeds those SAME
bodies to `api.services.user_definitions.save()` over the document the builder saved
at base `e4e24524ef` (`repaste-prior-pre-c46.json`: counter ids `_1` = slow, `_2` =
fast, for a script the frozen corpus map does not know).

Nothing under `api/` changed for C46. The rule these tests read is the one
`param_manifest._canonicalize_manifest` has always had: on an edit, an id the stored
document holds keeps its PRIOR record, and an id it does not hold refuses the whole
save (owner condition 15).
"""
from __future__ import annotations

import copy
import json
import pathlib

import pytest

from api.services import alert_rev_migration as rev
from api.services import indicator_alert_service as ias
from api.services import param_manifest as pms
from api.services import user_definitions as svc

FIX = pathlib.Path(__file__).parent / "fixtures" / "pine_param_ids"
PRIOR = json.loads((FIX / "repaste-prior-pre-c46.json").read_text(encoding="utf-8"))
SENT = json.loads((FIX / "repaste-requests.json").read_text(encoding="utf-8"))

USER = "c46-user"
DEF_ID = "u_c46000000001"
DEF_FRESH = "u_c46000000002"


@pytest.fixture
def store(tmp_path, monkeypatch):
    """`tests/test_param_manifest.py::store`, verbatim."""
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()
    rev.init_schema()
    return tmp_path


def _doc(compute, def_id=DEF_ID):
    return {"id": def_id, "compute": copy.deepcopy(compute)}


def _stored(def_id=DEF_ID):
    import sqlite3
    c = sqlite3.connect(svc._DB_PATH)
    c.row_factory = sqlite3.Row
    row = svc._newest(c, USER, def_id)
    return row, json.loads(row["definition"])


def _roster(definition):
    m = definition["compute"]["paramManifest"]
    return {pid: e["sourceName"] for pid, e in m.items()}


def _values(definition):
    s = definition["compute"]["paramState"]
    return {pid: (st["state"], st["value"]) for pid, st in s.items()}


def _save_prior():
    svc.save(USER, DEF_ID, _doc(PRIOR["definition"]["compute"]))


def test_the_fixtures_are_what_this_file_says_they_are():
    """NON-VACUITY. The prior document holds COUNTER ids in walk order, and each
    pinned request is the roster the door test asserts it sent."""
    assert _roster(PRIOR["definition"]) == {"__uct_param_1": "slow", "__uct_param_2": "fast"}
    assert _roster({"compute": SENT["same"]}) == {"__uct_param_1": "slow", "__uct_param_2": "fast"}
    assert _roster({"compute": SENT["added"]}) == {
        "__uct_param_1": "slow", "__uct_param_2": "fast", "__uct_param_1001": "sig"}
    assert _roster({"compute": SENT["renamed"]}) == {"__uct_param_1": "slow", "__uct_param_1001": "quick"}
    assert _roster({"compute": SENT["fresh"]}) == {"__uct_param_1001": "fast", "__uct_param_1002": "slow"}


def test_a_the_same_pine_pasted_over_the_pre_c46_document_SAVES_with_the_same_ids_and_values(store):
    _save_prior()
    _, before = _stored()
    svc.save(USER, DEF_ID, _doc(SENT["same"]))  # accepted: it does not raise
    row, after = _stored()
    # the same script is the same document, and the store keeps one version of it
    assert row["version"] == 1
    assert _roster(after) == {"__uct_param_1": "slow", "__uct_param_2": "fast"}
    assert _values(after) == {"__uct_param_1": (pms.ATTACHED, 21), "__uct_param_2": (pms.ATTACHED, 9)}
    assert _values(after) == _values(before)
    assert after["compute"]["paramManifest"] == before["compute"]["paramManifest"]


def test_a_control_WITHOUT_the_carry_the_same_paste_is_refused(store):
    """What C46 would have shipped without `paramCarry.js`: the fresh translation's
    own (source) ids, PUT over the pre-C46 document. This is the regression the
    carry exists for, and the proof this file can see a refusal."""
    _save_prior()
    with pytest.raises(pms.ParamManifestRejected, match="__uct_param_100[12]"):
        svc.save(USER, DEF_ID, _doc(SENT["fresh"]))
    row, after = _stored()
    assert row["version"] == 1
    assert _roster(after) == {"__uct_param_1": "slow", "__uct_param_2": "fast"}


def test_b_an_input_ADDED_on_an_edit_is_refused_by_condition_15_and_nothing_is_stored(store):
    """The carried ids are accepted; the added input's id is new to the stored
    document, and an edit may not introduce one. Not a C46 change: at base the
    added input minted counter id `_3`, which the server refused the same way
    (the last test in this file)."""
    _save_prior()
    with pytest.raises(pms.ParamManifestRejected, match="__uct_param_1001"):
        svc.save(USER, DEF_ID, _doc(SENT["added"]))
    row, after = _stored()
    assert row["version"] == 1
    assert _roster(after) == {"__uct_param_1": "slow", "__uct_param_2": "fast"}


def test_c_a_RENAMED_input_is_a_new_identity_and_is_refused_by_condition_15(store):
    _save_prior()
    with pytest.raises(pms.ParamManifestRejected, match="__uct_param_1001"):
        svc.save(USER, DEF_ID, _doc(SENT["renamed"]))
    row, _ = _stored()
    assert row["version"] == 1


def test_d_a_FRESH_paste_into_a_new_definition_saves_with_source_ids(store):
    _save_prior()
    svc.save(USER, DEF_FRESH, _doc(SENT["fresh"], DEF_FRESH))
    row, d = _stored(DEF_FRESH)
    assert row["version"] == 1
    assert _roster(d) == {"__uct_param_1001": "fast", "__uct_param_1002": "slow"}
    assert _values(d) == {"__uct_param_1001": (pms.ATTACHED, 9), "__uct_param_1002": (pms.ATTACHED, 21)}


# ─── what BASE did with (b) and (c), reconstructed from the same bodies ──────
#
# Under the walk-order counter the renamed script minted `_1` = slow, `_2` = quick,
# and the added script `_1` = slow, `_2` = fast, `_3` = sig. Re-keying the pinned
# bodies that way reproduces the base request; the server is unchanged, so its
# answer here IS base's answer.

def _rekey(compute, mapping):
    c = copy.deepcopy(compute)
    c["paramManifest"] = {mapping.get(pid, pid): e for pid, e in c["paramManifest"].items()}
    return c


def test_base_record_an_ADDED_input_was_refused_at_base_too(store):
    _save_prior()
    base_body = _rekey(SENT["added"], {"__uct_param_1001": "__uct_param_3"})
    with pytest.raises(pms.ParamManifestRejected, match="__uct_param_3"):
        svc.save(USER, DEF_ID, _doc(base_body))


def test_base_record_a_RENAMED_input_was_ACCEPTED_at_base_under_the_old_inputs_record(store):
    """⚠️ The one behaviour that differs from base. The counter gave `quick` the
    number `fast` used to have, so the server took the save — and, because the
    prior record wins verbatim, went on calling it `fast` / "Fast". A match by
    position, presented as the same input. Under C46 a renamed input is a new one."""
    _save_prior()
    base_body = _rekey(SENT["renamed"], {"__uct_param_1001": "__uct_param_2"})
    svc.save(USER, DEF_ID, _doc(base_body))  # accepted: it does not raise
    _, after = _stored()
    entry = after["compute"]["paramManifest"]["__uct_param_2"]
    assert (entry["sourceName"], entry["title"]) == ("fast", "Fast")
