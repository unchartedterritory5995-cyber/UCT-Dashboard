"""Account deletion takes a member's rows in chart_iq_feedback.db, uct_agent.db and study.db with it.

The census (`tests/test_alert_erasure.py::test_THE_CENSUS_...`) went red on master 2026-11-17 naming
member-keyed tables an account deletion neither purged nor named; `member_store_erasure.purge_user`
now reaches the three databases no statement on the purge's auth.db connection reaches, and
`j2_note_tweet_captures` (auth.db) is deleted by the member's id, not only through its trigger.

⭐ OWNER RULING 2026-11-17 (delegated to and taken by the coordinator): deleting an account ERASES the
member's UCT Agent conversation history (conversations, turns, and any member-keyed telemetry or state
in uct_agent.db) and the rest of their Study data (every member-keyed table in study.db). Rows that
carry no member identifier may stay, and a rail must prove they carry none. This file is that rail.

What this file makes impossible:
  1. A deleted member's row surviving in any member table of the three stores, or the OTHER member's
     rows going: both members seeded in every member table through each store's OWN write API (the
     Agent's conversations, turns, state, telemetry, request ledger, spend ledger, rate window and
     in-flight lease; Study's profile, attempts, sessions, game runs, badges, checkpoints, reminders,
     feedback, review marks and a frozen weekly leaderboard), then the account deleted the way the
     admin door does it (`purge_user_data`, then `_cascade_delete_user`). Afterwards the deleted
     member's id and display name appear in NO cell of either file, every row the other member owns is
     still there, a conversation's turns went with it whatever `user_id` they carried, and the shared
     limits (the day's dollars, the request window, the in-flight count) read exactly what they read
     before.
  2. A table in uct_agent.db or study.db that nobody classified: THE STORE CENSUS reads every CREATE
     TABLE in the modules that open each store (an AST read of the imports and the store's own
     connection, never a roster) and fails by name on a table that is neither erased nor named in
     `KEPT` with its reason, or on a member column that is neither the delete key nor cleared.
  3. A purge that CREATES a store file a pod never had.
  4. One broken store aborting the others.
"""
from __future__ import annotations

import ast
import functools
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import pytest

from tests.test_alert_erasure import _CREATE, _MEMBER_COLUMNS, _body, _columns, _sql_strings

REPO = Path(__file__).resolve().parents[1]
GONE, STAYS = "member-gone-0001", "member-stays-0002"
#: Writes one turn into GONE's conversation: `store.add_turn` does not check who owns a conversation
#: (the routes do), so the store can hold a turn row keyed by someone else in the member's chat.
WRITER = "member-other-writer-0003"
GONE_NAME, STAYS_NAME = "Gone Trader", "Stays Trader"
TS = "2026-11-17T12:00:00+00:00"
NOW = datetime(2026, 11, 17, 17, 0, tzinfo=timezone.utc)

#: The module that owns each store's file; the census finds every OTHER module that opens it.
STORE_MODULES = {"uct_agent": "api.services.uct_agent.store", "study": "api.services.study_store"}
#: A reviewer's id, in the spellings these two stores use beside the census's member columns.
_REVIEWER_COLUMNS = {"by_user", "reviewed_by", "handled_by"}
_MEMBER_SPELLINGS = _MEMBER_COLUMNS | _REVIEWER_COLUMNS

#: ⛔ Every table in either store that an account deletion does NOT delete rows from, with WHY. A new
#: table lands in the erasure or here BY NAME, never by default; a member column on any of them must
#: be cleared (`member_store_erasure.ANONYMISED`).
KEPT = {
    "uct_agent": {
        "agent_spend": "the Agent's dollar ledger: every row of the ET day counts toward the daily cap, "
                       "so the row stays and its user_id is cleared",
        "agent_rate_events": "the global 60-second request window counts every row: user_id cleared "
                             "('' -- NOT NULL); pruned within the hour",
        "agent_inflight": "the global in-flight limit counts every live lease: user_id cleared; the lease "
                          "expires on its own",
        "agent_replicas": "web replicas seen per deployment; no member column",
    },
    "study": {
        "study_items": "the shared drill bank; reviewed_by (the admin who reviewed) is cleared",
        "study_corrections": "the bank's edit history; by_user (the admin) is cleared",
        "study_bars": "chart bars for the bank; no member column",
        "study_intraday": "intraday replay bars for the bank; no member column",
        "study_terms": "the glossary; no member column",
        "study_trust": "approval counts per item TYPE; no member column",
        "study_weekly_close": "frozen weekly leaderboards: display names and XP, no member id; the member's "
                              "own entries are renamed (`member_store_erasure._scrub_frozen_boards`)",
    },
}


