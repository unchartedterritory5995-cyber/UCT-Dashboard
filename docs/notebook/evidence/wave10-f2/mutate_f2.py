"""F2 mutation harness (lane F2 only). Each mutation: exact-text replacement(s), asserted
unique; the scoped files run with a fresh bytecode prefix; restore from captured bytes;
sha checked against the capture AND against the committed blob (git cat-file)."""
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time

REPO = r"C:\Users\Patrick\uct-worktrees\notebook-w10s1"
DB = "api/services/journal_two/db.py"
DV = "tests/test_journal_two_derivation_versions.py"
FILES = ["tests/test_journal_two_build_record_withdrawal.py", DV,
         "tests/test_journal_two_fts_map_note_rowid.py", "tests/test_journal_two_task_digest.py",
         "tests/test_journal_two_tag_index.py"]

MUTATIONS = [
    # (id, what, file, [(old, new)], expect)   expect: "red" or "green"
    ("M1", "schema_built ignores the withholding", DB,
     [('    if _WITHHELD and (_db_key(conn), name.split("@", 1)[0]) in _WITHHELD:',
       '    if False:')], "red"),
    ("M2", "the FTS boot check does not withhold", DB,
     [('    _withhold(conn, _FTS_MAP_FAMILY)              # this process falls back until proved',
       '    pass')], "red"),
    ("M3", "the tag boot check does not withhold", DB,
     [('    _withhold(conn, _NOTE_TAG_INDEX_FAMILY)         # this process scans until proved',
       '    pass')], "red"),
    ("M4", "no retry: one attempt only", DB,
     [('    waits = (0.0, *_UNMARK_RETRY_WAITS_S)', '    waits = (0.0,)')], "red"),
    ("M5", "withholding keyed by connection, not by file", DB,
     [('            return os.path.normcase(os.path.abspath(row[2])) if row[2] else f"memory:{id(conn)}"',
       '            return f"memory:{id(conn)}"')], "red"),
    ("M6", "a proven FTS rebuild never restores trust", DB,
     [('    out["marked"] = True\n    _trust(conn, _FTS_MAP_FAMILY)\n',
       '    out["marked"] = True\n')], "red"),
    ("M7", "the FTS record carries no version", DB,
     [('_FTS_MAP_BUILD = f"{_FTS_MAP_FAMILY}@{FTS_MAP_VERSION}"', '_FTS_MAP_BUILD = _FTS_MAP_FAMILY')], "red"),
    ("M8", "the FTS rebuild keeps an existing trigger body (IF NOT EXISTS, no drop)", DB,
     [('        for name in ("j2_notes_fts_ai", "j2_notes_fts_ad", "j2_notes_fts_au"):\n'
       '            conn.execute(f"DROP TRIGGER IF EXISTS {name}")\n'
       '        for stmt in _script_statements(_J2_NOTES_FTS_TRIGGERS_DDL):\n'
       '            conn.execute(stmt)\n',
       '        for stmt in _script_statements(_J2_NOTES_FTS_TRIGGERS_DDL):\n'
       '            conn.execute(stmt.replace("CREATE TRIGGER ", "CREATE TRIGGER IF NOT EXISTS ", 1))\n')], "red"),
    ("M9", "the FTS swap goes through executescript (commits first: not atomic)", DB,
     [('        for name in ("j2_notes_fts_ai", "j2_notes_fts_ad", "j2_notes_fts_au"):\n'
       '            conn.execute(f"DROP TRIGGER IF EXISTS {name}")\n'
       '        for stmt in _script_statements(_J2_NOTES_FTS_TRIGGERS_DDL):\n'
       '            conn.execute(stmt)\n',
       '        conn.executescript("DROP TRIGGER IF EXISTS j2_notes_fts_ai; DROP TRIGGER IF EXISTS j2_notes_fts_ad;'
       ' DROP TRIGGER IF EXISTS j2_notes_fts_au;" + _J2_NOTES_FTS_TRIGGERS_DDL)\n'
       '        conn.execute("BEGIN IMMEDIATE")\n')], "red"),
    ("M10", "a task-index version mismatch keeps the old invalidation triggers", DB,
     [('            for name in _TASK_DIGEST_TRIGGERS:\n'
       '                conn.execute(f"DROP TRIGGER IF EXISTS {name}")\n'
       '            for stmt in _script_statements(_TASK_DIGEST_TRIGGERS_DDL):\n'
       '                conn.execute(stmt)\n', '')], "red"),
    ("M11", "the schema carries a second, drifted copy of the task triggers", DB,
     [('""" + _TASK_DIGEST_TRIGGERS_DDL + """',
       '""" + _TASK_DIGEST_TRIGGERS_DDL.replace("ON j2_notes BEGIN", "ON  j2_notes BEGIN") + """')], "red"),
    ("M12", "CODE edit: the task au trigger fires on title too, no bump", DB,
     [('CREATE TRIGGER IF NOT EXISTS j2_note_task_digest_au AFTER UPDATE OF body_json ON j2_notes BEGIN',
       'CREATE TRIGGER IF NOT EXISTS j2_note_task_digest_au AFTER UPDATE OF body_json, title ON j2_notes BEGIN')],
     "red"),
    ("M13", "CODE edit: an FTS trigger body gains a statement, no bump", DB,
     [('    VALUES (new.id, last_insert_rowid(), new.rowid);\nEND;\n"""\n',
       '    VALUES (new.id, last_insert_rowid(), new.rowid);\n    SELECT 1;\nEND;\n"""\n')], "red"),
    ("M14", "COMMENT edit: an SQL comment inside the FTS trigger DDL (must HOLD)", DB,
     [('_J2_NOTES_FTS_TRIGGERS_DDL = """\nCREATE TRIGGER j2_notes_fts_ai',
       '_J2_NOTES_FTS_TRIGGERS_DDL = """\n-- the three FTS triggers, one per write kind\n'
       'CREATE TRIGGER j2_notes_fts_ai')], "green"),
    ("M15", "COMMENT edit: an SQL comment inside the task trigger DDL (must HOLD)", DB,
     [('_TASK_DIGEST_TRIGGERS_DDL = """CREATE TRIGGER IF NOT EXISTS j2_note_task_digest_ai',
       '_TASK_DIGEST_TRIGGERS_DDL = """-- invalidate on every write\n'
       'CREATE TRIGGER IF NOT EXISTS j2_note_task_digest_ai')], "green"),
    ("M16", "COMMENT edit: a Python comment inside the repair (must HOLD)", DB,
     [('    if not _fts_map_drift(conn):\n        return 0\n',
       '    if not _fts_map_drift(conn):\n        # nothing disagrees: write nothing\n        return 0\n')], "green"),
    ("M17", "test: the SQL normaliser keeps comments (the control must go red)", DV,
     [('    return " ".join(re.sub(r"--[^\\n]*", "", script).split())',
       '    return " ".join(script.split())')], "red"),
    ("M18", "test: the per-door rail drops a door (the census tie must go red)", DV,
     [('        (nb, "append_document_excerpt"): appender(notes_svc.append_document_excerpt, "exc-1"),\n', '')],
     "red"),
]


