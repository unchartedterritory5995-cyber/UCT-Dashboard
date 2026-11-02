"""SAVED-SCRIPT AUTO-UPGRADE — the pre-bump hardening (must land before the first
`SCRIPT_ENGINE_VERSION` bump).

MEDIUM-1  An engine-upgrade write-back migrates the alerts bound to the indicator
          (they must run the corrected maths; the first post-migration cycle is still
          suppressed) but sends ONE in-app notice per indicator, worded as an accuracy
          fix — never one "maths changed (revision a -> b)" notice per alert, triggered
          by somebody opening a chart. The reason is admitted only when the save IS an
          engine upgrade.
MEDIUM-2  What a newer engine learns about a stored version is remembered server-side
          (append-only `definition_engine_status`): a `refused` version is withheld,
          by name, from alerts, the sweep, on-demand runs, backtests and the screener's
          scannable stamp; a remembered status stops the list from re-sending the
          script, so no browser re-translates it.
L6        `pine_source` is bounded at the door.
"""

from __future__ import annotations

import json
import re
import sqlite3
import time
from pathlib import Path

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import user_definitions as router_mod
from api.services import alert_rev_migration as rev
from api.services import alert_user_series as aus
from api.services import indicator_alert_service as ias
from api.services import user_definitions as svc
from api.services import watchlist_alert_service as wls

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = "//@version=5\nindicator('Probe 9c1')\nplot(ta.sma(close, 20))\n"
DEF_ID = "u_00000000beef"


def _ast_sma(period: int) -> dict:
    return {"type": "call", "name": "sma", "args": [
        {"type": "series", "name": "close"}, {"type": "num", "value": period}]}


def defn(period: int = 20, *, engine=None, name: str = "Probe Script", def_id: str = DEF_ID) -> dict:
    meta = {"name": name, "shortName": "PS", "repaint": "non-repainting", "recurrenceOrigin": "pine"}
    if engine is not None:
        meta["engineVersion"] = engine
    return {"schemaVersion": 1, "id": def_id, "version": 1, "meta": meta,
            "compute": {"kind": "ast", "ast": _ast_sma(period)},
            "placement": {"target": "price"},
            "plots": [{"key": "value", "style": "line", "role": "primary"}], "inputs": []}


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()
    rev.init_schema()
    sent: list = []
    monkeypatch.setattr(wls, "deliver_alert_payload", lambda **kw: sent.append(kw) or {"ok": True})
    return {"tmp": tmp_path, "db": alert_db, "sent": sent}


def _bind(db: Path, user: str, indicator: str, n: int) -> list[int]:
    con = sqlite3.connect(str(db))
    try:
        ids = []
        for i in range(n):
            cur = con.execute(
                "INSERT INTO indicator_alerts (user_id, sym, indicator, condition, threshold, tf, "
                "active, last_value, last_evaluated_at, created_at) VALUES (?,?,?,?,?,?,1,?,?,?)",
                (user, f"SYM{i}", indicator, "below", 100.0, "D", 101.0, 1, int(time.time())))
            ids.append(cur.lastrowid)
        con.commit()
        return ids
    finally:
        con.close()


def _legacy_with_bindings(store, n=3):
    """A pre-engine (unstamped) script document holding its script, with `n` alerts."""
    svc.save("u1", DEF_ID, defn(20), pine_source=SCRIPT)
    return _bind(store["db"], "u1", f"{DEF_ID}.value", n)


# ═══ MEDIUM-1 — ONE accuracy-fix notice per indicator ════════════════════════

