"""HELD WITHHOLDS, SERVER HALF (coordinator ruling 2026-11-19): a SAVED copy minted before its script's narrow withholds.

Run ONLY this file:  python -m pytest tests/test_pine_held_withholds_saved_copies.py -q -p no:cacheprovider

The member door (part B, `engine/heldWithholds.js`) honours each narrow withhold on every NEW mint and stamps the ones
it honoured (`meta.heldWithholds`). A copy saved BEFORE a withhold keeps its old bytes. Rails:

  * the reader is the committed file the browser imports, and the stamp key is the browser's (one fixture, both sides);
  * a stored copy is OWED a withhold only for the door it was minted on, only when its stamp does not name it, and the
    sentence says what to do (add it again; or, where the door refuses the script itself, that it is withheld);
  * such a copy is refused BY NAME at every server door (served rows, alerts, scans, the scannable stamp, the save
    door, a share preview and install), nothing is deleted, and the copy that honours the withholds is served;
  * the census counts saved copies per held script on a LOCAL fixture of the tables (never production).
The browser doors (install, headless compute) are railed in `app/src/components/chart/engine/heldWithholds.savedCopies.
test.js` and `engine/__tests__/headlessCompute.test.js`. Mutation-proved: `ci/mutants/held-withholds-saved-copies.json`.
"""
from __future__ import annotations

import json
import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools" / "vendor_harness"))

import held_evidence as he  # noqa: E402

from api.services import held_withholds as hw  # noqa: E402
from api.services import runtime_definitions as rt  # noqa: E402
from api.services import user_definitions as svc  # noqa: E402

KEYS = json.loads((ROOT / "tests" / "fixtures" / "held_withhold_keys.json").read_text(encoding="utf-8"))["cases"]

#: a runtime document's script (its own `compute.source`) and a host document's script (stored beside it)
RT_SOURCE = '//@version=5\nindicator("held rt")\nvar float s = 0.0\ns := s + close\nplot(s, title="Sum")\n'
HOST_SOURCE = (ROOT / "corpus" / "committed" / "atr-bands__ad60b125e6.pine").read_text(encoding="utf-8")
OTHER_SOURCE = '//@version=5\nindicator("unrelated")\nplot(close, title="Close")\n'

RT_OUTPUT = {"door": "runtime", "scope": "output", "title": "Sum", "evidence": ["cap-a"]}
RT_COLOUR = {"door": "runtime", "scope": "outputColour", "title": "Sum", "evidence": ["cap-a"]}
HOST_LABELS = {"door": "host", "scope": "objectFamily", "family": "label", "evidence": ["cap-b"]}
HOST_OUTPUT = {"door": "host", "scope": "output", "title": "Mean", "evidence": ["cap-c"]}


def _file(tmp_path, scripts, name="held-synthetic.json"):
    f = tmp_path / name
    f.write_text(json.dumps({"schema": "uct.held-withholds/v1", "scripts": [
        {"sha256": hw.source_hash(src), "withholds": ws} for src, ws in scripts]}), encoding="utf-8")
    return str(f)


def runtime_defn(source=RT_SOURCE, def_id="u_0000000000b1", stamp=None) -> dict:
    meta = {"name": "held", "shortName": "h", "repaint": "non-repainting", "lane": "runtime", "runtimeHistory": "listing"}
    if stamp is not None:
        meta[hw.MINTED] = stamp
    return {
        "schemaVersion": 1, "id": def_id, "version": 1, "meta": meta,
        "compute": {"kind": "runtime", "fn": f"runtime:{def_id}", "rev": 1, "source": source, "outputs": {"value": 0}},
        "placement": {"target": "pane", "pane": {"height": 0.25}},
        "plots": [{"key": "value", "style": "line", "role": "primary", "label": "Sum"}],
        "inputs": [],
    }


def host_defn(def_id="u_0000000000c1", stamp=None) -> dict:
    meta = {"name": "Held", "shortName": "HD", "repaint": "non-repainting", "recurrenceOrigin": "pine"}
    if stamp is not None:
        meta[hw.MINTED] = stamp
    return {
        "schemaVersion": 1, "id": def_id, "version": 1, "meta": meta,
        "compute": {"kind": "ast", "ast": {"type": "call", "name": "sma", "args": [
            {"type": "series", "name": "close"}, {"type": "num", "value": 20}]}},
        "placement": {"target": "price"},
        "plots": [{"key": "value", "style": "line", "role": "primary"}],
        "inputs": [],
    }


# ═══ the reader and the key ════════════════════════════════════════════════════════