# ── the store census ────────────────────────────────────────────────────────────────────────

def _dotted(path: Path, root: Path) -> str:
    rel = path.relative_to(root.parent).with_suffix("")
    parts = list(rel.parts)
    if parts[-1] == "__init__":
        parts.pop()
    return ".".join(parts)


def _opens(path: Path, root: Path, target: str, tree: ast.AST) -> bool:
    """Is `path` the store module `target`, or does it bind that module by an import (absolute or
    relative) and touch its connection, write door, path or write lock?"""
    me = _dotted(path, root)
    if me == target:
        return True
    package = me if path.name == "__init__.py" else me.rpartition(".")[0]
    aliases = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            base = node.module or ""
            if node.level:
                up = package.split(".")
                up = up[:len(up) - (node.level - 1)] if node.level > 1 else up
                base = ".".join(up + ([node.module] if node.module else []))
            for a in node.names:
                if f"{base}.{a.name}" == target:
                    aliases.add(a.asname or a.name)
        elif isinstance(node, ast.Import):
            for a in node.names:
                if a.name == target and a.asname:
                    aliases.add(a.asname)
    return any(isinstance(n, ast.Attribute) and isinstance(n.value, ast.Name) and n.value.id in aliases
               and n.attr in ("_connect", "_write", "_DB_PATH", "_WRITE_LOCK") for n in ast.walk(tree))


def store_census(root: Path = REPO / "api") -> dict[str, dict[str, dict]]:
    """{store: {table: {"files", "columns"}}} for every CREATE TABLE in a module that opens the store."""
    out: dict[str, dict[str, dict]] = {name: {} for name in STORE_MODULES}
    for path in sorted(root.rglob("*.py")):
        if path.name.startswith("test_") or path.name.endswith("_test.py") or "tests" in path.parts:
            continue
        text = path.read_text(encoding="utf-8").upper()
        if "CREATE" not in text or "TABLE" not in text:      # no CREATE TABLE can hide from both words
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for name, target in STORE_MODULES.items():
            if not _opens(path, root, target, tree):
                continue
            for s in _sql_strings(path):
                for m in _CREATE.finditer(s):
                    entry = out[name].setdefault(m.group(1), {"files": set(), "columns": set()})
                    entry["files"].add(path.relative_to(root.parent).as_posix())
                    entry["columns"] |= _columns(_body(s, m.end() - 1))
    return out


@functools.lru_cache(maxsize=1)
def _repo_census() -> dict[str, dict[str, dict]]:
    """The repo's store census, read once per session (one walk of `api/`); never mutated."""
    return store_census()


def unclassified(name: str, tables: dict[str, dict], kept: dict[str, str]) -> list[str]:
    """Each table of one store that is neither erased nor kept by name, and each member column that is
    neither the delete key nor cleared."""
    from api.services import member_store_erasure as mse
    store = mse.BY_NAME[name]
    erased = set(store.tables) | {t for t, _fk, _p in store.joins}
    cleared = set(mse.ANONYMISED.get(name, ()))
    out = []
    for table, info in sorted(tables.items()):
        where = ", ".join(sorted(info["files"]))
        if table not in erased and table not in kept:
            out.append(f"{table} ({where}): neither erased by member_store_erasure nor named in KEPT")
        if table in store.tables and "user_id" not in info["columns"]:
            out.append(f"{table} ({where}): erased by user_id but has no user_id column")
        covered = ({"user_id"} if table in store.tables else set()) | {c for t, c in cleared if t == table}
        loose = sorted((info["columns"] & _MEMBER_SPELLINGS) - covered)
        if loose:
            out.append(f"{table} ({where}): member column(s) {loose} neither deleted by nor cleared")
    return out


