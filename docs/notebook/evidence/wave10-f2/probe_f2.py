"""Wave 10 follow-up F2: the probe for review minors N-1 and N-4 (wave10-10A-R1-rereview.md).

Scratch databases in a temp directory only. Nothing under C:\\data, no sandbox, no pod.
Run from the repo root:  python docs/notebook/evidence/wave10-f2/probe_f2.py
The SAME file is run before the fix (probe-before.txt) and after it (probe-after.txt).

N-1  A recorded derived structure (the FTS map's note_rowid, the tag index) on a database
     whose notes a logical restore RENUMBERED, booted while another connection holds the
     write lock, so the boot's first write -- withdrawing the record -- raises "database is
     locked". The re-review's P5, for both structures, in both journal modes. PASS = the
     reads answer what they answered before the renumbering (never [] or other notes).
     N1-retry: the lock is released 0.6 s into the boot (connection timeout 0.2 s). PASS =
     the same, and the record ends withdrawn-and-rebuilt or trusted-by-this-boot.
N-4  A database whose trigger bodies differ from the code's, holding the record a previous
     release wrote, is booted; then a write the old trigger ignores. PASS = the boot
     installed the code's trigger body, and the read after the write is right.
"""
import json
import os
import pathlib
import sqlite3
import sys
import tempfile
import threading
import time

sys.path.insert(0, os.getcwd())
import conftest  # noqa: F401,E402  pins every /data path before api.* imports

TMP = pathlib.Path(tempfile.mkdtemp(prefix="w10f2_probe_"))
DATA = TMP / "data"
DATA.mkdir()
for flag in (".notebook_migration_v4", ".notebook_migration_v5"):
    (DATA / flag).write_bytes(b"1")
os.environ["DATA_DIR"] = str(DATA)

from api.services.journal_two import db as j2db  # noqa: E402
from api.services.journal_two import note_tasks  # noqa: E402
from api.services.journal_two import notes as notes_svc  # noqa: E402
from datetime import datetime  # noqa: E402

U = "u1"
NOW = datetime(2026, 9, 25, 12, tzinfo=note_tasks.ET)
RESULTS = []


def verdict(name, ok, detail):
    RESULTS.append((name, ok))
    print(f"  {'PASS' if ok else 'FAIL'}  {name}: {detail}")


def insert(c, nid, text, tags="[]", user=U, body_json=None):
    body = body_json or json.dumps({"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": text}]}]})
    c.execute("INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags,"
              " created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
              (nid, user, nid, body, text, tags, "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z"))


def search_answers(c):
    notes_svc.register_note_sql_functions(c)
    listed = sorted(n["id"] for n in notes_svc.list_notes(U, q="breakout", conn=c))
    ranked = sorted(n["id"] for n in notes_svc.list_notes(U, q="breakout", sort="relevance", conn=c))
    rows, total = notes_svc.list_and_count_notes(U, q="breakout", conn=c)
    return listed, ranked, (sorted(n["id"] for n in rows), total)


def tag_answers(c):
    notes_svc.register_note_sql_functions(c)
    rows, total = notes_svc.list_and_count_notes(U, tag="setups", conn=c)
    listed = sorted(n["id"] for n in notes_svc.list_notes(U, tag="setups", conn=c))
    return listed, (sorted(n["id"] for n in rows), total)


def records(c):
    return sorted(r[0] for r in c.execute("SELECT name FROM j2_schema_builds"))


def connect(path, timeout=5.0):
    c = sqlite3.connect(str(path), timeout=timeout)
    c.row_factory = sqlite3.Row
    return c


def drifted_db(name, mode):
    """A healthy recorded database, then its j2_notes renumbered as a logical restore does."""
    p = TMP / name
    c = connect(p)
    if mode == "wal":
        c.execute("PRAGMA journal_mode=WAL")
    j2db.ensure_schema(c)
    for i in range(12):
        insert(c, f"id{i:03d}", "breakout over the pivot" if i % 3 == 0 else "range day",
               tags=json.dumps(["Setups"] if i % 4 == 0 else ["research/semis"]))
    c.commit()
    want = (search_answers(c), tag_answers(c))
    recs = records(c)
    c.execute("UPDATE j2_notes SET rowid = 100000 - rowid")     # reversed, no collision
    c.commit()
    c.close()
    return p, want, recs


def boot_step(fn, c):
    """What ensure_schema does around each wave-10 step: run it, and on an exception
    roll back and print one line."""
    try:
        return fn(c)
    except Exception as e:  # noqa: BLE001
        try:
            c.rollback()
        except Exception:  # noqa: BLE001
            pass
        return f"raised {type(e).__name__}: {e}"