def test_the_reader_is_the_file_the_browser_imports_and_the_derivation_writes():
    assert pathlib.Path(hw.FILE_PATH) == he.DOOR_FILE
    doc = json.loads(he.DOOR_FILE.read_text(encoding="utf-8"))
    assert set(hw.committed()) == {s["sha256"] for s in doc["scripts"]} and len(hw.committed()) >= 1
    for ws in hw.committed().values():
        assert all(w["door"] in hw.NARROW_SCOPES for w in ws)


def test_the_stamp_key_is_the_browsers_one_fixture_both_languages():
    assert len(KEYS) >= 4 and {c["withhold"]["scope"] for c in KEYS} == {"output", "outputColour", "paint", "objectFamily"}
    for c in KEYS:
        assert hw.withhold_key(c["withhold"]) == c["key"], c


def test_a_broken_file_withholds_nothing(tmp_path, monkeypatch):
    for content in ("{ not json", "[]", '{"scripts": [{"sha256": "zz", "withholds": []}]}'):
        f = tmp_path / "hw.json"
        f.write_text(content, encoding="utf-8")
        monkeypatch.setattr(hw, "FILE_PATH", str(f))
        assert hw.committed() == {}, content
        assert hw.refused(runtime_defn()) is None


# ═══ owed: by door, by stamp ═══════════════════════════════════════════════════════

def test_a_copy_is_owed_only_its_doors_withholds_that_its_stamp_does_not_name(tmp_path, monkeypatch):
    monkeypatch.setattr(hw, "FILE_PATH", _file(tmp_path, [(RT_SOURCE, [RT_OUTPUT, RT_COLOUR, HOST_LABELS]),
                                                         (HOST_SOURCE, [HOST_LABELS])]))
    # a runtime copy with no stamp: the runtime door's two, never the host door's
    assert hw.owed(runtime_defn()) == [RT_OUTPUT, RT_COLOUR]
    why = hw.refused(runtime_defn())
    assert why.startswith(hw.GUARD + ": this saved copy is not drawn") and "`Sum`" in why and "the colour of `Sum`" in why
    assert "Add the script again" in why and "—" not in why
    # an OLDER stamp (one of the two): owed the other; the stamp naming both: owed nothing
    assert hw.owed(runtime_defn(stamp=[hw.withhold_key(RT_OUTPUT)])) == [RT_COLOUR]
    assert hw.owed(runtime_defn(stamp=sorted(hw.withhold_key(w) for w in (RT_OUTPUT, RT_COLOUR)))) == []
    assert hw.refused(runtime_defn(stamp=[hw.withhold_key(RT_OUTPUT), hw.withhold_key(RT_COLOUR)])) is None
    # a stamp naming the OTHER door's key does not honour this door's
    assert hw.owed(runtime_defn(stamp=[hw.withhold_key(HOST_LABELS)])) == [RT_OUTPUT, RT_COLOUR]
    # the CRLF form of the script is the same script
    assert hw.owed(runtime_defn(source=RT_SOURCE.replace("\n", "\r\n"))) == [RT_OUTPUT, RT_COLOUR]
    # a host copy: its script is the one stored beside it, and only the host door's withhold
    assert hw.owed(host_defn(), HOST_SOURCE) == [HOST_LABELS]
    assert "its labels" in hw.refused(host_defn(), HOST_SOURCE)
    assert hw.owed(host_defn(stamp=["host:objectFamily:label"]), HOST_SOURCE) == []
    # CONTROLS: no script beside a host copy, an unrelated script, a document no Pine door mints
    assert hw.owed(host_defn(), None) == []
    assert hw.owed(runtime_defn(source=OTHER_SOURCE)) == []
    assert hw.owed({"compute": {"kind": "server", "source": RT_SOURCE}, "meta": {}}) == []


def test_a_withhold_the_host_door_cannot_honour_narrowly_says_the_script_is_withheld(tmp_path, monkeypatch):
    """The host door refuses the whole script for any withhold but a drawing family (`memberPaneDefinition.js`), so a
    saved host copy is not told to add the script again: there is no narrower version to add."""
    monkeypatch.setattr(hw, "FILE_PATH", _file(tmp_path, [(HOST_SOURCE, [HOST_OUTPUT, HOST_LABELS])]))
    why = hw.refused(host_defn(), HOST_SOURCE)
    assert why.startswith(hw.GUARD + ": this script is not drawn") and "`Mean`" in why
    assert "withheld until that is fixed" in why and "Add the script again" not in why
    # CONTROL: the drawing family alone is narrow
    monkeypatch.setattr(hw, "FILE_PATH", _file(tmp_path, [(HOST_SOURCE, [HOST_LABELS])], "only-labels.json"))
    assert "Add the script again" in hw.refused(host_defn(), HOST_SOURCE)


# ═══ every server door ═════════════════════════════════════════════════════════════