def test_an_ENGINE_UPGRADE_migrates_every_binding_and_sends_ONE_accuracy_notice(store):
    ids = _legacy_with_bindings(store, 3)
    out = svc.save("u1", DEF_ID, defn(25, engine=1), pine_source=SCRIPT,
                   expected_version=1, reason=svc.ENGINE_UPGRADE_REASON)
    assert out["rev_bumped"] is True and out["migrated"] == 3
    notices = [s for s in store["sent"] if s.get("source") == "indicator_engine_upgrade"]
    per_alert = [s for s in store["sent"] if s.get("source") == "indicator_alert_migration"]
    assert per_alert == [], "an engine upgrade must not send one notice per alert"
    assert len(notices) == 1 and out["notified"] == 1
    assert notices[0]["message"] == "Probe Script: accuracy update applied — its alerts now use the corrected calculation"
    assert "revision" not in notices[0]["message"] and "→" not in notices[0]["message"]
    assert notices[0]["channels_allowed"] == frozenset({"in_app"})
    # the bindings DID migrate: corrected maths, previous value cleared, first cycle skipped
    for aid in ids:
        row = rev.rev_row(aid)
        assert row is not None and row["def_rev"] == out["rev"]
        alert = {"id": aid, "last_evaluated_at": 1}
        assert rev.suppress_first_cycle(alert) is True, (
            "the corrected value moves under a level alert exactly as an edit does — the skip stays")


def test_an_upgrade_with_NO_bindings_sends_nothing(store):
    svc.save("u1", DEF_ID, defn(20), pine_source=SCRIPT)
    out = svc.save("u1", DEF_ID, defn(25, engine=1), pine_source=SCRIPT,
                   expected_version=1, reason=svc.ENGINE_UPGRADE_REASON)
    assert out["appended"] is True and out["notified"] == 0
    assert store["sent"] == []


def test_an_ORDINARY_edit_still_notifies_per_alert(store):
    """Control: without the reason, Phase C's per-binding notice is unchanged."""
    _legacy_with_bindings(store, 2)
    svc.save("u1", DEF_ID, defn(25), pine_source=SCRIPT, expected_version=1)
    assert len([s for s in store["sent"] if s.get("source") == "indicator_alert_migration"]) == 2
    assert [s for s in store["sent"] if s.get("source") == "indicator_engine_upgrade"] == []


@pytest.mark.parametrize("why,kwargs", [
    ("no base_version", dict(pine_source=SCRIPT, expected_version=None)),
    ("a different script", dict(pine_source=SCRIPT + "// edited\n", expected_version=1)),
    ("no script", dict(pine_source=None, expected_version=1)),
])
def test_the_reason_is_REFUSED_unless_the_save_IS_an_engine_upgrade(store, why, kwargs):
    _legacy_with_bindings(store, 1)
    with pytest.raises(ValueError, match="engine upgrade"):
        svc.save("u1", DEF_ID, defn(25, engine=1), reason=svc.ENGINE_UPGRADE_REASON, **kwargs)
    assert store["sent"] == [] and len(svc.history("u1", DEF_ID)) == 1, why


def test_the_reason_is_refused_when_the_stamp_is_not_NEWER(store):
    svc.save("u1", DEF_ID, defn(20, engine=1), pine_source=SCRIPT)
    with pytest.raises(ValueError, match="newer engine"):
        svc.save("u1", DEF_ID, defn(25, engine=1), pine_source=SCRIPT,
                 expected_version=1, reason=svc.ENGINE_UPGRADE_REASON)
    with pytest.raises(ValueError, match="not a save reason"):
        svc.save("u1", DEF_ID, defn(25, engine=2), pine_source=SCRIPT,
                 expected_version=1, reason="anything")


# ═══ MEDIUM-2 — the remembered verdict ═══════════════════════════════════════

def test_a_recorded_REFUSAL_is_appended_never_touches_the_document_and_is_served(store):
    svc.save("u1", DEF_ID, defn(20), pine_source=SCRIPT)
    before = svc.get("u1", DEF_ID)
    svc.record_engine_status("u1", DEF_ID, version=1, engine=1, status="refused",
                             reason="the pasted script offers no plot")
    after = svc.get("u1", DEF_ID)
    assert after["definition"] == before["definition"] and after["version"] == 1
    assert after["engine_status"] == {"engine": 1, "status": "refused",
                                      "reason": "the pasted script offers no plot"}
    assert svc.list_for_user("u1")[0]["engine_status"]["status"] == "refused"
    assert svc.live_definitions()[0]["engine_status"]["status"] == "refused"
    why = svc.engine_withheld_reason(after)
    assert why and "offers no plot" in why
    # a WRITE-FAILED status is remembered but withholds nothing from the lanes
    svc.record_engine_status("u1", DEF_ID, version=1, engine=1, status="write-failed",
                             reason="needs your repaint acknowledgement")
    assert svc.engine_withheld_reason(svc.get("u1", DEF_ID)) is None


