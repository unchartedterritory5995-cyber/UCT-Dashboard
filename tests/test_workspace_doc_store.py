"""TERM-021 (FB-S5-01) — the versioned workspace document store, its migration and its backup.

Every store here is a synthetic file in ``tmp_path``; nothing reads the wall clock in an
assertion; nothing touches the shared data root. The two acceptance criteria the backlog names,
restated as what THIS slice can prove at the store layer:

  (a) a corrupt blob is not lost when a default board is autosaved over it — it survives
      VERBATIM as the version before, and its parse failure is counted, not absorbed;
  (b) version N-1 can be restored, and a restore APPENDS rather than rewrites.

(The member-facing halves live in ``tests/test_workspace_doc_router.py``.)
"""
from __future__ import annotations

import ast
import datetime as dt
import json
import os
import re
import sqlite3
from pathlib import Path

import pytest

from api.services import store_backup as sb
from api.services import workspace_doc_store as wds
from tools import store_restore as sr

REPO = Path(__file__).resolve().parents[1]
APP_SRC = REPO / "app" / "src"
USER = "u-term021"
BOARD = wds.BOARD_CHARTS
NOW = dt.datetime(2026, 9, 27, 7, 5, 0, tzinfo=dt.timezone.utc)

CORRUPT = '{"widgets":[{"i":"w1","type":"chart","x":0,"y":0,"w":12,"h'   # truncated mid-write
GOOD_LAYOUT = json.dumps({"widgets": [{"i": "w1", "type": "chart", "x": 0, "y": 0, "w": 12, "h": 10}],
                          "cols": 24, "version": 1})
EMPTY_BOARD = json.dumps({"widgets": [], "cols": 24, "version": 1})


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(wds, "_DB_PATH", str(tmp_path / "workspace_docs.db"))
    monkeypatch.delenv(wds.ENABLED_ENV, raising=False)
    return tmp_path / "workspace_docs.db"


def doc(**prefs):
    return {"schema_version": wds.SCHEMA_VERSION, "board": BOARD, "prefs": prefs}


# ═══ 1. append-only, by construction and by measurement ══════════════════════
def test_every_change_appends_a_version_and_nothing_is_rewritten(store):
    r1 = wds.write(USER, BOARD, doc(charts_theme="a"), base_version=0)
    r2 = wds.write(USER, BOARD, doc(charts_theme="b"), base_version=1)
    assert (r1["version"], r2["version"]) == (1, 2)
    assert wds.get_version(USER, BOARD, 1)["doc"]["prefs"] == {"charts_theme": "a"}
    assert wds.get_version(USER, BOARD, 2)["doc"]["prefs"] == {"charts_theme": "b"}
    con = sqlite3.connect(str(store))
    try:
        rows = con.execute("SELECT version FROM workspace_doc_versions ORDER BY id").fetchall()
        triggers = con.execute("SELECT name FROM sqlite_master WHERE type='trigger'").fetchall()
    finally:
        con.close()
    assert [r[0] for r in rows] == [1, 2]
    assert triggers == [], f"a trigger could rewrite rows no statement here names: {triggers}"


def test_the_module_issues_no_UPDATE_or_DELETE_and_the_scan_can_see_one():
    """By AST over the module's own string constants, never by grep: its docstring says
    UPDATE and DELETE on purpose."""
    tree = ast.parse(Path(wds.__file__).read_text(encoding="utf-8"))
    sql = [n.value.strip().upper() for n in ast.walk(tree)
           if isinstance(n, ast.Constant) and isinstance(n.value, str)]
    offenders = [s for s in sql if s.startswith("UPDATE ") or s.startswith("DELETE FROM")
                 or "INSERT OR REPLACE" in s or s.startswith("REPLACE INTO")
                 or "DROP TABLE" in s]
    assert offenders == [], offenders
    # Control: the same walk sees the INSERTs, so an empty list is a measurement.
    assert any(s.startswith("INSERT INTO WORKSPACE_DOC_VERSIONS") for s in sql)