def test_the_store_census_reads_each_store_from_the_modules_that_open_it():
    found = _repo_census()
    modules = {name: {f for info in tables.values() for f in info["files"]} for name, tables in found.items()}
    # Non-vacuity, by name: the store's own module and the two that open it for their ledgers.
    assert {"api/services/uct_agent/store.py", "api/services/uct_agent/budget.py",
            "api/services/uct_agent/limits.py"} <= modules["uct_agent"], modules["uct_agent"]
    assert "api/services/study_store.py" in modules["study"], modules["study"]
    for table in ("agent_conversations", "agent_turns", "agent_spend", "agent_replicas"):
        assert table in found["uct_agent"], table
    for table in ("study_profile", "study_attempts", "study_trust", "study_weekly_close"):
        assert table in found["study"], table
    # Precision control: the Agent's knowledge index creates tables in ITS OWN file.
    assert "api/services/uct_agent/knowledge/index.py" not in modules["uct_agent"]
    assert "docs" not in found["uct_agent"] and "meta" not in found["uct_agent"]


def test_THE_STORE_CENSUS_every_table_in_uct_agent_db_and_study_db_is_erased_or_kept_by_name():
    found = _repo_census()
    problems = [f"{name}: {p}" for name in STORE_MODULES for p in unclassified(name, found[name], KEPT[name])]
    assert not problems, ("tables in uct_agent.db / study.db an account deletion does not account for: "
                          "add each to member_store_erasure (erase or clear) or to KEPT with the reason:\n  "
                          + "\n  ".join(problems))
    from api.services import member_store_erasure as mse
    for name in STORE_MODULES:
        store = mse.BY_NAME[name]
        stale = sorted(t for t in KEPT[name] if t not in found[name] or t in store.tables)
        assert not stale, f"KEPT[{name!r}] names tables no module creates, or that are erased: {stale}"
        erased = (*store.tables, *(t for t, _fk, _p in store.joins))
        gone = sorted(t for t in erased if t not in found[name])
        assert not gone, f"member_store_erasure erases {name} tables no module creates: {gone}"
        no_col = sorted(f"{t}.{c}" for t, c in mse.ANONYMISED.get(name, ())
                        if c not in found[name].get(t, {}).get("columns", set()))
        assert not no_col, f"member_store_erasure clears {name} columns the schema does not have: {no_col}"


def test_the_store_census_fails_by_name_on_a_new_member_table(tmp_path):
    """The census can fail: a module that opens the Agent store and creates a member table nobody
    classified is named; a module that creates one in ITS OWN file is not attributed to the store."""
    pkg = tmp_path / "api" / "services"
    pkg.mkdir(parents=True)
    (pkg / "fresh_agent_feature.py").write_text(
        "def remember(uid):\n"
        "    from api.services.uct_agent import store\n"
        "    c = store._connect()\n"
        '    c.execute("CREATE TABLE IF NOT EXISTS agent_fresh_notes ("  # a comment between fragments\n'
        '              " id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, note TEXT)")\n', encoding="utf-8")
    (pkg / "elsewhere.py").write_text(
        "import sqlite3\n"
        "def remember(uid):\n"
        '    sqlite3.connect("own.db").execute("CREATE TABLE IF NOT EXISTS own_notes (user_id TEXT)")\n',
        encoding="utf-8")
    found = store_census(tmp_path / "api")
    assert set(found["uct_agent"]) == {"agent_fresh_notes"} and found["study"] == {}, found
    assert unclassified("uct_agent", found["uct_agent"], KEPT["uct_agent"]) == [
        "agent_fresh_notes (api/services/fresh_agent_feature.py): neither erased by member_store_erasure "
        "nor named in KEPT",
        "agent_fresh_notes (api/services/fresh_agent_feature.py): member column(s) ['user_id'] neither "
        "deleted by nor cleared"]


# ── the stores at tmp paths, seeded through their own write APIs ──────────────────────────