print(f"python {sys.version.split()[0]}  sqlite {sqlite3.sqlite_version}  tmp {TMP}")
print(f"_FTS_MAP_BUILD={j2db._FTS_MAP_BUILD!r}  tag={j2db._NOTE_TAG_INDEX_BUILD!r}"
      f"  task={j2db._TASK_DIGEST_BUILD!r}")

# ── N-1 ─────────────────────────────────────────────────────────────────────────
for mode in ("delete", "wal"):
    print(f"\n== N-1 journal_mode={mode}: renumbered + recorded; the boot cannot take the write lock ==")
    p, want, recs = drifted_db(f"n1_{mode}.db", mode)
    print(f"  records before the renumbering: {recs}")
    probe = connect(p)
    drifted = (search_answers(probe), tag_answers(probe))
    probe.close()
    print(f"  non-vacuity: the drift misleads the recorded reads: search {drifted[0] != want[0]},"
          f" tag {drifted[1] != want[1]}")
    holder = sqlite3.connect(str(p), isolation_level=None, timeout=0.2)
    holder.execute("BEGIN IMMEDIATE")
    c = connect(p, timeout=0.2)
    t0 = time.time()
    fts_out = boot_step(j2db._upgrade_fts_map_note_rowid, c)
    tag_out = boot_step(j2db._ensure_note_tag_index, c)
    took = time.time() - t0
    holder.execute("ROLLBACK")
    holder.close()
    print(f"  fts step: {fts_out}")
    print(f"  tag step: {tag_out}")
    print(f"  boot took {took:.2f}s; records now: {records(c)}")
    got = (search_answers(c), tag_answers(c))
    print(f"  fts ready={notes_svc._fts_map_ready(c)}  tag ready={notes_svc._tag_index_ready(c)}")
    print(f"  search want {want[0]}\n         got  {got[0]}")
    print(f"  tag    want {want[1]}\n         got  {got[1]}")
    verdict(f"N1-{mode}-search", got[0] == want[0], "search answers the pre-renumbering notes")
    verdict(f"N1-{mode}-tag", got[1] == want[1], "tag reads answer the pre-renumbering notes")
    c.close()

print("\n== N1-retry: the lock is released 0.6 s into the boot (connection timeout 0.2 s) ==")
p, want, recs = drifted_db("n1_retry.db", "wal")
holder = sqlite3.connect(str(p), isolation_level=None, timeout=0.2, check_same_thread=False)
holder.execute("BEGIN IMMEDIATE")
timer = threading.Timer(0.6, lambda: holder.execute("ROLLBACK"))
timer.start()
c = connect(p, timeout=0.2)
fts_out = boot_step(j2db._upgrade_fts_map_note_rowid, c)
tag_out = boot_step(j2db._ensure_note_tag_index, c)
timer.join()
holder.close()
print(f"  fts step: {fts_out}")
print(f"  tag step: {tag_out}")
print(f"  records now: {records(c)}  fts ready={notes_svc._fts_map_ready(c)}"
      f"  tag ready={notes_svc._tag_index_ready(c)}")
got = (search_answers(c), tag_answers(c))
verdict("N1-retry-search", got[0] == want[0], f"got {got[0][0]}")
verdict("N1-retry-tag", got[1] == want[1], f"got {got[1][0]}")
c.close()

# ── N-4 ─────────────────────────────────────────────────────────────────────────
PROD_FTS_RECORD = "j2_notes_fts_map.note_rowid"      # the record every database holds today


def trigger_sql(c, name):
    r = c.execute("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?", (name,)).fetchone()
    return " ".join((r[0] if r else "").split())


def code_trigger(script, name):
    for stmt in j2db._script_statements(script):
        if stmt.split()[2] == name or (stmt.split()[2:5] == ["IF", "NOT", "EXISTS"] and stmt.split()[5] == name):
            return " ".join(stmt.replace("IF NOT EXISTS ", "").rstrip(";").split())
    return None


def task_digest_code_trigger(name):
    import re
    m = re.search(r"CREATE TRIGGER IF NOT EXISTS " + name + r"\b.*?END;", j2db._J2_SCHEMA, re.S)
    return " ".join(m.group(0).replace("IF NOT EXISTS ", "").rstrip(";").split()) if m else None


print("\n== CONTROL (probe honesty): on a fresh database the comparison below says 'equal' ==")
c = connect(TMP / "control.db")
j2db.ensure_schema(c)
fts_eq = trigger_sql(c, "j2_notes_fts_au") == code_trigger(j2db._J2_NOTES_FTS_TRIGGERS_DDL, "j2_notes_fts_au")
task_eq = trigger_sql(c, "j2_note_task_digest_au") == task_digest_code_trigger("j2_note_task_digest_au")
verdict("CONTROL-fts-compare", fts_eq, "a fresh database's fts au body equals the code's")
verdict("CONTROL-task-compare", task_eq, "a fresh database's task au body equals the code's")
c.close()

