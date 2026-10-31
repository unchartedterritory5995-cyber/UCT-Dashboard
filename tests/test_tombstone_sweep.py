"""The restore overrides, the replay's WAL checkpoint, and the LIVE tombstone sweep.

Rails (each mutation-proved; the report records the mutations):
  * a restore with no off-site tombstones can still be done ON PURPOSE -- from a local
    tombstone file, or `--allow-unreplayed` with nothing -- and it prints the unverified ids
    and leaves a pending marker that the sweep later finishes and retires;
  * the replay's checkpoint leaves no `-wal` content: the MAIN file alone carries the deletes;
  * the sweep removes a stale author id re-saved by an open editor, a late alert fire, and rows
    a failed purge half left -- and touches no other member's rows;
  * the sweep is idempotent, and skips an id that still has a `users` row.
"""
from __future__ import annotations

import json
import shutil
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
from api.services import tombstone_sweep as ts                     # noqa: E402
from api.services import user_definitions as svc                   # noqa: E402
from api.services import user_definitions_erasure as ude           # noqa: E402

LEAVER = "u-leaver-7f3a"
CONTROL = "u-control-11b2"
FRIEND = "u-friend-90cc"


def _definition(def_id: str, period: int = 5, name: str = "Average") -> dict:
    close = {"type": "series", "name": "close"}
    tree = {"type": "call", "name": "sma", "args": [close, {"type": "num", "value": period}]}
    return {
        "schemaVersion": 1, "id": def_id, "version": 1,
        "meta": {"name": name, "shortName": "AV", "repaint": "non-repainting"},
        "compute": {"kind": "ast", "ast": tree, "fn": svc.ast_hash(tree)},
        "placement": {"target": "price"},
        "plots": [{"key": "value", "style": "line", "role": "primary"}],
        "inputs": [],
    }


@pytest.fixture(autouse=True)
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    auth = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(auth))
    monkeypatch.setattr(ias, "_DB_PATH", str(auth))
    ias.init_schema()                                   # indicator_alerts + indicator_alert_fires
    with sqlite3.connect(str(auth)) as c:
        c.execute("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY)")
        at.ensure_table(c)
    tomb_dir = tmp_path / "tombstone_store"
    monkeypatch.setenv(at.LOCAL_STORE_ENV, str(tomb_dir))
    aus.forget()
    yield {"tmp": tmp_path, "auth": auth, "tomb_dir": tomb_dir}
    aus.forget()


def _seed(user_id: str, name: str) -> dict:
    def_id = svc.new_def_id()
    svc.save(user_id, def_id, _definition(def_id, 5, name))
    token = svc.share(user_id, def_id)["token"]
    svc.publish(user_id, def_id)
    return {"def_id": def_id, "token": token}


def _store_rows() -> dict:
    out = {}
    with sqlite3.connect(svc._DB_PATH) as c:
        for t in ("user_definitions", "definition_shares", "definition_listings"):
            for r in c.execute(f"SELECT * FROM {t} ORDER BY id"):
                out[(t, r[0])] = tuple(r)
    return out


def _auth_rows(auth) -> dict:
    with sqlite3.connect(str(auth)) as c:
        return {t: c.execute(f"SELECT * FROM {t} ORDER BY id").fetchall()
                for t in ("indicator_alerts", "indicator_alert_fires")}


def _fire(auth, user_id: str, alert_id: int, key: str) -> None:
    with sqlite3.connect(str(auth)) as c:
        c.execute("INSERT INTO indicator_alert_fires (alert_id, user_id, sym, indicator, condition, tf,"
                  " fire_key, value, fired_at) VALUES (?,?,'SPY','u_aaaaaaaaaaaa.value','above','D',?,1.0,0)",
                  (alert_id, user_id, key))


def _alert(auth, user_id: str) -> int:
    with sqlite3.connect(str(auth)) as c:
        cur = c.execute("INSERT INTO indicator_alerts (user_id, sym, indicator, condition, tf, created_at)"
                        " VALUES (?, 'SPY', 'u_aaaaaaaaaaaa.value', 'above', 'D', 0)", (user_id,))
        return cur.lastrowid


def _delete_account(auth, user_id: str) -> dict:
    """The live deletion, as the admin door runs it: tombstone + purge, then the users row."""
    from api.services.journal_two import account_purge
    with sqlite3.connect(str(auth)) as c:
        rep = account_purge.purge_user_data(user_id, c)
        c.execute("DELETE FROM users WHERE id = ?", (user_id,))
        c.commit()
    return rep


# ═══ the live sweep ═════════════════════════════════════════════════════════