@pytest.fixture
def member_stores(tmp_path, monkeypatch):
    """The three stores at tmp paths, pointed at through each module's OWN path authority."""
    from api.services import study_store
    from api.services.uct_agent import store as agent_store
    paths = {"chart_iq_feedback": tmp_path / "chart_iq_feedback.db",
             "uct_agent": tmp_path / "uct_agent.db",
             "study": tmp_path / "study.db"}
    monkeypatch.setenv("CHART_IQ_FEEDBACK_DB", str(paths["chart_iq_feedback"]))
    monkeypatch.setattr(agent_store, "_DB_PATH", str(paths["uct_agent"]))
    monkeypatch.setattr(agent_store, "_READY", False)
    monkeypatch.setattr(study_store, "_DB_PATH", str(paths["study"]))
    # One web replica, so the Agent's replica table holds a row too (it carries no member id).
    monkeypatch.setenv("RAILWAY_DEPLOYMENT_ID", "deploy-erasure-test")
    monkeypatch.setenv("RAILWAY_REPLICA_ID", "replica-1")
    from api.services import member_store_erasure as mse
    # Non-vacuity: the purge resolves exactly these files.
    assert {s.name: s.path() for s in mse.STORES} == {k: str(v) for k, v in paths.items()}
    return paths


def _seed(paths) -> dict:
    """Both members in every member table of the three stores, written by the product's own doors'
    functions. GONE is also an admin (reviews an item, handles STAYS's feedback); STAYS reviews one
    too. Every free text a member wrote names its writer, so a copy of it anywhere would be seen."""
    from api.services import study_store as ss
    from api.services.chart_iq import feedback
    from api.services.uct_agent import budget, limits
    from api.services.uct_agent import store as agent
    ss.init_db()
    day, week = ss.et_day_of(NOW), ss.week_of(ss.et_day_of(NOW))
    item = {"type": "recall", "skill_id": "sk.erasure", "prompt_json": {"subject": "gap"},
            "answer_json": {"answer": "a gap"}, "review_status": ss.STATUS_APPROVED}
    ss.upsert_items([{**item, "id": f"si_{c * 12}"} for c in "abc"])
    out: dict = {"conversations": {}, "feedback": {}}
    for uid, name in ((GONE, GONE_NAME), (STAYS, STAYS_NAME)):
        # chart_iq_feedback.db
        feedback.save(uid, "AAA", "2026-11-17", "useful", note=f"what {uid} thought")
        # uct_agent.db
        conv = agent.create_conversation(uid, f"screen for {uid}")
        out["conversations"][uid] = conv
        agent.add_turn(uid, conv, "member", f"show me {uid}'s screen")
        agent.add_turn(uid, conv, "agent", "Here it is.", {"kind": "reply"})
        assert agent.set_state(uid, conv, "lastScreen", {"spec": {"filters": []}, "ids": ["AAA"]})
        agent.record_telemetry(uid, conv, {"path": "model", "disposition": "ok", "actions": ["screen"]})
        request = budget.open_request(uid, conv, f"a message from {uid}")
        spent = budget.reserve(user_id=uid, request_id=request, category="turn", model="m", worst_usd=0.02,
                               site_reader=lambda: (0.0, 15.0))
        budget.settle(spent, actual_usd=0.01)
        assert limits.admit(uid, new_request=True)                # a live lease, left in flight
        # study.db
        ss.update_profile(uid, {"display_name": name, "reminder_on": True, "reminder_time": "08:00"})
        session = ss.create_session(uid, "daily", ["si_aaaaaaaaaaaa"], day_et=day, now=NOW)
        ss.record_attempt(uid, "si_aaaaaaaaaaaa", {"pick": f"{uid}'s answer"}, True, 1.0,
                          session_id=session["id"], now=NOW)
        ss.record_game_run(uid, "size", f"run-{uid}", 3, 5, now=NOW)
        ss.award_badge(uid, "first_steps")
        ss.record_checkpoint(uid, "m1", True, 0.9, ["sk.erasure"])
        assert ss.claim_reminder(uid, day)
        out["feedback"][uid] = ss.add_feedback("si_aaaaaaaaaaaa", uid, role="member", channel="site",
                                               kind="too_hard", text=f"{uid} found this hard")["feedback"]["id"]
    # GONE, as an admin: a fix on one item, and STAYS's feedback marked handled. STAYS approves another.
    ss.review("si_bbbbbbbbbbbb", "fix", GONE, field="lesson_text", after="a clearer lesson")
    ss.review("si_cccccccccccc", "approve", STAYS)
    assert ss.handle_feedback([out["feedback"][STAYS]], GONE, note="looked at it") == 1
    # The week closes with both members on the frozen board.
    assert ss.close_week(week, now=NOW) is not None
    # A turn written into GONE's chat under another id, and GONE's own late turn into a chat GONE had
    # already deleted (the reply lands after the delete): the two ways a turn is NOT reached through
    # the other key.
    agent.add_turn(WRITER, out["conversations"][GONE], "outcome", f"the result of {GONE}'s screen")
    late = agent.create_conversation(GONE, "a chat deleted mid-turn")
    assert agent.delete_conversation(GONE, late)
    agent.add_turn(GONE, late, "agent", f"a late reply to {GONE}")
    out["week"] = week
    return out