def test_a_byte_identical_write_appends_nothing(store):
    wds.write(USER, BOARD, doc(charts_theme="a"), base_version=0)
    again = wds.write(USER, BOARD, doc(charts_theme="a"), base_version=1)
    assert again == {"appended": False, "version": 1, "tombstone": False}
    assert [h["version"] for h in wds.history(USER, BOARD)] == [1]


# ═══ 2. atomic compare-and-set: a stale base NEVER overwrites ════════════════
def test_a_stale_base_version_is_refused_and_the_head_is_untouched(store):
    wds.write(USER, BOARD, doc(charts_theme="mine"), base_version=0)
    wds.write(USER, BOARD, doc(charts_theme="other-tab"), base_version=1)
    with pytest.raises(wds.VersionConflict) as exc:
        wds.write(USER, BOARD, doc(charts_theme="stale-tab"), base_version=1)
    assert (exc.value.base_version, exc.value.head_version) == (1, 2)
    assert wds.head(USER, BOARD)["doc"]["prefs"] == {"charts_theme": "other-tab"}
    assert [h["version"] for h in wds.history(USER, BOARD)] == [2, 1]


def test_a_first_write_must_name_base_zero(store):
    with pytest.raises(wds.VersionConflict):
        wds.write(USER, BOARD, doc(charts_theme="a"), base_version=3)
    assert wds.head(USER, BOARD) is None


# ═══ 3. tombstoned delete and restore of N-1 ═════════════════════════════════
def test_a_delete_appends_a_tombstone_and_every_earlier_version_survives(store):
    wds.write(USER, BOARD, doc(charts_theme="a"), base_version=0)
    t = wds.tombstone(USER, BOARD, base_version=1)
    assert t["appended"] and t["version"] == 2 and t["tombstone"]
    assert wds.head(USER, BOARD)["tombstone"] is True
    assert wds.get_version(USER, BOARD, 1)["doc"]["prefs"] == {"charts_theme": "a"}
    # Idempotent: nothing live to tombstone twice.
    assert wds.tombstone(USER, BOARD, base_version=2)["appended"] is False
    assert [h["version"] for h in wds.history(USER, BOARD)] == [2, 1]


def test_restoring_N_minus_1_appends_a_copy_and_rewrites_nothing(store):
    wds.write(USER, BOARD, doc(charts_workspace_layout=GOOD_LAYOUT), base_version=0)
    wds.write(USER, BOARD, doc(charts_workspace_layout=EMPTY_BOARD), base_version=1)
    res = wds.restore(USER, BOARD, 1, base_version=2)
    assert res["appended"] and res["version"] == 3 and res["restored_from"] == 1
    h = wds.head(USER, BOARD)
    assert h["doc"]["prefs"]["charts_workspace_layout"] == GOOD_LAYOUT
    assert h["source"] == "restore" and h["restored_from"] == 1
    # The version that was replaced is still there: a restore is itself undoable.
    assert wds.get_version(USER, BOARD, 2)["doc"]["prefs"]["charts_workspace_layout"] == EMPTY_BOARD


def test_a_restore_on_a_stale_base_is_refused(store):
    wds.write(USER, BOARD, doc(charts_theme="a"), base_version=0)
    wds.write(USER, BOARD, doc(charts_theme="b"), base_version=1)
    with pytest.raises(wds.VersionConflict):
        wds.restore(USER, BOARD, 1, base_version=1)
    assert wds.head(USER, BOARD)["doc"]["prefs"] == {"charts_theme": "b"}


def test_a_tombstone_cannot_be_restored_as_a_document(store):
    wds.write(USER, BOARD, doc(charts_theme="a"), base_version=0)
    wds.tombstone(USER, BOARD, base_version=1)
    with pytest.raises(LookupError):
        wds.restore(USER, BOARD, 2, base_version=2)
    assert wds.restore(USER, BOARD, 1, base_version=2)["version"] == 3