for label, record in (("today's bare record", PROD_FTS_RECORD), ("a version-0 record", PROD_FTS_RECORD + "@0")):
    print(f"\n== N-4 FTS triggers: an older au body (still names note_rowid), {label} ==")
    p = TMP / f"n4_fts_{'bare' if '@' not in record else 'v0'}.db"
    c = connect(p)
    j2db.ensure_schema(c)
    for i in range(6):
        insert(c, f"n{i}", "breakout over the pivot" if i % 2 else "a quiet range")
    c.commit()
    c.execute("DROP TRIGGER j2_notes_fts_au")
    c.execute("""CREATE TRIGGER j2_notes_fts_au
AFTER UPDATE OF title ON j2_notes BEGIN
    DELETE FROM j2_notes_fts
    WHERE rowid = (SELECT fts_rowid FROM j2_notes_fts_map WHERE note_id = old.id);
    INSERT INTO j2_notes_fts(note_id, user_id, title, body_plain)
    VALUES (new.id, new.user_id, new.title, new.body_plain);
    INSERT OR REPLACE INTO j2_notes_fts_map(note_id, fts_rowid, note_rowid)
    VALUES (new.id, last_insert_rowid(), new.rowid);
END""")
    c.execute("DELETE FROM j2_schema_builds WHERE name LIKE 'j2_notes_fts_map.note_rowid%'")
    c.execute("INSERT INTO j2_schema_builds (name, built_at) VALUES (?, 'then')", (record,))
    c.commit()
    j2db.ensure_schema(c)                                  # the boot
    want_body = code_trigger(j2db._J2_NOTES_FTS_TRIGGERS_DDL, "j2_notes_fts_au")
    have = trigger_sql(c, "j2_notes_fts_au")
    print(f"  records after boot: {[r for r in records(c) if r.startswith('j2_notes_fts_map')]}")
    print(f"  au body after boot == code's: {have == want_body}")
    c.execute("UPDATE j2_notes SET body_plain = 'breakout from a sync' WHERE id = 'n0'")
    c.commit()
    got = search_answers(c)[0]
    print(f"  search after a body_plain write to n0: {got}")
    verdict(f"N4-fts-{'bare' if '@' not in record else 'v0'}-trigger", have == want_body,
            "the boot installed the code's au body")
    verdict(f"N4-fts-{'bare' if '@' not in record else 'v0'}-answer", got == ["n0", "n1", "n3", "n5"],
            "the edited note is found")
    c.close()

print("\n== N-4 task-index invalidation triggers: an older au body, a version-0 record ==")
p = TMP / "n4_task.db"
c = connect(p)
j2db.ensure_schema(c)


def task_doc(*texts):
    return {"type": "doc", "content": [{"type": "taskList", "content": [
        {"type": "taskItem", "attrs": {"checked": False},
         "content": [{"type": "paragraph", "content": [{"type": "text", "text": t}]}]} for t in texts]}]}


nid = notes_svc.create_note(U, {"title": "t", "bodyJson": task_doc("old task")}, conn=c)["id"]
c.execute("DROP TRIGGER j2_note_task_digest_au")
c.execute("CREATE TRIGGER j2_note_task_digest_au AFTER UPDATE OF title ON j2_notes BEGIN"
          " DELETE FROM j2_note_task_digest WHERE note_id = old.id; END")
c.execute("DELETE FROM j2_schema_builds WHERE name LIKE 'j2_note_task_digest%'")
c.execute("INSERT INTO j2_schema_builds (name, built_at) VALUES ('j2_note_task_digest@0', 'then')")
c.commit()
j2db.ensure_schema(c)                                      # the boot: a version mismatch
have = trigger_sql(c, "j2_note_task_digest_au")
want_body = task_digest_code_trigger("j2_note_task_digest_au")
print(f"  records after boot: {[r for r in records(c) if r.startswith('j2_note_task_digest')]}")
print(f"  au body after boot == code's: {have == want_body}")
# a non-door body write (the connector engine's media rewrite, a migration): no refill
c.execute("UPDATE j2_notes SET body_json = ? WHERE id = ?", (json.dumps(task_doc("new task")), nid))
c.commit()
got = [t["text"] for t in note_tasks.list_tasks(U, status="all", now=NOW, conn=c)["tasks"]]
print(f"  tasks after a raw body write: {got}")
verdict("N4-task-trigger", have == want_body, "the boot installed the code's au body")
verdict("N4-task-answer", got == ["new task"], "the tasks view serves the body, not a stale row")
c.close()

print("\nSUMMARY: " + " ".join(f"{n}={'PASS' if ok else 'FAIL'}" for n, ok in RESULTS))
print(f"{sum(ok for _, ok in RESULTS)} PASS / {sum(not ok for _, ok in RESULTS)} FAIL")