def test_a_status_about_a_version_that_is_no_longer_live_is_refused(store):
    svc.save("u1", DEF_ID, defn(20), pine_source=SCRIPT)
    svc.save("u1", DEF_ID, defn(21), pine_source=SCRIPT)
    with pytest.raises(svc.SaveConflict):
        svc.record_engine_status("u1", DEF_ID, version=1, engine=1, status="refused", reason="x")
    with pytest.raises(ValueError):
        svc.record_engine_status("u1", DEF_ID, version=2, engine=1, status="bogus", reason="x")
    with pytest.raises(svc.ForkRefused):
        svc.record_engine_status("u2", DEF_ID, version=2, engine=1, status="refused", reason="x")
    # and a newer version carries no status of the old one
    assert "engine_status" not in svc.get("u1", DEF_ID)


def test_a_remembered_status_stops_the_list_resending_the_script(store):
    svc.save("u1", DEF_ID, defn(20), pine_source=SCRIPT)
    assert svc.list_for_user("u1", source_below=1)[0]["pine_source"] == SCRIPT
    svc.record_engine_status("u1", DEF_ID, version=1, engine=1, status="write-failed", reason="422")
    assert "pine_source" not in svc.list_for_user("u1", source_below=1)[0], \
        "a remembered failure must not cost a re-download and re-translation on every load"
    # a NEWER engine than the one that answered asks again
    assert svc.list_for_user("u1", source_below=2)[0]["pine_source"] == SCRIPT


def test_EVERY_server_lane_withholds_a_refused_version_by_name(store, monkeypatch):
    svc.save("u1", DEF_ID, defn(20), pine_source=SCRIPT)
    svc.record_engine_status("u1", DEF_ID, version=1, engine=1, status="refused",
                             reason="the pasted script offers no plot")
    # alerts — the admission's gate, by name, before anything is evaluated
    with pytest.raises(aus.AdmissionRefused) as exc:
        aus.admit_user_definition("u1", DEF_ID, bars=[{"t": 1, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}])
    assert exc.value.gate == "withheld" and "engine-refused" in str(exc.value)
    # the sweep
    from api.services.screener import scan_evaluator
    assert scan_evaluator.definitions_to_sweep() == []
    # an on-demand run
    from api.services.screener import scan_run
    with pytest.raises(scan_run.RunRefused) as run_exc:
        scan_run._load_definition("u1", DEF_ID)
    assert "engine-refused" in run_exc.value.detail
    # a backtest
    from api.routers import screener_backtest
    with pytest.raises(HTTPException) as bt:
        screener_backtest._definition_tree(DEF_ID, "u1")
    assert bt.value.status_code == 409 and "engine-refused" in bt.value.detail
    # the screener's scannable stamp
    stamped = router_mod._stamped(svc.list_for_user("u1")[0])
    assert stamped["scannable"] is False and stamped["scan_refusal"]["gate"] == "withheld"


def test_CONTROL_an_unrefused_version_passes_the_engine_gate(store):
    """Non-vacuity: the same lanes see nothing from the engine gate without a record."""
    svc.save("u1", DEF_ID, defn(20), pine_source=SCRIPT)
    row = svc.get("u1", DEF_ID)
    assert svc.engine_withheld_reason(row) is None
    aus._gate_engine(row, DEF_ID)   # does not raise
    from api.services.screener import scan_evaluator
    assert len(scan_evaluator.definitions_to_sweep()) == 1


def test_a_refusal_drops_the_members_admitted_alert_functions(store, monkeypatch):
    calls = []
    monkeypatch.setattr(aus, "forget", lambda uid=None: calls.append(uid) or 0)
    svc.save("u1", DEF_ID, defn(20), pine_source=SCRIPT)
    calls.clear()
    svc.record_engine_status("u1", DEF_ID, version=1, engine=1, status="write-failed", reason="x")
    assert calls == [], "a write failure withholds nothing, so nothing is dropped"
    svc.record_engine_status("u1", DEF_ID, version=1, engine=1, status="refused", reason="x")
    assert calls == ["u1"]