def sha(b):
    return hashlib.sha256(b).hexdigest()


def blob(path):
    return subprocess.run(["git", "-C", REPO, "cat-file", "blob", f"HEAD:{path}"],
                          capture_output=True, check=True).stdout


def run_pytest():
    env = dict(os.environ)
    env["PYTHONPYCACHEPREFIX"] = tempfile.mkdtemp(prefix="f2mut_pyc_")
    t0 = time.time()
    p = subprocess.run([sys.executable, "-m", "pytest", "-q", "-p", "no:randomly", "-p", "no:cacheprovider",
                        *FILES], cwd=REPO, env=env, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    out = p.stdout + p.stderr
    tot = [l for l in out.splitlines() if re.search(r"\d+ (passed|failed)", l) and " in " in l]
    failed = sorted(set(re.findall(r"^FAILED (\S+)", out, re.M)))
    return p.returncode, (tot[-1].strip() if tot else "NO TOTALS LINE"), failed, round(time.time() - t0, 1)


def main():
    only = set(sys.argv[1:])
    results = []
    for mid, what, path, reps, expect in MUTATIONS:
        if only and mid not in only:
            continue
        full = os.path.join(REPO, path)
        orig = open(full, "rb").read()
        assert orig == blob(path), f"{path} differs from HEAD before {mid}"
        orig_sha = sha(orig)
        text = orig.decode("utf-8")
        for old, new in reps:
            n = text.count(old)
            assert n == 1, f"{mid}: anchor found {n} times: {old[:70]!r}"
            text = text.replace(old, new)
        try:
            open(full, "wb").write(text.encode("utf-8"))
            code, totals, failed, secs = run_pytest()
        finally:
            open(full, "wb").write(orig)
        restored = open(full, "rb").read()
        ok_restore = sha(restored) == orig_sha and restored == blob(path)
        verdict = "red" if code != 0 else "green"
        rec = {"id": mid, "what": what, "file": path, "expect": expect, "got": verdict,
               "as_expected": verdict == expect, "totals": totals, "failed": failed,
               "seconds": secs, "restored_sha256": sha(restored)[:16], "restore_verified": ok_restore}
        results.append(rec)
        print(json.dumps(rec), flush=True)
        assert ok_restore, f"{mid}: RESTORE FAILED"
    st = subprocess.run(["git", "-C", REPO, "status", "--porcelain"], capture_output=True, text=True).stdout
    print("GIT STATUS PORCELAIN LINES:", len([l for l in st.splitlines() if l.strip()]))
    print(st)
    return results


if __name__ == "__main__":
    main()
