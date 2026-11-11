"""2026-11-02 -- line identity: a new line never inherits a deleted line's alerts.

Owner decision: "Do not allow newly created lines to silently inherit deleted lines'
references or alerts. Preserve existing saved definitions and compatibility."
(docs/indicators/OUTPUT-IDENTITY-PROPOSAL-2026-11-02.md.)

What is pinned here, server side:
  * `user_definitions.save` decides every line's identity against the stored
    predecessor and stores it in the version row's `line_ids` column, NEVER in the
    document: a continuing key keeps it, a key the previous version lacked (or a row
    the draft marked `newLine`) gets a fresh one, a client-sent uid is stripped and
    never trusted, and the stored document is exactly what was sent;
  * the identity is invisible to every maths identity (no `rev` bump, no migration);
  * an alert row records the line it was armed on and is refused at the `line` gate
    when its key now names a different line -- on the cache-hit path too;
  * a row stored before line identity is bound once, from the version history:
    adopted when the key never broke, retired when it was deleted and re-added.
"""
from __future__ import annotations

import json
import sqlite3

import pytest

from api.services import alert_user_series as aus
from api.services import indicator_alert_evaluator as ev
from api.services import indicator_alert_service as ias
from api.services import user_definitions as ud
from tests.test_alert_user_admission import (  # noqa: F401 -- fixtures by name
    ADDRESS, DEF_ID, RISING, USER_A, _ast_sma, alerts_db, defn, defs_db, save,
)

UID = ud.PLOT_UID_RE


def _ids(version=None):
    return ud.line_identities(USER_A, DEF_ID, version)


def _plots(version=None):
    row = ud.get(USER_A, DEF_ID, version)
    return {p["key"]: p for p in row["definition"]["plots"]}


def _two(keys=("value", "slow")):
    d = defn(ast_tree=_ast_sma(5))
    d["plots"] = [{"key": k, "style": "line", "role": "primary" if i == 0 else "secondary"}
                  for i, k in enumerate(keys)]
    return d


def _stamp_times(times):
    """Give each stored version of DEF_ID its own created_at (one per second is
    too coarse for a test that saves three versions in one second)."""
    with sqlite3.connect(str(ud._DB_PATH)) as c:
        for version, ts in times.items():
            c.execute("UPDATE user_definitions SET created_at=? WHERE user_id=? AND "
                      "def_id=? AND version=?", (ts, USER_A, DEF_ID, version))


# ─── the definitions rule ────────────────────────────────────────────────────

def test_a_new_definition_gives_every_line_its_own_uid(defs_db, alerts_db):
    d = _two()
    save(USER_A, d)
    p = _ids()
    assert UID.match(p["value"]) and UID.match(p["slow"]) and p["value"] != p["slow"]
    stored = ud.get(USER_A, DEF_ID)["definition"]
    assert all("uid" not in q for q in stored["plots"]), "an identity leaked into the document"


def test_an_edit_of_a_line_keeps_its_uid_and_its_maths_still_moves_rev(defs_db, alerts_db):
    first = save(USER_A, defn(ast_tree=_ast_sma(5)))
    uid = _ids()["value"]
    second = save(USER_A, defn(ast_tree=_ast_sma(9)))
    assert _ids()["value"] == uid
    assert second["rev"] != first["rev"], "the maths moved; rev must still bump"


def test_a_deleted_key_typed_again_later_is_a_NEW_line(defs_db, alerts_db):
    save(USER_A, _two())
    old = _ids()["slow"]
    save(USER_A, _two(("value",)))
    assert "slow" not in _plots()
    save(USER_A, _two())
    new = _ids()["slow"]
    assert UID.match(new) and new != old
    assert _ids()["value"] == _ids(1)["value"], "the untouched line kept its uid"


def test_a_client_sent_uid_is_never_trusted(defs_db, alerts_db):
    save(USER_A, _two())
    real = _ids()["value"]
    spoof = _two()
    spoof["plots"][0]["uid"] = "p_000000000000"
    spoof["plots"][1]["uid"] = real            # try to give 'slow' the other line's identity
    save(USER_A, spoof)
    p = _ids()
    assert p["value"] == real and p["slow"] == _ids(1)["slow"]
    assert all("uid" not in q for q in ud.get(USER_A, DEF_ID)["definition"]["plots"])