# ═══ 4. the migration COPIES, verbatim, and a corrupt blob is KEPT ═══════════
def test_the_snapshot_copies_the_board_keys_verbatim_and_nothing_else(store):
    prefs = {"charts_workspace_layout": GOOD_LAYOUT, "charts_theme": "oled-gold",
             "theme": "oled", "joystick_hub": "{}", "notebook_tour": "1"}
    seen = []
    res = wds.ensure_snapshot(USER, lambda uid: (seen.append(uid), dict(prefs))[1])
    assert res == {"snapshotted": True, "version": 1} and seen == [USER]
    got = wds.prefs_from_doc(wds.head(USER, BOARD)["doc"])
    # The read-fallback shim returns the SAME keys and the SAME bytes, and only board keys.
    assert got == {"charts_workspace_layout": GOOD_LAYOUT, "charts_theme": "oled-gold"}
    # A second call is a no-op: the migration copies once.
    assert wds.ensure_snapshot(USER, lambda uid: pytest.fail("re-read"))["snapshotted"] is False


def test_the_shim_round_trips_every_board_key_byte_for_byte(store):
    prefs = {k: f"{{\"k\":\"{k}\",\"u\":\"é☃\"}}" for k in wds.WORKSPACE_PREF_KEYS}
    prefs["charts_vol_pane_pct"] = ""
    prefs["charts_theme"] = "tv"
    prefs["charts_active_template"] = None     # user_preferences.pref_value is nullable
    wds.ensure_snapshot(USER, lambda uid: prefs)
    assert wds.prefs_from_doc(wds.head(USER, BOARD)["doc"]) == prefs


def test_a_corrupt_blob_survives_verbatim_and_its_parse_failure_is_counted(store):
    wds.ensure_snapshot(USER, lambda uid: {"charts_workspace_layout": CORRUPT, "charts_theme": "not-json"})
    assert wds.head(USER, BOARD)["doc"]["prefs"]["charts_workspace_layout"] == CORRUPT
    assert wds.parse_failure_count(USER) == 1           # the plain-text theme is not an alarm
    con = sqlite3.connect(str(store))
    try:
        row = con.execute("SELECT pref_key, version, raw_len FROM workspace_parse_failures").fetchone()
    finally:
        con.close()
    assert row == ("charts_workspace_layout", 1, len(CORRUPT))
    assert wds.stats()["parse_failures"] == 1


def test_acceptance_a_the_value_a_default_board_overwrites_is_version_N_minus_1(store, monkeypatch):
    """STATE-2 at the store layer: prefs hold a corrupt blob; the client, reading it as a new
    user, autosaves an empty board. Through the two hooks the old value must come back."""
    monkeypatch.setenv(wds.ENABLED_ENV, "1")
    prefs = {"charts_workspace_layout": CORRUPT}
    ticket = wds.begin_pref_write(USER, "charts_workspace_layout", lambda uid: dict(prefs))
    prefs["charts_workspace_layout"] = EMPTY_BOARD           # the old store is overwritten here
    wds.finish_pref_write(ticket, EMPTY_BOARD)
    assert wds.head(USER, BOARD)["doc"]["prefs"]["charts_workspace_layout"] == EMPTY_BOARD
    back = wds.restore(USER, BOARD, wds.head(USER, BOARD)["version"] - 1,
                       base_version=wds.head(USER, BOARD)["version"])
    assert back["doc"]["prefs"]["charts_workspace_layout"] == CORRUPT


def test_a_snapshot_after_a_tombstone_starts_a_new_live_head(store):
    wds.ensure_snapshot(USER, lambda uid: {"charts_theme": "a"})
    wds.tombstone(USER, BOARD, base_version=1)
    res = wds.ensure_snapshot(USER, lambda uid: {"charts_theme": "b"})
    assert res == {"snapshotted": True, "version": 3}
    assert wds.head(USER, BOARD)["doc"]["prefs"] == {"charts_theme": "b"}


# ═══ 5. the document schema ══════════════════════════════════════════════════
@pytest.mark.parametrize("bad, why", [
    ({"schema_version": True, "board": BOARD, "prefs": {}}, "schema_version"),
    ({"schema_version": 2, "board": BOARD, "prefs": {}}, "schema_version"),
    ({"schema_version": 1, "board": "other", "prefs": {}}, "board"),
    ({"schema_version": 1, "board": BOARD, "prefs": {"theme": "oled"}}, "outside the board"),
    ({"schema_version": 1, "board": BOARD, "prefs": {"charts_theme": {"x": 1}}}, "TEXT or null"),
    ({"schema_version": 1, "board": BOARD, "prefs": {}, "extra": 1}, "unknown top-level"),
    ([], "object"),
])
def test_an_invalid_document_is_refused_and_nothing_is_written(store, bad, why):
    with pytest.raises(wds.InvalidDocument, match=why):
        wds.write(USER, BOARD, bad, base_version=0)
    assert wds.head(USER, BOARD) is None


