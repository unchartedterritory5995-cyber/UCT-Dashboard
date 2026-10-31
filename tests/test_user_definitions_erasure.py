"""Account deletion reaches the saved-indicator store (`user_definitions.db`).

⛔⛔ THE GAP. `account_purge.purge_user_data` ran SQL only on the auth.db connection it was
handed, and saved indicators live in a SECOND database. A deleted member kept every saved
indicator, every version of each, their share links and their public-library listings; a
backup restore would have brought them back even after a fix to the live purge.

The rails, each mutation-proved (the report records the mutations):
  1. the purge removes THIS member's definitions (every version), shares, listings, re-lint
     rows -- and, in auth.db, their indicator alerts (test_journal_two_account_purge.py
     carries the auth.db half table by table);
  2. other members' rows are byte-for-byte untouched;
  3. other members' COPIES survive with `origin.author_id` scrubbed to null, and still
     install, draw (validate + byte-identical re-save) and evaluate (the alert lane's real
     admission, cross-lane equality included);
  4. a restore of an older `user_definitions.db` snapshot replays the tombstones and comes
     back without the member;
  5. any failure surfaces in the report's `errors`, never a silent skip.
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from api.services import account_tombstones as at                  # noqa: E402
from api.services import alert_user_series as aus                  # noqa: E402
from api.services import indicator_alert_service as ias            # noqa: E402
from api.services import user_definitions as svc                   # noqa: E402
from api.services import user_definitions_erasure as ude           # noqa: E402

LEAVER = "u-leaver-7f3a"
CONTROL = "u-control-11b2"
FRIEND = "u-friend-90cc"
THIRD = "u-third-5d01"


def _definition(def_id: str, period: int = 5, name: str = "Leaver Average") -> dict:
    close = {"type": "series", "name": "close"}
    tree = {"type": "call", "name": "sma", "args": [close, {"type": "num", "value": period}]}
    return {
        "schemaVersion": 1, "id": def_id, "version": 1,
        "meta": {"name": name, "shortName": "LA", "repaint": "non-repainting"},
        "compute": {"kind": "ast", "ast": tree, "fn": svc.ast_hash(tree)},
        "placement": {"target": "price"},
        "plots": [{"key": "value", "style": "line", "role": "primary"}],
        "inputs": [],
    }


def _bars(n: int = 80) -> list:
    out = []
    for i in range(n):
        c = 100.0 + i
        out.append({"t": 1_700_000_000 + i * 300, "o": c, "h": c * 1.002, "l": c * 0.998,
                    "c": c, "v": 100_000})
    return out


@pytest.fixture(autouse=True)
def store(tmp_path, monkeypatch):
    """A private definition store AND the alert DB a rev-bumping save migrates against (the
    same pairing tests/test_definition_sharing.py documents), plus an empty alert registry."""
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()
    monkeypatch.setenv(at.LOCAL_STORE_ENV, str(tmp_path / "tombstone_store"))
    aus.forget()
    yield tmp_path
    aus.forget()


def _rows(where: str = "1=1", args: tuple = ()) -> dict:
    """Every row of every table in the store that has a `user_id` column, keyed (table, rowid)
    -> the full row. ⛔ The tables are read off the FILE, never off `ude.MEMBER_TABLES`: a rail
    that iterated the list under test would pass with a table dropped from it (mutation M2)."""
    out = {}
    with sqlite3.connect(svc._DB_PATH) as c:
        tables = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        for table in tables:
            if not any(col[1] == "user_id" for col in c.execute(f'PRAGMA table_info("{table}")')):
                continue
            for r in c.execute(f'SELECT rowid, * FROM "{table}" WHERE {where}', args):
                out[(table, r[0])] = r[1:]
    return out


def _relint_row(user_id: str, def_id: str) -> None:
    """One audit row as `user_definition_relint._heal` writes it (its own DDL)."""
    from api.services import user_definition_relint as rl
    with sqlite3.connect(svc._DB_PATH) as c:
        c.executescript(rl._LOG_SCHEMA)
        c.execute("INSERT INTO user_definition_relint_log (user_id, def_id, version, plot_key,"
                  " old_mode, new_mode, healed_at) VALUES (?,?,1,'value','repaints','non-repainting',0)",
                  (str(user_id), def_id))


def _seed_member(user_id: str, name: str) -> dict:
    """Two versions of one definition, a share link, a library listing and a re-lint row."""
    def_id = svc.new_def_id()
    svc.save(user_id, def_id, _definition(def_id, 5, name))
    svc.save(user_id, def_id, _definition(def_id, 8, name))
    token = svc.share(user_id, def_id)["token"]
    assert svc.publish(user_id, def_id)["listed"] is True
    _relint_row(user_id, def_id)
    return {"def_id": def_id, "token": token}


# ═══ 1 + 2. the member's rows go, nobody else's move ═════════════════════════

def test_the_purge_removes_the_members_definitions_shares_listings_and_relint_rows():
    gone = _seed_member(LEAVER, "Leaver Average")
    kept = _seed_member(CONTROL, "Control Average")
    mine_before = _rows("user_id = ?", (LEAVER,))
    tables_seeded = {t for t, _ in mine_before}
    # Typed here on purpose, NOT read from ude.MEMBER_TABLES: the four tables this rail proves.
    expected = {"user_definitions", "definition_shares", "definition_listings", "user_definition_relint_log"}
    assert tables_seeded == expected, f"seed did not reach: {expected - tables_seeded}"
    assert len([k for k in mine_before if k[0] == "user_definitions"]) == 2, "two versions are two rows"
    others_before = _rows("user_id <> ?", (LEAVER,))

    report = svc.purge_user(LEAVER)

    assert report["ok"] is True and report["errors"] == [], report
    assert _rows("user_id = ?", (LEAVER,)) == {}, "the deleted member still owns rows"
    assert report["rows_deleted"]["user_definitions"] == 2
    assert _rows("user_id <> ?", (LEAVER,)) == others_before, "another member's rows changed"
    # The doors agree: the link is dead, the library no longer lists them, the control's work stands.
    with pytest.raises(svc.ShareRefused) as exc:
        svc.resolve_share(gone["token"])
    assert exc.value.reason == "not-found"
    tokens = {e["token"] for e in svc.public_library(60)["entries"]}
    assert gone["token"] not in tokens and kept["token"] in tokens
    assert svc.list_for_user(LEAVER) == [] and len(svc.list_for_user(CONTROL)) == 1
    # Idempotent: a second purge finds nothing and is not an error.
    again = svc.purge_user(LEAVER)
    assert again["ok"] is True and sum(again["rows_deleted"].values()) == 0


def test_the_purge_drops_the_members_compiled_alert_series_and_only_theirs():
    for uid in (LEAVER, CONTROL):
        def_id = svc.new_def_id()
        svc.save(uid, def_id, _definition(def_id))
        aus.admit_user_definition(uid, def_id, bars=_bars())
    assert any(k.startswith(LEAVER + aus.SCOPE_SEP) for k in aus.USER_FUNCS)
    report = svc.purge_user(LEAVER)
    assert report["user_funcs_dropped"] >= 1
    assert not any(k.startswith(LEAVER + aus.SCOPE_SEP) for k in aus.USER_FUNCS)
    assert any(k.startswith(CONTROL + aus.SCOPE_SEP) for k in aus.USER_FUNCS)


# ═══ 3. other members' copies survive, scrubbed, and still work ═════════════

def _origin(row_blob: str):
    return json.loads(row_blob).get("origin")


def test_other_members_copies_survive_with_the_author_scrubbed_and_still_install_draw_and_evaluate():
    leaver = _seed_member(LEAVER, "Leaver Average")
    control = _seed_member(CONTROL, "Control Average")
    copy_id = svc.install_share(FRIEND, leaver["token"])["def_id"]
    # A second version of the copy, and a fork of it: both carry the origin forward.
    edited = svc.get(FRIEND, copy_id)["definition"]
    edited["meta"]["name"] = "Friend's edit"
    svc.save(FRIEND, copy_id, edited)
    fork_id = svc.fork(FRIEND, copy_id)["def_id"]
    from_control = svc.install_share(FRIEND, control["token"])["def_id"]

    def friend_rows():
        with sqlite3.connect(svc._DB_PATH) as c:
            return c.execute("SELECT id, def_id, version, ast_hash, definition FROM user_definitions"
                             " WHERE user_id = ? ORDER BY id", (FRIEND,)).fetchall()

    before = friend_rows()
    carrying = [r for r in before if (_origin(r[4]) or {}).get("author_id") == LEAVER]
    assert len(carrying) == 3, f"non-vacuity: the leaver's id rides on 3 rows, saw {len(carrying)}"
    identity_before = {(d, v): svc.result_identity(svc.get(FRIEND, d, version=v)["definition"])
                       for _, d, v, _, _ in before}

    report = svc.purge_user(LEAVER)
    assert report["ok"] is True and report["authors_scrubbed"] == 3, report

    after = friend_rows()
    assert [r[:4] for r in after] == [r[:4] for r in before], "a copy's row, version or ast_hash moved"
    for (rid, d, v, _h, blob), (_, _, _, _, old) in zip(after, before):
        new_origin, old_origin = _origin(blob), _origin(old)
        if (old_origin or {}).get("author_id") == LEAVER:
            assert new_origin["author_id"] is None
            assert {k: x for k, x in new_origin.items() if k != "author_id"} == \
                   {k: x for k, x in old_origin.items() if k != "author_id"}
            assert {k: x for k, x in json.loads(blob).items() if k != "origin"} == \
                   {k: x for k, x in json.loads(old).items() if k != "origin"}
        else:
            assert blob == old, f"row {rid} did not name the leaver and still changed"
    assert svc.get(FRIEND, from_control)["definition"]["origin"]["author_id"] == CONTROL
    # The leaver's id is gone from the whole store, not just from `origin`.
    with sqlite3.connect(svc._DB_PATH) as c:
        hits = c.execute("SELECT COUNT(*) FROM user_definitions WHERE instr(definition, ?) > 0",
                         (LEAVER,)).fetchone()[0]
    assert hits == 0
    # Every key a copy is filed under is unmoved.
    assert {(d, v): svc.result_identity(svc.get(FRIEND, d, version=v)["definition"])
            for _, d, v, _, _ in after} == identity_before

    # DRAWS: the stored document still validates, and a re-save of exactly what a client reads
    # back appends nothing (the scrub wrote the store's own canonical bytes).
    for d in (copy_id, fork_id):
        doc = svc.get(FRIEND, d)["definition"]
        svc.validate_v2(doc)
        assert svc.save(FRIEND, d, doc)["appended"] is False
    # EVALUATES: the alert lane's real admission, cross-lane equality included.
    admitted = aus.admit_user_definition(FRIEND, copy_id, bars=_bars())
    assert admitted["addresses"] == [f"{copy_id}.value"]
    # INSTALLS: the copy can be shared on, and the next copy names its new author.
    token = svc.share(FRIEND, copy_id)["token"]
    third = svc.install_share(THIRD, token)
    assert third["origin"]["author_id"] == FRIEND
    assert svc.get(THIRD, third["def_id"])["ast_hash"] == svc.get(FRIEND, copy_id)["ast_hash"]


@pytest.mark.parametrize("json1", [True, False], ids=["json1", "instr-fallback"])
def test_the_scrub_matches_the_AUTHOR_not_any_mention_of_the_id(json1, monkeypatch):
    """Only a copy whose `origin.author_id` IS the leaver is rewritten. A copy authored by someone
    else that merely mentions the id (here, as its whole name) keeps its author and its bytes.
    ⛔ Run in BOTH selection modes: with JSON1 SQLite never returns that row, so only the
    instr fallback -- which does fetch it -- proves the exact check in Python (mutation M4)."""
    monkeypatch.setattr(ude, "_has_json1", lambda conn: json1)
    # Named EXACTLY the leaver's id, so the stored text holds the same JSON string the
    # pre-filter searches for ('"<id>"') -- a looser mention would never reach the guard.
    control = _seed_member(CONTROL, LEAVER)
    _seed_member(LEAVER, "Leaver Average")
    copy_id = svc.install_share(FRIEND, control["token"])["def_id"]
    with sqlite3.connect(svc._DB_PATH) as c:
        before = c.execute("SELECT definition FROM user_definitions WHERE user_id = ? AND def_id = ?",
                           (FRIEND, copy_id)).fetchone()[0]
    assert LEAVER in before, "non-vacuity: the copy must mention the leaver's id"
    report = svc.purge_user(LEAVER)
    assert report["ok"] is True and report["authors_scrubbed"] == 0
    with sqlite3.connect(svc._DB_PATH) as c:
        after = c.execute("SELECT definition FROM user_definitions WHERE user_id = ? AND def_id = ?",
                          (FRIEND, copy_id)).fetchone()[0]
    assert after == before
    assert json.loads(after)["origin"]["author_id"] == CONTROL


# ═══ 5. failures surface ════════════════════════════════════════════════════

def test_a_table_that_fails_is_an_error_in_the_report_and_the_other_tables_still_go(monkeypatch):
    _seed_member(LEAVER, "Leaver Average")
    with sqlite3.connect(svc._DB_PATH) as c:
        c.execute("CREATE TABLE definition_broken (x INTEGER)")       # no user_id column
    monkeypatch.setattr(ude, "MEMBER_TABLES", ude.MEMBER_TABLES + ("definition_broken",))
    report = svc.purge_user(LEAVER)
    assert report["ok"] is False
    assert any(e.startswith("definition_broken:") for e in report["errors"]), report["errors"]
    assert report["rows_deleted"]["user_definitions"] == 2, "one bad table aborted the rest"


def test_a_store_that_cannot_be_opened_surfaces_through_the_account_purge(monkeypatch, tmp_path):
    from api.services.journal_two import account_purge
    blocked = tmp_path / "a_directory_not_a_db"
    blocked.mkdir()
    monkeypatch.setattr(svc, "_DB_PATH", str(blocked))
    conn = sqlite3.connect(":memory:")
    try:
        report = account_purge.purge_user_data(LEAVER, conn)
    finally:
        conn.close()
    assert report["ok"] is False
    assert any(e.startswith("user_definitions.db:") for e in report["errors"]), report["errors"]


def test_the_account_purge_reaches_the_second_database():
    from api.services.journal_two import account_purge
    _seed_member(LEAVER, "Leaver Average")
    _seed_member(CONTROL, "Control Average")
    conn = sqlite3.connect(":memory:")
    try:
        report = account_purge.purge_user_data(LEAVER, conn)
    finally:
        conn.close()
    assert report["ok"] is True, report["errors"]
    assert report["user_definitions"]["rows_deleted"]["user_definitions"] == 2
    assert _rows("user_id = ?", (LEAVER,)) == {}
    assert len(svc.list_for_user(CONTROL)) == 1


# ═══ 4. a restored snapshot is re-purged ═════════════════════════════════════

def _snapshot(dst: Path) -> None:
    src = sqlite3.connect(svc._DB_PATH)
    out = sqlite3.connect(str(dst))
    try:
        src.backup(out)
    finally:
        src.close()
        out.close()


def test_a_restore_of_a_snapshot_taken_BEFORE_the_deletion_comes_back_without_the_member(tmp_path):
    from api.services import store_backup as sb
    from api.services.journal_two import account_purge
    from tools import store_restore as sr

    leaver = _seed_member(LEAVER, "Leaver Average")
    _seed_member(CONTROL, "Control Average")
    copy_id = svc.install_share(FRIEND, leaver["token"])["def_id"]

    work = tmp_path / "work"
    work.mkdir()
    art = sb.build_artifacts("user_definitions", svc._DB_PATH, str(work), sr.dt.datetime.now(sr.dt.timezone.utc))

    # The live deletion: the tombstone goes to the (local) off-site store first.
    conn = sqlite3.connect(":memory:")
    try:
        report = account_purge.purge_user_data(LEAVER, conn)
    finally:
        conn.close()
    assert report["ok"] is True and report["tombstone"]["offsite"] is True, report

    # Control: the snapshot really does hold the member (an empty replay restores them).
    control_dest = tmp_path / "control" / "user_definitions.db"
    control_dest.parent.mkdir()
    sr.restore_file(Path(art["gz"]), control_dest, now=sr.dt.datetime.now(sr.dt.timezone.utc),
                    prepare=sr.replay_preparer("user_definitions", {}))
    with sqlite3.connect(str(control_dest)) as c:
        assert c.execute("SELECT COUNT(*) FROM user_definitions WHERE user_id = ?", (LEAVER,)).fetchone()[0] == 2

    # The real restore door, end to end: replays, then renames in.
    dest = tmp_path / "restored" / "user_definitions.db"
    dest.parent.mkdir()
    code = sr.main(["--restore", art["gz"], "--manifest", art["manifest_path"], "--to", str(dest)])
    assert code == sr.PASS
    with sqlite3.connect(str(dest)) as c:
        for table in ude.MEMBER_TABLES:
            try:
                n = c.execute(f"SELECT COUNT(*) FROM {table} WHERE user_id = ?", (LEAVER,)).fetchone()[0]
            except sqlite3.OperationalError:
                continue
            assert n == 0, f"{table}: the restore brought the deleted member back"
        assert c.execute("SELECT COUNT(*) FROM user_definitions WHERE user_id = ?", (CONTROL,)).fetchone()[0] == 2
        blob = c.execute("SELECT definition FROM user_definitions WHERE user_id = ? AND def_id = ?",
                         (FRIEND, copy_id)).fetchone()[0]
    assert json.loads(blob)["origin"]["author_id"] is None, "the restored copy kept the author's id"


def test_a_restore_with_no_readable_tombstones_is_refused_and_the_target_is_untouched(tmp_path, monkeypatch):
    from api.services import store_backup as sb
    from tools import store_restore as sr

    _seed_member(LEAVER, "Leaver Average")
    work = tmp_path / "work"
    work.mkdir()
    art = sb.build_artifacts("user_definitions", svc._DB_PATH, str(work), sr.dt.datetime.now(sr.dt.timezone.utc))
    monkeypatch.delenv(at.LOCAL_STORE_ENV, raising=False)
    monkeypatch.setattr(at, "default_store", lambda: None)
    dest = tmp_path / "restored" / "user_definitions.db"
    dest.parent.mkdir()
    dest.write_bytes(b"the store as it stood")
    code = sr.main(["--restore", art["gz"], "--manifest", art["manifest_path"], "--to", str(dest),
                    "--replace"])
    assert code == sr.FAIL
    assert dest.read_bytes() == b"the store as it stood"
    assert not list(dest.parent.glob("*.pre-restore-*")), "something was moved aside"


def test_a_replay_that_leaves_the_member_present_refuses(tmp_path, monkeypatch):
    from tools import store_restore as sr
    _seed_member(LEAVER, "Leaver Average")
    snap = tmp_path / "snap.db"
    _snapshot(snap)
    monkeypatch.setattr(ude, "purge_users_rows", lambda ids, conn: {"rows_deleted": {}, "errors": []})
    with pytest.raises(sr.RestoreRefused):
        sr.replay_preparer("user_definitions", {LEAVER: "t"})(snap)


# ═══ the table list cannot fall behind the database ══════════════════════════

def _store_schemas() -> list[str]:
    """Every module-level `CREATE TABLE` string of every module that writes THIS database:
    `user_definitions` itself and any module that opens it through the store's own
    `_connect` (today `user_definition_relint`). Derived by AST, never listed."""
    import ast
    out = []
    for path in sorted((REPO / "api").rglob("*.py")):
        src = path.read_text(encoding="utf-8")
        if path.name != "user_definitions.py" and not (
                "user_definitions" in src and ("ud._connect(" in src or "user_definitions._connect(" in src)):
            continue
        for node in ast.parse(src).body:
            if (isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant)
                    and isinstance(node.value.value, str) and "CREATE TABLE" in node.value.value.upper()):
                out.append((path.name, node.value.value))
    return out


def test_every_table_this_database_holds_with_a_user_id_is_purged(tmp_path):
    schemas = _store_schemas()
    names = {n for n, _ in schemas}
    assert {"user_definitions.py", "user_definition_relint.py"} <= names, f"non-vacuity: {names}"
    conn = sqlite3.connect(str(tmp_path / "census.db"))
    try:
        for _, ddl in schemas:
            conn.executescript(ddl)
        tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        member = sorted(t for t in tables
                        if any(c[1] == "user_id" for c in conn.execute(f'PRAGMA table_info("{t}")')))
    finally:
        conn.close()
    assert "user_definitions" in member
    missing = sorted(set(member) - set(ude.MEMBER_TABLES))
    assert not missing, f"user_definitions.db tables holding a member's user_id the purge leaves behind: {missing}"