def test_the_uid_is_invisible_to_the_maths_identities():
    d = defn(ast_tree=_ast_sma(5))
    with_uid = json.loads(json.dumps(d))
    with_uid["plots"][0]["uid"] = "p_0123456789ab"
    assert ud.trees_identity(d) == ud.trees_identity(with_uid)
    assert ud.ast_hash(d["compute"]["ast"]) == ud.ast_hash(with_uid["compute"]["ast"])


def test_an_OLD_row_keeps_the_implicit_identity_and_is_never_rewritten(defs_db, alerts_db):
    """A version row stored before line identity has no `line_ids`. A byte-identical
    re-save appends nothing; an edit keeps the continuing line on `k:<key>`."""
    save(USER_A, defn(ast_tree=_ast_sma(5)))
    with sqlite3.connect(str(ud._DB_PATH)) as c:      # make it a pre-identity row
        c.execute("UPDATE user_definitions SET line_ids=NULL WHERE def_id=?", (DEF_ID,))
    assert _ids()["value"] == "k:value"
    again = ud.save(USER_A, DEF_ID, defn(ast_tree=_ast_sma(5)))
    assert again["appended"] is False, "a byte-identical re-save of an old row appended a version"
    ud.save(USER_A, DEF_ID, defn(ast_tree=_ast_sma(7)))
    assert _ids()["value"] == "k:value"


def test_the_stored_document_is_exactly_what_was_sent(defs_db, alerts_db):
    d = _two()
    save(USER_A, d)
    assert ud.get(USER_A, DEF_ID)["definition"]["plots"] == d["plots"]


def test_the_served_copy_carries_the_uids_and_the_store_does_not(defs_db, alerts_db):
    save(USER_A, _two())
    served = ud.with_served_uids(ud.get(USER_A, DEF_ID)["definition"], _ids())
    assert [p["uid"] for p in served["plots"]] == [_ids()["value"], _ids()["slow"]]
    assert all("uid" not in q for q in ud.get(USER_A, DEF_ID)["definition"]["plots"])


def test_line_continuity_reads_the_history(defs_db, alerts_db):
    save(USER_A, _two())
    save(USER_A, _two(("value",)))
    save(USER_A, _two())
    _stamp_times({1: 1000, 2: 2000, 3: 3000})
    cur = _ids()
    assert ud.line_continuous_since(USER_A, DEF_ID, "value", 1500) == cur["value"]
    assert ud.line_continuous_since(USER_A, DEF_ID, "slow", 1500) is None   # broke at v2
    assert ud.line_continuous_since(USER_A, DEF_ID, "slow", 3500) == cur["slow"]


# ─── alerts ──────────────────────────────────────────────────────────────────

@pytest.fixture
def rising(monkeypatch):
    monkeypatch.setattr(ev, "_fetch_bars_for_alert",
                        lambda sym, tf, count=200: [dict(b) for b in RISING])


def _create(address=ADDRESS):
    return ias.create(user_id=USER_A, sym="TEST", indicator=address,
                      condition="above", threshold=120.0, tf="5")


def test_an_alert_records_the_line_it_was_armed_on(defs_db, alerts_db, rising):
    save(USER_A, defn(ast_tree=_ast_sma(5)))
    row = ias.get(_create())
    assert row["plot_uid"] == _ids()["value"]
    assert aus.refusal_for_alert(row) is None