def test_an_oversized_document_is_refused_not_truncated(store, monkeypatch):
    monkeypatch.setattr(wds, "MAX_DOC_BYTES", 200)
    with pytest.raises(wds.InvalidDocument, match="exceeds"):
        wds.write(USER, BOARD, doc(chart_settings="x" * 500), base_version=0)
    assert wds.head(USER, BOARD) is None


# ═══ 6. the key set is DERIVED from the client, never trusted ════════════════
_SET_PREF_LITERAL = re.compile(r"\bsetPref(?:Merged)?\s*\(\s*['\"]([A-Za-z0-9_]+)['\"]")


def _strip_js_comments(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"(?m)(^|[^:\\])//.*$", r"\1", src)


def _client_board_keys() -> set[str]:
    ws = _strip_js_comments((APP_SRC / "pages" / "charts" / "ChartsWorkspace.jsx").read_text(encoding="utf-8"))
    keys = set(_SET_PREF_LITERAL.findall(ws))
    themes = (APP_SRC / "components" / "chart" / "chartThemes.js").read_text(encoding="utf-8")
    m = re.search(r"export const WIDGET_GLOBAL_PREF_KEYS\s*=\s*\{(.*?)\}", themes, re.S)
    assert m, "WIDGET_GLOBAL_PREF_KEYS moved — re-point this scan"
    # The workspace loops this table (`for (const [type, key] of Object.entries(...))`).
    assert "Object.entries(WIDGET_GLOBAL_PREF_KEYS)" in ws, "the workspace no longer loops the table"
    keys |= set(re.findall(r":\s*'([A-Za-z0-9_]+)'", m.group(1)))
    return keys


def test_the_key_set_is_exactly_what_the_workspace_writes():
    derived = _client_board_keys()
    # Non-vacuity: the scan found real, named keys.
    assert {"charts_workspace_layout", "chart_settings", "aisearch_settings"} <= derived
    assert derived == set(wds.WORKSPACE_PREF_KEYS), (
        f"client writes but store lacks: {sorted(derived - wds.WORKSPACE_PREF_KEYS)}; "
        f"store lists but client never writes: {sorted(wds.WORKSPACE_PREF_KEYS - derived)}")


def test_the_comment_stripper_does_not_eat_a_url_or_a_real_call():
    src = "setPref('a', 1) // setPref('ghost', 2)\n/* setPref('ghost2') */ x = 'http://h/p'; setPref('b')"
    assert set(_SET_PREF_LITERAL.findall(_strip_js_comments(src))) == {"a", "b"}


def test_every_board_key_is_one_the_preferences_endpoint_accepts():
    """The mirror only ever sees a key the endpoint validated; a board key the endpoint refused
    would be a key the document could never learn."""
    from api.routers import auth as auth_router
    assert set(wds.WORKSPACE_PREF_KEYS) <= set(auth_router._PREFERENCE_KEYS)
    assert wds.PLAIN_TEXT_KEYS <= wds.WORKSPACE_PREF_KEYS


# ═══ 7. the flag: dark means NO I/O ══════════════════════════════════════════
def test_flag_off_the_hooks_do_no_io_at_all(store, monkeypatch):
    monkeypatch.delenv(wds.ENABLED_ENV, raising=False)

    def boom(*a, **k):
        raise AssertionError("the store was touched while dark")

    monkeypatch.setattr(wds, "_connect", boom)
    ticket = wds.begin_pref_write(USER, "charts_workspace_layout", boom)
    assert ticket is None
    wds.finish_pref_write(ticket, "{}")
    assert not store.exists()


def test_flag_on_a_non_board_key_is_ignored(store, monkeypatch):
    monkeypatch.setenv(wds.ENABLED_ENV, "1")
    assert wds.begin_pref_write(USER, "notebook_tour", lambda uid: pytest.fail("read")) is None
    assert not store.exists()