def test_the_sweep_removes_a_stale_author_a_late_fire_and_a_failed_halfs_rows_and_nothing_else(env):
    auth = env["auth"]
    with sqlite3.connect(str(auth)) as c:
        c.executemany("INSERT INTO users (id) VALUES (?)", [(LEAVER,), (CONTROL,), (FRIEND,)])
    leaver = _seed(LEAVER, "Leaver")
    _seed(CONTROL, "Control")
    copy_id = svc.install_share(FRIEND, leaver["token"])["def_id"]
    stale_editor_doc = svc.get(FRIEND, copy_id)["definition"]          # an open tab, pre-deletion
    friend_alert = _alert(auth, FRIEND)
    _fire(auth, FRIEND, friend_alert, "friend-1")

    rep = _delete_account(auth, LEAVER)
    assert rep["ok"] is True, rep["errors"]

    # What a purge that already ran cannot see:
    stale_editor_doc["meta"]["name"] = "edited in a tab left open"       # 1. the stale re-save
    assert stale_editor_doc["origin"]["author_id"] == LEAVER
    svc.save(FRIEND, copy_id, stale_editor_doc)
    late_alert = _alert(auth, LEAVER)                                    # 2. a late evaluator write
    _fire(auth, LEAVER, late_alert, "late-1")
    def_id = svc.new_def_id()                                            # 3. a failed half's leftovers
    svc.save(LEAVER, def_id, _definition(def_id, 9, "left behind"))

    others_before = {k: v for k, v in _store_rows().items() if LEAVER not in json.dumps(v)}
    friend_fires_before = [r for r in _auth_rows(auth)["indicator_alert_fires"] if r[2] == FRIEND]

    with sqlite3.connect(str(auth)) as c:
        out = ts.sweep(auth_conn=c)
    assert out["ok"] is True, out["errors"]
    assert out["auth_db"]["indicator_alert_fires"] == 1 and out["auth_db"]["indicator_alerts"] == 1
    assert out["stores"]["user_definitions"]["authors_scrubbed"] >= 1

    rows = _auth_rows(auth)
    assert not [r for r in rows["indicator_alert_fires"] if r[2] == LEAVER], "the late fire survived"
    assert [r for r in rows["indicator_alert_fires"] if r[2] == FRIEND] == friend_fires_before
    assert svc.list_for_user(LEAVER) == []
    newest = svc.get(FRIEND, copy_id)
    assert newest["definition"]["meta"]["name"] == "edited in a tab left open"
    assert newest["definition"]["origin"]["author_id"] is None, "the re-saved author id survived"
    with sqlite3.connect(svc._DB_PATH) as c:
        assert c.execute("SELECT COUNT(*) FROM user_definitions WHERE instr(definition, ?) > 0",
                         (LEAVER,)).fetchone()[0] == 0
    # Nobody else moved: every row that never named the leaver is byte-identical.
    after = _store_rows()
    assert {k: after.get(k) for k in others_before} == others_before


def test_the_sweep_is_idempotent(env):
    auth = env["auth"]
    leaver = _seed(LEAVER, "Leaver")
    svc.install_share(FRIEND, leaver["token"])
    with sqlite3.connect(str(auth)) as c:
        at.record_tombstone(LEAVER, c)
        first = ts.sweep(auth_conn=c)
    assert first["ok"] is True and first["stores"]["user_definitions"]["rows_deleted"] > 0
    store_once, auth_once = _store_rows(), _auth_rows(auth)
    with sqlite3.connect(str(auth)) as c:
        second = ts.sweep(auth_conn=c)
    assert second["ok"] is True
    assert second["stores"]["user_definitions"]["rows_deleted"] == 0
    assert second["stores"]["user_definitions"]["authors_scrubbed"] == 0
    assert sum(second["auth_db"].values()) == 0
    assert _store_rows() == store_once and _auth_rows(auth) == auth_once


def test_the_sweep_never_erases_an_account_that_still_exists(env):
    auth = env["auth"]
    _seed(CONTROL, "Control")
    with sqlite3.connect(str(auth)) as c:
        c.execute("INSERT INTO users (id) VALUES (?)", (CONTROL,))
        at.record_tombstone(CONTROL, c)                  # e.g. a deletion refused after its tombstone
        before = _store_rows()
        out = ts.sweep(auth_conn=c)
    assert out["skipped_still_members"] == [CONTROL]
    assert _store_rows() == before