def _auth_db(tmp_path) -> sqlite3.Connection:
    """An auth.db with the real users DDL and the Journal schema; both members, each with one
    imported tweet card on a live document AND one whose document row is already gone."""
    from api.services import auth_db
    from api.services.journal_two.db import ensure_schema
    conn = sqlite3.connect(tmp_path / "auth.db")
    conn.row_factory = sqlite3.Row
    conn.executescript(auth_db._SCHEMA)
    ensure_schema(conn)
    for uid in (GONE, STAYS):
        conn.execute("INSERT INTO users (id, email, password_hash, display_name, role) "
                     "VALUES (?, ?, 'x', 'n', 'member')", (uid, f"{uid}@example.test"))
        conn.execute("INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags, created_at, updated_at)"
                     " VALUES (?,?,?,?,?,?,?,?)", (f"note-{uid}", uid, "t", '{"type":"doc"}', "b", "[]", TS, TS))
        conn.execute("INSERT INTO j2_note_documents (id, user_id, note_id, attachment_url, status, created_at)"
                     " VALUES (?,?,?,?,'ready',?)", (f"doc-{uid}", uid, f"note-{uid}", f"tweet:{uid}", TS))
        for doc in (f"doc-{uid}", f"doc-gone-{uid}"):
            conn.execute("INSERT INTO j2_note_tweet_captures (document_id, user_id, note_id, tweet_id, author_handle,"
                         " created_at) VALUES (?,?,?,?,?,?)", (doc, uid, f"note-{uid}", "1", "someone", TS))
    conn.commit()
    return conn


def _count(path, table, uid, col="user_id") -> int:
    k = sqlite3.connect(path)
    try:
        return k.execute(f'SELECT COUNT(*) FROM "{table}" WHERE "{col}" = ?', (uid,)).fetchone()[0]
    finally:
        k.close()


def _cells_naming(path, needles) -> dict[str, int]:
    """table -> rows with any cell containing any needle, over EVERY table in the file."""
    k = sqlite3.connect(path)
    try:
        out = {}
        for (t,) in k.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
                              ).fetchall():
            n = sum(1 for row in k.execute(f'SELECT * FROM "{t}"')
                    if any(v is not None and needle in str(v) for v in row for needle in needles))
            if n:
                out[t] = n
        return out
    finally:
        k.close()


def _member_columns(found) -> list[tuple[str, str, str]]:
    """(store, table, column) for every member column the store census reads."""
    return [(name, t, c) for name, tables in found.items() for t, info in sorted(tables.items())
            for c in sorted(info["columns"] & _MEMBER_SPELLINGS)]


def _shared_limits(path) -> dict:
    """What the Agent's shared limits read: the dollars, the request window, the in-flight leases."""
    k = sqlite3.connect(path)
    try:
        return {"spend": k.execute("SELECT COUNT(*), ROUND(SUM(CASE status WHEN 'reserved' THEN reserved_usd "
                                   "ELSE actual_usd END), 6) FROM agent_spend").fetchone(),
                "rate_events": k.execute("SELECT COUNT(*) FROM agent_rate_events").fetchone()[0],
                "inflight": k.execute("SELECT COUNT(*) FROM agent_inflight").fetchone()[0]}
    finally:
        k.close()