# ═══ the router ══════════════════════════════════════════════════════════════

@pytest.fixture
def client(store, monkeypatch):
    a = FastAPI()
    a.include_router(router_mod.router)
    a.dependency_overrides[get_current_user_with_plan] = lambda: {"id": "u1", "role": "user", "plan": "pro"}
    monkeypatch.setattr(router_mod, "is_paid_user", lambda u: True)
    return TestClient(a)


def test_the_router_carries_the_reason_and_the_status(client, store):
    r = client.post("/api/user-definitions", json={"definition": defn(), "pine_source": SCRIPT})
    def_id = r.json()["def_id"]
    _bind(store["db"], "u1", f"{def_id}.value", 2)
    up = client.put(f"/api/user-definitions/{def_id}", json={
        "definition": defn(25, engine=1, def_id=def_id), "pine_source": SCRIPT,
        "base_version": 1, "save_reason": "engine-upgrade"})
    assert up.status_code == 200, up.text
    assert len([s for s in store["sent"] if s.get("source") == "indicator_engine_upgrade"]) == 1
    bad = client.put(f"/api/user-definitions/{def_id}", json={
        "definition": defn(26, engine=1, def_id=def_id), "save_reason": "something-else"})
    assert bad.status_code == 422
    st = client.post(f"/api/user-definitions/{def_id}/engine-status",
                     json={"version": 2, "engine": 1, "status": "refused", "reason": "nope"})
    assert st.status_code == 200, st.text
    stale = client.post(f"/api/user-definitions/{def_id}/engine-status",
                        json={"version": 1, "engine": 1, "status": "refused", "reason": "nope"})
    assert stale.status_code == 409
    missing = client.post("/api/user-definitions/u_0000000000ff/engine-status",
                          json={"version": 1, "engine": 1, "status": "refused", "reason": "nope"})
    assert missing.status_code == 404
    listed = client.get("/api/user-definitions").json()["definitions"][0]
    assert listed["engine_status"]["status"] == "refused" and listed["scannable"] is False


def test_L6_pine_source_is_bounded_at_the_door(client):
    big = "x" * (svc.MAX_PINE_SOURCE_BYTES + 1)
    r = client.post("/api/user-definitions", json={"definition": defn(), "pine_source": big})
    assert r.status_code == 422
    ok = client.post("/api/user-definitions", json={"definition": defn(), "pine_source": "x" * 10})
    assert ok.status_code == 200


def test_the_browser_cap_IS_the_store_cap():
    """`scriptEngineVersion.PINE_SOURCE_MAX_BYTES` is read from the JS file, not restated."""
    js = (ROOT / "app/src/components/chart/engine/scriptEngineVersion.js").read_text(encoding="utf-8")
    m = re.search(r"export const PINE_SOURCE_MAX_BYTES = (\d+) \* (\d+)", js)
    assert m, "the browser's cap is not declared where this rail reads it"
    assert int(m.group(1)) * int(m.group(2)) == svc.MAX_PINE_SOURCE_BYTES


# ═══ review MEDIUM-1 — a refusal is not lifted by saving around it ════════════

def _refused(store):
    svc.save("u1", DEF_ID, defn(20), pine_source=SCRIPT)
    svc.record_engine_status("u1", DEF_ID, version=1, engine=1, status="refused",
                             reason="the pasted script offers no plot")


def test_a_FORMULA_save_of_a_refused_definition_stays_withheld(store):
    """Even an unchanged re-save from the Formula tab (no script, no stamp, marked
    `scriptEdited`) must not put the refused maths back into the lanes."""
    _refused(store)
    edited = defn(20)
    edited["meta"]["scriptEdited"] = True
    out = svc.save("u1", DEF_ID, edited, expected_version=1)
    assert out["appended"] is True and out["version"] == 2
    row = svc.get("u1", DEF_ID)
    assert row["engine_status"]["status"] == "refused"
    assert svc.engine_withheld_reason(row), "a hand save lifted the withhold"
    from api.services.screener import scan_evaluator
    assert scan_evaluator.definitions_to_sweep() == []