def test_the_sweep_registers_one_job_and_its_kill_switch_works(monkeypatch):
    class Sched:
        def __init__(self):
            self.jobs = []

        def add_job(self, fn, trigger, **kw):
            self.jobs.append(kw)

    monkeypatch.setenv(ts.ENABLED_ENV, "0")
    off = Sched()
    assert ts.register_jobs(off) is False and off.jobs == []
    monkeypatch.delenv(ts.ENABLED_ENV)
    on = Sched()
    assert ts.register_jobs(on) is True
    assert [j["id"] for j in on.jobs] == ["account_tombstone_sweep"] and on.jobs[0]["max_instances"] == 1


# ═══ the replay's checkpoint ════════════════════════════════════════════════

def test_the_replay_checkpoints_so_the_MAIN_FILE_alone_carries_the_deletes(env):
    from tools import store_restore as sr
    _seed(LEAVER, "Leaver")
    _seed(CONTROL, "Control")
    copy = env["tmp"] / "restoring.db"
    src = sqlite3.connect(svc._DB_PATH)
    dst = sqlite3.connect(str(copy))
    src.backup(dst)
    src.close()
    dst.close()
    with sqlite3.connect(str(copy)) as c:
        assert c.execute("PRAGMA journal_mode=WAL").fetchone()[0] == "wal"
    # An idle second connection: closing the replay's connection is then NOT the last close, so
    # SQLite's own close-time checkpoint does not run -- only the explicit one can move the pages.
    bystander = sqlite3.connect(str(copy))
    bystander.execute("SELECT 1").fetchone()
    try:
        sr.replay_preparer("user_definitions", {LEAVER: ""})(copy)
        wal = Path(f"{copy}-wal")
        assert not wal.exists() or wal.stat().st_size == 0, "the replay left -wal content behind"
        main_only = env["tmp"] / "main_only.db"
        shutil.copyfile(copy, main_only)                  # the bytes os.replace would move
    finally:
        bystander.close()
    with sqlite3.connect(str(main_only)) as c:
        assert c.execute("SELECT COUNT(*) FROM user_definitions WHERE user_id = ?", (LEAVER,)).fetchone()[0] == 0
        assert c.execute("SELECT COUNT(*) FROM user_definitions WHERE user_id = ?", (CONTROL,)).fetchone()[0] == 1


# ═══ the disaster overrides ═════════════════════════════════════════════════

def _backup_then_delete(env):
    """A snapshot that still holds LEAVER, then the live deletion (tombstone off-site)."""
    from api.services import store_backup as sb
    from tools import store_restore as sr
    auth = env["auth"]
    leaver = _seed(LEAVER, "Leaver")
    _seed(CONTROL, "Control")
    copy_id = svc.install_share(FRIEND, leaver["token"])["def_id"]
    work = env["tmp"] / "work"
    work.mkdir()
    art = sb.build_artifacts("user_definitions", svc._DB_PATH, str(work), sr.dt.datetime.now(sr.dt.timezone.utc))
    rep = _delete_account(auth, LEAVER)
    assert rep["ok"] is True and rep["tombstone"]["offsite"] is True, rep
    return art, copy_id


def _restore_over_live(art, *extra) -> tuple[int, str]:
    import contextlib
    import io
    from tools import store_restore as sr
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        code = sr.main(["--restore", art["gz"], "--manifest", art["manifest_path"],
                        "--to", svc._DB_PATH, "--replace", *extra])
    return code, buf.getvalue()


def _leaver_rows() -> int:
    # closing(), not `with connect()`: the latter only commits, and on Windows an open handle
    # blocks the restore's move-aside of the live file.
    import contextlib
    with contextlib.closing(sqlite3.connect(svc._DB_PATH)) as c:
        return c.execute("SELECT COUNT(*) FROM user_definitions WHERE user_id = ?", (LEAVER,)).fetchone()[0]


def test_a_local_tombstone_file_restores_without_the_offsite_store_and_leaves_a_marker(env, monkeypatch):
    art, copy_id = _backup_then_delete(env)
    monkeypatch.setattr(at, "default_store", lambda: None)            # the bucket is unreachable
    listing = env["tmp"] / "tombstones.json"
    listing.write_text(json.dumps([LEAVER]), encoding="utf-8")
    code, out = _restore_over_live(art, "--tombstones-file", str(listing))
    assert code == 0, out
    assert "OFF-SITE TOMBSTONES NOT READ" in out
    assert _leaver_rows() == 0
    assert svc.get(FRIEND, copy_id)["definition"]["origin"]["author_id"] is None
    marker = Path(svc._DB_PATH + ude.PENDING_MARKER_SUFFIX)
    body = json.loads(marker.read_text(encoding="utf-8"))
    assert body["replayed_ids"] == [LEAVER]
    assert set(body["unverified_user_ids"]) == {CONTROL, FRIEND}