def _frozen_names(path, week) -> list[str]:
    k = sqlite3.connect(path)
    try:
        raw = k.execute("SELECT rows_json FROM study_weekly_close WHERE week_et = ?", (week,)).fetchone()[0]
    finally:
        k.close()
    return sorted(r["display_name"] for r in json.loads(raw))


# ── 1. the account deletion erases the member everywhere, and only them ───────────────────

def test_deleting_an_account_erases_the_member_from_every_store_and_keeps_the_other_member(
        member_stores, tmp_path, monkeypatch):
    from api.routers.auth import _cascade_delete_user
    from api.services import account_tombstones as at
    from api.services.journal_two import account_purge
    monkeypatch.setenv(at.LOCAL_STORE_ENV, str(tmp_path / "tombs"))
    seeded = _seed(member_stores)
    found = _repo_census()
    columns = _member_columns(found)
    db = {"uct_agent": member_stores["uct_agent"], "study": member_stores["study"]}
    auth_path = tmp_path / "auth.db"
    conn = _auth_db(tmp_path)

    # Non-vacuity, derived from the census: the seed reached EVERY member column of both stores for
    # the deleted member, and every owner column for the other one.
    unreached = [f"{n}.{t}.{c}" for n, t, c in columns if _count(db[n], t, GONE, c) < 1]
    assert not unreached, f"the seed does not reach these member columns (extend _seed): {unreached}"
    stays_owned = [(n, t, c) for n, t, c in columns if c == "user_id"]
    assert all(_count(db[n], t, STAYS, c) >= 1 for n, t, c in stays_owned), stays_owned
    assert GONE_NAME in _frozen_names(member_stores["study"], seeded["week"])
    stays_before = {(n, t, c): _count(db[n], t, STAYS, c) for n, t, c in columns}
    limits_before = _shared_limits(member_stores["uct_agent"])
    gone_turns_before = _count(member_stores["uct_agent"], "agent_turns", GONE)
    auth_before = (_count(member_stores["chart_iq_feedback"], "chart_iq_feedback", GONE),
                   _count(member_stores["chart_iq_feedback"], "chart_iq_feedback", STAYS),
                   _count(auth_path, "j2_note_tweet_captures", GONE), _count(auth_path, "j2_note_tweet_captures", STAYS))
    assert auth_before == (1, 1, 2, 2), auth_before

    try:
        report = account_purge.purge_user_data(GONE, conn)       # the admin door's order:
        _cascade_delete_user(conn, GONE)                          # the purge, then the account row
        assert conn.execute("SELECT COUNT(*) FROM users WHERE id = ?", (GONE,)).fetchone()[0] == 0
    finally:
        conn.close()
    assert report["errors"] == [], report["errors"]

    # The deleted member's id and display name are in NO cell of either file -- the kept tables included.
    for name, path in db.items():
        left = _cells_naming(path, (GONE, GONE_NAME))
        assert not left, f"{name}: rows still naming the deleted member, by table: {left}"
    # ...nor in chart_iq_feedback.db or the tweet cards.
    assert (_count(member_stores["chart_iq_feedback"], "chart_iq_feedback", GONE),
            _count(member_stores["chart_iq_feedback"], "chart_iq_feedback", STAYS),
            _count(auth_path, "j2_note_tweet_captures", GONE),
            _count(auth_path, "j2_note_tweet_captures", STAYS)) == (0, 1, 0, 2)
    # A conversation's turns went with it: the turn another id wrote into GONE's chat too.
    k = sqlite3.connect(member_stores["uct_agent"])
    try:
        in_gone_chat = k.execute("SELECT COUNT(*) FROM agent_turns WHERE conversation_id = ?",
                                 (seeded["conversations"][GONE],)).fetchone()[0]
        writer_rows = k.execute("SELECT COUNT(*) FROM agent_turns WHERE user_id = ?", (WRITER,)).fetchone()[0]
    finally:
        k.close()
    assert (in_gone_chat, writer_rows) == (0, 0), (in_gone_chat, writer_rows)

    # The other member: every row they own, every mark they made, still there.
    stays_after = {key: _count(db[key[0]], key[1], STAYS, key[2]) for key in stays_before}
    changed = {f"{n}.{t}.{c}": (stays_before[(n, t, c)], v) for (n, t, c), v in stays_after.items()
               if v != stays_before[(n, t, c)]}
    assert not changed, f"the other member's rows changed (before, after): {changed}"
    assert _frozen_names(member_stores["study"], seeded["week"]) == ["Member", STAYS_NAME]
    # No shared limit loosened: the day's dollars, the request window and the in-flight count are what
    # they were -- those rows stay, without the member's id.
    assert _shared_limits(member_stores["uct_agent"]) == limits_before

    # The report names what it did, store by store (a turn reached both ways is counted once per delete).
    ms = report["member_stores"]
    assert gone_turns_before == 3
    assert {t: ms["rows_deleted"][t] for t in ("agent_turns", "agent_conversations", "study_profile",
                                               "study_game_runs", "chart_iq_feedback")} == {
        "agent_turns": 4, "agent_conversations": 1, "study_profile": 1, "study_game_runs": 1,
        "chart_iq_feedback": 1}, ms["rows_deleted"]
    assert ms["rows_anonymised"] == {"agent_spend": 1, "agent_rate_events": 1, "agent_inflight": 1,
                                     "study_items": 1, "study_corrections": 1, "study_feedback": 1}, ms
    assert ms["stores"]["study.db"]["boards_renamed"] == 1
    assert report["rows_deleted"]["j2_note_tweet_captures"] == 1