def test_a_script_save_without_a_STAMP_does_not_lift_it_either(store):
    _refused(store)
    svc.save("u1", DEF_ID, defn(22), pine_source=SCRIPT, expected_version=1)
    assert svc.engine_withheld_reason(svc.get("u1", DEF_ID))


def test_a_save_FROM_THE_SCRIPT_path_lifts_it(store):
    """Stamped AND carrying its script: today's translation — the one door out."""
    _refused(store)
    svc.save("u1", DEF_ID, defn(25, engine=1), pine_source=SCRIPT, expected_version=1)
    row = svc.get("u1", DEF_ID)
    assert "engine_status" not in row and svc.engine_withheld_reason(row) is None


def test_a_tombstone_and_a_resurrect_carry_the_refusal(store):
    _refused(store)
    assert svc.soft_delete("u1", DEF_ID) is True
    svc.save("u1", DEF_ID, defn(20))          # resurrect over the tombstone (no script)
    assert svc.engine_withheld_reason(svc.get("u1", DEF_ID))


def test_a_fork_of_a_refused_definition_is_refused_too(store):
    _refused(store)
    out = svc.fork("u1", DEF_ID)
    assert svc.engine_withheld_reason(svc.get("u1", out["def_id"]))


def test_the_withhold_sentence_names_the_real_door():
    st = {"engine_status": {"engine": 1, "status": "refused", "reason": "r"}}
    assert "Pine tab" in svc.engine_withheld_reason(st)


# ═══ review #1 — every refusal has a way out: it binds only its own engine ════
#
# Semantics (`engine_withheld_reason`): a `refused` verdict (recorded or carried)
# names the engine that refused. While that engine is today's (`SCRIPT_ENGINE_VERSION`
# >= it), the version is held. Once the engine moves past it:
#   * a version that HOLDS its script is held until today's engine re-answers it (the
#     next chart load re-translates it: accepted -> written back from the script path,
#     refused -> a new verdict at today's number);
#   * a version WITHOUT its script (a studio / Formula hand edit, a share install) can
#     never be re-translated, so the verdict expires and it runs as the member's maths.
# The browser (`savedScriptUpgrade.upgradeKindOf`) answers the same question the same way.

def _bump(monkeypatch, n):
    monkeypatch.setattr(svc, "SCRIPT_ENGINE_VERSION", n)


def test_a_carried_refusal_on_a_SCRIPTLESS_descendant_expires_when_the_engine_passes_it(store, monkeypatch):
    _refused(store)                                   # v1 refused by engine 1 (today's)
    edited = defn(23)
    edited["meta"]["scriptEdited"] = True
    svc.save("u1", DEF_ID, edited, expected_version=1)   # studio edit: no script
    row = svc.get("u1", DEF_ID)
    assert row["engine_status"]["engine"] == 1, "the carry must name the engine that refused"
    assert svc.engine_withheld_reason(row), "while the refusing engine is today's, it is held"
    _bump(monkeypatch, 2)
    assert svc.engine_withheld_reason(svc.get("u1", DEF_ID)) is None, \
        "a scriptless descendant can never be re-translated: the verdict must expire"
    from api.services.screener import scan_evaluator
    assert len(scan_evaluator.definitions_to_sweep()) == 1


def test_a_refused_version_HOLDING_its_script_stays_held_until_todays_engine_re_answers(store, monkeypatch):
    _refused(store)
    _bump(monkeypatch, 2)
    row = svc.get("u1", DEF_ID)
    why = svc.engine_withheld_reason(row)
    assert why and "re-check" in why, "held, but as awaiting today's engine, not as refused by it"
    # the list hands the newer browser the script so it CAN re-answer
    assert svc.list_for_user("u1", source_below=2)[0]["pine_source"] == SCRIPT
    # today's engine accepts it: the write-back (script path, stamp 2) lifts it
    svc.save("u1", DEF_ID, defn(25, engine=2), pine_source=SCRIPT, expected_version=1,
             reason="engine-upgrade")
    assert svc.engine_withheld_reason(svc.get("u1", DEF_ID)) is None


