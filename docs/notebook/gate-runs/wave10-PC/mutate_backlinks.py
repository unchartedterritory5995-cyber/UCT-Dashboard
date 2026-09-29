"""Lane PC mutation proof for the one-pass backlinks rails. Restores by content hash and proves
the restore against git (status clean), never by git checkout."""
import hashlib, os, re, shutil, subprocess, sys, glob
ROOT = r"C:/Users/Patrick/uct-worktrees/notebook-w10-pc"
TARGET = os.path.join(ROOT, "api/services/journal_two/notes.py")
TESTS = ["tests/test_journal_two_backlinks_one_pass.py", "tests/test_journal_two_notes_read_plans.py"] + (["api/services/journal_two/test_notes.py"] if os.environ.get("PC_FULL") else [])
orig = open(TARGET, "rb").read()
H = hashlib.sha256(orig).hexdigest()
NL = b"\r\n" if b"\r\n" in orig else b"\n"

OLD_COUNT = (b'        row = conn.execute(' + NL +
             b'            f"SELECT COUNT(*) AS c FROM ({ids_sql}) x"' + NL +
             b'            " CROSS JOIN j2_notes n ON n.id = x.note_id"' + NL +
             b'            " WHERE n.user_id = ? AND n.deleted_at IS NULL",' + NL +
             b'            (*ids_params, user_id),' + NL +
             b'        ).fetchone()' + NL +
             b'        out["count"] = int(row["c"] or 0) if row else 0')
MUTS = {
    "M1 total counted AFTER the limit (len of the page)":
        (b'out["count"] = int(rows[0]["total"]) if rows else 0', b'out["count"] = len(rows)'),
    "M2 trashed notes admitted":
        (b'" WHERE n.user_id = ? AND n.deleted_at IS NULL"' + NL + b'            " ORDER BY n.updated_at DESC, n.id"',
         b'" WHERE n.user_id = ?"' + NL + b'            " ORDER BY n.updated_at DESC, n.id"'),
    "M3 no id tiebreak":
        (b'" ORDER BY n.updated_at DESC, n.id"', b'" ORDER BY n.updated_at DESC"'),
    "M4 embed detail not scoped to the member":
        (b'WHERE user_id = ? AND symbol = ? AND note_id IN', b'WHERE (user_id = ? OR 1) AND symbol = ? AND note_id IN'),
    "M5 second COUNT pass restored":
        (b'        out["count"] = int(rows[0]["total"]) if rows else 0', OLD_COUNT),
    "M6 embed detail grouped over every embed of the symbol":
        (b'symbol = ? AND note_id IN ({marks})"', b'symbol = ? AND (note_id IN ({marks}) OR 1)"'),
}

def run():
    for p in glob.glob(os.path.join(ROOT, "api/services/journal_two/__pycache__/notes.*.pyc")):
        os.remove(p)
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    r = subprocess.run([sys.executable, "-B", "-m", "pytest", *TESTS, "-q", "-p", "no:cacheprovider"],
                       cwd=ROOT, capture_output=True, text=True, env=env)
    tail = [l for l in (r.stdout + r.stderr).splitlines() if re.search(r"\d+ (passed|failed)", l)]
    fails = sorted({l.split("::")[-1].split(" ")[0].split("[")[0] for l in r.stdout.splitlines() if l.startswith("FAILED")})
    return r.returncode, (tail[-1] if tail else "NO TOTALS LINE"), fails

def restore():
    with open(TARGET, "wb") as f:
        f.write(orig)
    assert hashlib.sha256(open(TARGET, "rb").read()).hexdigest() == H
    st = subprocess.run(["git", "-C", ROOT, "status", "--porcelain", "--", TARGET], capture_output=True, text=True).stdout
    assert st.strip() == "", st

try:
    print("CONTROL (no mutation):", run(), flush=True)
    for name, (a, b) in MUTS.items():
        if os.environ.get("PC_ONLY") and not name.startswith(os.environ["PC_ONLY"]): continue
        assert orig.count(a) == 1, (name, orig.count(a))
        with open(TARGET, "wb") as f:
            f.write(orig.replace(a, b))
        rc, tot, fails = run()
        restore()
        print(f"{name}: rc={rc} {tot} red={fails}", flush=True)
    print("AFTER (restored):", run())
finally:
    restore()
    print("restored, sha", H[:16], "git status clean")