def test_a_failing_hook_never_raises_and_is_counted(store, monkeypatch):
    monkeypatch.setenv(wds.ENABLED_ENV, "1")
    monkeypatch.setattr(wds, "_HOOK_FAILURES", {"snapshot": 0, "mirror": 0})

    def boom(*a, **k):
        raise sqlite3.OperationalError("disk I/O error")

    monkeypatch.setattr(wds, "_connect", boom)
    ticket = wds.begin_pref_write(USER, "charts_theme", lambda uid: {})
    wds.finish_pref_write(ticket, "x")
    assert wds._HOOK_FAILURES == {"snapshot": 1, "mirror": 1}


# ═══ 8. backed up from day one, and the backup restores into a usable store ═══
class _FakeR2:
    def __init__(self):
        self.objects: dict[str, bytes] = {}

    def upload_file(self, path, bucket, key, ExtraArgs=None):
        self.objects[key] = Path(path).read_bytes()

    def download_file(self, bucket, key, dest):
        Path(dest).write_bytes(self.objects[key])

    def list_objects_v2(self, Bucket=None, Prefix="", ContinuationToken=None):
        keys = sorted(k for k in self.objects if k.startswith(Prefix))
        return {"Contents": [{"Key": k} for k in keys], "IsTruncated": False}

    def delete_object(self, Bucket=None, Key=None):
        self.objects.pop(Key, None)


def _registered():
    return [s for s in sb.STORES if s.module == wds.__name__]


def test_the_store_is_registered_for_backup_with_its_path_read_from_this_module(store):
    regs = _registered()
    assert len(regs) == 1, f"workspace doc store registrations: {regs}"
    spec = regs[0]
    assert (spec.name, spec.klass, spec.attr) == ("workspace_docs", sb.CLASS_MEMBER, "_DB_PATH")
    # The path is the module's, as it resolves right now (the fixture moved it): never restated.
    assert sb.resolve_path(spec.name) == str(store)


def test_the_rehearsal_restores_the_backup_into_a_store_this_module_can_read(store, tmp_path, monkeypatch):
    wds.ensure_snapshot(USER, lambda uid: {"charts_workspace_layout": CORRUPT})
    wds.mirror_pref(USER, "charts_workspace_layout", EMPTY_BOARD)
    wds.tombstone(USER, BOARD, base_version=2)
    assert store.exists()

    monkeypatch.setenv(sb.ENABLED_ENV, "1")
    r2 = _FakeR2()
    res = sb.run_backup(now=NOW, client=r2, bucket="b", stores=["workspace_docs"])
    assert res["workspace_docs"]["status"] == "ok", res

    work = tmp_path / "rehearsal"
    out = sr.rehearse_stores(r2, "b", now=NOW, work=work, stores=["workspace_docs"])
    assert out["verdict"] == sr.PASS, out
    restored = out["stores"]["workspace_docs"]["restored"]
    assert restored["tables"]["workspace_doc_versions"] == 3
    assert restored["tables"]["workspace_parse_failures"] == 1

    # The restored copy is not merely integrity-ok: the module reads it and can restore N-1 on it.
    copy = tmp_path / "reread.db"
    sr.restore_file(Path(work / "workspace_docs" / Path(res["workspace_docs"]["key"]).name), copy, now=NOW)
    monkeypatch.setattr(wds, "_DB_PATH", str(copy))
    assert [h["version"] for h in wds.history(USER, BOARD)] == [3, 2, 1]
    back = wds.restore(USER, BOARD, 1, base_version=3)
    assert back["doc"]["prefs"]["charts_workspace_layout"] == CORRUPT


def test_an_unarmed_store_is_reported_absent_and_never_created(tmp_path, monkeypatch):
    monkeypatch.setattr(wds, "_DB_PATH", str(tmp_path / "never.db"))
    monkeypatch.setenv(sb.ENABLED_ENV, "1")
    res = sb.run_backup(now=NOW, client=_FakeR2(), bucket="b", stores=["workspace_docs"])
    assert res["workspace_docs"]["status"] == "absent"
    assert not (tmp_path / "never.db").exists()