def test_CONTROL_todays_engine_refusing_again_keeps_it_held(store, monkeypatch):
    _refused(store)
    _bump(monkeypatch, 2)
    svc.record_engine_status("u1", DEF_ID, version=1, engine=2, status="refused", reason="still no plot")
    why = svc.engine_withheld_reason(svc.get("u1", DEF_ID))
    assert why and "version 2" in why and "still no plot" in why


def test_the_server_engine_number_IS_the_browsers():
    """`svc.SCRIPT_ENGINE_VERSION` is read against the JS file, not trusted."""
    js = (ROOT / "app/src/components/chart/engine/scriptEngineVersion.js").read_text(encoding="utf-8")
    m = re.search(r"export const SCRIPT_ENGINE_VERSION = (\d+)", js)
    assert m and int(m.group(1)) == svc.SCRIPT_ENGINE_VERSION


# ═══ review #2 — the script path lifts a refusal only with a stamp >= the refuser ═

def test_a_raw_PUT_of_the_stored_script_with_its_OLD_stamp_does_not_lift_it(store, monkeypatch):
    _bump(monkeypatch, 2)
    svc.save("u1", DEF_ID, defn(20, engine=1), pine_source=SCRIPT)
    svc.record_engine_status("u1", DEF_ID, version=1, engine=2, status="refused", reason="no plot")
    out = svc.save("u1", DEF_ID, defn(21, engine=1), pine_source=SCRIPT, expected_version=1)
    assert out["appended"] is True
    row = svc.get("u1", DEF_ID)
    assert svc.engine_withheld_reason(row), "an engine-1 stamp is not today's translation"


def test_CONTROL_a_stamp_at_the_refusing_engine_does_lift_it(store, monkeypatch):
    _bump(monkeypatch, 2)
    svc.save("u1", DEF_ID, defn(20, engine=1), pine_source=SCRIPT)
    svc.record_engine_status("u1", DEF_ID, version=1, engine=2, status="refused", reason="no plot")
    svc.save("u1", DEF_ID, defn(26, engine=2), pine_source=SCRIPT, expected_version=1)
    assert svc.engine_withheld_reason(svc.get("u1", DEF_ID)) is None


# ═══ review #3 — a share install carries the verdict, like a fork ═════════════

def test_a_share_install_of_a_refused_version_carries_its_verdict(store):
    _refused(store)
    token = svc.share("u1", DEF_ID)["token"]
    out = svc.install_share("u2", token)
    row = svc.get("u2", out["def_id"])
    assert row["engine_status"]["status"] == "refused" and row["engine_status"]["engine"] == 1
    assert svc.engine_withheld_reason(row), "the installer's lanes would run the refused maths"


def test_CONTROL_a_share_install_of_an_unrefused_version_carries_nothing(store):
    svc.save("u1", DEF_ID, defn(20), pine_source=SCRIPT)
    out = svc.install_share("u2", svc.share("u1", DEF_ID)["token"])
    assert "engine_status" not in svc.get("u2", out["def_id"])


# ═══ review #4 — the copy and its carried verdict are ONE transaction ════════

@pytest.mark.parametrize("door", ["fork", "install"])
def test_a_copy_and_its_carried_verdict_commit_together(store, monkeypatch, door):
    _refused(store)
    token = svc.share("u1", DEF_ID)["token"] if door == "install" else None

    def boom(*a, **k):
        raise RuntimeError("carry failed")
    monkeypatch.setattr(svc, "_carry_refusal", boom)
    with pytest.raises(RuntimeError):
        svc.fork("u1", DEF_ID) if door == "fork" else svc.install_share("u2", token)
    owner = "u1" if door == "fork" else "u2"
    assert [r["def_id"] for r in svc.list_for_user(owner)] == ([DEF_ID] if door == "fork" else []), \
        "the copy was committed without its verdict"