def test_allow_unreplayed_restores_reports_the_unverified_ids_and_the_sweep_later_purges_them(env, monkeypatch):
    art, copy_id = _backup_then_delete(env)
    real_default_store = at.default_store
    monkeypatch.setattr(at, "default_store", lambda: None)
    code, out = _restore_over_live(art)                                # no source, no flag
    assert code != 0 and "NOT RESTORED" in out and _leaver_rows() == 0
    code, out = _restore_over_live(art, "--allow-unreplayed")
    assert code == 0, out
    assert _leaver_rows() == 1, "non-vacuity: an unreplayed restore brings the member back"
    assert "UNVERIFIED" in out and LEAVER in out
    marker = Path(svc._DB_PATH + ude.PENDING_MARKER_SUFFIX)
    assert LEAVER in json.loads(marker.read_text(encoding="utf-8"))["unverified_user_ids"]

    # The live auth.db does not know this deletion (say auth.db was restored from older bytes
    # too): only the marker makes the sweep consult the off-site list.
    fresh_auth = sqlite3.connect(":memory:")
    try:
        out1 = ts.sweep(auth_conn=fresh_auth)                       # off-site still unreachable
        assert out1["markers"]["user_definitions"]["pending"] is True
        assert _leaver_rows() == 1 and marker.exists()
        monkeypatch.setattr(at, "default_store", real_default_store)  # the bucket is back
        out2 = ts.sweep(auth_conn=fresh_auth)
    finally:
        fresh_auth.close()
    assert out2["ok"] is True, out2["errors"]
    assert _leaver_rows() == 0
    assert svc.get(FRIEND, copy_id)["definition"]["origin"]["author_id"] is None
    assert not marker.exists()
    assert list(Path(svc._DB_PATH).parent.glob("*.tombstone-replay-pending.retired-*.json"))


# ═══ B1: the sweep parses only the rows that name a deleted author ══════════

class _CountingJson:
    """Stands in for `json` inside user_definitions_erasure: counts every parse."""

    def __init__(self, real):
        self.real, self.loads_calls = real, 0

    def loads(self, s, *a, **k):
        self.loads_calls += 1
        return self.real.loads(s, *a, **k)

    def __getattr__(self, name):
        return getattr(self.real, name)


class _RecordingLock:
    """Wraps the store's write lock: how often it was taken, and how many parses ran under it."""

    def __init__(self, real, counter):
        self.real, self.counter, self.taken, self.parses_held, self._at = real, counter, 0, 0, 0

    def __enter__(self):
        self.real.__enter__()
        self.taken += 1
        self._at = self.counter.loads_calls
        return self

    def __exit__(self, *exc):
        self.parses_held += self.counter.loads_calls - self._at
        return self.real.__exit__(*exc)


@pytest.mark.parametrize("json1", [True, False], ids=["json1", "instr-fallback"])
def test_the_live_sweep_never_fetches_or_parses_a_row_that_does_not_name_a_deleted_author(
        env, monkeypatch, json1):
    monkeypatch.setattr(ude, "_has_json1", lambda conn: json1)
    auth = env["auth"]
    leaver = _seed(LEAVER, "Leaver")
    control = _seed(CONTROL, "Control")
    mine = svc.install_share(FRIEND, leaver["token"])["def_id"]
    for _ in range(12):                                   # copies of ANOTHER author: never parsed
        svc.install_share(FRIEND, control["token"])
    with sqlite3.connect(svc._DB_PATH) as c:              # a malformed row must not sink the query
        c.execute("INSERT INTO user_definitions (user_id, def_id, version, rev, ast_hash, definition,"
                  " repaint, created_at) VALUES (?, 'u_000000000bad', 1, 1, 'x', ?, '{}', 0)",
                  (FRIEND, '{"origin": {"author_id": "' + LEAVER + '"'))
    with sqlite3.connect(str(auth)) as c:
        at.record_tombstone(LEAVER, c)
    counter = _CountingJson(ude.json)
    monkeypatch.setattr(ude, "json", counter)
    lock = _RecordingLock(svc._WRITE_LOCK, counter)
    monkeypatch.setattr(svc, "_WRITE_LOCK", lock)
    checks = []
    real_remaining = ude.authors_remaining
    monkeypatch.setattr(ude, "authors_remaining", lambda *a, **k: checks.append(1) or real_remaining(*a, **k))

    with sqlite3.connect(str(auth)) as c:
        out = ts.sweep(auth_conn=c)

    assert out["ok"] is True, out["errors"]
    assert out["stores"]["user_definitions"]["authors_scrubbed"] == 1
    assert svc.get(FRIEND, mine)["definition"]["origin"]["author_id"] is None
    # One matching copy -> at most two parses (the fallback also fetches the malformed row,
    # which names the id but cannot be parsed). Never the twelve other-author copies.
    assert counter.loads_calls == (1 if json1 else 2), f"parsed {counter.loads_calls} rows"
    assert lock.taken == 1 and lock.parses_held == counter.loads_calls
    assert checks == [], "the live sweep ran the restore's second author pass under the lock"