@pytest.fixture
def store(tmp_path, monkeypatch):
    from api.services import alert_rev_migration as rev
    from api.services import indicator_alert_service as ias
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()
    rev.init_schema()
    # the runtime save door's own gates opened (`test_runtime_definitions.py` rails them)
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    monkeypatch.delenv(rt.KILL_ENV, raising=False)
    monkeypatch.delenv(rt.ALLOW_ENV, raising=False)
    monkeypatch.setenv(rt.STAGE_ENV, rt.STAGE_ALL)
    monkeypatch.setattr(rt, "not_graded", lambda source, graded_only=False: None)
    monkeypatch.setattr(hw, "FILE_PATH", str(tmp_path / "absent.json"))
    return tmp_path


def test_a_saved_host_copy_is_refused_by_name_at_every_server_door(store, tmp_path, monkeypatch):
    from api.routers import user_definitions as router_mod
    from api.services import alert_user_series as aus
    from api.services.screener import scan_run
    did = "u_0000000000c1"
    # CONTROL first: no withholds, the copy saves, is served unstamped, and every lane admits it
    svc.save("u1", did, host_defn(did), pine_source=HOST_SOURCE)
    row = svc.get("u1", did)
    assert "held_divergence" not in row and svc.engine_withheld_reason(row) is None
    assert hw.STAMP not in rt.stamp_served(row)["definition"]["meta"]
    aus._gate_engine(row, did)                                            # no raise
    assert scan_run._load_definition("u1", did)
    # the script gains a withhold on the host door: the copy saved before it is refused by name everywhere
    monkeypatch.setattr(hw, "FILE_PATH", _file(tmp_path, [(HOST_SOURCE, [HOST_LABELS])]))
    row = svc.get("u1", did)
    why = row["held_divergence"]
    assert why.startswith(hw.GUARD + ": this saved copy is not drawn") and "its labels" in why
    assert svc.engine_withheld_reason(row) == why                        # alerts, sweep, on-demand, backtests
    assert rt.stamp_served(row)["definition"]["meta"][hw.STAMP] == why   # served rows -> the install door
    assert hw.STAMP not in row["definition"]["meta"]                     # the stored row is untouched
    with pytest.raises(aus.AdmissionRefused) as exc:
        aus._gate_engine(row, did)
    assert hw.GUARD in str(exc.value)
    with pytest.raises(scan_run.RunRefused):
        scan_run._load_definition("u1", did)
    st = router_mod._stamped(row)
    assert st["scannable"] is False and st["scan_refusal"]["gate"] == "withheld"
    # the save door refuses the same document again, by name, and writes nothing
    with pytest.raises(svc.SaveRefused) as exc:
        svc.save("u1", did, host_defn(did), pine_source=HOST_SOURCE)
    assert exc.value.guard == hw.GUARD and "this copy is not saved" in str(exc.value)
    assert svc.get("u1", did)["version"] == 1
    # the copy the member door mints today (it stamps the withhold it honoured) is stored and served
    svc.save("u1", did, host_defn(did, stamp=["host:objectFamily:label"]), pine_source=HOST_SOURCE)
    row = svc.get("u1", did)
    assert row["version"] == 2 and "held_divergence" not in row and svc.engine_withheld_reason(row) is None
    assert hw.STAMP not in rt.stamp_served(row)["definition"]["meta"]


def test_a_saved_runtime_copy_is_refused_by_name_and_the_honouring_copy_is_served(store, tmp_path, monkeypatch):
    did = "u_0000000000b1"
    svc.save("u1", did, runtime_defn(def_id=did))
    row = svc.get("u1", did)
    assert "held_divergence" not in row and hw.STAMP not in rt.stamp_served(row)["definition"]["meta"]
    monkeypatch.setattr(hw, "FILE_PATH", _file(tmp_path, [(RT_SOURCE, [RT_OUTPUT])]))
    row = svc.get("u1", did)
    why = row["held_divergence"]
    assert why.startswith(hw.GUARD + ":") and "`Sum`" in why
    assert svc.engine_withheld_reason(row) == why
    assert rt.stamp_served(row)["definition"]["meta"][hw.STAMP] == why
    # a runtime document is judged on its own source even when the row carries no sentence (a share preview, a probe)
    assert rt.stamp_served({"def_id": did, "definition": row["definition"]})["definition"]["meta"][hw.STAMP] == why
    with pytest.raises(svc.SaveRefused) as exc:
        svc.save("u1", did, runtime_defn(def_id=did))
    assert exc.value.guard == hw.GUARD
    assert svc.get("u1", did)["version"] == 1
    svc.save("u1", did, runtime_defn(def_id=did, stamp=["runtime:output:Sum"]))
    row = svc.get("u1", did)
    assert row["version"] == 2 and "held_divergence" not in row
    assert hw.STAMP not in rt.stamp_served(row)["definition"]["meta"]