# ── 2. a store this pod never created is never created by the purge ─────────────────────────

def test_a_store_that_does_not_exist_is_reported_absent_and_is_never_created(tmp_path, monkeypatch):
    from api.services import member_store_erasure as mse
    from api.services import study_store
    from api.services.uct_agent import store as agent_store
    nope = tmp_path / "never"
    monkeypatch.setenv("CHART_IQ_FEEDBACK_DB", str(nope / "chart_iq_feedback.db"))
    monkeypatch.setattr(agent_store, "_DB_PATH", str(nope / "uct_agent.db"))
    monkeypatch.setattr(agent_store, "_READY", False)
    monkeypatch.setattr(study_store, "_DB_PATH", str(nope / "study.db"))
    rep = mse.purge_user(GONE)
    assert rep["errors"] == [] and rep["ok"] is True, rep
    assert {db: r.get("absent") for db, r in rep["stores"].items()} == {
        "chart_iq_feedback.db": True, "uct_agent.db": True, "study.db": True}
    assert set(rep["rows_deleted"]) == {t for s in mse.STORES for t in (*s.tables, *(j[0] for j in s.joins))}
    assert {"agent_turns", "study_profile", "chart_iq_feedback"} <= set(rep["rows_deleted"])
    assert set(rep["rows_anonymised"]) == {"agent_spend", "agent_rate_events", "agent_inflight",
                                           "study_items", "study_corrections", "study_feedback"}
    assert not nope.exists()


# ── 3. one broken store never aborts the others ─────────────────────────────────────────────

def test_a_broken_store_is_reported_and_the_others_are_still_purged(member_stores):
    from api.services import member_store_erasure as mse
    _seed(member_stores)
    member_stores["chart_iq_feedback"].write_bytes(b"this is not a sqlite database" * 64)
    rep = mse.purge_user(GONE)
    assert rep["ok"] is False
    assert [e for e in rep["errors"] if e.startswith("chart_iq_feedback.db")], rep["errors"]
    assert _count(member_stores["uct_agent"], "agent_conversation_state", GONE) == 0
    assert _count(member_stores["uct_agent"], "agent_turns", GONE) == 0
    assert _count(member_stores["study"], "study_game_runs", GONE) == 0
    assert _count(member_stores["study"], "study_game_runs", STAYS) == 1