@pytest.mark.parametrize("json1", [True, False], ids=["json1", "instr-fallback"])
def test_a_NUMERIC_author_id_naming_a_deleted_member_is_selected_and_scrubbed(env, monkeypatch, json1):
    """Review fix: `origin.author_id` stored as a JSON NUMBER. `json_extract` returns an INTEGER,
    which never equals the TEXT id the selector binds, and the fallback's `"<id>"` needle cannot
    see an unquoted number -- so the copy was never selected and kept naming the deleted member.
    A second copy whose numeric author merely STARTS with the same digits is a control: the
    selector may fetch it (a superset), the exact check must leave it alone."""
    monkeypatch.setattr(ude, "_has_json1", lambda conn: json1)
    leaver, near = "424242", 4242420
    with sqlite3.connect(svc._DB_PATH) as c:
        for def_id, author in (("u_00000000num1", int(leaver)), ("u_00000000num2", near)):
            doc = {"id": def_id, "meta": {"name": "Copy"}, "origin": {"author_id": author}}
            c.execute("INSERT INTO user_definitions (user_id, def_id, version, rev, ast_hash, definition,"
                      " repaint, created_at) VALUES (?, ?, 1, 1, 'x', ?, '{}', 0)",
                      (FRIEND, def_id, ude._canonical(doc)))
        # Non-vacuity: the row really stores a NUMBER, the shape this rail is about.
        stored = c.execute("SELECT definition FROM user_definitions WHERE def_id = 'u_00000000num1'").fetchone()[0]
        assert '"author_id":424242' in stored
        assert [r[0] for r in ude.authored_rows([leaver], c)], "the selector missed a numeric author"
    with sqlite3.connect(str(env["auth"])) as c:
        at.record_tombstone(leaver, c)
    with sqlite3.connect(str(env["auth"])) as c:
        out = ts.sweep(auth_conn=c)
    assert out["ok"] is True, out["errors"]
    assert out["stores"]["user_definitions"]["authors_scrubbed"] == 1
    with sqlite3.connect(svc._DB_PATH) as c:
        authors = {d: json.loads(b)["origin"]["author_id"] for d, b in c.execute(
            "SELECT def_id, definition FROM user_definitions WHERE def_id LIKE 'u_00000000num%'")}
    assert authors == {"u_00000000num1": None, "u_00000000num2": near}, authors


def test_the_RESTORE_still_refuses_when_a_copy_still_names_a_deleted_author(env, monkeypatch):
    from tools import store_restore as sr
    leaver = _seed(LEAVER, "Leaver")
    svc.install_share(FRIEND, leaver["token"])
    snap = env["tmp"] / "snap.db"
    src, dst = sqlite3.connect(svc._DB_PATH), sqlite3.connect(str(snap))
    src.backup(dst)
    src.close()
    dst.close()
    monkeypatch.setattr(ude, "scrub_authors", lambda ids, conn: 0)       # a scrub that did nothing
    with pytest.raises(sr.RestoreRefused) as exc:
        sr.replay_preparer("user_definitions", {LEAVER: ""})(snap)
    assert "authors_remaining=['" + LEAVER in str(exc.value)


def test_a_pending_marker_that_cannot_be_written_refuses_the_restore_and_the_store_is_untouched(env, monkeypatch):
    from tools import store_restore as sr
    art, _ = _backup_then_delete(env)
    monkeypatch.setattr(at, "default_store", lambda: None)

    def boom(*a, **k):
        raise OSError("disk full")
    monkeypatch.setattr(sr, "write_pending_marker", boom)
    live = Path(svc._DB_PATH)
    before = live.read_bytes()
    code, out = _restore_over_live(art, "--allow-unreplayed")
    assert code != 0 and "NOT RESTORED" in out, out
    assert live.read_bytes() == before, "the store was replaced although nothing is pending"
    assert not list(live.parent.glob("*.pre-restore-*")), "the live store was moved aside"