def test_a_NEW_line_under_a_deleted_key_does_not_inherit_its_alert(defs_db, alerts_db, rising):
    save(USER_A, defn(ast_tree=_ast_sma(5)))
    old_alert = _create()
    save(USER_A, defn(ast_tree=_ast_sma(5), plot_key="other"))     # 'value' deleted
    save(USER_A, defn(ast_tree=_ast_sma(5)))                         # 'value' typed again
    refusal = aus.refusal_for_alert(ias.get(old_alert))
    assert refusal is not None and refusal.gate == "line"
    assert aus.REFUSAL_FRAGMENTS["line"] in str(refusal)
    # a NEW alert on the new line arms fine -- and populates the shared cache --
    new_alert = _create()
    assert aus.refusal_for_alert(ias.get(new_alert)) is None
    # ...and the old alert is STILL refused on the cache-hit path.
    refusal = aus.refusal_for_alert(ias.get(old_alert))
    assert refusal is not None and refusal.gate == "line"


def test_an_edit_of_the_line_keeps_its_alert(defs_db, alerts_db, rising):
    save(USER_A, defn(ast_tree=_ast_sma(5)))
    alert = _create()
    save(USER_A, defn(ast_tree=_ast_sma(6)))
    aus.forget()
    assert aus.refusal_for_alert(ias.get(alert)) is None


def _unbind(alert_id, created_at):
    with sqlite3.connect(str(ias._DB_PATH)) as c:
        c.execute("UPDATE indicator_alerts SET plot_uid=NULL, created_at=? WHERE id=?",
                  (created_at, alert_id))


def test_a_pre_identity_alert_on_an_unbroken_line_is_bound_to_it(defs_db, alerts_db, rising):
    save(USER_A, defn(ast_tree=_ast_sma(5)))
    alert = _create()
    save(USER_A, defn(ast_tree=_ast_sma(6)))
    _stamp_times({1: 1000, 2: 2000})
    _unbind(alert, 1500)
    aus.forget()
    assert aus.refusal_for_alert(ias.get(alert)) is None
    assert ias.get(alert)["plot_uid"] == _ids()["value"], "the row was not bound"


def test_a_pre_identity_alert_whose_key_was_deleted_and_re_added_is_RETIRED(
        defs_db, alerts_db, rising):
    save(USER_A, defn(ast_tree=_ast_sma(5)))
    alert = _create()
    save(USER_A, defn(ast_tree=_ast_sma(5), plot_key="other"))
    save(USER_A, defn(ast_tree=_ast_sma(5)))
    _stamp_times({1: 1000, 2: 2000, 3: 3000})
    _unbind(alert, 1500)
    aus.forget()
    refusal = aus.refusal_for_alert(ias.get(alert))
    assert refusal is not None and refusal.gate == "line"
    assert ias.get(alert)["plot_uid"] == aus.RETIRED_LINE
    # bound ONCE: a later bind attempt never overwrites it
    assert ias.bind_plot_uid(alert, _ids()["value"]) is False
    assert aus.refusal_for_alert(ias.get(alert)).gate == "line"


def test_a_builtin_alert_carries_no_line_and_is_untouched(defs_db, alerts_db, rising):
    row = ias.get(_create("rsi"))
    assert row["plot_uid"] is None and aus.refusal_for_alert(row) is None


def test_a_pre_identity_alert_is_RETIRED_when_its_line_is_replaced_in_ONE_save(
        defs_db, alerts_db, rising):
    """Independent QA 2026-11-02, a CONFIRMED blocker: a definition and an alert from
    before line identity (both unbound), then ONE save in which the member removed
    'value' and added a new 'value' (`newLine`). The key never left the document,
    so only the identity change `k:value` -> `p_...` shows the line is new -- and
    a legacy exemption in the continuity check let the alert adopt it."""
    save(USER_A, defn(ast_tree=_ast_sma(5)))
    alert = _create()
    with sqlite3.connect(str(ud._DB_PATH)) as c:
        c.execute("UPDATE user_definitions SET line_ids=NULL WHERE def_id=?", (DEF_ID,))
    d = defn(ast_tree=_ast_sma(5))
    d["plots"][0][ud.NEW_LINE_FLAG] = True
    save(USER_A, d)
    assert UID.match(_ids()["value"])
    _stamp_times({1: 1000, 2: 2000})
    _unbind(alert, 1500)
    aus.forget()
    refusal = aus.refusal_for_alert(ias.get(alert))
    assert refusal is not None and refusal.gate == "line"
    assert ias.get(alert)["plot_uid"] == aus.RETIRED_LINE