def test_a_stamp_a_client_wrote_back_is_never_stored_or_served(store, tmp_path, monkeypatch):
    # a runtime save scrubs it; a host row is served without it when nothing is owed
    d = runtime_defn()
    d["meta"][hw.STAMP] = "stale"
    svc.save("u1", d["id"], d)
    assert hw.STAMP not in svc.get("u1", d["id"])["definition"]["meta"]
    h = host_defn()
    h["meta"][hw.STAMP] = "stale"
    svc.save("u1", h["id"], h, pine_source=HOST_SOURCE)
    assert hw.STAMP not in rt.stamp_served(svc.get("u1", h["id"]))["definition"]["meta"]
    # the MINT stamp is the member's document and is kept
    svc.save("u1", "u_0000000000b2", runtime_defn(def_id="u_0000000000b2", stamp=["runtime:output:Sum"]))
    assert svc.get("u1", "u_0000000000b2")["definition"]["meta"][hw.MINTED] == ["runtime:output:Sum"]


def test_a_shared_version_saved_before_its_withholds_previews_stamped_and_is_never_installed(store, tmp_path,
                                                                                            monkeypatch):
    from api.routers import user_definitions as router_mod
    did = "u_0000000000c1"
    svc.save("author", did, host_defn(did), pine_source=HOST_SOURCE)
    token = svc.share("author", did)["token"]
    # CONTROL: no withholds, it previews unstamped and installs
    assert hw.STAMP not in router_mod.resolve_shared(token, user={"id": "r0"})["definition"]["meta"]
    assert svc.install_share("r0", token)["version"] == 1
    monkeypatch.setattr(hw, "FILE_PATH", _file(tmp_path, [(HOST_SOURCE, [HOST_LABELS])]))
    preview = router_mod.resolve_shared(token, user={"id": "r1"})
    assert preview["definition"]["meta"][hw.STAMP].startswith(hw.GUARD + ": this shared version is not installed")
    assert "held_divergence" not in preview and "pine_source" not in preview
    with pytest.raises(svc.SaveRefused) as exc:
        svc.install_share("r1", token)
    assert exc.value.guard == hw.GUARD and "The member who shared it" in str(exc.value)
    assert svc.list_for_user("r1") == []                                 # nothing written
    # the author's own row is kept, unchanged
    assert svc.get("author", did)["version"] == 1


# ═══ the census, on a LOCAL fixture of the tables ══════════════════════════════════

def test_the_census_counts_live_saved_copies_per_held_script_never_who(store, tmp_path, monkeypatch):
    stamp = ["runtime:output:Sum"]
    svc.save("m1", "u_0000000000d1", runtime_defn(def_id="u_0000000000d1"))                 # stale -> owed
    svc.save("m2", "u_0000000000d2", runtime_defn(def_id="u_0000000000d2", stamp=stamp))    # honours it
    svc.save("m3", "u_0000000000d3", host_defn("u_0000000000d3"), pine_source=RT_SOURCE)    # host copy, unstamped -> owed
    svc.save("m4", "u_0000000000d4", host_defn("u_0000000000d4"))                           # no script: not counted
    svc.save("m5", "u_0000000000d5", runtime_defn(def_id="u_0000000000d5"))
    assert svc.soft_delete("m5", "u_0000000000d5")                                          # tombstone: not counted
    svc.save("m6", "u_0000000000d6", runtime_defn(def_id="u_0000000000d6"))                 # stale v1 ...
    svc.save("m6", "u_0000000000d6", runtime_defn(def_id="u_0000000000d6", stamp=stamp))    # ... honoured v2: once
    svc.save("m7", "u_0000000000d7", runtime_defn(source=OTHER_SOURCE, def_id="u_0000000000d7"))  # unrelated
    monkeypatch.setattr(hw, "FILE_PATH", _file(tmp_path, [(RT_SOURCE, [RT_OUTPUT, HOST_LABELS]),
                                                         (HOST_SOURCE, [HOST_LABELS])]))
    got = svc.held_withholds_census()
    assert got == {
        hw.source_hash(RT_SOURCE): {"copies": 4, "owed": 2, "byDoor": {"host": 1, "runtime": 3}},
        hw.source_hash(HOST_SOURCE): {"copies": 0, "owed": 0, "byDoor": {"host": 0, "runtime": 0}},
    }
    # counts only: nothing names a member, a definition or a script
    flat = json.dumps(got)
    assert not any(x in flat for x in ("m1", "u_0000000000d1", "indicator("))
    # the census agrees with the doors: exactly the owed copies are refused when served
    refused = [r["def_id"] for r in svc.live_definitions() if r.get("held_divergence")]
    assert sorted(refused) == ["u_0000000000d1", "u_0000000000d3"]