def test_identities_of_an_all_legacy_history_need_no_document_parse(defs_db, alerts_db,
                                                                     monkeypatch):
    """QA 2026-11-02 measured ~0.8 s for a 100-version history. With no row that
    recorded identities, the answer comes from a metadata query alone."""
    for n in range(5, 25):
        save(USER_A, defn(ast_tree=_ast_sma(n)))
    with sqlite3.connect(str(ud._DB_PATH)) as c:
        c.execute("UPDATE user_definitions SET line_ids=NULL WHERE def_id=?", (DEF_ID,))
    calls = {"n": 0}
    real = ud._plot_keys_of

    def counting(doc):
        calls["n"] += 1
        return real(doc)
    monkeypatch.setattr(ud, "_plot_keys_of", counting)
    assert ud.line_identities(USER_A, DEF_ID) == {"value": "k:value"}
    assert calls["n"] == 1, f"parsed {calls['n']} documents for one version"


def test_line_is_a_named_gate():
    assert "line" in aus.GATES and set(aus.REFUSAL_FRAGMENTS) == set(aus.GATES)


def test_a_row_ADDED_in_the_draft_is_a_new_line_even_under_a_continuing_key(defs_db, alerts_db):
    """Remove 'slow' and add a new 'slow' before ONE save: the key is in both
    versions, so only the draft's `newLine` marker can say it is a different line.
    The marker is never stored."""
    save(USER_A, _two())
    old = _ids()["slow"]
    d = _two()
    d["plots"][1][ud.NEW_LINE_FLAG] = True
    save(USER_A, d)
    assert UID.match(_ids()["slow"]) and _ids()["slow"] != old
    assert all(ud.NEW_LINE_FLAG not in q for q in ud.get(USER_A, DEF_ID)["definition"]["plots"])
    assert _ids()["value"] == _ids(1)["value"]


# ─── what the browser is served ──────────────────────────────────────────────

def test_the_router_serves_identities_BESIDE_an_unchanged_definition(defs_db, alerts_db):
    from api.routers import user_definitions as r
    user = {"id": USER_A, "role": "member"}
    d = _two()
    saved = r._save_or_400(USER_A, DEF_ID, d)
    assert saved["plot_identities"] == _ids()
    one = r.get_definition(DEF_ID, version=None, user=user, graph=False, source=False)
    assert one["plot_identities"] == _ids()
    assert one["definition"]["plots"] == d["plots"], "the served definition must equal the stored one"
    listed = r.list_definitions(user=user, graph=False, engine=None)["definitions"]
    assert listed[0]["plot_identities"] == _ids()
    hist = r.definition_history(DEF_ID, user=user, graph=False)["versions"]
    assert hist[-1]["plot_identities"] == _ids()
    # a copy carrying uids (an older tab's, say) sent back stores nothing new and no uid
    again = r._save_or_400(USER_A, DEF_ID, ud.with_served_uids(one["definition"], _ids()))
    assert again["appended"] is False
    assert all("uid" not in p for p in ud.get(USER_A, DEF_ID)["definition"]["plots"])


def test_a_version_row_written_WITHOUT_identities_inherits_them_while_the_key_continues(
        defs_db, alerts_db):
    """A row whose `line_ids` is NULL (a direct write, an old path) must not turn a
    stamped line into a legacy `k:` one -- that would refuse every alert on it."""
    save(USER_A, _two())
    before = _ids()
    with sqlite3.connect(str(ud._DB_PATH)) as c:
        row = c.execute("SELECT * FROM user_definitions WHERE def_id=? ORDER BY version DESC",
                        (DEF_ID,)).fetchone()
        cols = [d[0] for d in c.execute("SELECT * FROM user_definitions LIMIT 0").description]
        rec = dict(zip(cols, row))
        rec.pop("id", None)
        rec["version"] += 1
        rec["line_ids"] = None
        c.execute(f"INSERT INTO user_definitions ({','.join(rec)}) VALUES ({','.join('?' * len(rec))})",
                  list(rec.values()))
    assert _ids() == before
